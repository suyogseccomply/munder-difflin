/**
 * Small capped JSON ledgers: finished temps and integration events. Plain files in
 * userData rather than config.json, as they are append-heavy and disposable. A write
 * failure never surfaces, because recording an event must not fail the event itself.
 * Free of any `electron` import, so paths are passed in and it can be tested alone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Newest first. A hand-edited or half-written file drops bad rows, not the ledger. */
export function readLedger<T>(path: string, isRow: (v: unknown) => v is T): T[] {
  try {
    if (!existsSync(path)) return [];
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(isRow) : [];
  } catch {
    return [];
  }
}

function write<T>(path: string, rows: T[]): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(rows));
  } catch { /* best-effort */ }
}

export function appendLedger<T>(path: string, row: T, isRow: (v: unknown) => v is T, limit: number): void {
  write(path, [row, ...readLedger(path, isRow)].slice(0, limit));
}

/** Change the newest row matching `match`. Returns false when there is none. */
export function updateLedger<T>(path: string, isRow: (v: unknown) => v is T, match: (row: T) => boolean, patch: Partial<T>): boolean {
  const rows = readLedger(path, isRow);
  const i = rows.findIndex(match);
  if (i < 0) return false;
  rows[i] = { ...rows[i], ...patch };
  write(path, rows);
  return true;
}

// ─── Finished temps ─────────────────────────────────────────────────────────

export type WorkerEndReason = 'done' | 'token-cap' | 'idle' | 'stopped' | 'crashed';

export interface WorkerHistoryRow {
  workerId: string;
  name: string;
  objective: string;
  provider: string;
  startedAt: number;
  endedAt: number;
  tokens: number;
  endReason: WorkerEndReason;
  /** Set when the temp's worktree was kept because it holds unmerged work. */
  keptWorktree?: string;
}

export const WORKER_HISTORY_LIMIT = 200;

export function isWorkerHistoryRow(v: unknown): v is WorkerHistoryRow {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<WorkerHistoryRow>;
  return typeof r.workerId === 'string' && typeof r.startedAt === 'number' && typeof r.endedAt === 'number'
    && typeof r.tokens === 'number' && typeof r.endReason === 'string';
}

// ─── Integration events ─────────────────────────────────────────────────────

export const INTEGRATION_EVENTS_PER_ROW = 50;
const INTEGRATION_LOG_LIMIT = 1000;

/** No URL, path, query, header or body: any of them can hold a credential. */
export interface IntegrationEvent {
  integrationId: string;
  source: 'worker' | 'test';
  method: string;
  status: number;
  ms: number;
  at: number;
}

export function isIntegrationEvent(v: unknown): v is IntegrationEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<IntegrationEvent>;
  return typeof e.integrationId === 'string' && typeof e.status === 'number' && typeof e.at === 'number';
}

/** Built field by field, so an extra field on the caller's object can't be stored. */
export function appendIntegrationEvent(path: string, e: IntegrationEvent): void {
  const row: IntegrationEvent = {
    integrationId: e.integrationId, source: e.source, method: e.method, status: e.status, ms: e.ms, at: e.at
  };
  appendLedger(path, row, isIntegrationEvent, INTEGRATION_LOG_LIMIT);
}

export function integrationEvents(path: string, id: string): IntegrationEvent[] {
  return readLedger(path, isIntegrationEvent).filter((e) => e.integrationId === id).slice(0, INTEGRATION_EVENTS_PER_ROW);
}
