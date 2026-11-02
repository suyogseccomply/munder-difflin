'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  cloneFields, cloneObjective, cloneTarget, isHoldExempt, parseTempTarget, requesterVerdict, tempsPerAgent
} = loadTs('src/shared/tempRouting.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

test('temp targets parse, and agent ids stay agent ids', () => {
  assert.deepEqual(parseTempTarget('temp'), { temp: true });
  assert.deepEqual(parseTempTarget(cloneTarget('dwight')), { temp: true, cloneOf: 'dwight' });
  for (const other of ['god', 'broadcast', 'temporary', 'temp:', '', null, 5]) assert.equal(parseTempTarget(other), null, String(other));
});

test('a clone copies the job description, never the identity', () => {
  const clone = cloneFields({
    id: 'dwight', sessionId: 's', ptyId: 'p', worktreePath: '/w', status: 'working', onHold: true, archived: true, isGod: true,
    provider: 'codex', role: 'tester', cwd: '/repo', model: 'm', goal: 'g', character: 'pam', accent: 'mint', command: 'codex'
  });
  assert.deepEqual(clone, { provider: 'codex', role: 'tester', capabilities: undefined, cwd: '/repo', model: 'm', command: 'codex', goal: 'g', character: 'pam', accent: 'mint' });
  assert.match(cloneObjective('do it', 'keep tests green'), /keep tests green[\s\S]*do it/);
  assert.equal(cloneObjective('do it', '  '), 'do it');
});

test('temps per agent stays in range and defaults sensibly', () => {
  assert.equal(tempsPerAgent(undefined), 2);
  assert.equal(tempsPerAgent(9), 4);
  assert.equal(tempsPerAgent(-1), 0);
  assert.equal(tempsPerAgent(1.9), 1);
});

test('an agent at its limit waits, zero refuses, and the orchestrator is unlimited here', () => {
  assert.equal(requesterVerdict('jim', 'god', 0, 2), 'allow');
  assert.equal(requesterVerdict('jim', 'god', 2, 2), 'wait');
  assert.equal(requesterVerdict('jim', 'god', 0, 0), 'refuse');
  assert.equal(requesterVerdict('god', 'god', 99, 0), 'allow');
  assert.equal(requesterVerdict(undefined, 'god', 99, 0), 'allow');
});

test('only the person and harness notices pass a 1:1', () => {
  for (const from of ['human', 'system']) assert.equal(isHoldExempt(from), true, from);
  for (const from of ['god', 'jim', 'scheduler', 'webhook']) assert.equal(isHoldExempt(from), false, from);
});

// ─── The real router ────────────────────────────────────────────────────────

function withHive(fn) {
  const home = mkdtempSync(join(tmpdir(), 'munder-hold-'));
  const events = [];
  try {
    const hive = new HiveManager(() => home, (channel, payload) => { events.push({ channel, payload }); });
    hive.ensureHive();
    return fn(hive, join(home, 'hive'), events);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function addAgents(hive, root) {
  const reg = hive.registry();
  reg.godId = 'god';
  for (const id of ['god', 'jim', 'pam']) reg.agents[id] = { id, name: id, cwd: root, provider: 'claude', status: 'idle', lastSeen: 0 };
  require('node:fs').writeFileSync(join(root, 'registry.json'), JSON.stringify(reg));
  for (const id of ['god', 'jim', 'pam']) require('node:fs').mkdirSync(join(root, 'agents', id, 'inbox'), { recursive: true });
}

const mail = (root, id) => {
  const dir = join(root, 'agents', id, 'inbox');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).subject) : [];
};

test('mail to an agent on hold waits, the person still gets through, and release delivers in order', () => withHive((hive, root) => {
  addAgents(hive, root);
  assert.equal(hive.setAgentHold('jim', true).ok, true);

  hive.send({ to: 'jim', act: 'inform', subject: 'from boss 1' }, 'god');
  hive.send({ to: 'jim', act: 'inform', subject: 'from schedule' }, 'scheduler');
  hive.send({ to: 'jim', act: 'inform', subject: 'from me' }, 'human');
  hive.send({ to: 'jim', act: 'inform', subject: 'guardrail' }, 'system');
  hive.send({ to: 'pam', act: 'inform', subject: 'for pam' }, 'god');

  assert.deepEqual(mail(root, 'jim').sort(), ['from me', 'guardrail']);
  assert.deepEqual(mail(root, 'pam'), ['for pam']);
  assert.equal(readdirSync(join(root, 'agents', 'jim', 'held')).length, 2);

  hive.setAgentHold('jim', false);
  assert.deepEqual(mail(root, 'jim').sort(), ['from boss 1', 'from me', 'from schedule', 'guardrail']);
  assert.equal(readdirSync(join(root, 'agents', 'jim', 'held')).length, 0);
}));

test('a sender expecting a reply is told the agent is on hold', () => withHive((hive, root) => {
  addAgents(hive, root);
  hive.setAgentHold('jim', true);
  hive.send({ to: 'jim', act: 'request', subject: 'please do it', requires_reply: true }, 'pam');
  assert.ok(mail(root, 'pam').some((s) => /hold/i.test(s)));
}));

test('a held message flies no envelope', () => withHive((hive, root, events) => {
  addAgents(hive, root);
  hive.setAgentHold('jim', true);
  events.length = 0;
  hive.send({ to: 'jim', act: 'inform', subject: 'held' }, 'god');
  const flown = events.filter((e) => e.channel === 'hive:message').flatMap((e) => e.payload.targets);
  assert.ok(!flown.includes('jim'));
}));

test('turning a hold on twice loses nothing, and held mail stays out of memory mining', () => withHive((hive, root) => {
  addAgents(hive, root);
  hive.setAgentHold('jim', true);
  hive.setAgentHold('jim', true);
  hive.send({ to: 'jim', act: 'inform', subject: 'x' }, 'god');
  assert.equal(readdirSync(join(root, 'agents', 'jim', 'held')).length, 1);
  assert.match(readFileSync('src/main/hive.ts', 'utf8'), /MINE_IGNORE_LINES = \[[^\]]*'held\/'/);
  assert.match(readFileSync('src/main/memory.ts', 'utf8'), /held\//);
}));

test('spawn requests can be filed by a person even with orchestrator spawning off', () => {
  const src = readFileSync('src/main/index.ts', 'utf8');
  assert.match(src, /ROUTED_REQUEST_PREFIX/);
  assert.match(src, /renameSync\(tmp, file\)/);
});
