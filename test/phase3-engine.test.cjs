'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const { ControlRegistry } = loadTs('src/main/control.ts');
const { controlSupportForProvider } = loadTs('src/shared/agentProvider.ts');
const { DEFAULT_CONTEXT_TRIGGER, compactOnFillDue } = loadTs('src/shared/triggers.ts');
const {
  appendIntegrationEvent, appendLedger, integrationEvents, isWorkerHistoryRow, readLedger, updateLedger
} = loadTs('src/main/jsonLedger.ts');
const { CircuitBreaker } = loadTs('src/main/breaker.ts');

// ─── Control ────────────────────────────────────────────────────────────────

test('a restart clears the halt and queued steers, but keeps a deliberate pause', () => {
  const c = new ControlRegistry();
  c.pause('a', true); c.halt('a'); c.steer('a', 'note');
  c.forgetRun('a');
  assert.equal(c.shouldHalt('a'), false);
  assert.equal(c.takeSteer('a'), undefined);
  assert.equal(c.snapshot('a').paused, true);
});

test('forgetting an unknown agent is harmless', () => {
  assert.doesNotThrow(() => new ControlRegistry().forgetRun('ghost'));
});

test('a steer is kept for a provider that would lose it', () => {
  const c = new ControlRegistry((id) => id !== 'pi-agent');
  c.steer('pi-agent', 'note');
  assert.equal(c.takeSteer('pi-agent'), undefined);
  assert.equal(c.snapshot('pi-agent').pendingSteers, 1);
  c.steer('claude-agent', 'note');
  assert.equal(c.takeSteer('claude-agent'), 'note');
});

test('a floor-wide hold covers agents that start later, and lifts cleanly', () => {
  const c = new ControlRegistry();
  c.setFloorDeliveryPaused(true);
  assert.equal(c.isAutoDeliveryPaused('spawned-later'), true);
  assert.equal(c.snapshot('spawned-later').autoDeliveryPaused, true);
  c.setFloorDeliveryPaused(false);
  assert.equal(c.isAutoDeliveryPaused('spawned-later'), false);
});

test('lifting the floor hold keeps a per-agent hold', () => {
  const c = new ControlRegistry();
  c.pauseAutoDelivery('a', true);
  c.setFloorDeliveryPaused(true);
  c.setFloorDeliveryPaused(false);
  assert.equal(c.isAutoDeliveryPaused('a'), true);
});

test('control support matches each provider bridge', () => {
  for (const p of ['claude', 'codex', 'antigravity', 'gemini', 'grok']) {
    assert.deepEqual(controlSupportForProvider(p), { tools: true, halt: true, steer: true }, p);
  }
  for (const p of ['pi', 'opencode', 'qwen', 'crush', 'kimi', 'cursor', 'copilot', 'custom']) {
    assert.deepEqual(controlSupportForProvider(p), { tools: false, halt: false, steer: false }, p);
  }
  assert.equal(controlSupportForProvider(undefined).steer, true);
});

// ─── Compact on fill ────────────────────────────────────────────────────────

test('compact on fill is on for new installs only', () => {
  assert.equal(DEFAULT_CONTEXT_TRIGGER.compact.onFill, true);
  const rule = { ...DEFAULT_CONTEXT_TRIGGER.compact };
  delete rule.onFill; // what an existing install has stored
  assert.equal(compactOnFillDue(rule, 70, undefined, 1e9), false);
});

test('compact on fill needs a reading over the bar, and a gap since the last one', () => {
  const rule = DEFAULT_CONTEXT_TRIGGER.compact;
  const now = 1e9;
  assert.equal(compactOnFillDue(rule, 61, undefined, now), true);
  assert.equal(compactOnFillDue(rule, 59, undefined, now), false);
  assert.equal(compactOnFillDue(rule, null, undefined, now), false, 'an unmetered agent stays on the timer');
  assert.equal(compactOnFillDue(rule, 61, now - 60_000, now), false, 'no compact loop');
  assert.equal(compactOnFillDue(rule, 61, now - 11 * 60_000, now), true);
  assert.equal(compactOnFillDue({ ...rule, enabled: false }, 90, undefined, now), false);
});

