'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  ROLE_BUNDLES, applyRoleBundle, filterCapabilities, isSafeServerSpec, parseCapabilityList,
  resolveAgentMcp, serverSpecFromEntry, serversForAgent
} = loadTs('src/shared/capabilities.ts');
const { loadCapabilityList, verifyCapabilityUpdate } = loadTs('src/main/capabilityList.ts');
const { MCP_CATALOG } = loadTs('src/shared/mcpCatalog.ts');

const entry = (over = {}) => ({
  id: 'demo', name: 'Demo', kind: 'mcp-server', purposes: ['search'], maker: 'Acme', tier: 'vendor',
  source: 'https://github.com/acme/demo', what: 'Does a demo thing.', wave: 1, worksWith: ['claude'],
  install: { door: 'mcp-local', ref: 'demo', manual: ['By hand: add a server to your client with the command npx and the arguments -y @acme/demo --stdio'] },
  ...over
});
const list = (...entries) => JSON.stringify({ version: 1, purposes: [{ id: 'search', label: 'Web search' }], entries });
const parseOne = (over) => parseCapabilityList(list(entry(over))).entries[0];

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const signedUpdate = (catalog, issuedAt = '2026-10-16T16:56:30.784Z', key = privateKey) => {
  const digest = createHash('sha256').update(catalog).digest('hex');
  const signature = sign(null, Buffer.from(['munder-difflin/catalog-update@1', issuedAt, digest].join('\n')), key).toString('base64');
  return JSON.stringify({ format: 'munder-difflin/catalog-update@1', issuedAt, catalog, signature });
};

// ─── Parsing ────────────────────────────────────────────────────────────────

test('the list parses, and malformed or duplicate entries are dropped', () => {
  const parsed = parseCapabilityList(list(entry(), entry(), entry({ id: '../bad' }), entry({ id: 'x', kind: 'virus' }), entry({ id: 'y', source: 'http://insecure' }), 'nope'));
  assert.deepEqual(parsed.entries.map((e) => e.id), ['demo']);
  assert.deepEqual(parsed.purposes, [{ id: 'search', label: 'Web search' }]);
});

test('unreadable input is refused rather than treated as empty', () => {
  for (const bad of ['{not json', 'null', '{}', '{"entries":[]}']) assert.equal(parseCapabilityList(bad), null, bad);
});

test('an unreviewed entry carries no install actions, whatever it claims', () => {
  const e = parseOne({ wave: 3, install: { door: 'command', steps: [{ argv: ['claude', 'mcp', 'add', 'x', '--', 'npx', 'evil'], label: 'go' }], url: 'https://x', manual: ['Read the docs'] } });
  assert.equal(e.reviewed, false);
  assert.equal(e.door, 'none');
  assert.deepEqual(e.steps, []);
  assert.equal(serverSpecFromEntry(e), null);
});

test('a secret name that is not an env var name is dropped', () => {
  const e = parseOne({ signIn: { kind: 'key', secretNames: ['GOOD_KEY', 'bad name', 'PATH=evil'] } });
  assert.deepEqual(e.secretNames, ['GOOD_KEY']);
  assert.equal(e.signIn, 'key');
});

// ─── Server specs ───────────────────────────────────────────────────────────

test('a reviewed entry yields its launch spec from a written-out line', () => {
  assert.deepEqual(serverSpecFromEntry(parseOne()), { command: 'npx', args: ['-y', '@acme/demo', '--stdio'] });
});

test('a reviewed entry yields its spec from a claude mcp add step or manual line', () => {
  const fromStep = parseOne({ install: { door: 'command', steps: [{ argv: ['claude', 'mcp', 'add', 'demo', '--scope', 'user', '--', 'uvx', 'demo-mcp'], label: 'Add' }], manual: [] } });
  assert.deepEqual(serverSpecFromEntry(fromStep), { command: 'uvx', args: ['demo-mcp'] });
  const fromLine = parseOne({ install: { door: 'mcp-local', manual: ['By hand in Claude Code: claude mcp add --scope user demo -- npx -y @acme/demo'] } });
  assert.deepEqual(serverSpecFromEntry(fromLine), { command: 'npx', args: ['-y', '@acme/demo'] });
});

