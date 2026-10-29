export const DEFAULT_SOUND_LIBRARY = {
  pet: 'https://assets.mixkit.co/sfx/preview/mixkit-dog-barking-7078.mp3',
  wow: 'https://assets.mixkit.co/sfx/preview/mixkit-arcade-game-over-213.mp3',
  fail: 'https://assets.mixkit.co/sfx/preview/mixkit-arcade-retro-game-over-213.mp3',
  amongus: 'https://assets.mixkit.co/sfx/preview/mixkit-game-notification-253.mp3',
  shield: 'https://assets.mixkit.co/sfx/preview/mixkit-sci-fi-click-900.mp3',
  meme: 'https://assets.mixkit.co/sfx/preview/mixkit-bubble-pop-up-2406.mp3',
  michael: 'https://assets.mixkit.co/sfx/preview/mixkit-tech-break-fail-1910.mp3',
  slap: 'https://assets.mixkit.co/sfx/preview/mixkit-jump-into-water-1338.mp3',
};

export function createRoomState(code) {
  return {
    code,
    members: new Map(),
    votes: new Map(),
    commandLog: [],
    createdAt: Date.now(),
    defaultSounds: DEFAULT_SOUND_LIBRARY,
  };
}

export function joinRoom(room, { socketId, nickname }) {
  const cleanedNick = String(nickname || 'Guest').trim().slice(0, 24) || 'Guest';
  const member = {
    id: socketId,
    socketId,
    nickname: cleanedNick,
    connected: true,
    isHost: room.members.size === 0,
    receiveOnly: false,
    receiveOnlyUntil: 0,
    canSendSound: true,
    lastSeen: Date.now(),
    lastVoteAt: 0,
  };
  room.members.set(socketId, member);
  return member;
}

export function removeMember(room, socketId) {
  const member = room.members.get(socketId);
  if (!member) return null;
  room.members.delete(socketId);
  for (const vote of room.votes.values()) {
    if (vote.targetId === socketId) {
      vote.status = 'cancelled';
      vote.result = { accepted: false, status: 'cancelled', reason: 'target disconnected' };
    }
  }
  return member;
}

export function getMemberStatus(room, socketId) {
  const member = room.members.get(socketId);
  if (!member) {
    return { connected: false, receiveOnly: false, canSendSound: false, remainingMs: 0 };
  }
  const now = Date.now();
  const receiveOnly = !!member.receiveOnlyUntil && member.receiveOnlyUntil > now;
  return {
    connected: member.connected,
    receiveOnly,
    canSendSound: member.canSendSound && !receiveOnly,
    remainingMs: Math.max(0, member.receiveOnlyUntil - now),
  };
}

export function getRoomSnapshot(room) {
  return {
    code: room.code,
    members: [...room.members.values()].map((member) => {
      const status = getMemberStatus(room, member.socketId);
      return {
        id: member.id,
        socketId: member.socketId,
        nickname: member.nickname,
        connected: member.connected,
        canSendSound: status.canSendSound,
        receiveOnly: status.receiveOnly,
        receiveOnlyRemainingMs: status.remainingMs,
      };
    }),
  };
}

export function sendSoundCommand(room, { senderId, targetIds = [], soundKey, volume = 1, includeSender = false }) {
  const sender = room.members.get(senderId);
  if (!sender) {
    return { accepted: false, reason: 'sender not found' };
  }

  if (getMemberStatus(room, senderId).receiveOnly) {
    return { accepted: false, reason: 'sender is in receive-only mode' };
  }

  const candidates = [...new Set((targetIds || []).filter(Boolean))];
  const targets = candidates
    .filter((id) => (includeSender ? room.members.has(id) : id !== senderId && room.members.has(id)));

  if (!targets.length && !includeSender) {
    return { accepted: false, reason: 'no valid recipients selected' };
  }

  const finalTargets = includeSender ? [...new Set([...targets, senderId])] : targets;

  room.commandLog.push({
    senderId,
    targets: finalTargets,
    soundKey,
    volume,
    createdAt: Date.now(),
  });

  return { accepted: true, targets: finalTargets };
}

