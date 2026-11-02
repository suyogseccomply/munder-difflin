'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const { limitBreaches, periodStart, cleanPeriodLimits } = loadTs('src/shared/tokenLimits.ts');
const { detectWorkSwitches, handoffFollowUp, handoffRequestBody } = loadTs('src/shared/workSwitch.ts');
const { CostLedgerTotals } = loadTs('src/main/costLifetime.ts');

// ─── Periods ────────────────────────────────────────────────────────────────

test('periods begin at local boundaries, and weeks on Monday', () => {
  const now = new Date(2026, 10, 4, 15, 30).getTime(); // Wednesday 4 Nov 2026
  assert.equal(periodStart('fiveHour', now), now - 5 * 3600_000);
  assert.equal(periodStart('daily', now), new Date(2026, 10, 4).getTime());
  assert.equal(periodStart('weekly', now), new Date(2026, 10, 2).getTime());
  assert.equal(periodStart('monthly', now), new Date(2026, 10, 1).getTime());
  const sunday = new Date(2026, 10, 8, 9).getTime();
  assert.equal(periodStart('weekly', sunday), new Date(2026, 10, 2).getTime());
});

test('an agent over its own limit is blamed, with the figures', () => {
  const out = limitBreaches({ agents: { a: { daily: 100 } } }, ['a', 'b'], (id) => (id === 'a' ? 150 : 0), Date.now());
  assert.match(out.get('a'), /150.*daily.*100/);
  assert.equal(out.has('b'), false);
});

test('an office limit blames the top spender among candidates, never the orchestrator', () => {
  // god's tokens count toward the total but it isn't a candidate.
  const usage = { a: 40, b: 70 };
  const out = limitBreaches({ office: { weekly: 200 } }, ['a', 'b'], (id) => (id === null ? 500 : usage[id]), Date.now());
  assert.deepEqual([...out.keys()], ['b']);
  assert.match(out.get('b'), /office.*weekly/);
});

test('an unread ledger trips nothing, rather than reading as zero or over', () => {
  const out = limitBreaches({ office: { daily: 1 }, agents: { a: { daily: 1 } } }, ['a'], () => null, Date.now());
  assert.equal(out.size, 0);
});

test('at the limit is fine, and junk limits are ignored', () => {
  assert.equal(limitBreaches({ agents: { a: { daily: 100 } } }, ['a'], () => 100, Date.now()).size, 0);
  assert.equal(limitBreaches({ agents: { a: { daily: -1, weekly: NaN } } }, ['a'], () => 999, Date.now()).size, 0);
  assert.equal(limitBreaches(undefined, ['a'], () => 999, Date.now()).size, 0);
  assert.deepEqual(cleanPeriodLimits({ daily: 10.7, weekly: 0, monthly: NaN }), { daily: 10 });
});

// ─── Ledger windows ─────────────────────────────────────────────────────────

const rowAt = (ts, input, agent = 'a', session = 's', extra = {}) =>
  `${JSON.stringify({ agent_id: agent, session_id: session, ts, input, output: 0, cache_read: 9999, cache_creation: 0, usd: 0, ...extra })}\n`;