test('a hosted server has no launch spec, and neither does a non-server', () => {
  const hosted = parseOne({ install: { door: 'command', steps: [{ argv: ['claude', 'mcp', 'add', '--transport', 'http', 'demo', 'https://x.example/mcp'], label: 'Add' }], manual: [] } });
  assert.equal(serverSpecFromEntry(hosted), null);
  assert.equal(serverSpecFromEntry(parseOne({ kind: 'skill' })), null);
});

for (const [label, spec] of [
  ['an arbitrary program', { command: 'powershell', args: ['-c', 'x'] }],
  ['a local path', { command: 'C:\\evil.exe', args: ['x'] }],
  ['cmd.exe chaining', { command: 'npx', args: ['-y', 'x&calc'] }],
  ['a pipe', { command: 'npx', args: ['x|y'] }],
  ['env expansion', { command: 'npx', args: ['%PATH%'] }],
  ['a space', { command: 'npx', args: ['a b'] }],
  ['a quote', { command: 'npx', args: ['a"b'] }],
  ['no arguments', { command: 'npx', args: [] }],
  ['non-string arguments', { command: 'npx', args: [1] }],
  ['nothing at all', null]
]) {
  test(`a spec with ${label} is refused`, () => assert.equal(isSafeServerSpec(spec), false));
}

test('a line whose arguments would chain a command yields no spec', () => {
  const e = parseOne({ install: { door: 'mcp-local', manual: ['add a server with the command npx and the arguments -y x&calc'] } });
  assert.equal(serverSpecFromEntry(e), null);
});

// ─── Grants ─────────────────────────────────────────────────────────────────

const serverIds = (mcp) => Object.keys(mcp.servers);
const safeDefaults = MCP_CATALOG.filter((e) => e.tier === 'safe-readonly' && e.defaultEnabled).map((e) => `munder-${e.id}`);

test('an agent with no grants behaves as before', () => {
  assert.deepEqual(serverIds(resolveAgentMcp('/w', undefined, undefined, undefined)).sort(), [...safeDefaults].sort());
});

test('filesystem and git stay scoped to the agent folder', () => {
  const fs = resolveAgentMcp('/work/here', undefined, undefined, undefined).servers['munder-filesystem'];
  assert.ok(fs.args.includes('/work/here'));
  assert.ok(!fs.args.includes('<cwd>'));
});

test('an agent grant beats the floor in both directions', () => {
  const off = resolveAgentMcp('/w', { fetch: { enabled: true } }, { fetch: false }, undefined);
  assert.ok(!serverIds(off).includes('munder-fetch'));
  const on = resolveAgentMcp('/w', { fetch: { enabled: false } }, { fetch: true }, undefined);
  assert.ok(serverIds(on).includes('munder-fetch'));
});

test('a secret server needs an explicit yes, and only names its key', () => {
  assert.ok(!serverIds(resolveAgentMcp('/w', undefined, undefined, undefined)).includes('munder-github-token'));
  const granted = resolveAgentMcp('/w', undefined, { 'github-token': true }, undefined);
  assert.ok(serverIds(granted).includes('munder-github-token'));
  assert.deepEqual(granted.secretNames, ['GITHUB_PERSONAL_ACCESS_TOKEN']);
  assert.equal(granted.servers['munder-github-token'].env, undefined);
});

