import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import multer from 'multer';
import { Server } from 'socket.io';
import {
  createRoomState,
  joinRoom,
  removeMember,
  sendSoundCommand,
  getRoomSnapshot,
  createVote,
  castVote,
  applyExpiredRestrictions,
  getMemberStatus,
} from './game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const rooms = new Map();
const socketToRoom = new Map();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_AUDIO_SIZE || 10 * 1024 * 1024) },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only audio files are accepted.'));
  },
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadDir));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.post('/upload', (req, res) => {
  upload.single('audio')(req, res, (error) => {
    if (error) {
      return res.status(400).json({ ok: false, error: error.message || 'Audio upload failed.' });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No audio file received.' });
    }

    const publicUrl = `/uploads/${req.file.filename}`;
    res.json({
      ok: true,
      url: publicUrl,
      name: req.file.originalname,
    });
  });
});

const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

const normalizeRoomCode = (roomCode) => String(roomCode || '').trim().toUpperCase();

function getRoom(roomCode) {
  const code = normalizeRoomCode(roomCode);
  if (!code) return null;
  if (!rooms.has(code)) {
    rooms.set(code, createRoomState(code));
  }
  return rooms.get(code);
}

function emitRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  io.to(roomCode).emit('room:state', getRoomSnapshot(room));
}

function cleanExpiredRestrictions() {
  for (const room of rooms.values()) {
    const expired = applyExpiredRestrictions(room);
    if (expired.length) {
      emitRoomState(room.code);
      io.to(room.code).emit('member:permissions', {
        roomCode: room.code,
        expired,
      });
    }
  }
}

setInterval(cleanExpiredRestrictions, 1000);