async function fold(text, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'munder-limits-'));
  try {
    const f = join(dir, 'ledger.jsonl');
    writeFileSync(f, text);
    const t = new CostLedgerTotals();
    await t.refreshFully(f);
    await fn(t, f);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const T0 = Date.parse('2026-11-04T10:00:00Z');
const H = 3600_000;

test('cumulative samples become deltas placed in the time they happened', () => fold(
  rowAt(new Date(T0).toISOString(), 100) + rowAt(new Date(T0 + 2 * H).toISOString(), 300) + rowAt(new Date(T0 + 4 * H).toISOString(), 350),
  (t) => {
    assert.equal(t.tokensSince('a', T0 - H), 350);
    assert.equal(t.tokensSince('a', T0 + H), 250);
    assert.equal(t.tokensSince('a', T0 + 3 * H), 50);
  }
));

test('work tokens leave out cache reads, and count output and cache writes', () => fold(
  rowAt(new Date(T0).toISOString(), 10, 'a', 's', { output: 20, cache_creation: 30, cache_read: 1e9 }),
  (t) => assert.equal(t.tokensSince('a', 0), 60)
));

test('a counter reset after an app restart is not lost or negative', () => fold(
  rowAt(new Date(T0).toISOString(), 500) + rowAt(new Date(T0 + H).toISOString(), 10) + rowAt(new Date(T0 + 2 * H).toISOString(), 40),
  (t) => assert.equal(t.tokensSince('a', 0), 540)
));

test('separate sessions and agents do not mix, and null means everyone', () => fold(
  rowAt(new Date(T0).toISOString(), 100, 'a', 's1') + rowAt(new Date(T0).toISOString(), 50, 'a', 's2') + rowAt(new Date(T0).toISOString(), 7, 'b', 's3'),
  (t) => {
    assert.equal(t.tokensSince('a', 0), 150);
    assert.equal(t.tokensSince('b', 0), 7);
    assert.equal(t.tokensSince(null, 0), 157);
  }
));

test('a cold ledger answers null, and appended rows fold in later', async () => {
  assert.equal(new CostLedgerTotals().tokensSince('a', 0), null);
  await fold(rowAt(new Date(T0).toISOString(), 100), async (t, f) => {
    appendFileSync(f, rowAt(new Date(T0 + H).toISOString(), 130));
    await t.refresh(f);
    assert.equal(t.tokensSince('a', 0), 130);
  });
});

test('bad rows and timestamps do not break the count', () => fold(
  `{broken\n${rowAt('not a date', 100)}${rowAt(new Date(T0).toISOString(), 150)}`,
  (t) => assert.equal(t.tokensSince('a', T0 - H), 50)
));

test('tokens outside the window fall away over a long ledger', () => fold(
  rowAt(new Date(T0 - 100 * 24 * H).toISOString(), 1000) + rowAt(new Date(T0).toISOString(), 1100),
  (t) => assert.equal(t.tokensSince('a', T0 - H), 100)
));

// ─── Work switches ──────────────────────────────────────────────────────────

const card = (id, assignee, status) => ({ id, assignee, status });
const step = (state, tasks) => detectWorkSwitches(state, tasks);

test('the first poll only records a baseline', () => {
  const { switched } = step(null, [card('a', 'x', 'done'), card('b', 'x', 'doing')]);
  assert.deepEqual(switched, []);
});

test('finishing a card and starting another is a switch, in one poll or two', () => {
  const base = step(null, [card('a', 'x', 'doing'), card('b', 'x', 'todo')]).state;
  assert.deepEqual(step(base, [card('a', 'x', 'done'), card('b', 'x', 'doing')]).switched, ['x']);

  const done = step(base, [card('a', 'x', 'done'), card('b', 'x', 'todo')]);
  assert.deepEqual(done.switched, []);
  assert.deepEqual(step(done.state, [card('a', 'x', 'done'), card('b', 'x', 'doing')]).switched, ['x']);
});

test('a switch fires once', () => {
  const base = step(null, [card('a', 'x', 'doing'), card('b', 'x', 'todo')]).state;
  const first = step(base, [card('a', 'x', 'done'), card('b', 'x', 'doing')]);
  assert.deepEqual(step(first.state, [card('a', 'x', 'done'), card('b', 'x', 'doing')]).switched, []);
});

test('picking up work with nothing finished is not a switch, so context survives', () => {
  const base = step(null, [card('a', 'x', 'doing'), card('b', 'x', 'todo')]).state;
  assert.deepEqual(step(base, [card('a', 'x', 'doing'), card('b', 'x', 'doing')]).switched, []);
  assert.deepEqual(step(base, [card('a', 'x', 'blocked'), card('b', 'x', 'doing')]).switched, []);
});

test('one agent finishing and another starting is not a switch for either', () => {
  const base = step(null, [card('a', 'x', 'doing'), card('b', 'y', 'todo')]).state;
  assert.deepEqual(step(base, [card('a', 'x', 'done'), card('b', 'y', 'doing')]).switched, []);
});

test('a brand new card counts as started', () => {
  const base = step(null, [card('a', 'x', 'doing')]).state;
  assert.deepEqual(step(base, [card('a', 'x', 'done'), card('new', 'x', 'doing')]).switched, ['x']);
});

test('the handoff instructions name the file', () => {
  assert.match(handoffRequestBody('/h/handoff.md'), /\/h\/handoff\.md/);
  assert.match(handoffFollowUp('/h/handoff.md'), /\/h\/handoff\.md.*inbox/);
});

// ─── New installs only ──────────────────────────────────────────────────────

test('a saved rule without these options keeps them off, and a fresh one gets them', () => {
  const { withTriggerDefaults } = loadTs('src/main/config.ts');
  const { DEFAULT_CONTEXT_TRIGGER } = loadTs('src/shared/triggers.ts');
  const saved = withTriggerDefaults({ contextTrigger: { compact: { enabled: true }, clear: { enabled: false } } });
  assert.equal(saved.contextTrigger.compact.onFill, false);
  assert.equal(saved.contextTrigger.clear.onWorkSwitch, false);
  const fresh = withTriggerDefaults({ contextTrigger: DEFAULT_CONTEXT_TRIGGER });
  assert.equal(fresh.contextTrigger.compact.onFill, true);
  assert.equal(fresh.contextTrigger.clear.onWorkSwitch, true);
  const chosen = withTriggerDefaults({ contextTrigger: { compact: { onFill: true }, clear: { onWorkSwitch: true } } });
  assert.equal(chosen.contextTrigger.compact.onFill, true);
  assert.equal(chosen.contextTrigger.clear.onWorkSwitch, true);
});

test('the standup is not a new-install default, and only onboarded installs get it', () => {
  const config = readFileSync('src/main/config.ts', 'utf8');
  assert.match(config, /missions: \[\],/);
  const index = readFileSync('src/main/index.ts', 'utf8');
  assert.match(index, /!cfg\.opsStandupSeeded[\s\S]{0,500}onboardingComplete/);
});