test('a list server reaches only the agents granted it, and a bad spec never does', () => {
  const servers = {
    demo: { label: 'Demo', command: 'npx', args: ['-y', '@acme/demo'], secretNames: ['DEMO_KEY', 'bad name'] },
    evil: { label: 'Evil', command: 'powershell', args: ['-c', 'x'], secretNames: [] }
  };
  const a = resolveAgentMcp('/w', undefined, { demo: true, evil: true }, servers);
  assert.deepEqual(a.servers['munder-list-demo'], { command: 'npx', args: ['-y', '@acme/demo'] });
  assert.ok(!serverIds(a).includes('munder-list-evil'));
  assert.deepEqual(a.secretNames, ['DEMO_KEY']);
  assert.ok(!serverIds(resolveAgentMcp('/w', undefined, undefined, servers)).includes('munder-list-demo'));
});

test('there are eleven bundles naming only real servers', () => {
  assert.equal(ROLE_BUNDLES.length, 11);
  const known = new Set(MCP_CATALOG.map((e) => e.id));
  for (const b of ROLE_BUNDLES) for (const s of b.servers) assert.ok(known.has(s), `${b.id}: ${s}`);
});

test('a bundle turns on its safe servers and asks consent for the rest', () => {
  const bundle = ROLE_BUNDLES.find((b) => b.id === 'reviewer');
  const { grants, needsConsent } = applyRoleBundle(bundle, undefined);
  assert.equal(grants.git, true);
  assert.equal(grants.fetch, false);
  assert.deepEqual(needsConsent, ['github-token']);
  assert.equal(grants['github-token'], false);
});

test('a bundle keeps an existing consent and leaves list servers alone', () => {
  const bundle = ROLE_BUNDLES.find((b) => b.id === 'reviewer');
  const { grants } = applyRoleBundle(bundle, { 'github-token': true, demo: true });
  assert.equal(grants['github-token'], true);
  assert.equal(grants.demo, true);
});

test('who has what lists plain server ids per agent', () => {
  const servers = { demo: { label: 'Demo', command: 'npx', args: ['x'], secretNames: [] } };
  const ids = serversForAgent(undefined, { demo: true, time: false }, servers);
  assert.ok(ids.includes('demo'));
  assert.ok(!ids.includes('time'));
  assert.ok(ids.includes('fetch'));
});

test('filters combine', () => {
  const { entries } = parseCapabilityList(list(entry(), entry({ id: 'b', name: 'Other', kind: 'skill', wave: 3, purposes: ['testing'] })));
  assert.deepEqual(filterCapabilities(entries, { query: 'other' }).map((e) => e.id), ['b']);
  assert.deepEqual(filterCapabilities(entries, { kind: 'skill' }).map((e) => e.id), ['b']);
  assert.deepEqual(filterCapabilities(entries, { reviewedOnly: true }).map((e) => e.id), ['demo']);
  assert.deepEqual(filterCapabilities(entries, { purpose: 'testing', reviewedOnly: true }), []);
});

// ─── Signature and cache ────────────────────────────────────────────────────

test('a correctly signed list verifies', () => {
  assert.equal(verifyCapabilityUpdate(signedUpdate(list(entry())), publicKey).catalog, list(entry()));
});

test('a tampered catalog, wrong key, or junk fails verification', () => {
  const body = JSON.parse(signedUpdate(list(entry())));
  assert.equal(verifyCapabilityUpdate(JSON.stringify({ ...body, catalog: list(entry({ name: 'Evil' })) }), publicKey), null);
  assert.equal(verifyCapabilityUpdate(JSON.stringify({ ...body, issuedAt: '2030-01-01T00:00:00.000Z' }), publicKey), null);
  assert.equal(verifyCapabilityUpdate(signedUpdate(list(entry()), undefined, generateKeyPairSync('ed25519').privateKey), publicKey), null);
  for (const junk of ['{', 'null', '{}']) assert.equal(verifyCapabilityUpdate(junk, publicKey), null);
});

