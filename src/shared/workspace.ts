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
