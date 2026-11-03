import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { addShot, mergeSegments, normalizeRegion, searchMeetings, type MeetingSummary, type Region, type TranscriptSegment } from '@shared/stapler';
import { TEMP_TARGET, cloneTarget } from '@shared/tempRouting';
import { faceFromWord, ringPositions } from '@shared/staplerExtras';
import { ClipRecorder, decodeToSamples, hasSound } from './audio';

type Mode = 'menu' | 'shot' | 'meeting' | 'message' | 'meetings';
interface Shot { path: string; preview: string }
interface Target { id: string; name: string }
interface Capture { dataUrl: string; width: number; height: number }

const REGION_KEY = 'cth.stapler.lastRegion';
const FACE_KEY = 'cth.stapler.faceWord';
const TARGET_KEY = 'cth.stapler.lastTarget';
const CLIP_MS = 20_000;

const panel: CSSProperties = { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-500)', fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink-900)', overflow: 'auto', boxSizing: 'border-box' };
const button: CSSProperties = { padding: '6px 10px', border: 'none', cursor: 'pointer', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)', fontSize: 13, textAlign: 'start' };
const primary: CSSProperties = { ...button, background: 'var(--cth-ink-900)', color: 'var(--cth-paper-100)', textAlign: 'center' };
const muted: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-500)', lineHeight: '16px' };
const field: CSSProperties = { padding: '5px 8px', border: 'none', outline: 'none', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink-900)', boxSizing: 'border-box', width: '100%' };

const micStream = () => navigator.mediaDevices.getUserMedia({ audio: true });

async function transcribeBlob(blob: Blob): Promise<string> {
  const samples = await decodeToSamples(blob);
  if (!hasSound(samples)) return '';
  const res = await window.cth.staplerTranscribe(samples);
  if (!res.ok) throw new Error(res.error);
  return res.text;
}

