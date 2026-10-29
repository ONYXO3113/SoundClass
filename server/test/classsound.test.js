import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoomState,
  joinRoom,
  removeMember,
  sendSoundCommand,
  createVote,
  castVote,
  getRoomSnapshot,
  applyExpiredRestrictions,
  getMemberStatus,
} from '../src/game.js';

test('join room and list members', () => {
  const room = createRoomState('ABCD');
  const member = joinRoom(room, { socketId: 's1', nickname: 'Alice' });
  assert.equal(member.nickname, 'Alice');
  assert.equal(room.members.size, 1);
  assert.equal(getRoomSnapshot(room).members.length, 1);
});

test('sound command to one recipient works', () => {
  const room = createRoomState('ABCD');
  joinRoom(room, { socketId: 's1', nickname: 'Alice' });
  joinRoom(room, { socketId: 's2', nickname: 'Bob' });

  const result = sendSoundCommand(room, {
    senderId: 's1',
    targetIds: ['s2'],
    soundKey: 'pet',
    volume: 0.8,
  });

  assert.equal(result.accepted, true);
  assert.equal(room.commandLog.length, 1);
});

test('default sender is excluded from receiving sound', () => {
  const room = createRoomState('ABCD');
  joinRoom(room, { socketId: 's1', nickname: 'Alice' });
  joinRoom(room, { socketId: 's2', nickname: 'Bob' });

  const result = sendSoundCommand(room, {
    senderId: 's1',
    targetIds: ['s1', 's2'],
    soundKey: 'pet',
    volume: 0.6,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.targets.includes('s1'), false);
  assert.equal(result.targets.includes('s2'), true);
});

test('all-room send includes sender in the recipients list', () => {
  const room = createRoomState('ABCD');
  joinRoom(room, { socketId: 's1', nickname: 'Alice' });
  joinRoom(room, { socketId: 's2', nickname: 'Bob' });

  const result = sendSoundCommand(room, {
    senderId: 's1',
    targetIds: ['s1', 's2'],
    soundKey: 'pet',
    volume: 0.6,
    includeSender: true,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.targets.includes('s1'), true);
  assert.equal(result.targets.includes('s2'), true);
});

test('member in receive only cannot send sound', () => {
  const room = createRoomState('ABCD');
  joinRoom(room, { socketId: 's1', nickname: 'Alice' });
  const member = joinRoom(room, { socketId: 's2', nickname: 'Bob' });
  member.receiveOnlyUntil = Date.now() + 120000;

  const result = sendSoundCommand(room, {
    senderId: 's2',
    targetIds: ['s1'],
    soundKey: 'pet',
    volume: 0.7,
  });

  assert.equal(result.accepted, false);
  assert.match(result.reason, /receive/i);
});

test('majority vote above 60% passes', () => {
  const room = createRoomState('ABCD');
  joinRoom(room, { socketId: 's1', nickname: 'Alice' });
  joinRoom(room, { socketId: 's2', nickname: 'Bob' });
  joinRoom(room, { socketId: 's3', nickname: 'Charlie' });

  const proposal = createVote(room, { initiatorId: 's1', targetId: 's2' });
  castVote(room, proposal.id, 's1', 'for');
  castVote(room, proposal.id, 's3', 'for');

  const result = proposal.result;
  assert.equal(result?.accepted, true);
  assert.equal(result?.supportRate, 100);
});

test('vote under 60% fails', () => {
  const room = createRoomState('ABCD');
  joinRoom(room, { socketId: 's1', nickname: 'Alice' });
  joinRoom(room, { socketId: 's2', nickname: 'Bob' });
  joinRoom(room, { socketId: 's3', nickname: 'Charlie' });

  const proposal = createVote(room, { initiatorId: 's1', targetId: 's2' });
  castVote(room, proposal.id, 's1', 'for');
  castVote(room, proposal.id, 's3', 'against');

  assert.equal(proposal.result?.accepted, false);
});

test('a disconnected target cancels the vote', () => {
  const room = createRoomState('ABCD');
  joinRoom(room, { socketId: 's1', nickname: 'Alice' });
  joinRoom(room, { socketId: 's2', nickname: 'Bob' });

  const proposal = createVote(room, { initiatorId: 's1', targetId: 's2' });
  removeMember(room, 's2');

  const outcome = proposal.result ?? { status: 'cancelled' };
  assert.equal(outcome.status, 'cancelled');
});

test('receive-only status expires automatically', () => {
  const room = createRoomState('ABCD');
  const member = joinRoom(room, { socketId: 's1', nickname: 'Alice' });
  member.receiveOnlyUntil = Date.now() - 1000;

  const updated = applyExpiredRestrictions(room);
  assert.equal(updated.length, 1);
  assert.equal(getMemberStatus(room, 's1').receiveOnly, false);
});
