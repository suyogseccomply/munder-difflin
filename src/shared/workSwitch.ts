/**
 * Spots when an agent moves on to different work, from the task board.
 *
 * The board is the only reliable signal: message conversation ids are random per
 * message unless carried, and the orchestrator writes tasks.json by hand, so a patch
 * hook would miss its edits. A switch is a card finished, then a different card
 * started, by the same agent. The two can land in different polls.
 */

export interface WorkTask { id: string; assignee?: string; status: string }

export interface WorkSwitchState {
  /** Task id to its last seen assignee and status. */
  seen: Map<string, { assignee?: string; status: string }>;
  /** Agents who have finished a card and not yet started another. */
  finished: Set<string>;
}

export const newWorkSwitchState = (): WorkSwitchState | null => null;

/** Folds one poll. The first only records a baseline, so launching the app can't
 *  read existing cards as switches. */
export function detectWorkSwitches(prior: WorkSwitchState | null, tasks: readonly WorkTask[]): { state: WorkSwitchState; switched: string[] } {
  const seen = new Map(tasks.map((t) => [t.id, { assignee: t.assignee, status: t.status }]));
  if (!prior) return { state: { seen, finished: new Set() }, switched: [] };

  const finished = new Set(prior.finished);
  for (const t of tasks) {
    const before = prior.seen.get(t.id);
    if (t.assignee && before?.status === 'doing' && t.status === 'done') finished.add(t.assignee);
  }
  const switched = new Set<string>();
  for (const t of tasks) {
    const before = prior.seen.get(t.id);
    const startedNow = t.status === 'doing' && !(before?.status === 'doing' && before.assignee === t.assignee);
    if (startedNow && t.assignee && finished.has(t.assignee)) {
      switched.add(t.assignee);
      finished.delete(t.assignee);
    }
  }
  return { state: { seen, finished }, switched: [...switched] };
}

export const WORK_SWITCH_MIN_SESSION_MS = 60 * 60 * 1000;
export const HANDOFF_TIMEOUT_MS = 5 * 60 * 1000;

export function handoffRequestBody(path: string): string {
  return [
    'You are moving on to different work, and your context will be cleared shortly to save tokens.',
    `Before anything else, write a short handoff to ${path}: what you finished, decisions and open questions, the files involved, and what you are starting next.`,
    'Replace any earlier handoff. Then stop and wait; do not start new work until your context has been cleared.'
  ].join(' ');
}

export function handoffFollowUp(path: string): string {
  return `Your context was just cleared because your work changed. Read ${path} if it exists to pick up the thread, then re-read your inbox and carry on with your current task.`;
}