export function StaplerApp() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('menu');
  const [invisible, setInvisible] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [target, setTargetState] = useState(() => localStorage.getItem(TARGET_KEY) ?? 'god');
  const setTarget = (v: string) => { setTargetState(v); localStorage.setItem(TARGET_KEY, v); };
  const [note, setNote] = useState('');
  const [faceWord, setFaceWord] = useState(() => localStorage.getItem(FACE_KEY) ?? 'stapler');

  // The window is transparent; only the panel or the mascot should paint.
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, []);

  useEffect(() => {
    if (!open) return;
    void window.cth.hiveRegistry().then((reg) => {
      const agents = Object.values((reg as { agents?: Record<string, { id: string; name: string; archived?: boolean }> }).agents ?? {});
      setTargets(agents.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name })));
    }).catch(() => setTargets([]));
  }, [open]);

  const expand = (v: boolean) => { setOpen(v); void window.cth.staplerExpand(v); };
  const send = useCallback(async (subject: string, body: string): Promise<boolean> => {
    const res = await window.cth.routingSend({ to: target, subject, body });
    setNote(res.ok ? t('stapler.sent') : (res.error ?? t('stapler.failed')));
    return res.ok;
  }, [target, t]);

  const dictation = useDictation(setNote, setInvisible);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => expand(true)}
        aria-label={t('stapler.open')}
        style={{ position: 'fixed', inset: 6, border: 'none', borderRadius: '50%', cursor: 'pointer', background: dictation ? 'var(--cth-coral)' : 'var(--cth-lemon)', boxShadow: 'inset 0 0 0 2px var(--cth-ink-900)', fontSize: 26, color: 'var(--cth-ink-900)' }}
      >
        {dictation ? <span aria-hidden>●</span> : <StaplerFace word={faceWord} size={52} />}
      </button>
    );
  }

  return (
    <div style={panel}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ flex: 1, fontSize: 14 }}>{t('stapler.title')}</strong>
        {mode !== 'menu' && <button type="button" style={button} onClick={() => { setMode('menu'); setNote(''); }}>{t('stapler.back')}</button>}
        <button type="button" style={button} onClick={() => expand(false)}>{t('stapler.minimize')}</button>
      </div>

      <label style={{ ...muted, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {t('stapler.sendTo')}
        <select value={target} onChange={(e) => setTarget(e.target.value)} style={field}>
          <option value="god">{t('stapler.orchestrator')}</option>
          {targets.filter((x) => x.id !== 'god').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          <option value={TEMP_TARGET}>{t('tempRouting.aTemp')}</option>
          {targets.map((x) => <option key={`clone-${x.id}`} value={cloneTarget(x.id)}>{t('tempRouting.cloneOf', { name: x.name })}</option>)}
        </select>
      </label>

      {mode === 'menu' && (
        <>
          <Ring
            face={<StaplerFace word={faceWord} size={64} />}
            actions={[
              { label: t('stapler.screenshot'), run: () => setMode('shot') },
              { label: t('stapler.meeting'), run: () => setMode('meeting') },
              { label: t('stapler.message'), run: () => setMode('message') },
              { label: t('stapler.meetings'), run: () => setMode('meetings') },
              { label: invisible ? t('stapler.visibleAgain') : t('stapler.makeInvisible'), run: () => { const next = !invisible; setInvisible(next); void window.cth.staplerSetInvisible(next); } }
            ]}
          />
          <label style={{ ...muted, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {t('stapler.faceWord')}
            <input
              value={faceWord}
              onChange={(e) => { setFaceWord(e.target.value); localStorage.setItem(FACE_KEY, e.target.value); }}
              style={field}
            />
          </label>
          <span style={muted}>{invisible ? t('stapler.hiddenNow') : t('stapler.invisibleHint')}</span>
          <span style={muted}>{t('stapler.dictateHint')}</span>
        </>
      )}
      {mode === 'shot' && <ShotMode onSend={send} />}
      {mode === 'meeting' && <MeetingMode onSend={send} setInvisible={setInvisible} />}
      {mode === 'message' && <MessageMode onSend={send} />}
      {mode === 'meetings' && <MeetingsMode onSend={send} />}

      {note && <span role="status" style={{ fontSize: 12 }}>{note}</span>}
    </div>
  );
}

/** Drawn from a word, so everyone's Stapler can look different. Original to this app. */
function StaplerFace({ word, size }: { word: string; size: number }) {
  const f = faceFromWord(word);
  const cx = 32;
  const eyeY = 26;
  const mouth = {
    smile: 'M23 41 Q32 49 41 41',
    flat: 'M24 43 L40 43',
    open: 'M27 40 Q32 50 37 40 Z',
    smirk: 'M24 43 Q34 46 41 38'
  }[f.mouth];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden style={{ display: 'block' }}>
      <ellipse cx={cx} cy={32} rx={26 + f.wobble / 3} ry={26 - f.wobble / 3} fill={`hsl(${f.hue} 70% 72%)`} stroke="#1a1320" strokeWidth={2} />
      {f.blush && <><circle cx={cx - 15} cy={36} r={4} fill="#f4a0a0" opacity={0.7} /><circle cx={cx + 15} cy={36} r={4} fill="#f4a0a0" opacity={0.7} /></>}
      <circle cx={cx - f.eyeGap} cy={eyeY} r={f.eyeSize} fill="#1a1320" />
      <circle cx={cx + f.eyeGap} cy={eyeY} r={f.eyeSize} fill="#1a1320" />
      <path d={mouth} fill={f.mouth === 'open' ? '#1a1320' : 'none'} stroke="#1a1320" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

/** The actions around the face. Each is a real button, in reading order for the keyboard. */
function Ring({ face, actions }: { face: React.ReactNode; actions: { label: string; run: () => void }[] }) {
  const spots = ringPositions(actions.length, 108);
  const SIZE = 300;
  return (
    <div style={{ position: 'relative', width: SIZE, height: SIZE, alignSelf: 'center', flexShrink: 0 }}>
      <div style={{ position: 'absolute', left: SIZE / 2 - 32, top: SIZE / 2 - 32 }}>{face}</div>
      {actions.map((a, i) => (
        <button
          key={a.label}
          type="button"
          onClick={a.run}
          style={{ position: 'absolute', left: SIZE / 2 + spots[i].x - 42, top: SIZE / 2 + spots[i].y - 42, width: 84, height: 84, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 6, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-500)', color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)', fontSize: 11, lineHeight: '13px' }}
        >{a.label}</button>
      ))}
    </div>
  );
}

/** Hold the keys to record, let go to type the result at the cursor. If the key hook
 *  couldn't load, main sends a toggle instead. */
function useDictation(setNote: (s: string) => void, setInvisible: (v: boolean) => void): boolean {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const session = useRef<{ recorder: MediaRecorder; parts: Blob[]; stream: MediaStream } | null>(null);

  useEffect(() => {
    const stop = (): void => {
      const current = session.current;
      if (!current) return;
      session.current = null;
      setActive(false);
      current.recorder.onstop = () => {
        current.stream.getTracks().forEach((x) => x.stop());
        void transcribeBlob(new Blob(current.parts, { type: 'audio/webm' }))
          .then(async (text) => {
            if (!text) { setNote(t('stapler.heardNothing')); return; }
            const res = await window.cth.staplerTypeText(text);
            if (!res.ok) setNote(res.error ?? t('stapler.failed'));
          })
          .catch((e) => setNote(String(e)));
      };
      current.recorder.stop();
    };
    const start = (): void => {
      if (session.current) return;
      void micStream().then((stream) => {
        const parts: Blob[] = [];
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
        recorder.start();
        session.current = { recorder, parts, stream };
        setActive(true);
      }).catch(() => setNote(t('stapler.noMic')));
    };
    const offToggle = window.cth.onStaplerDictateToggle(() => { if (session.current) stop(); else start(); });
    const offHold = window.cth.onStaplerDictate((what) => { if (what === 'start') start(); else stop(); });
    return () => { offToggle(); offHold(); };
  }, [setNote, setInvisible, t]);
  return active;
}

function ShotMode({ onSend }: { onSend: (subject: string, body: string) => Promise<boolean> }) {
  const { t } = useTranslation();
  const [shots, setShots] = useState<Shot[]>([]);
  const [attached, setAttached] = useState<string[]>([]);
  const [text, setText] = useState('');
  const attach = async (folder: boolean) => {
    const paths = await window.cth.staplerPickFiles(folder);
    setAttached((cur) => [...new Set([...cur, ...paths])]);
  };
  const [capture, setCapture] = useState<Capture | null>(null);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [error, setError] = useState('');
  const image = useRef<HTMLImageElement | null>(null);
  const last = (): Region | null => {
    try { return JSON.parse(localStorage.getItem(REGION_KEY) ?? 'null') as Region | null; } catch { return null; }
  };

  const begin = async () => {
    setError('');
    const res = await window.cth.staplerCapture();
    if (res.ok) setCapture(res); else setError(res.error);
  };
  const end = () => { setCapture(null); setDrag(null); void window.cth.staplerEndCapture(); };

  const crop = async (region: Region) => {
    const img = image.current;
    if (!img || !capture) return;
    const canvas = document.createElement('canvas');
    canvas.width = region.width;
    canvas.height = region.height;
    canvas.getContext('2d')?.drawImage(img, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
    const preview = canvas.toDataURL('image/png');
    localStorage.setItem(REGION_KEY, JSON.stringify(region));
    end();
    const res = await window.cth.staplerSaveShot(preview);
    if (!res.ok) { setError(res.error); return; }
    const next = addShot(shots, { path: res.path, preview });
    setShots(next.shots);
    if (next.full) setError(t('stapler.batchFull'));
  };

  if (capture) {
    const scale = () => capture.width / (image.current?.clientWidth || capture.width);
    const at = (e: MouseEvent) => {
      const box = image.current!.getBoundingClientRect();
      return { x: (e.clientX - box.left) * scale(), y: (e.clientY - box.top) * scale() };
    };
    const shown = drag && normalizeRegion(drag.a, drag.b, capture);
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000', cursor: 'crosshair', zIndex: 10 }}>
        <img
          ref={image}
          src={capture.dataUrl}
          alt=""
          draggable={false}
          style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
          onMouseDown={(e) => { const p = at(e); setDrag({ a: p, b: p }); }}
          onMouseMove={(e) => { if (drag) setDrag({ a: drag.a, b: at(e) }); }}
          onMouseUp={(e) => {
            if (!drag) return;
            const region = normalizeRegion(drag.a, at(e), capture);
            setDrag(null);
            if (region) void crop(region);
          }}
        />
        {shown && (
          <div style={{ position: 'absolute', pointerEvents: 'none', left: shown.x / scale(), top: shown.y / scale(), width: shown.width / scale(), height: shown.height / scale(), boxShadow: '0 0 0 2px var(--cth-coral), 0 0 0 9999px rgba(0,0,0,0.35)' }} />
        )}
        <div style={{ position: 'absolute', top: 12, insetInlineStart: 12, display: 'flex', gap: 8 }}>
          <button type="button" style={button} onClick={end}>{t('stapler.cancel')}</button>
          {last() && <button type="button" style={button} onClick={() => void crop(last()!)}>{t('stapler.useLast')}</button>}
          <span style={{ ...button, cursor: 'default' }}>{t('stapler.dragHint')}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <button type="button" style={button} onClick={() => void begin()} disabled={shots.length >= 8}>{t('stapler.takeShot', { count: shots.length })}</button>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {shots.map((s, i) => <img key={s.path} src={s.preview} alt={t('stapler.shotAlt', { n: i + 1 })} style={{ width: 72, height: 48, objectFit: 'cover', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }} />)}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" style={button} onClick={() => void attach(false)}>{t('stapler.attachFiles')}</button>
        <button type="button" style={button} onClick={() => void attach(true)}>{t('stapler.attachFolder')}</button>
      </div>
      {attached.map((p) => <span key={p} style={{ ...muted, overflowWrap: 'anywhere' }}>{p}</span>)}
      <span style={muted}>{t('stapler.shotsExpire')}</span>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('stapler.addNote')} aria-label={t('stapler.addNote')} rows={3} style={field} />
      <button
        type="button"
        style={primary}
        disabled={shots.length === 0 && attached.length === 0}
        onClick={() => void onSend(t('stapler.shotsSubject', { count: shots.length + attached.length }), [text.trim(), ...shots.map((s) => `Screenshot: ${s.path}`), ...attached.map((p) => `Attached: ${p}`)].filter(Boolean).join('\n')).then((ok) => { if (ok) { setShots([]); setAttached([]); setText(''); } })}
      >
        {t('stapler.send')}
      </button>
      {error && <span style={{ fontSize: 12, color: 'var(--cth-coral)' }}>{error}</span>}
    </>
  );
}

function MessageMode({ onSend }: { onSend: (subject: string, body: string) => Promise<boolean> }) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const session = useRef<{ recorder: MediaRecorder; parts: Blob[]; stream: MediaStream } | null>(null);

  const toggle = async () => {
    setError('');
    if (session.current) {
      const s = session.current;
      session.current = null;
      setRecording(false);
      setBusy(true);
      s.recorder.onstop = () => {
        s.stream.getTracks().forEach((x) => x.stop());
        void transcribeBlob(new Blob(s.parts, { type: 'audio/webm' }))
          .then((said) => { if (said) setText((cur) => [cur, said].filter(Boolean).join(' ')); else setError(t('stapler.heardNothing')); })
          .catch((e) => setError(String(e)))
          .finally(() => setBusy(false));
      };
      s.recorder.stop();
      return;
    }
    try {
      const stream = await micStream();
      const parts: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      recorder.start();
      session.current = { recorder, parts, stream };
      setRecording(true);
    } catch { setError(t('stapler.noMic')); }
  };

  return (
    <>
      <button type="button" style={button} onClick={() => void toggle()} disabled={busy}>
        {busy ? t('stapler.transcribing') : recording ? t('stapler.stopRecording') : t('stapler.startRecording')}
      </button>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('stapler.transcriptHere')} aria-label={t('stapler.transcriptHere')} rows={6} style={field} />
      <button type="button" style={primary} disabled={!text.trim() || recording || busy} onClick={() => void onSend(t('stapler.messageSubject'), text.trim()).then((ok) => { if (ok) setText(''); })}>{t('stapler.send')}</button>
      {error && <span style={{ fontSize: 12, color: 'var(--cth-coral)' }}>{error}</span>}
    </>
  );
}

function MeetingMode({ onSend, setInvisible }: { onSend: (subject: string, body: string) => Promise<boolean>; setInvisible: (v: boolean) => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [state, setState] = useState<'idle' | 'recording' | 'finishing' | 'done'>('idle');
  const [themMissing, setThemMissing] = useState(false);
  const [error, setError] = useState('');
  const [savedPath, setSavedPath] = useState('');
  const run = useRef<{ startedAt: number; recorders: ClipRecorder[]; collected: TranscriptSegment[] } | null>(null);

  const start = async () => {
    setError('');
    setSegments([]);
    let mic: MediaStream;
    try { mic = await micStream(); } catch { setError(t('stapler.noMic')); return; }
    const startedAt = Date.now();
    const collected: TranscriptSegment[] = [];
    const onClip = (speaker: 'you' | 'them') => async (blob: Blob, at: number) => {
      try {
        const text = await transcribeBlob(blob);
        if (text) { collected.push({ speaker, atMs: at - startedAt, text }); setSegments(mergeSegments(collected)); }
      } catch (e) { setError(String(e)); }
    };
    const recorders = [new ClipRecorder(mic, CLIP_MS, onClip('you'))];
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      display.getVideoTracks().forEach((x) => x.stop());
      if (display.getAudioTracks().length) recorders.push(new ClipRecorder(new MediaStream(display.getAudioTracks()), CLIP_MS, onClip('them')));
      else setThemMissing(true);
    } catch { setThemMissing(true); }
    recorders.forEach((r) => r.start());
    run.current = { startedAt, recorders, collected };
    // A recording window shouldn't appear in the screen share it is recording.
    setInvisible(true);
    void window.cth.staplerSetInvisible(true);
    setState('recording');
  };

  const stop = async () => {
    const current = run.current;
    if (!current) return;
    run.current = null;
    setState('finishing');
    await Promise.all(current.recorders.map((r) => r.stop()));
    setInvisible(false);
    void window.cth.staplerSetInvisible(false);
    const res = await window.cth.staplerSaveMeeting({ title, startedAt: current.startedAt, segments: current.collected });
    if (res.ok) setSavedPath(res.path); else setError(res.error);
    setSegments(mergeSegments(current.collected));
    setState('done');
  };

  return (
    <>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('stapler.meetingTitle')} aria-label={t('stapler.meetingTitle')} disabled={state !== 'idle' && state !== 'done'} style={field} />
      {state === 'idle' && <span style={{ ...muted, color: 'var(--cth-ink-700)' }}>{t('stapler.consent')}</span>}
      {state === 'recording' && <span role="status" style={{ fontSize: 13, color: 'var(--cth-coral)', fontWeight: 600 }}>● {t('stapler.recordingNow')}</span>}
      {themMissing && <span style={muted}>{t('stapler.themMissing')}</span>}
      {(state === 'idle' || state === 'done') && <button type="button" style={primary} onClick={() => void start()}>{t('stapler.startMeeting')}</button>}
      {state === 'recording' && <button type="button" style={primary} onClick={() => void stop()}>{t('stapler.stopMeeting')}</button>}
      {state === 'finishing' && <span style={muted}>{t('stapler.transcribing')}</span>}
      <div style={{ flex: 1, minHeight: 80, overflow: 'auto', fontSize: 12, lineHeight: '17px' }}>
        {segments.map((s, i) => <div key={i}><strong>{s.speaker === 'you' ? t('stapler.you') : t('stapler.them')}:</strong> {s.text}</div>)}
      </div>
      {state === 'done' && segments.length > 0 && (
        <button type="button" style={button} onClick={() => void onSend(t('stapler.describeSubject', { title: title || t('stapler.untitled') }), `Read this meeting transcript and write a short description next to it, as description.md in the same folder: what it was about, decisions, and who is doing what next. Transcript: ${savedPath}`)}>{t('stapler.describe')}</button>
      )}
      {state === 'done' && segments.length > 0 && (
        <button type="button" style={button} onClick={() => void onSend(t('stapler.meetingSubject', { title: title || t('stapler.untitled') }), `Transcript: ${savedPath}\n\n${segments.map((s) => `${s.speaker === 'you' ? 'You' : 'Them'}: ${s.text}`).join('\n')}`)}>{t('stapler.sendTranscript')}</button>
      )}
      {error && <span style={{ fontSize: 12, color: 'var(--cth-coral)' }}>{error}</span>}
    </>
  );
}

