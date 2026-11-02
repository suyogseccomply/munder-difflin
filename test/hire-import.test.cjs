'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const { readHireManifestFiles } = loadTs('src/main/hire.ts');

const manifest = (name) => ({ spec: 'munder-difflin/hire@1', name });

test('batch import keeps every valid manifest and reports invalid files independently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'munder-hire-import-'));
  try {
    const jim = join(dir, '01-jim.json');
    const brokenJson = join(dir, '02-broken.json');
    const invalidManifest = join(dir, '03-missing-name.json');
    const pam = join(dir, '04-pam.json');
    writeFileSync(jim, JSON.stringify(manifest('Jim')));
    writeFileSync(brokenJson, '{ definitely not json');
    writeFileSync(invalidManifest, JSON.stringify({ spec: 'munder-difflin/hire@1' }));
    writeFileSync(pam, JSON.stringify(manifest('Pam')));

    const result = readHireManifestFiles([jim, brokenJson, invalidManifest, pam]);

    assert.deepEqual(result.manifests.map((m) => m.name), ['Jim', 'Pam']);
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /02-broken\.json/);
    assert.match(result.errors[1], /03-missing-name\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty file selection is a valid empty batch', () => {
  assert.deepEqual(readHireManifestFiles([]), { manifests: [], errors: [] });
});

test('batch errors identify the file without exposing its parent directory', () => {
  const path = join(tmpdir(), 'private-project-name', 'missing-hire.json');
  const result = readHireManifestFiles([path]);
  assert.equal(result.manifests.length, 0);
  assert.match(result.errors[0], /missing-hire\.json/);
  assert.doesNotMatch(result.errors[0], /private-project-name/);
});

test('Electron picker and IPC validate the full selection rather than file zero', () => {
  const source = readFileSync('src/main/index.ts', 'utf8');
  const start = source.indexOf("ipcMain.handle('hire:openFile'");
  const end = source.indexOf('\n/**', start);
  const handler = source.slice(start, end);
  assert.ok(start >= 0 && end > start, 'hire import IPC handler is present');
  assert.match(handler, /properties:\s*\['openFile', 'multiSelections'\]/);
  assert.match(handler, /readHireManifestFiles\(res\.filePaths\)/);
  assert.doesNotMatch(handler, /res\.filePaths\[0\]/);
});

test('renderer wiring appends every cold-start and runtime arrival', () => {
  const app = readFileSync('src/renderer/src/App.tsx', 'utf8');
  assert.match(app, /enqueuePendingHires\(\[m\]\)/);
  assert.match(app, /enqueuePendingHires\(queued\)/);
  assert.doesNotMatch(app, /queued\[queued\.length\s*-\s*1\]/);
});

test('closing a hire review clears the remaining batch', () => {
  const app = readFileSync('src/renderer/src/App.tsx', 'utf8');
  assert.match(app, /const closeAddAgentReview = \(\) => \{[\s\S]*?clearPendingHires\(\);[\s\S]*?setAddAgentOpen\(false\);[\s\S]*?\}/);
  assert.match(app, /<AddAgentModal[\s\S]*?onClose=\{closeAddAgentReview\}/);
});

test('review UI exposes progress and an explicit skip without auto-spawn', () => {
  const modal = readFileSync('src/renderer/src/components/AddAgentModal.tsx', 'utf8');
  assert.match(modal, /hireQueueProgress\(hireQueue\)/);
  assert.match(modal, />\{tr\('addAgent\.skipHire'\)\}<\/PixelButton>/);
  assert.match(modal, /finishPendingHire\(\)/);
  const start = modal.indexOf('const importHire = async');
  const end = modal.indexOf('const submit = async', start);
  const importFlow = modal.slice(start, end);
  assert.match(importFlow, /enqueuePendingHires\(res\.manifests\)/);
  assert.doesNotMatch(importFlow, /spawnPty/);
});

