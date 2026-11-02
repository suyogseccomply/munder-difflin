'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { groupTextHits, parseMeaningResults, resultsMessage, shapeOfSource } = loadTs('src/shared/memoryResults.ts');

const SAMPLE = `Results for: "login"
============================================================

  [1] dwight / technical
      Source: memory.md
      Match:  cosine=0.61  bm25=1.20

      Fixed the session cookie.
      Tests pass now.
  ------------------------------------------------------------

  [2] jim / general
      Source: notes.md
      Match:  cosine=0.40

      Login page copy.
`;

test('printed results become hits with their fields', () => {
  const hits = parseMeaningResults(SAMPLE);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], { rank: 1, wing: 'dwight', room: 'technical', source: 'memory.md', match: 'cosine=0.61  bm25=1.20', body: 'Fixed the session cookie.\nTests pass now.' });
  assert.equal(hits[1].wing, 'jim');
  assert.equal(hits[1].body, 'Login page copy.');
});

test('Windows line endings parse the same', () => {
  assert.deepEqual(parseMeaningResults(SAMPLE.replace(/\n/g, '\r\n')), parseMeaningResults(SAMPLE));
});

test('output in any other shape yields nothing, so the raw text is shown', () => {
  for (const other of ['', 'No results found.', '{"results":[]}', 'plain text\nacross lines']) {
    assert.deepEqual(parseMeaningResults(other), [], other);
  }
});

test('results group as tickets, agents and notes, and nothing is dropped', () => {
  assert.equal(shapeOfSource('board.md'), 'tickets');
  assert.equal(shapeOfSource('tasks.json'), 'tickets');
  assert.equal(shapeOfSource('agents'), 'agents');
  assert.equal(shapeOfSource('dwight/memory.md'), 'notes');
  assert.equal(shapeOfSource('something-new'), 'notes');
  const g = groupTextHits([{ source: 'board.md', excerpt: 'a' }, { source: 'agents', excerpt: 'b' }, { source: 'x/memory.md', excerpt: 'c' }]);
  assert.deepEqual([g.tickets.length, g.agents.length, g.notes.length], [1, 1, 1]);
});

test('a prompt goes ahead of the results', () => {
  assert.match(resultsMessage('Use these', 'R'), /^Use these[\s\S]*R$/);
  assert.equal(resultsMessage('  ', 'R'), 'R');
});
