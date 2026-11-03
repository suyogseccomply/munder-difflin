'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { VOCABULARY_SIZE, cleanVocabulary, correctTranscript } = loadTs('src/shared/vocabulary.ts');
const {
  expiredFiles, faceFromWord, holdKeyFor, holdStep, mayDraftFor, newHoldState, ringPositions, teamReplyHowTo, teamReplyTarget
} = loadTs('src/shared/staplerExtras.ts');

const run = (steps) => {
  let state = newHoldState();
  const actions = [];
  for (const [key, down] of steps) {
    const r = holdStep(state, key, down);
    state = r.state;
    if (r.action) actions.push(r.action);
  }
  return actions;
};

test('holding all three keys starts, and letting any go stops, in any order', () => {
  assert.deepEqual(run([['ctrl', true], ['alt', true], ['space', true], ['space', false]]), ['start', 'stop']);
  assert.deepEqual(run([['space', true], ['alt', true], ['ctrl', true], ['ctrl', false]]), ['start', 'stop']);
});

test('auto-repeat and partial combinations do nothing', () => {
  assert.deepEqual(run([['ctrl', true], ['alt', true], ['space', true], ['space', true], ['space', true]]), ['start']);
  assert.deepEqual(run([['ctrl', true], ['space', true], ['space', false], ['ctrl', false]]), []);
});

test('it stops once, and can start again', () => {
  assert.deepEqual(run([['ctrl', true], ['alt', true], ['space', true], ['alt', false], ['ctrl', false], ['space', false], ['ctrl', true], ['alt', true], ['space', true]]), ['start', 'stop', 'start']);
});

test('only the combination keys are recognised', () => {
  const codes = { ctrl: [29, 3613], alt: [56, 3640], space: 57 };
  assert.equal(holdKeyFor(3613, codes), 'ctrl');
  assert.equal(holdKeyFor(56, codes), 'alt');
  assert.equal(holdKeyFor(57, codes), 'space');
  for (const other of [30, 31, 0, 28]) assert.equal(holdKeyFor(other, codes), null);
});

test('technical names are spelled right, including common mishearings', () => {
  assert.equal(correctTranscript('deploy it on cube ernetes with post gress'), 'deploy it on Kubernetes with Postgres');
  assert.equal(correctTranscript('push to get hub and ask clawed'), 'push to GitHub and ask Claude');
  assert.equal(correctTranscript('our arr grew and anthropic replied'), 'our ARR grew and Anthropic replied');
  assert.equal(correctTranscript('the node js api'), 'the Node.js API');
  assert.ok(VOCABULARY_SIZE >= 100);
});

test('whole words only, and ordinary words are left alone', () => {
  assert.equal(correctTranscript('carrying the barrel'), 'carrying the barrel');
  assert.equal(correctTranscript('a linear notion with slack time'), 'a linear notion with slack time');
  assert.equal(correctTranscript('we react fast in windows of time'), 'we react fast in windows of time');
  assert.equal(correctTranscript('nothing to see'), 'nothing to see');
});

test('your own words win, and bad entries are ignored', () => {
  assert.equal(correctTranscript('ask seccomply about it', ['SecComply']), 'ask SecComply about it');
  assert.equal(correctTranscript('the a.b thing and axb', ['A.B']), 'the A.B thing and axb', 'a dot is not a wildcard');
  assert.deepEqual(cleanVocabulary(['  x ', 'x', '', 5, 'y'.repeat(61)]), ['x']);
  assert.deepEqual(cleanVocabulary('nope'), []);
});

test('screenshots go after a day and not before', () => {
  const now = 1e12;
  const day = 86400000;
  const files = [{ n: 'old', mtimeMs: now - day - 1 }, { n: 'edge', mtimeMs: now - day }, { n: 'new', mtimeMs: now - 5 }];
  assert.deepEqual(expiredFiles(files, now).map((f) => f.n), ['old']);
});

test('the ring starts at the top and is evenly spaced', () => {
  const p = ringPositions(4, 100);
  assert.deepEqual(p[0], { x: 0, y: -100 });
  assert.deepEqual(p[2], { x: 0, y: 100 });
  assert.equal(ringPositions(5, 80).length, 5);
});

test('a word always draws the same face, within range', () => {
  assert.deepEqual(faceFromWord('Pam '), faceFromWord('pam'));
  assert.notDeepEqual(faceFromWord('pam'), faceFromWord('dwight'));
  for (const word of ['', 'a', 'jelly', '日本語']) {
    const f = faceFromWord(word);
    assert.ok(f.hue >= 0 && f.hue < 360);
    assert.ok(f.eyeSize >= 2 && f.eyeSize <= 4);
    assert.ok(['smile', 'flat', 'open', 'smirk'].includes(f.mouth));
  }
});

const office = 'a'.repeat(40);

test('a team reply is recognised only in its exact form', () => {
  assert.equal(teamReplyTarget(`[team-reply ${office}]`), office);
  assert.equal(teamReplyTarget(`[team-reply ${office}] extra`), office);
  for (const bad of ['[team-reply abc]', `re: [team-reply ${office}]`, null, 5]) assert.equal(teamReplyTarget(bad), null, String(bad));
  assert.ok(teamReplyHowTo(office).includes(`[team-reply ${office}]`));
});

test('only whoever answers a teammate can draft for them', () => {
  assert.equal(mayDraftFor({ agentId: 'jim' }, 'jim'), true);
  assert.equal(mayDraftFor({ agentId: 'jim' }, 'pam'), false);
  assert.equal(mayDraftFor('you', 'jim'), false);
  assert.equal(mayDraftFor({ agentId: 'temp' }, 'worker-x'), true);
  assert.equal(mayDraftFor({ agentId: 'temp:jim' }, 'worker-x'), true);
  assert.equal(mayDraftFor({ agentId: 'temp' }, 'jim'), false);
});
