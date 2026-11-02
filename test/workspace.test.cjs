'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  floorMessages, isStaleTask, normalizeWorkspaceView, shiftColumn, sortAgentCards, stageMove, stagedMovesMessage
} = loadTs('src/shared/workspace.ts');

test('only an explicit workspace value leaves Classic', () => {
  assert.equal(normalizeWorkspaceView('workspace'), 'workspace');
  for (const v of [undefined, null, 'pro', 1]) assert.equal(normalizeWorkspaceView(v), 'classic');
});

test('an open task over three days old is stale; done or dateless never is', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  assert.equal(isStaleTask({ status: 'doing', createdAt: '2026-11-01T00:00:00Z' }, now), true);
  assert.equal(isStaleTask({ status: 'doing', createdAt: '2026-11-09T00:00:00Z' }, now), false);
  assert.equal(isStaleTask({ status: 'done', createdAt: '2026-01-01T00:00:00Z' }, now), false);
  assert.equal(isStaleTask({ status: 'todo', createdAt: 'nonsense' }, now), false);
});

test('a move replaces the earlier one, and moving back unstages it', () => {
  const task = { id: 'a', title: 'A', status: 'todo' };
  let moves = stageMove([], task, 'doing');
  moves = stageMove(moves, task, 'done');
  assert.deepEqual(moves, [{ taskId: 'a', title: 'A', to: 'done' }]);
  assert.deepEqual(stageMove(moves, task, 'todo'), []);
});

test('arrow moves stop at the ends of the board', () => {
  assert.equal(shiftColumn('todo', 1), 'doing');
  assert.equal(shiftColumn('todo', -1), 'todo');
  assert.equal(shiftColumn('done', 1), 'done');
});

test('staged moves become one message, and a title cannot add lines', () => {
  const text = stagedMovesMessage([{ taskId: 'a', title: 'one\n- b "x" -> done', to: 'done' }]);
  assert.equal(text.split('\n').length, 2);
  assert.match(text, /a "one - b/);
});

test('a message in two mailboxes shows once, newest first, and search covers all fields', () => {
  const m = (id, created_at, subject, direction = 'inbox') => ({ id, from: 'jim', to: 'pam', subject, body: 'hello', created_at, direction });
  const all = [m('1', '2026-01-01T00:00:00Z', 'old'), m('1', '2026-01-01T00:00:00Z', 'old', 'outbox'), m('2', '2026-02-01T00:00:00Z', 'new')];
  assert.deepEqual(floorMessages(all, '').map((x) => x.id), ['2', '1']);
  assert.deepEqual(floorMessages(all, 'OLD').map((x) => x.id), ['1']);
  assert.equal(floorMessages(all, 'hello').length, 2);
  assert.deepEqual(floorMessages(all, 'zzz'), []);
});

test('cards put people-blocking agents first and leave out the orchestrator', () => {
  const order = sortAgentCards([
    { name: 'Idle', status: 'idle' }, { name: 'Boss', status: 'blocked', isGod: true },
    { name: 'Busy', status: 'working' }, { name: 'Stuck', status: 'blocked' }
  ]).map((a) => a.name);
  assert.deepEqual(order, ['Stuck', 'Busy', 'Idle']);
});

// ─── Tickets, filters and the queue ─────────────────────────────────────────

const { cleanTicketPrefix, inDateRange, isEditHeld, moveInList, nextTicketId, stagedStatus } = loadTs('src/shared/workspace.ts');
const { parseTasks } = (() => { try { return loadTs('src/renderer/src/components/TasksKanban.tsx'); } catch { return {}; } })();

test('ticket keys count up from the highest in use and ignore other id styles', () => {
  assert.equal(nextTicketId('V53', []), 'V53-1');
  assert.equal(nextTicketId('V53', ['V53-298', 'V53-2', 'bmt-900', 'V53-x', 'webhook-abc', 'V53-1.5']), 'V53-299');
  assert.equal(nextTicketId('V5', ['V53-298']), 'V5-1');
});

test('a ticket prefix is letters and digits starting with a letter', () => {
  assert.equal(cleanTicketPrefix('v53'), 'V53');
  assert.equal(cleanTicketPrefix('a-b c'), 'ABC');
  for (const bad of ['', '123', null, undefined, '!!']) assert.equal(cleanTicketPrefix(bad), 'MD', String(bad));
});

test('date ranges work, and an undated card shows only under All', () => {
  const now = new Date(2026, 10, 10, 15).getTime();
  const at = (d) => new Date(2026, 10, d, 9).toISOString();
  assert.equal(inDateRange(at(10), 'today', now), true);
  assert.equal(inDateRange(at(9), 'today', now), false);
  assert.equal(inDateRange(at(5), 'week', now), true);
  assert.equal(inDateRange(at(1), 'week', now), false);
  assert.equal(inDateRange(at(1), 'month', now), true);
  for (const missing of ['', undefined, 'nonsense']) {
    assert.equal(inDateRange(missing, 'today', now), false);
    assert.equal(inDateRange(missing, 'all', now), true);
  }
});

test('a staged move changes the column shown, not the card', () => {
  const task = { id: 'a', status: 'todo' };
  assert.equal(stagedStatus(task, [{ taskId: 'a', title: 'A', to: 'done' }]), 'done');
  assert.equal(stagedStatus(task, [{ taskId: 'b', title: 'B', to: 'done' }]), 'todo');
  assert.equal(task.status, 'todo');
});

test('a queued message moves one place and stops at the ends', () => {
  const q = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(moveInList(q, 'b', -1).map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(moveInList(q, 'b', 1).map((x) => x.id), ['a', 'c', 'b']);
  assert.deepEqual(moveInList(q, 'a', -1).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(moveInList(q, 'c', 1).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(moveInList(q, 'zzz', 1).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(q.map((x) => x.id), ['a', 'b', 'c'], 'the original is untouched');
});

test('an edit hold lapses, so a closed window cannot block the queue for good', () => {
  assert.equal(isEditHeld({ editingUntil: 100 }, 50), true);
  assert.equal(isEditHeld({ editingUntil: 100 }, 100), false);
  assert.equal(isEditHeld({}, 50), false);
});