const withDir = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'munder-capabilities-'));
  try { await fn(join(dir, 'list.json')); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('a fetched list is cached and served without the network', () => withDir(async (cache) => {
  const first = await loadCapabilityList(cache, { key: publicKey, now: 1000, fetcher: async () => signedUpdate(list(entry())) });
  assert.equal(first.list.entries.length, 1);
  const second = await loadCapabilityList(cache, { key: publicKey, now: 2000, fetcher: async () => { throw new Error('should not fetch'); } });
  assert.equal(second.stale, false);
  assert.equal(second.list.entries.length, 1);
}));

test('offline falls back to the last good copy, flagged stale', () => withDir(async (cache) => {
  await loadCapabilityList(cache, { key: publicKey, now: 1000, fetcher: async () => signedUpdate(list(entry())) });
  const later = await loadCapabilityList(cache, { key: publicKey, now: 1000 + 2 * 86400000, fetcher: async () => { throw new Error('offline'); } });
  assert.equal(later.stale, true);
  assert.equal(later.error, 'offline');
  assert.equal(later.list.entries.length, 1);
}));

test('offline with no cache reports the error and no list', () => withDir(async (cache) => {
  const r = await loadCapabilityList(cache, { key: publicKey, fetcher: async () => { throw new Error('offline'); } });
  assert.equal(r.list, null);
  assert.equal(r.error, 'offline');
}));

test('a tampered download is refused and the good copy survives', () => withDir(async (cache) => {
  await loadCapabilityList(cache, { key: publicKey, now: 1000, fetcher: async () => signedUpdate(list(entry())) });
  const body = JSON.parse(signedUpdate(list(entry())));
  const r = await loadCapabilityList(cache, { key: publicKey, force: true, now: 2000, fetcher: async () => JSON.stringify({ ...body, catalog: list(entry({ name: 'Evil' })) }) });
  assert.equal(r.stale, true);
  assert.match(r.error, /signature/);
  assert.equal(r.list.entries[0].name, 'Demo');
}));

test('a cache edited on disk is not believed', () => withDir(async (cache) => {
  await loadCapabilityList(cache, { key: publicKey, now: 1000, fetcher: async () => signedUpdate(list(entry())) });
  const stored = JSON.parse(readFileSync(cache, 'utf8'));
  const update = JSON.parse(stored.update);
  update.catalog = list(entry({ name: 'Evil' }));
  writeFileSync(cache, JSON.stringify({ ...stored, update: JSON.stringify(update) }));
  const r = await loadCapabilityList(cache, { key: publicKey, now: 2000, fetcher: async () => { throw new Error('offline'); } });
  assert.equal(r.list, null);
}));

// ─── Spawn wiring ───────────────────────────────────────────────────────────

test('servers reach Claude through --mcp-config=, not a settings file', () => {
  const hive = readFileSync('src/main/hive.ts', 'utf8');
  // Claude Code ignores mcpServers in --settings; the agent would silently get none.
  assert.ok(!/hookSettings[\s\S]{0,4000}\{ mcpServers \}\s*:\s*\{\}/.test(hive));
  // The space form is variadic and swallows the prompt, so Claude fails to start.
  assert.match(hive, /args\.push\(`--mcp-config=\$\{mcpPath\}`\)/);
  assert.ok(!/args\.push\('--mcp-config'/.test(hive));
});

// ─── Install steps, skills and integrations ─────────────────────────────────

const { integrationsForAgent, isRunnableStep, skillsForAgent } = loadTs('src/shared/capabilities.ts');

test('only exact, reviewed-shape commands can be run for the user', () => {
  for (const ok of [
    ['claude', 'mcp', 'add', 'x', '--', 'npx', '-y', 'pkg'],
    ['claude', 'mcp', 'add', '--transport', 'http', 'x', 'https://x.example/mcp'],
    ['claude', 'plugin', 'install', 'skill-creator@claude-plugins-official'],
    ['codex', 'mcp', 'add', 'x', '--url', 'https://x.example/mcp']
  ]) assert.equal(isRunnableStep(ok), true, ok.join(' '));
  for (const bad of [
    ['claude', 'mcp', 'add'],
    ['claude', '--dangerously-skip-permissions'],
    ['claude', 'mcp', 'remove', 'x'],
    ['npx', '-y', 'evil'],
    ['brew', 'install', 'x'],
    ['powershell', '-c', 'x'],
    ['claude', 'mcp', 'add', 'x', 'a&calc'],
    ['claude', 'mcp', 'add', 'x', 'a|b'],
    ['claude', 'mcp', 'add', 'x', 'a b'],
    ['claude', 'mcp', 'add', 'x', '%PATH%'],
    ['claude', 'mcp', 'add', 'x', 'https://x?a=1&b=2'],
    'claude mcp add x', null, [], [1, 2, 3]
  ]) assert.equal(isRunnableStep(bad), false, String(bad));
});

test('skills are on unless turned off, and integrations are off unless granted', () => {
  assert.deepEqual(skillsForAgent(['a', 'b'], undefined), ['a', 'b']);
  assert.deepEqual(skillsForAgent(['a', 'b'], { a: false, b: true }), ['b']);
  assert.deepEqual(integrationsForAgent(['x', 'y'], undefined), []);
  assert.deepEqual(integrationsForAgent(['x', 'y'], ['y', 'revoked']), ['y']);
});

test('a skill turned off for an agent is removed, and the others are copied', () => {
  const { HiveManager } = loadTs('src/main/hive.ts');
  const { mkdirSync, existsSync } = require('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'munder-skills-'));
  try {
    const src = join(dir, 'src');
    const dest = join(dir, 'dest');
    for (const id of ['keep', 'drop']) { mkdirSync(join(src, id), { recursive: true }); writeFileSync(join(src, id, 'SKILL.md'), id); }
    const hive = new HiveManager(() => dir);
    hive.copyBundledSkills(src, dest);
    assert.equal(existsSync(join(dest, 'drop', 'SKILL.md')), true);
    hive.copyBundledSkills(src, dest, { drop: false });
    assert.equal(existsSync(join(dest, 'drop')), false);
    assert.equal(existsSync(join(dest, 'keep', 'SKILL.md')), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ─── Slack ──────────────────────────────────────────────────────────────────

const { channelAllowed, parseChannelList, slackManifest } = loadTs('src/shared/slackSetup.ts');

test('channel lists parse, and an empty one means every channel', () => {
  assert.deepEqual(parseChannelList(' C1, C2  C3 '), ['C1', 'C2', 'C3']);
  assert.deepEqual(parseChannelList(undefined), []);
  assert.equal(channelAllowed([], 'C9'), true);
  assert.equal(channelAllowed(['C1'], 'C1'), true);
  assert.equal(channelAllowed(['C1'], 'C9'), false);
  assert.equal(channelAllowed(['C1'], undefined), false);
});

test('the trigger filter accepts several channels', () => {
  const { shouldTrigger } = require('../src/main/slack-trigger.cjs');
  const ev = (channel) => ({ channel, text: '<@BOT> hi', user: 'U', ts: '1', type: 'app_mention' });
  const threads = { has: () => false, add: () => {} };
  assert.equal(shouldTrigger(ev('C2'), 'BOT', 'C1, C2', threads).trigger, true);
  assert.equal(shouldTrigger(ev('C3'), 'BOT', 'C1, C2', threads).trigger, false);
  assert.equal(shouldTrigger(ev('C3'), 'BOT', '', threads).trigger, true);
});

test('the manifest subscribes to mentions and direct messages, and uses a given URL', () => {
  const m = JSON.parse(slackManifest('https://t.example/slack'));
  assert.equal(m.settings.event_subscriptions.request_url, 'https://t.example/slack');
  for (const e of ['app_mention', 'message.channels', 'message.groups', 'message.im']) assert.ok(m.settings.event_subscriptions.bot_events.includes(e), e);
  assert.ok(m.oauth_config.scopes.bot.includes('chat:write'));
  assert.ok(!JSON.parse(slackManifest(undefined)).settings.event_subscriptions.request_url.includes('undefined'));
});