io.on('connection', (socket) => {
  socket.on('join:room', ({ roomCode, nickname }, ack = () => {}) => {
    const code = normalizeRoomCode(roomCode);
    if (!code || code.length < 4) {
      return ack({ ok: false, error: 'Room code is invalid.' });
    }

    const room = getRoom(code);
    const member = joinRoom(room, {
      socketId: socket.id,
      nickname,
    });

    const previousRoom = socketToRoom.get(socket.id);
    if (previousRoom && previousRoom !== code) {
      socket.leave(previousRoom);
    }

    socket.join(code);
    socketToRoom.set(socket.id, code);
    socket.data.roomCode = code;
    socket.data.member = member;

    emitRoomState(code);
    ack({ ok: true, roomCode: code, member: { id: socket.id, nickname: member.nickname } });
  });

  socket.on('sound:play', ({ targetIds = [], soundKey, volume = 1, includeSender = false }, ack = () => {}) => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) {
      return ack({ ok: false, error: 'You are not in a room.' });
    }

    const room = rooms.get(roomCode);
    if (!room) {
      return ack({ ok: false, error: 'Room not found.' });
    }

    const targets = [...new Set(targetIds.filter(Boolean))];
    const senderStatus = getMemberStatus(room, socket.id);
    if (senderStatus.receiveOnly) {
      return ack({ ok: false, error: 'You are in receive-only mode for 2 minutes.' });
    }

    const finalTargets = includeSender ? [...targets, socket.id] : targets;
    const result = sendSoundCommand(room, {
      senderId: socket.id,
      targetIds: finalTargets,
      soundKey,
      volume,
    });

    if (!result.accepted) {
      return ack({ ok: false, error: result.reason || 'Sound rejected.' });
    }

    const payload = {
      senderId: socket.id,
      senderNickname: room.members.get(socket.id)?.nickname || 'Unknown',
      soundKey,
      volume,
      targetIds: result.targets,
      sentAt: Date.now(),
    };

    for (const targetId of result.targets) {
      io.to(targetId).emit('sound:play', payload);
    }

    socket.emit('sound:accepted', { ok: true, recipients: result.targets });
    ack({ ok: true, recipients: result.targets });
  });

  socket.on('vote:start', ({ targetId }, ack = () => {}) => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) {
      return ack({ ok: false, error: 'You are not in a room.' });
    }

    const room = rooms.get(roomCode);
    const initiator = room?.members?.get(socket.id);
    const target = room?.members?.get(targetId);

    if (!room || !initiator || !target) {
      return ack({ ok: false, error: 'Invalid vote target.' });
    }

    const activeVotesForTarget = [...room.votes.values()].filter(
      (vote) => vote.targetId === targetId && vote.status === 'active',
    );
    if (activeVotesForTarget.length > 0) {
      return ack({ ok: false, error: 'A vote is already active for this user.' });
    }

    if (Date.now() - (initiator.lastVoteAt || 0) < 30000) {
      return ack({ ok: false, error: 'Please wait 30 seconds before starting another vote.' });
    }

    const vote = createVote(room, { initiatorId: socket.id, targetId });
    if (!vote || vote.id === null) {
      return ack({ ok: false, error: 'Vote was rejected.' });
    }

    initiator.lastVoteAt = Date.now();
    const payload = {
      id: vote.id,
      targetId,
      targetNickname: target.nickname,
      eligibleVoters: vote.eligibleVoters,
      endsAt: vote.endsAt,
      status: 'active',
      createdAt: vote.createdAt,
    };

    io.to(roomCode).emit('vote:created', payload);
    ack({ ok: true, vote: payload });
  });

  socket.on('vote:cast', ({ voteId, direction }, ack = () => {}) => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) {
      return ack({ ok: false, error: 'You are not in a room.' });
    }

    const room = rooms.get(roomCode);
    if (!room) {
      return ack({ ok: false, error: 'Room not found.' });
    }

    if (!['for', 'against'].includes(direction)) {
      return ack({ ok: false, error: 'Vote direction is invalid.' });
    }

    const result = castVote(room, voteId, socket.id, direction);
    if (!result.accepted) {
      return ack({ ok: false, error: 'Vote rejected.' });
    }

    const vote = room.votes.get(voteId);
    const payload = {
      id: voteId,
      targetId: vote.targetId,
      votes: [...vote.votes.entries()].map(([id, value]) => ({ memberId: id, value })),
      favourable: [...vote.votes.values()].filter((value) => value === 'for').length,
      against: [...vote.votes.values()].filter((value) => value === 'against').length,
      votesExpressed: [...vote.votes.values()].filter((value) => value === 'for' || value === 'against').length,
      status: vote.status,
      accepted: result.result.accepted,
      supportRate: result.result.supportRate,
      quorumReached: result.result.quorumReached,
      endsAt: vote.endsAt,
    };

    io.to(roomCode).emit('vote:update', payload);

    if (vote.status === 'approved' || vote.status === 'rejected' || vote.status === 'cancelled') {
      const finalResult = {
        id: voteId,
        targetId: vote.targetId,
        accepted: vote.result.accepted,
        status: vote.status,
        supportRate: vote.result.supportRate,
        favourable: vote.result.favourable,
        against: vote.result.against,
      };
      io.to(roomCode).emit('vote:result', finalResult);

      if (vote.status === 'approved') {
        const target = room.members.get(vote.targetId);
        if (target) {
          target.receiveOnly = true;
          target.receiveOnlyUntil = Date.now() + 120000;
          target.canSendSound = false;
        }
      }
    }

    ack({ ok: true, result: payload });
  });

  socket.on('room:request-state', (_, ack = () => {}) => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) {
      return ack({ ok: false, error: 'Not in a room.' });
    }
    const room = rooms.get(roomCode);
    if (!room) {
      return ack({ ok: false, error: 'Room missing.' });
    }
    ack({ ok: true, state: getRoomSnapshot(room) });
  });

  socket.on('disconnect', () => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    removeMember(room, socket.id);
    socketToRoom.delete(socket.id);

    for (const vote of room.votes.values()) {
      if (vote.targetId === socket.id) {
        vote.status = 'cancelled';
        vote.result = { accepted: false, status: 'cancelled', reason: 'target disconnected' };
      }
    }

    emitRoomState(roomCode);
    io.to(roomCode).emit('vote:cancelled', { roomCode, reason: 'target disconnected' });
  });
});

const port = Number(process.env.PORT || 3001);
server.listen(port, '0.0.0.0', () => {
  console.log(`ClassSound server running on http://localhost:${port}`);
});
