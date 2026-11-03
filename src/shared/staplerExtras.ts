/** Pure logic for hold-to-talk, screenshot cleanup, the ring, the face and team replies. */

// ─── Hold to talk ───────────────────────────────────────────────────────────

/** Key groups the hold combination is made of. Either side's Ctrl or Alt counts. */
export type HoldKey = 'ctrl' | 'alt' | 'space';
export interface HoldState { ctrl: boolean; alt: boolean; space: boolean; active: boolean }
export const newHoldState = (): HoldState => ({ ctrl: false, alt: false, space: false, active: false });

/** One key change. Starts once all three are down, stops when any comes up. Auto-repeat
 *  from a held key changes nothing, so it can't restart a recording. */
export function holdStep(state: HoldState, key: HoldKey, down: boolean): { state: HoldState; action: 'start' | 'stop' | null } {
  const next: HoldState = { ...state, [key]: down };
  const all = next.ctrl && next.alt && next.space;
  if (all && !state.active) return { state: { ...next, active: true }, action: 'start' };
  if (!all && state.active) return { state: { ...next, active: false }, action: 'stop' };
  return { state: next, action: null };
}

/** Which combination key a hook keycode is. Null for every other key, which are
 *  dropped at once: the hook never records or forwards what is typed. */
export function holdKeyFor(keycode: number, codes: { ctrl: number[]; alt: number[]; space: number }): HoldKey | null {
  if (codes.ctrl.includes(keycode)) return 'ctrl';
  if (codes.alt.includes(keycode)) return 'alt';
  return keycode === codes.space ? 'space' : null;
}

// ─── Screenshot cleanup ─────────────────────────────────────────────────────

export const SHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const expiredFiles = <T extends { mtimeMs: number }>(files: readonly T[], now: number): T[] =>
  files.filter((f) => now - f.mtimeMs > SHOT_MAX_AGE_MS);

// ─── The ring ───────────────────────────────────────────────────────────────

/** Positions evenly around a circle, starting at the top. */
export function ringPositions(count: number, radius: number): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
    return { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) };
  });
}

// ─── The face ───────────────────────────────────────────────────────────────

export interface FaceSpec {
  hue: number;
  eyeGap: number;
  eyeSize: number;
  mouth: 'smile' | 'flat' | 'open' | 'smirk';
  wobble: number;
  blush: boolean;
}

const hash = (word: string): number => {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) { h ^= word.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/** The same word always draws the same face. */
export function faceFromWord(word: string): FaceSpec {
  const h = hash(word.trim().toLowerCase() || 'stapler');
  const mouths: FaceSpec['mouth'][] = ['smile', 'flat', 'open', 'smirk'];
  return {
    hue: h % 360,
    eyeGap: 7 + ((h >>> 9) % 6),
    eyeSize: 2 + ((h >>> 13) % 3),
    mouth: mouths[(h >>> 16) % 4],
    wobble: (h >>> 19) % 7,
    blush: ((h >>> 23) & 1) === 1
  };
}

// ─── Team replies ───────────────────────────────────────────────────────────

const TEAM_REPLY = /^\[team-reply ([a-f0-9]{40})\]/;

/** The office a message's subject says it's a draft reply to, or null. */
export const teamReplyTarget = (subject: unknown): string | null =>
  (typeof subject === 'string' ? TEAM_REPLY.exec(subject)?.[1] ?? null : null);

/** The instruction added to a teammate's message when an agent answers them. */
export const teamReplyHowTo = (officeId: string): string =>
  `To draft a reply, send a message to "human" with the subject exactly "[team-reply ${officeId}]" and your reply as the body. Your operator approves it before it goes out, so don't promise that it has been sent.`;

/** Only whoever answers this teammate can draft for them: the named agent, or a temp
 *  when a temp answers. Any other sender's draft is dropped. */
export function mayDraftFor(answeredBy: 'you' | { agentId: string }, from: string): boolean {
  if (answeredBy === 'you') return false;
  return answeredBy.agentId === 'temp' || answeredBy.agentId.startsWith('temp:')
    ? from.startsWith('worker-')
    : answeredBy.agentId === from;
}
