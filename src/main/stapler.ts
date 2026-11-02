/**
 * The Stapler: a small always-on-top window that catches screenshots, meetings,
 * voice messages and dictation, and hands them to an agent. It runs in its own
 * session, so the main window's mic gate is untouched and microphone access exists
 * only while this window does.
 */
import { BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, screen, session, app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_MODELS, transcribeLocally, type LocalModel } from './localTranscribe';
import {
  STAPLER_SAMPLE_RATE,
  formatTranscript,
  isSafeMeetingId,
  meetingFolderName,
  pasteCommand,
  type MeetingSummary,
  type TranscriptSegment
} from '../shared/stapler';

export const DICTATION_SHORTCUT = 'CommandOrControl+Alt+Space';
const COLLAPSED = { width: 76, height: 76 };
const EXPANDED = { width: 380, height: 560 };

export interface StaplerDeps {
  preloadPath: string;
  rendererUrl?: string;
  rendererFile: string;
  hiveRoot: () => string | null;
  localModel: () => LocalModel;
}

let win: BrowserWindow | null = null;
let deps: StaplerDeps | null = null;
let restoreBounds: Electron.Rectangle | null = null;

const shotsDir = (): string | null => { const r = deps?.hiveRoot(); return r ? join(r, 'stapler', 'shots') : null; };
const meetingsDir = (): string | null => { const r = deps?.hiveRoot(); return r ? join(r, 'stapler', 'meetings') : null; };

function readMeeting(root: string, id: string): MeetingSummary | null {
  try {
    const meta = JSON.parse(readFileSync(join(root, id, 'meeting.json'), 'utf8')) as { title?: string; startedAt?: number };
    return {
      id,
      title: typeof meta.title === 'string' ? meta.title : id,
      startedAt: typeof meta.startedAt === 'number' ? meta.startedAt : 0,
      transcript: readFileSync(join(root, id, 'transcript.md'), 'utf8')
    };
  } catch {
    return null;
  }
}

function createWindow(): BrowserWindow {
  const ses = session.fromPartition('persist:stapler');
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media' || permission === 'clipboard-read'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  // The other side of a meeting. Video is required by the API and discarded by the
  // renderer. Windows captures system audio directly; elsewhere this may fail, and
  // the meeting carries on with the microphone only.
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources[0]) callback({ video: sources[0], audio: 'loopback' });
      else callback({});
    }).catch(() => callback({}));
  });

  const area = screen.getPrimaryDisplay().workArea;
  const next = new BrowserWindow({
    ...COLLAPSED,
    x: area.x + area.width - COLLAPSED.width - 24,
    y: area.y + area.height - COLLAPSED.height - 24,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: deps!.preloadPath, sandbox: true, contextIsolation: true, partition: 'persist:stapler' }
  });
  next.setAlwaysOnTop(true, 'floating');
  if (deps!.rendererUrl) void next.loadURL(`${deps!.rendererUrl}#stapler`);
  else void next.loadFile(deps!.rendererFile, { hash: 'stapler' });
  next.on('closed', () => {
    win = null;
    restoreBounds = null;
    if (globalShortcut.isRegistered(DICTATION_SHORTCUT)) globalShortcut.unregister(DICTATION_SHORTCUT);
  });
  globalShortcut.register(DICTATION_SHORTCUT, () => {
    if (win && !win.isDestroyed()) win.webContents.send('stapler:dictateToggle');
  });
  return next;
}