test('batch token caps persist atomically before review advances', () => {
  const modal = readFileSync('src/renderer/src/components/AddAgentModal.tsx', 'utf8');
  const start = modal.indexOf('const submit = async');
  const end = modal.indexOf('\n  return (', start);
  const submitFlow = modal.slice(start, end);
  const persistCap = submitFlow.indexOf('await window.cth.setAgentTokenCap');
  const advance = submitFlow.indexOf('advanceHireReview()');

  assert.ok(persistCap >= 0, 'submit must use the atomic single-agent config IPC');
  assert.ok(advance > persistCap, 'the current cap must persist before the batch advances');
  assert.match(submitFlow.slice(persistCap, advance), /onConfigChange\?\.\(updated\)/,
    'the latest config must be returned to App before the next review');
  assert.doesNotMatch(submitFlow, /agentTokenCaps:\s*\{\s*\.\.\.\(config\.agentTokenCaps/,
    'renderer must never replace the cap map from a stale config snapshot');
});

test('Command Center sets and clears one cap through the atomic IPC', () => {
  const panel = readFileSync('src/renderer/src/components/CommandCenterPanel.tsx', 'utf8');
  const start = panel.indexOf('const setAgentCap =');
  const end = panel.indexOf('\n\n  // The token meter', start);
  const capFlow = panel.slice(start, end);

  assert.ok(start >= 0 && end > start, 'Command Center cap handler is present');
  assert.match(capFlow, /window\.cth\.setAgentTokenCap\(id, tokens\)/);
  assert.doesNotMatch(capFlow, /updateConfig\(\{\s*agentTokenCaps/);
});

// ─── Export ─────────────────────────────────────────────────────────────────
const { buildHireManifest, validateHireManifest, HIRE_EXPORT_FIELDS } = loadTs('src/shared/hire.ts');
const { prepareHireExport } = loadTs('src/main/hire.ts');
const { HIRE_TEMPLATES, HIRE_TEMPLATE_CATEGORIES, templateManifest } = loadTs('src/shared/hireTemplates.ts');

const fullAgent = () => ({
  name: 'Dwight', description: 'Tests the login flow', goal: 'Keep login green',
  character: 'dwight', accent: 'mint', provider: 'claude', model: 'claude-sonnet-4-6[1m]',
  isolate: true, tokenCap: 5000
});

test('an exported agent survives a round trip through a file and the importer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'munder-hire-export-'));
  try {
    const { manifest, omitted } = buildHireManifest(fullAgent());
    assert.deepEqual(omitted, []);
    const prepared = prepareHireExport(manifest);
    assert.equal(prepared.ok, true);
    assert.equal(prepared.fileName, 'dwight.hire.json');
    const path = join(dir, prepared.fileName);
    writeFileSync(path, prepared.json);
    const back = readHireManifestFiles([path]);
    assert.deepEqual(back.errors, []);
    assert.equal(back.manifests[0].goal, 'Keep login green');
    assert.equal(back.manifests[0].model, 'claude-sonnet-4-6[1m]');
    assert.equal(back.manifests[0].tokenCap, 5000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deselected fields stay out and are not reported as refused', () => {
  const include = Object.fromEntries(HIRE_EXPORT_FIELDS.map((f) => [f, false]));
  const { manifest, omitted } = buildHireManifest(fullAgent(), include);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(manifest))).sort(), ['name', 'spec']);
  assert.deepEqual(omitted, []);
});

for (const [label, value] of [
  ['an Anthropic-style key', 'use sk-ant-abcdefghijklmnop1234'],
  ['a GitHub token', 'ghp_abcdefghijklmnopqrstuvwxyz12'],
  ['a Slack token', 'xoxb-1234567890-abcdefgh'],
  ['an AWS key id', 'AKIAABCDEFGHIJKLMNOP'],
  ['a private key', '-----BEGIN RSA PRIVATE KEY-----'],
  ['a bearer header', 'Authorization: Bearer abcdefghijklmnopqrstuvwx'],
  ['an assignment', 'password = hunter2hunter2']
]) {
  test(`a goal holding ${label} is refused and reported`, () => {
    const { manifest, omitted } = buildHireManifest({ ...fullAgent(), goal: value });
    assert.equal(manifest.goal, undefined);
    assert.deepEqual(omitted, [{ field: 'goal', reason: 'secret' }]);
    assert.ok(!JSON.stringify(manifest).includes(value));
  });
}

for (const value of ['read C:\\Users\\sam\\repo\\notes', 'see /home/sam/repo', 'open /Users/sam/repo', 'in ~/secret']) {
  test(`a goal naming a home path is refused: ${value.replace(/\\/g, "/")}`, () => {
    const { manifest, omitted } = buildHireManifest({ ...fullAgent(), goal: value });
    assert.equal(manifest.goal, undefined);
    assert.deepEqual(omitted, [{ field: 'goal', reason: 'path' }]);
  });
}

test('ordinary prose about tokens and paths is kept', () => {
  const goal = 'Reduce token usage and tidy src/main/hire.ts. Rotate the password policy doc.';
  assert.equal(buildHireManifest({ ...fullAgent(), goal }).manifest.goal, goal);
});

test('an engine agent files cannot carry drops the engine and its model, with reasons', () => {
  const { manifest, omitted } = buildHireManifest({ ...fullAgent(), provider: 'gemini', model: 'gemini-3-pro' });
  assert.equal(manifest.provider, undefined);
  assert.equal(manifest.model, undefined);
  assert.deepEqual(omitted, [
    { field: 'provider', reason: 'unsupported-provider' },
    { field: 'model', reason: 'needs-provider' }
  ]);
});

test('over-long text and bad caps are refused, and the result still validates', () => {
  const { manifest, omitted } = buildHireManifest({ ...fullAgent(), description: 'x'.repeat(201), goal: 'y'.repeat(4001), tokenCap: -1 });
  assert.deepEqual(omitted.map((o) => [o.field, o.reason]), [['description', 'too-long'], ['goal', 'too-long'], ['tokenCap', 'invalid']]);
  assert.equal(validateHireManifest(JSON.parse(JSON.stringify(manifest))).ok, true);
});

test('fields outside the export source cannot reach the file', () => {
  const { manifest } = buildHireManifest({
    ...fullAgent(), command: 'claude --dangerously-skip-permissions', cwd: '/home/sam/repo',
    worktreePath: '/home/sam/wt', env: { API_KEY: 'hidden' }
  });
  const json = JSON.stringify(manifest);
  for (const leak of ['dangerously', '/home/sam', 'hidden', 'commandFlags']) assert.ok(!json.includes(leak), leak);
});

test('a blank name is an error, not a broken file', () => {
  const { manifest, errors } = buildHireManifest({ name: '   ' });
  assert.equal(manifest, null);
  assert.ok(errors.length > 0);
});

test('the main process refuses to save an invalid manifest', () => {
  assert.equal(prepareHireExport({ spec: 'munder-difflin/hire@1', name: 'x', commandFlags: ['--dangerously-skip-permissions'] }).ok, false);
  assert.equal(prepareHireExport('nope').ok, false);
});

test('a name with no usable characters still gets a safe file name', () => {
  assert.equal(prepareHireExport({ spec: 'munder-difflin/hire@1', name: '../..' }).fileName, 'agent.hire.json');
});

test('there are 36 unique templates, each a valid manifest in a known category', () => {
  assert.equal(HIRE_TEMPLATES.length, 36);
  assert.equal(new Set(HIRE_TEMPLATES.map((t) => t.id)).size, 36);
  for (const t of HIRE_TEMPLATES) {
    assert.ok(HIRE_TEMPLATE_CATEGORIES.includes(t.category), t.id);
    const v = validateHireManifest(templateManifest(t));
    assert.deepEqual(v.errors, [], t.id);
    assert.equal(v.ok, true, t.id);
    assert.equal(v.manifest.provider, undefined, t.id);
    assert.equal(buildHireManifest({ name: t.name, goal: t.goal, description: t.description }).omitted.length, 0, t.id);
  }
});
