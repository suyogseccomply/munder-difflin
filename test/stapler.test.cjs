'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  MAX_SHOTS_PER_SEND, addShot, cleanSegmentText, formatTranscript, isSafeMeetingId, meetingFolderName,
  mergeSegments, normalizeRegion, pasteCommand, searchMeetings
} = loadTs('src/shared/stapler.ts');

const bounds = { width: 100, height: 100 };

test('a region can be dragged in any direction and stays on the image', () => {
  assert.deepEqual(normalizeRegion({ x: 50, y: 60 }, { x: 10, y: 20 }, bounds), { x: 10, y: 20, width: 40, height: 40 });
  assert.deepEqual(normalizeRegion({ x: -20, y: -20 }, { x: 500, y: 500 }, bounds), { x: 0, y: 0, width: 100, height: 100 });
});

test('a stray click is not a selection', () => {
  assert.equal(normalizeRegion({ x: 5, y: 5 }, { x: 8, y: 8 }, bounds), null);
});

test('a batch holds at most eight shots', () => {
  let shots = [];
  for (let i = 0; i < MAX_SHOTS_PER_SEND; i++) shots = addShot(shots, i).shots;
  assert.equal(shots.length, 8);
  const over = addShot(shots, 99);
  assert.equal(over.full, true);
  assert.equal(over.shots.length, 8);
});

test('silence markers are dropped, and real words are kept', () => {
  for (const noise of ['[BLANK_AUDIO]', ' (silence) ', '[Music]', 'BLANK AUDIO.', '   ']) assert.equal(cleanSegmentText(noise), '', noise);
  assert.equal(cleanSegmentText('  the   music was good '), 'the music was good');
});

test('both sides merge in spoken order, and a tie keeps its order', () => {
  const merged = mergeSegments([
    { speaker: 'them', atMs: 2000, text: 'second' },
    { speaker: 'you', atMs: 0, text: 'first' },
    { speaker: 'you', atMs: 2000, text: 'tied' },
    { speaker: 'them', atMs: 1000, text: '[BLANK_AUDIO]' }
  ]);
  assert.deepEqual(merged.map((s) => s.text), ['first', 'second', 'tied']);
});

test('the transcript says You and Them, with times', () => {
  const text = formatTranscript([{ speaker: 'them', atMs: 65000, text: 'hello' }, { speaker: 'you', atMs: 5000, text: 'hi' }]);
  assert.equal(text, '[00:05] You: hi\n[01:05] Them: hello');
});

test('folder names are safe, and ids from outside cannot escape', () => {
  const at = Date.parse('2026-11-02T10:30:05Z');
  assert.equal(meetingFolderName(at, 'Q4 Plan / Review!'), '2026-11-02-10-30-05-q4-plan-review');
  assert.equal(meetingFolderName(at, '../../etc'), '2026-11-02-10-30-05-etc');
  assert.equal(isSafeMeetingId(meetingFolderName(at, '../../etc')), true);
  for (const bad of ['..', '../x', 'a/b', '2026-..\\x', '', null, 5, 'C:\\x']) assert.equal(isSafeMeetingId(bad), false, String(bad));
});

test('meeting search covers titles and transcripts, newest first', () => {
  const m = [
    { id: '1', title: 'Budget', startedAt: 1, transcript: 'numbers' },
    { id: '2', title: 'Hiring', startedAt: 2, transcript: 'budget talk' },
    { id: '3', title: 'Other', startedAt: 3, transcript: 'nothing' }
  ];
  assert.deepEqual(searchMeetings(m, 'BUDGET').map((x) => x.id), ['2', '1']);
  assert.deepEqual(searchMeetings(m, '').map((x) => x.id), ['3', '2', '1']);
});

test('each platform pastes with a fixed command, and the text is never in it', () => {
  for (const p of ['win32', 'darwin', 'linux']) assert.ok(pasteCommand(p).command, p);
  assert.equal(pasteCommand('aix'), null);
});