function MeetingsMode({ onSend }: { onSend: (subject: string, body: string) => Promise<boolean> }) {
  const { t, i18n } = useTranslation();
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<MeetingSummary | null>(null);
  useEffect(() => { void window.cth.staplerListMeetings().then(setMeetings); }, [editing]);
  const hits = useMemo(() => searchMeetings(meetings, query), [meetings, query]);

  if (editing) {
    return (
      <>
        <strong style={{ fontSize: 13 }}>{editing.title}</strong>
        <textarea value={editing.transcript} onChange={(e) => setEditing({ ...editing, transcript: e.target.value })} aria-label={editing.title} rows={12} style={{ ...field, flex: 1 }} />
        <button type="button" style={primary} onClick={() => void window.cth.staplerUpdateTranscript(editing.id, editing.transcript).then(() => setEditing(null))}>{t('stapler.save')}</button>
        <button type="button" style={button} onClick={() => void onSend(t('stapler.meetingSubject', { title: editing.title }), editing.transcript)}>{t('stapler.sendTranscript')}</button>
      </>
    );
  }
  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('stapler.searchMeetings')} aria-label={t('stapler.searchMeetings')} style={field} />
      {hits.length === 0 && <span style={muted}>{t('stapler.noMeetings')}</span>}
      {hits.map((m) => (
        <button key={m.id} type="button" style={button} onClick={() => setEditing(m)}>
          <div>{m.title}</div>
          <div style={muted}>{new Date(m.startedAt).toLocaleString(i18n.language)}</div>
        </button>
      ))}
    </>
  );
}
