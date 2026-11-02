/**
 * Token limits per period, for the office and for each agent. Counts work tokens,
 * the same figure the breaker's per-agent cap uses, so the two never disagree.
 */

export const LIMIT_PERIODS = ['fiveHour', 'daily', 'weekly', 'monthly'] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];
export type PeriodLimits = Partial<Record<LimitPeriod, number>>;

export interface TokenLimits {
  office?: PeriodLimits;
  agents?: { [agentId: string]: PeriodLimits };
}

const PERIOD_LABEL: Record<LimitPeriod, string> = {
  fiveHour: '5-hour', daily: 'daily', weekly: 'weekly', monthly: 'monthly'
};

/** When a period began, in local time. Weeks start on Monday. */
export function periodStart(period: LimitPeriod, now: number): number {
  if (period === 'fiveHour') return now - 5 * 60 * 60 * 1000;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'weekly') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (period === 'monthly') d.setDate(1);
  return d.getTime();
}

const validLimit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Which agents are over a limit, and why. An agent limit blames that agent. An
 * office limit counts everyone and blames the biggest spender in the period, so one
 * runaway doesn't trip the whole floor. Only `candidates` can be blamed: the
 * orchestrator's tokens count toward the office but it is never itself tripped.
 * `tokensSince` returning null means the ledger isn't read yet, so nothing trips.
 */
export function limitBreaches(
  limits: TokenLimits | undefined,
  candidates: readonly string[],
  tokensSince: (agentId: string | null, fromMs: number) => number | null,
  now: number
): Map<string, string> {
  const out = new Map<string, string>();
  if (!limits) return out;
  for (const period of LIMIT_PERIODS) {
    const from = periodStart(period, now);
    for (const id of candidates) {
      const cap = limits.agents?.[id]?.[period];
      if (!validLimit(cap) || out.has(id)) continue;
      const used = tokensSince(id, from);
      if (used !== null && used > cap) {
        out.set(id, `token limit: ${used.toLocaleString()} work tokens over this agent's ${PERIOD_LABEL[period]} limit of ${cap.toLocaleString()}`);
      }
    }
    const officeCap = limits.office?.[period];
    if (!validLimit(officeCap)) continue;
    const total = tokensSince(null, from);
    if (total === null || total <= officeCap) continue;
    let top: string | null = null;
    let topUsed = -1;
    for (const id of candidates) {
      const used = tokensSince(id, from) ?? 0;
      if (used > topUsed) { top = id; topUsed = used; }
    }
    if (top && !out.has(top)) {
      out.set(top, `token limit: office at ${total.toLocaleString()} work tokens, over its ${PERIOD_LABEL[period]} limit of ${officeCap.toLocaleString()} (top spender ${topUsed.toLocaleString()})`);
    }
  }
  return out;
}

/** Keeps only positive whole numbers, so a blank field removes that limit. */
export function cleanPeriodLimits(raw: PeriodLimits | undefined): PeriodLimits {
  const out: PeriodLimits = {};
  for (const p of LIMIT_PERIODS) {
    const v = raw?.[p];
    if (validLimit(v)) out[p] = Math.floor(v);
  }
  return out;
}
