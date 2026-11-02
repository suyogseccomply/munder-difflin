/**
 * "A temp" and "A temp, clone of" as answers to who handles something. Targets are
 * plain strings, so they fit every existing "who answers" setting: `temp` or
 * `temp:<agentId>`. Also holds the 1:1 mail rule. No imports, for main and renderer.
 */

export const TEMP_TARGET = 'temp';

export function parseTempTarget(to: unknown): { temp: true; cloneOf?: string } | null {
  if (to === TEMP_TARGET) return { temp: true };
  if (typeof to === 'string' && to.startsWith(`${TEMP_TARGET}:`) && to.length > TEMP_TARGET.length + 1) {
    return { temp: true, cloneOf: to.slice(TEMP_TARGET.length + 1) };
  }
  return null;
}

export const cloneTarget = (agentId: string): string => `${TEMP_TARGET}:${agentId}`;

export interface CloneSource {
  provider?: string;
  role?: string;
  capabilities?: string[];
  cwd?: string;
  model?: string;
  command?: string;
  goal?: string;
  character?: string;
  accent?: string;
}

/** What a clone inherits. Nothing identifying this run of the source: no id, session,
 *  terminal, worktree, hold or archive state, and no memory. */
export function cloneFields(source: CloneSource): CloneSource {
  const { provider, role, capabilities, cwd, model, command, goal, character, accent } = source;
  return { provider, role, capabilities, cwd, model, command, goal, character, accent };
}

/** A clone works towards the source's standing goal, then this job. */
export function cloneObjective(objective: string, goal: string | undefined): string {
  return goal?.trim() ? `Your standing goal: ${goal.trim()}\n\nThis job: ${objective}` : objective;
}

export const DEFAULT_TEMPS_PER_AGENT = 2;
export const MAX_TEMPS_PER_AGENT = 4;

export function tempsPerAgent(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw)
    ? Math.min(MAX_TEMPS_PER_AGENT, Math.max(0, Math.floor(raw)))
    : DEFAULT_TEMPS_PER_AGENT;
}

export type RequesterVerdict = 'allow' | 'wait' | 'refuse';

/** Whether an agent may hire another temp now. The orchestrator and a person are
 *  limited only by the office's total. */
export function requesterVerdict(requestedBy: unknown, godId: string, liveByRequester: number, limit: number): RequesterVerdict {
  if (typeof requestedBy !== 'string' || !requestedBy || requestedBy === godId || requestedBy === 'god') return 'allow';
  if (limit === 0) return 'refuse';
  return liveByRequester >= limit ? 'wait' : 'allow';
}

/** Who still reaches an agent in a 1:1. The person, and the harness's own notices
 *  (which include the breaker's), because a guardrail must never be held back. */
export function isHoldExempt(from: string): boolean {
  return from === 'human' || from === 'system';
}