/** Registers the Stapler's IPC. The window itself opens on request. */
export function initStapler(d: StaplerDeps): void {
  deps = d;

  ipcMain.handle('stapler:toggle', () => {
    if (win && !win.isDestroyed()) { win.close(); return false; }
    win = createWindow();
    return true;
  });
  ipcMain.handle('stapler:isOpen', () => !!win && !win.isDestroyed());
  ipcMain.handle('stapler:close', () => { if (win && !win.isDestroyed()) win.close(); });

  ipcMain.handle('stapler:expand', (_e, expanded: unknown) => {
    if (!win || win.isDestroyed()) return;
    const size = expanded === true ? EXPANDED : COLLAPSED;
    const b = win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    // Anchored at the bottom right, so it grows into the screen and not off it.
    const x = Math.max(area.x, Math.min(b.x + b.width - size.width, area.x + area.width - size.width));
    const y = Math.max(area.y, Math.min(b.y + b.height - size.height, area.y + area.height - size.height));
    win.setResizable(true);
    win.setBounds({ x, y, ...size });
    win.setResizable(false);
  });

  /** Hides the window for the capture, then fills the display for region picking. */
  ipcMain.handle('stapler:capture', async () => {
    if (!win || win.isDestroyed()) return { ok: false as const, error: 'not open' };
    restoreBounds = win.getBounds();
    const display = screen.getDisplayMatching(restoreBounds);
    win.hide();
    await new Promise((r) => setTimeout(r, 180));
    try {
      const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
      if (!source) return { ok: false as const, error: 'no screen found' };
      win.setResizable(true);
      win.setBounds(display.bounds);
      return { ok: true as const, dataUrl: source.thumbnail.toDataURL(), width: size.width, height: size.height };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    } finally {
      win.show();
    }
  });

  ipcMain.handle('stapler:endCapture', () => {
    if (!win || win.isDestroyed() || !restoreBounds) return;
    win.setBounds(restoreBounds);
    win.setResizable(false);
    restoreBounds = null;
  });

  /** Writes a cropped PNG into the hive, where agents can read it. */
  ipcMain.handle('stapler:saveShot', (_e, dataUrl: unknown) => {
    const dir = shotsDir();
    if (!dir) return { ok: false as const, error: 'no hive open' };
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return { ok: false as const, error: 'not a png' };
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
    writeFileSync(path, Buffer.from(dataUrl.slice(22), 'base64'));
    return { ok: true as const, path };
  });

  ipcMain.handle('stapler:transcribe', (_e, samples: unknown) => {
    if (!(samples instanceof Float32Array)) return { ok: false as const, error: 'bad audio' };
    return transcribeLocally(samples, deps!.localModel(), join(app.getPath('userData'), 'whisper-models'));
  });
  ipcMain.handle('stapler:modelInfo', () => ({ sampleRate: STAPLER_SAMPLE_RATE, model: LOCAL_MODELS[deps!.localModel()] }));

  /** Drops out of screen shares where the OS allows it (Windows and macOS). */
  ipcMain.handle('stapler:setInvisible', (_e, on: unknown) => {
    if (win && !win.isDestroyed()) win.setContentProtection(on === true);
    return process.platform === 'win32' || process.platform === 'darwin';
  });

  /** Pastes at the cursor, then puts the user's clipboard back. */
  ipcMain.handle('stapler:typeText', async (_e, text: unknown) => {
    if (typeof text !== 'string' || !text.trim()) return { ok: false as const, error: 'nothing to type' };
    const saved = clipboard.readText();
    clipboard.writeText(text);
    const cmd = pasteCommand(process.platform);
    if (!cmd) return { ok: false as const, error: 'typing is not supported here. The text is on your clipboard.' };
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const child = spawn(cmd.command, cmd.args, { stdio: 'ignore', windowsHide: true });
      child.once('error', () => resolve({ ok: false, error: `could not run ${cmd.command}. The text is on your clipboard.` }));
      child.once('exit', (code) => {
        if (code !== 0) { resolve({ ok: false, error: `${cmd.command} failed. The text is on your clipboard.` }); return; }
        // Long enough for the target app to read it before it changes back.
        setTimeout(() => { clipboard.writeText(saved); resolve({ ok: true }); }, 400);
      });
    });
  });

  ipcMain.handle('stapler:saveMeeting', (_e, payload: unknown) => {
    const root = meetingsDir();
    if (!root) return { ok: false as const, error: 'no hive open' };
    const p = (payload ?? {}) as { title?: unknown; startedAt?: unknown; segments?: unknown };
    const startedAt = typeof p.startedAt === 'number' ? p.startedAt : Date.now();
    const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 120) : 'Meeting';
    const segments = (Array.isArray(p.segments) ? p.segments : []).filter((s): s is TranscriptSegment =>
      !!s && typeof s === 'object' && (s.speaker === 'you' || s.speaker === 'them') && typeof s.atMs === 'number' && typeof s.text === 'string');
    const id = meetingFolderName(startedAt, title);
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meeting.json'), JSON.stringify({ title, startedAt, segments }, null, 2));
    writeFileSync(join(dir, 'transcript.md'), formatTranscript(segments));
    return { ok: true as const, id, path: join(dir, 'transcript.md') };
  });

  ipcMain.handle('stapler:listMeetings', (): MeetingSummary[] => {
    const root = meetingsDir();
    if (!root || !existsSync(root)) return [];
    return readdirSync(root).filter(isSafeMeetingId).flatMap((id) => {
      const m = readMeeting(root, id);
      return m ? [m] : [];
    });
  });

  ipcMain.handle('stapler:updateTranscript', (_e, id: unknown, text: unknown) => {
    const root = meetingsDir();
    if (!root || !isSafeMeetingId(id) || typeof text !== 'string' || !existsSync(join(root, id))) return { ok: false };
    writeFileSync(join(root, id, 'transcript.md'), text);
    return { ok: true };
  });
}

export function shutdownStapler(): void {
  if (globalShortcut.isRegistered(DICTATION_SHORTCUT)) globalShortcut.unregister(DICTATION_SHORTCUT);
  if (win && !win.isDestroyed()) win.close();
}
