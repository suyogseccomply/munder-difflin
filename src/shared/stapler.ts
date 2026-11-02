/** Pure logic for the Stapler: batching shots, regions, and meeting transcripts. */

export const MAX_SHOTS_PER_SEND = 8;
/** Longest clip accepted for one transcription, at 16 kHz. */
export const MAX_TRANSCRIBE_SAMPLES = 16_000 * 60 * 5;
export const STAPLER_SAMPLE_RATE = 16_000;

export type StaplerSpeaker = 'you' | 'them';

export interface TranscriptSegment {
  speaker: StaplerSpeaker;
  /** Milliseconds from the start of the recording. */
  atMs: number;
  text: string;
}

export interface Region { x: number; y: number; width: number; height: number }

/** A dragged rectangle in any direction, kept inside the image. Null if too small
 *  to be a deliberate selection. */
export function normalizeRegion(a: { x: number; y: number }, b: { x: number; y: number }, bounds: { width: number; height: number }): Region | null {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const x1 = clamp(Math.min(a.x, b.x), bounds.width);
  const y1 = clamp(Math.min(a.y, b.y), bounds.height);
  const x2 = clamp(Math.max(a.x, b.x), bounds.width);
  const y2 = clamp(Math.max(a.y, b.y), bounds.height);
  const region = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  return region.width >= 8 && region.height >= 8 ? region : null;
}

/** Adds a shot unless the batch is full. */
export function addShot<T>(shots: readonly T[], shot: T): { shots: T[]; full: boolean } {
  return shots.length >= MAX_SHOTS_PER_SEND ? { shots: [...shots], full: true } : { shots: [...shots, shot], full: false };
}

/** Whisper emits these for silence or noise. They aren't speech, so they're dropped. */
const NON_SPEECH = /^[\s[(]*(blank[ _]audio|silence|music|inaudible|no speech)[\s\])]*\.?$/i;

export function cleanSegmentText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return NON_SPEECH.test(t) ? '' : t;
}

/** Both sides in spoken order. A tie keeps the order given. */
export function mergeSegments(segments: readonly TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .map((s, i) => ({ s, i, text: cleanSegmentText(s.text) }))
    .filter((x) => x.text)
    .sort((a, b) => a.s.atMs - b.s.atMs || a.i - b.i)
    .map((x) => ({ ...x.s, text: x.text }));
}

const clock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
};

/** The editable transcript file. */
export function formatTranscript(segments: readonly TranscriptSegment[]): string {
  return mergeSegments(segments)
    .map((s) => `[${clock(s.atMs)}] ${s.speaker === 'you' ? 'You' : 'Them'}: ${s.text}`)
    .join('\n');
}

/** A folder name safe on every OS, unique per start time. Never `.` or `..`. */
export function meetingFolderName(startedAt: number, title: string): string {
  const stamp = new Date(startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug ? `${stamp}-${slug}` : stamp;
}

/** Whether an id from the renderer is one folder name, so it can't escape the root. */
export function isSafeMeetingId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9]{4}-[0-9-]+[a-z0-9-]*$/.test(id) && id.length <= 80;
}

export interface MeetingSummary {
  id: string;
  title: string;
  startedAt: number;
  transcript: string;
}

export function searchMeetings<T extends MeetingSummary>(meetings: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const hits = q ? meetings.filter((m) => `${m.title}\n${m.transcript}`.toLowerCase().includes(q)) : [...meetings];
  return hits.sort((a, b) => b.startedAt - a.startedAt);
}

/** The keystroke that pastes into the focused app. Null where nothing can send it. */
export function pasteCommand(platform: string): { command: string; args: string[] } | null {
  if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', "(New-Object -ComObject WScript.Shell).SendKeys('^v')"] };
  if (platform === 'darwin') return { command: 'osascript', args: ['-e', 'tell application "System Events" to keystroke "v" using command down'] };
  if (platform === 'linux') return { command: 'xdotool', args: ['key', '--clearmodifiers', 'ctrl+v'] };
  return null;
}