// ─── Ledgers ────────────────────────────────────────────────────────────────

const withFile = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'munder-ledger-'));
  try { return fn(join(dir, 'ledger.json')); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const row = (workerId) => ({ workerId, name: workerId, objective: 'job', provider: 'claude', startedAt: 1, endedAt: 2, tokens: 3, endReason: 'done' });

test('a ledger is newest first and capped', () => withFile((f) => {
  for (const id of ['a', 'b', 'c']) appendLedger(f, row(id), isWorkerHistoryRow, 2);
  assert.deepEqual(readLedger(f, isWorkerHistoryRow).map((r) => r.workerId), ['c', 'b']);
}));

test('a damaged ledger drops bad rows, or reads as empty', () => withFile((f) => {
  writeFileSync(f, JSON.stringify([row('ok'), { junk: true }]));
  assert.equal(readLedger(f, isWorkerHistoryRow).length, 1);
  writeFileSync(f, '{broken');
  assert.deepEqual(readLedger(f, isWorkerHistoryRow), []);
}));

test('a kept worktree lands on the newest run of a reused temp id', () => withFile((f) => {
  appendLedger(f, row('w'), isWorkerHistoryRow, 5);
  appendLedger(f, { ...row('w'), endedAt: 9 }, isWorkerHistoryRow, 5);
  assert.equal(updateLedger(f, isWorkerHistoryRow, (r) => r.workerId === 'w', { keptWorktree: '/wt' }), true);
  const rows = readLedger(f, isWorkerHistoryRow);
  assert.equal(rows[0].keptWorktree, '/wt');
  assert.equal(rows[1].keptWorktree, undefined);
  assert.equal(updateLedger(f, isWorkerHistoryRow, (r) => r.workerId === 'nope', {}), false);
}));

test('an integration event stores only its listed fields, and each row gets its last 50', () => withFile((f) => {
  appendIntegrationEvent(f, {
    integrationId: 'x', source: 'worker', method: 'GET', status: 200, ms: 5, at: 1,
    url: 'https://x/?token=SECRET', authorization: 'SECRET'
  });
  assert.ok(!readFileSync(f, 'utf8').includes('SECRET'));
  for (let i = 0; i < 60; i++) appendIntegrationEvent(f, { integrationId: 'y', source: 'test', method: 'GET', status: 500, ms: 1, at: i });
  assert.equal(integrationEvents(f, 'y').length, 50);
  assert.equal(integrationEvents(f, 'x').length, 1);
}));

test('the broker reports each call without its path or query', async () => {
  const { IntegrationBroker } = loadTs('src/main/integrationBroker.ts');
  const events = [];
  const broker = new IntegrationBroker({
    getRecord: () => undefined, getSecret: () => undefined, onEvent: (e) => events.push(e)
  });
  const started = await broker.start();
  const { port } = broker.address ? broker.address() : started;
  const token = broker.grant('worker-1', ['known']);
  await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/i/known/secret-path?key=SECRET', headers: { authorization: `Bearer ${token}` } }, (res) => {
      res.resume(); res.on('close', resolve);
    }).on('error', reject);
  });
  await new Promise((r) => setTimeout(r, 50));
  await broker.stop();
  assert.equal(events.length, 1);
  assert.equal(events[0].integrationId, 'known');
  assert.equal(events[0].status, 404);
  assert.ok(!JSON.stringify(events).includes('SECRET'));
  assert.ok(!JSON.stringify(events).includes('secret-path'));
});

// ─── Default agent cap ──────────────────────────────────────────────────────

test('the breaker source applies the default cap, exempting temps and the orchestrator', () => {
  const src = readFileSync('src/main/breaker.ts', 'utf8');
  assert.match(src, /agentTokenCaps\?\.\[input\.agentId\] \?\? defaultCapFor\(input\.agentId, cfg\.defaultAgentTokenCap\)/);
  const { defaultCapFor } = loadTs('src/main/breaker.ts');
  assert.equal(defaultCapFor('dwight', 100), 100);
  assert.equal(defaultCapFor('worker-x', 100), undefined);
  assert.equal(defaultCapFor('god', 100), undefined);
  assert.equal(CircuitBreaker.name, 'CircuitBreaker');
});
