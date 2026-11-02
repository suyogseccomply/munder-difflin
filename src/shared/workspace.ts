/** Pure logic behind the Pro workspace screens, kept here so it can be tested. */

export type WorkspaceView = 'classic' | 'workspace';

/** Anything but the explicit value is Classic, so existing installs don't change. */
export const normalizeWorkspaceView = (v: unknown): WorkspaceView => (v === 'workspace' ? 'workspace' : 'classic');

export type WorkspaceScreen =
  | 'orchestrator' | 'agents' | 'tasks' | 'inbox' | 'automations' | 'memory' | 'capabilities' | 'temps' | 'team';

// ─── Tasks ──────────────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done';
export const TASK_COLUMNS: readonly TaskStatus[] = ['todo', 'doing', 'blocked', 'done'];

const STALE_MS = 3 * 24 * 60 * 60 * 1000;

/** Tasks carry no updated time, so stale means open and created over 3 days ago. */
export function isStaleTask(task: { status: TaskStatus; createdAt: string }, now: number): boolean {
  if (task.status === 'done') return false;
  const created = Date.parse(task.createdAt);
  return Number.isFinite(created) && now - created > STALE_MS;
}

export interface StagedMove { taskId: string; title: string; to: TaskStatus }

/** Stage a move. Moving a card back where it started unstages it. */
export function stageMove(moves: readonly StagedMove[], task: { id: string; title: string; status: TaskStatus }, to: TaskStatus): StagedMove[] {
  const rest = moves.filter((m) => m.taskId !== task.id);
  return to === task.status ? rest : [...rest, { taskId: task.id, title: task.title, to }];
}

/** One column left or right, stopping at the ends. */
export function shiftColumn(current: TaskStatus, direction: -1 | 1): TaskStatus {
  const i = TASK_COLUMNS.indexOf(current);
  return TASK_COLUMNS[Math.min(TASK_COLUMNS.length - 1, Math.max(0, i + direction))];
}

/** The message that hands staged moves to the orchestrator in one go. */
export function stagedMovesMessage(moves: readonly StagedMove[]): string {
  return [
    'The human moved these task cards. Update the board and tell the owners:',
    ...moves.map((m) => `- ${m.taskId} "${m.title.replace(/[\r\n]+/g, ' ')}" -> ${m.to}`)
  ].join('\n');
}

// ─── Inbox ──────────────────────────────────────────────────────────────────

export interface FloorMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  created_at: string;
  direction: 'inbox' | 'outbox';
}

/** A message appears in both the sender's outbox and the receiver's inbox. Shows it
 *  once, newest first, filtered by the search text. */
export function floorMessages<T extends FloorMessage>(messages: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of messages) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    if (!q || `${m.from} ${m.to} ${m.subject} ${m.body}`.toLowerCase().includes(q)) out.push(m);
  }
  return out.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

// ─── Agent cards ────────────────────────────────────────────────────────────

/** The statuses people need to act on come first. */
const STATUS_ORDER: Record<string, number> = { blocked: 0, waiting: 1, looping: 2, working: 3, thinking: 3, compacting: 4, idle: 5 };

export function sortAgentCards<T extends { name: string; status: string; isGod?: boolean }>(agents: readonly T[]): T[] {
  return agents.filter((a) => !a.isGod).sort((a, b) =>
    (STATUS_ORDER[a.status] ?? 6) - (STATUS_ORDER[b.status] ?? 6) || a.name.localeCompare(b.name));
}

// ─── Ticket keys ────────────────────────────────────────────────────────────

export const DEFAULT_TICKET_PREFIX = 'MD';

/** Letters and digits, starting with a letter, so keys read like V53-299. */
export function cleanTicketPrefix(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : '';
  return /^[A-Z]/.test(s) ? s : DEFAULT_TICKET_PREFIX;
}

/** The next key, one above the highest in use. Other id styles are left alone. */
export function nextTicketId(prefix: string, existing: readonly string[]): string {
  const p = `${prefix}-`;
  let top = 0;
  for (const id of existing) {
    if (!id.startsWith(p)) continue;
    const n = Number(id.slice(p.length));
    if (Number.isInteger(n) && n > top) top = n;
  }
  return `${p}${top + 1}`;
}

// ─── Task filters ───────────────────────────────────────────────────────────

export type TaskDateRange = 'all' | 'today' | 'week' | 'month';

/** Tasks made within the range. A card with no date is unknown, so it only shows
 *  under All rather than passing for new. */
export function inDateRange(createdAt: string | undefined, range: TaskDateRange, now: number): boolean {
  if (range === 'all') return true;
  const at = Date.parse(createdAt ?? '');
  if (!Number.isFinite(at)) return false;
  if (range === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return at >= d.getTime(); }
  return now - at <= (range === 'week' ? 7 : 30) * 86_400_000;
}

/** The column a card shows in, once staged moves are counted. */
export const stagedStatus = (task: { id: string; status: TaskStatus }, moves: readonly StagedMove[]): TaskStatus =>
  moves.find((m) => m.taskId === task.id)?.to ?? task.status;

// ─── Queue ──────────────────────────────────────────────────────────────────

/** One place earlier or later. The first and last stay put at the ends. */
export function moveInList<T extends { id: string }>(list: readonly T[], id: string, direction: -1 | 1): T[] {
  const i = list.findIndex((x) => x.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** How long a message being edited is held back. It lapses by itself, so a window
 *  closed mid-edit can't block the queue for good. */
export const QUEUE_EDIT_HOLD_MS = 10 * 60 * 1000;
export const isEditHeld = (m: { editingUntil?: number }, now: number): boolean => (m.editingUntil ?? 0) > now;