export function createVote(room, { initiatorId, targetId }) {
  const initiator = room.members.get(initiatorId);
  const target = room.members.get(targetId);

  if (!initiator || !target || initiatorId === targetId) {
    return { id: null, status: 'rejected', result: { accepted: false, status: 'rejected' } };
  }

  const eligibleVoters = [...room.members.keys()].filter((memberId) => memberId !== targetId);
  const vote = {
    id: `vote-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    initiatorId,
    targetId,
    eligibleVoters,
    votes: new Map(),
    createdAt: Date.now(),
    endsAt: Date.now() + 30000,
    status: 'active',
    result: null,
  };

  room.votes.set(vote.id, vote);
  vote.result = {
    accepted: false,
    status: 'active',
    favourable: 0,
    against: 0,
    votesExpressed: 0,
    supportRate: 0,
    quorumRequired: Math.min(3, vote.eligibleVoters.length || 0),
    quorumReached: false,
    targetId: vote.targetId,
  };
  return vote;
}

export function castVote(room, voteId, electorId, direction) {
  const vote = room.votes.get(voteId);
  if (!vote || vote.status !== 'active') return { accepted: false, status: 'rejected' };
  if (!vote.eligibleVoters.includes(electorId)) return { accepted: false, status: 'rejected' };
  if (vote.votes.has(electorId)) return { accepted: false, status: 'rejected' };
  if (!['for', 'against'].includes(direction)) return { accepted: false, status: 'rejected' };

  vote.votes.set(electorId, direction);
  vote.result = evaluateVote(room, voteId);
  return { accepted: true, result: vote.result };
}

export function evaluateVote(room, voteId) {
  const vote = room.votes.get(voteId);
  if (!vote) return { accepted: false, status: 'cancelled' };

  const target = room.members.get(vote.targetId);
  if (!target) {
    vote.status = 'cancelled';
    return { accepted: false, status: 'cancelled', reason: 'target disconnected' };
  }

  const allVotes = [...vote.votes.values()];
  const validVotes = allVotes.filter((v) => v === 'for' || v === 'against');
  const favourable = allVotes.filter((v) => v === 'for').length;
  const negative = allVotes.filter((v) => v === 'against').length;

  const quorumRequired = vote.eligibleVoters.length < 3 ? vote.eligibleVoters.length : 3;
  const quorumReached = validVotes.length >= quorumRequired;
  const supportRate = validVotes.length === 0 ? 0 : (favourable / validVotes.length) * 100;
  const accepted = quorumReached && supportRate >= 60;

  if (!quorumReached) {
    vote.status = 'active';
    return {
      accepted: false,
      status: 'active',
      favourable,
      against: negative,
      votesExpressed: validVotes.length,
      supportRate: Number(supportRate.toFixed(2)),
      quorumRequired,
      quorumReached: false,
      targetId: vote.targetId,
    };
  }

  vote.status = accepted ? 'approved' : 'rejected';
  if (vote.status === 'approved') {
    const targetMember = room.members.get(vote.targetId);
    if (targetMember) {
      targetMember.receiveOnly = true;
      targetMember.receiveOnlyUntil = Date.now() + 120000;
      targetMember.canSendSound = false;
    }
  }

  return {
    accepted,
    status: vote.status,
    favourable,
    against: negative,
    votesExpressed: validVotes.length,
    supportRate: Number(supportRate.toFixed(2)),
    quorumRequired,
    quorumReached,
    targetId: vote.targetId,
  };
}

export function applyExpiredRestrictions(room) {
  const now = Date.now();
  const expired = [];
  for (const member of room.members.values()) {
    if (member.receiveOnlyUntil && member.receiveOnlyUntil <= now) {
      member.receiveOnly = false;
      member.receiveOnlyUntil = 0;
      member.canSendSound = true;
      expired.push(member.id);
    }
  }
  return expired;
}
