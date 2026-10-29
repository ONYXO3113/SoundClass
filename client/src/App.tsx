import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

type Member = {
  id: string;
  socketId: string;
  nickname: string;
  connected: boolean;
  canSendSound: boolean;
  receiveOnly: boolean;
  receiveOnlyRemainingMs: number;
};

type SoundItem = {
  key: string;
  label: string;
  emoji: string;
  url: string;
};

type VoteState = {
  id: string | null;
  targetId: string | null;
  targetNickname: string | null;
  endsAt: number | null;
  favourable: number;
  against: number;
  votesExpressed: number;
  supportRate: number;
  quorumReached: boolean;
  status: string;
};

const defaultSounds: SoundItem[] = [
  { key: 'pet', label: 'Dog bark', emoji: '🐶', url: '/sounds/pet.mp3' },
  { key: 'wow', label: 'Wow', emoji: '😱', url: '/sounds/wow.mp3' },
  { key: 'fail', label: 'Game over', emoji: '💥', url: '/sounds/fail.mp3' },
  { key: 'amongus', label: 'Among Us', emoji: '🚨', url: '/sounds/amongus.mp3' },
  { key: 'shield', label: 'Shield', emoji: '🛡️', url: '/sounds/shield.mp3' },
  { key: 'meme', label: 'Meme', emoji: '😂', url: '/sounds/meme.mp3' },
  { key: 'michael', label: 'Michael', emoji: '🕺', url: '/sounds/michael.mp3' },
  { key: 'slap', label: 'Slap', emoji: '👊', url: '/sounds/slap.mp3' },
  { key: 'badtothebone', label: 'Bad to the bone', emoji: '🎸', url: '/sounds/Bad%20to%20the%20bone.mp3' },
  { key: 'chipichipi', label: 'Chipi chipi', emoji: '✨', url: '/sounds/Chipi%20Chipi%20Chapa%20Chapa.mp3' },
  { key: 'fart', label: 'Fart', emoji: '💨', url: '/sounds/fart.mp3' },
  { key: 'getout', label: 'Get OUT', emoji: '🚪', url: '/sounds/Get%20OUT!!.mp3' },
  { key: 'goofy', label: 'Goofy', emoji: '😆', url: '/sounds/goofy.mp3' },
  { key: 'huh', label: 'Huh', emoji: '🤔', url: '/sounds/huh!.mp3' },
  { key: 'oi', label: 'Oi oi oi', emoji: '🗣️', url: '/sounds/Oi%20oi%20oi.mp3' },
  { key: 'outro', label: 'Outro', emoji: '🎬', url: '/sounds/outro.mp3' },
  { key: 'rizz', label: 'Rizz', emoji: '😎', url: '/sounds/Rizz.mp3' },
  { key: 'sadhamster', label: 'Sad hamster', emoji: '🐹', url: '/sounds/Sad%20hamster.mp3' },
  { key: 'shionnn', label: 'SHI ONNN', emoji: '🔥', url: '/sounds/SHI%20ONNN.mp3' },
  { key: 'spongebob', label: 'SpongeBob', emoji: '🧽', url: '/sounds/spongebob.mp3' },
  { key: 'prowler', label: 'The prowler', emoji: '🌙', url: '/sounds/the%20prowler.mp3' },
  { key: 'metalpipe', label: 'Metal pipe', emoji: '🔧', url: '/sounds/u_edtmwfwu7c-metal-pipe-329305.mp3' },
  { key: 'yippee', label: 'Yippee', emoji: '🎉', url: '/sounds/yippee.mp3' },
];

const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

const formatCountdown = (ms: number | null) => {
  if (!ms || ms < 0) return '00:00';
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

function App() {
  const [roomCode, setRoomCode] = useState('ABCD');
  const [nickname, setNickname] = useState('Player');
  const [joined, setJoined] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [status, setStatus] = useState('En attente de salle');
  const [volume, setVolume] = useState(0.7);
  const [customSounds, setCustomSounds] = useState<SoundItem[]>([]);
  const [vote, setVote] = useState<VoteState>({
    id: null,
    targetId: null,
    targetNickname: null,
    endsAt: null,
    favourable: 0,
    against: 0,
    votesExpressed: 0,
    supportRate: 0,
    quorumReached: false,
    status: 'idle',
  });
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [selectedSoundKey, setSelectedSoundKey] = useState('pet');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const allSounds = useMemo(() => [...defaultSounds, ...customSounds], [customSounds]);

  useEffect(() => {
    const stored = localStorage.getItem('classsound-custom-sounds');
    if (stored) {
      try {
        setCustomSounds(JSON.parse(stored));
      } catch {
        // ignore malformed local data
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('classsound-custom-sounds', JSON.stringify(customSounds));
  }, [customSounds]);

  useEffect(() => {
    if (!joined || !socket) return;

    const onRoomState = (payload: { members: Member[] }) => {
      setMembers(payload.members ?? []);
      if (!selectedTargets.length) {
        const mine = payload.members.find((item) => item.socketId === selfId);
        if (mine) {
          setSelectedTargets([mine.socketId]);
        }
      }
    };

    const onSoundPlay = async (payload: { soundKey: string; volume: number; senderId: string; targetIds?: string[] }) => {
      const sound = allSounds.find((item) => item.key === payload.soundKey);
      if (!sound) return;

      const audio = new Audio(sound.url);
      audio.volume = Number(payload.volume ?? 1);
      audio.preload = 'auto';
      audio.onerror = () => {
        setMessage('Fichier audio introuvable : le son local demandé n’est pas présent dans le dossier sounds.');
      };

      const unlocked = await unlockAudioBeforePlay();
      if (!unlocked) {
        setMessage('Lecture bloquée par le navigateur. Clique sur “Activer l’audio” puis réessaie.');
        return;
      }

      audio.play().catch(() => {
        setMessage('Lecture bloquée par le navigateur. Clique sur “Activer l’audio”.');
      });
      audioRef.current = audio;
    };

    const onVoteCreated = (payload: { id: string; targetId: string; targetNickname: string; endsAt: number; status: string }) => {
      setVote({
        id: payload.id,
        targetId: payload.targetId,
        targetNickname: payload.targetNickname,
        endsAt: payload.endsAt,
        favourable: 0,
        against: 0,
        votesExpressed: 0,
        supportRate: 0,
        quorumReached: false,
        status: payload.status,
      });
      setMessage(`Vote lancé contre ${payload.targetNickname}`);
    };

    const onVoteUpdate = (payload: {
      id: string;
      favourable: number;
      against: number;
      votesExpressed: number;
      supportRate: number;
      quorumReached: boolean;
      targetId: string;
      status: string;
      endsAt: number;
    }) => {
      setVote((prev) => ({
        ...prev,
        id: payload.id,
        targetId: payload.targetId,
        favourable: payload.favourable,
        against: payload.against,
        votesExpressed: payload.votesExpressed,
        supportRate: payload.supportRate,
        quorumReached: payload.quorumReached,
        status: payload.status,
        endsAt: payload.endsAt,
      }));
    };

    const onVoteResult = (payload: { accepted: boolean; status: string; targetId: string; supportRate: number; favourable: number; against: number }) => {
      setVote((prev) => ({
        ...prev,
        status: payload.status,
        supportRate: payload.supportRate,
        favourable: payload.favourable,
        against: payload.against,
      }));
      setMessage(payload.accepted ? 'Vote accepté : cible en réception uniquement.' : 'Vote refusé ou annulé.');
    };

    socket.on('room:state', onRoomState);
    socket.on('sound:play', onSoundPlay);
    socket.on('vote:created', onVoteCreated);
    socket.on('vote:update', onVoteUpdate);
    socket.on('vote:result', onVoteResult);

    return () => {
      socket.off('room:state', onRoomState);
      socket.off('sound:play', onSoundPlay);
      socket.off('vote:created', onVoteCreated);
      socket.off('vote:update', onVoteUpdate);
      socket.off('vote:result', onVoteResult);
    };
  }, [joined, socket, selfId, allSounds, selectedTargets.length]);

  const connectSocket = () => {
    const nextSocket = io(socketUrl, { transports: ['websocket'] });
    nextSocket.on('connect', () => {
      setStatus('Connecté au serveur');
    });
    nextSocket.on('connect_error', () => {
      setStatus('Connexion impossible au serveur.');
    });
    setSocket(nextSocket);
  };

  const joinRoom = () => {
    if (!socket) {
      connectSocket();
      return;
    }

    socket.emit('join:room', { roomCode, nickname }, (response: { ok?: boolean; member?: { id?: string }; error?: string }) => {
      if (!response?.ok) {
        setStatus(response?.error || 'Impossible de rejoindre la salle');
        return;
      }
      setSelfId(response.member?.id ?? socket.id ?? null);
      setJoined(true);
      setStatus(`Salle ${roomCode} rejointe`);
      setMessage('Tu es connecté. Choisis un ou plusieurs destinataires.');
      socket.emit('room:request-state', {}, () => {});
    });
  };

  const handleToggleUser = (memberId: string) => {
    setSelectedTargets((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    );
  };

  const playLocalPreview = async (soundKey: string) => {
    const unlocked = await unlockAudioBeforePlay();
    if (!unlocked) {
      setMessage('Clique sur “Activer l’audio” pour autoriser les sons.');
      return;
    }

    const sound = allSounds.find((item) => item.key === soundKey);
    if (!sound) return;

    const audio = new Audio(sound.url);
    audio.volume = Number(volume ?? 0.7);
    audio.play().catch(() => {
      setMessage('Le navigateur a bloqué la lecture locale. Clique encore une fois sur le bouton.');
    });
    audioRef.current = audio;
    setMessage(`Test local : ${sound.label}`);
  };

  const sendSound = async (soundKey: string, targetMode: 'selected' | 'all' = 'selected') => {
    if (!socket) return;

    const unlocked = await unlockAudioBeforePlay();
    if (!unlocked) {
      setMessage('Clique sur “Activer l’audio” pour autoriser les sons.');
      return;
    }

    const includeSender = targetMode === 'all';
    const targetIds = targetMode === 'all'
      ? members.map((member) => member.socketId)
      : selectedTargets.filter((id) => id !== selfId);

    socket.emit('sound:play', { targetIds, soundKey, volume, includeSender }, (response: { ok?: boolean; error?: string }) => {
      if (!response?.ok) {
        setMessage(response?.error || 'Commande rejetée');
        return;
      }
      setMessage(`Son envoyé à ${targetIds.length} destinataire(s)`);
    });
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      setMessage('Format invalide. Utilise un fichier audio .mp3, .wav ou .ogg.');
      return;
    }

    const formData = new FormData();
    formData.append('audio', file);
    setUploading(true);

    try {
      const response = await fetch(`${socketUrl}/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = (await response.json()) as { ok?: boolean; url?: string; name?: string; error?: string };
      if (!data.ok || !data.url) {
        throw new Error(data.error || 'Échec du téléversement');
      }
      const item: SoundItem = {
        key: `custom-${Date.now()}`,
        label: data.name || file.name.replace(/\.[^.]+$/, ''),
        emoji: '🎧',
        url: data.url,
      };
      setCustomSounds((current) => [...current, item]);
      setMessage('Son ajouté avec succès.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erreur de téléversement');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const enableAudio = async () => {
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        setMessage('Le navigateur ne prend pas en charge l’audio Web.');
        return false;
      }
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      await audioContextRef.current.resume();
      setStatus('Audio activé');
      setMessage('Audio activé. Les sons peuvent maintenant être lus.');
      return true;
    } catch {
      setMessage('Impossible d’activer l’audio. Vérifie les permissions du navigateur.');
      return false;
    }
  };

  const unlockAudioBeforePlay = async () => {
    if (document.visibilityState === 'visible') {
      return enableAudio();
    }
    return false;
  };

  const startVote = (memberId: string) => {
    if (!socket) return;
    socket.emit('vote:start', { targetId: memberId }, (response: { ok?: boolean; error?: string }) => {
      if (!response?.ok) {
        setMessage(response?.error || 'Vote refusé');
        return;
      }
      setMessage('Vote lancé.');
    });
  };

  const castVoteNow = (direction: 'for' | 'against') => {
    if (!socket || !vote.id) return;
    socket.emit('vote:cast', { voteId: vote.id, direction }, (response: { ok?: boolean; error?: string }) => {
      if (!response?.ok) {
        setMessage(response?.error || 'Votre vote n’a pas été pris en compte.');
        return;
      }
      setMessage(direction === 'for' ? 'Vote “Pour” enregistré.' : 'Vote “Contre” enregistré.');
    });
  };

  const currentUser = members.find((member) => member.socketId === selfId);

  return (
    <div className="app-shell">
      {!joined ? (
        <div className="join-card">
          <div className="badge">CLASS SOUND</div>
          <h1>Soundboard de classe</h1>
          <p>Rejoins une salle, sélectionne les PCs et envoie des sons en temps réel.</p>

          <div className="field-block">
            <label>Code salle</label>
            <input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} maxLength={6} />
          </div>

          <div className="field-block">
            <label>Pseudonyme</label>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} />
          </div>

          <button className="primary" onClick={() => { if (!socket) connectSocket(); joinRoom(); }}>
            Rejoindre la salle
          </button>
          <div className="status-pill">{status}</div>
        </div>
      ) : (
        <div className="dashboard">
          <aside className="left-panel">
            <div className="panel-header">
              <div>
                <span className="mini-label">Salle</span>
                <h2>{roomCode}</h2>
              </div>
              <button className="secondary" onClick={enableAudio}>Activer l’audio</button>
            </div>

            <div className="members-box">
              <h3>Membres connectés</h3>
              {members.map((member) => (
                <div key={member.socketId} className={`member-row ${member.socketId === selfId ? 'self' : ''}`}>
                  <div>
                    <strong>{member.nickname}</strong>
                    <small>{member.receiveOnly ? 'Réception uniquement' : member.canSendSound ? 'Peut envoyer' : 'Interdit'}</small>
                  </div>
                  <div className="member-actions">
                    <input
                      type="checkbox"
                      checked={selectedTargets.includes(member.socketId)}
                      onChange={() => handleToggleUser(member.socketId)}
                      disabled={member.socketId === selfId}
                    />
                    <button className="tiny" onClick={() => startVote(member.socketId)} disabled={member.socketId === selfId}>Vote</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="panel-section">
              <div className="section-title-row">
                <h3>Destinataires</h3>
                <button className="tiny" onClick={() => setSelectedTargets(members.map((member) => member.socketId).filter((id) => id !== selfId))}>Tout</button>
              </div>
              <div className="selected-list">
                {selectedTargets.length === 0 ? 'Aucun destinataire sélectionné' : selectedTargets.map((id) => members.find((member) => member.socketId === id)?.nickname).filter(Boolean).join(', ')}
              </div>
            </div>

            <div className="panel-section">
              <h3>Volume local</h3>
              <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
              <div className="volume-readout">{Number(volume).toFixed(2)}</div>
            </div>
          </aside>

          <main className="main-panel">
            <div className="topbar">
              <div>
                <span className="mini-label">Statut</span>
                <strong>{status}</strong>
              </div>
              <div className="user-status">
                {currentUser?.receiveOnly ? <span className="danger-pill">Réception uniquement</span> : <span className="success-pill">Peut envoyer</span>}
              </div>
            </div>

            <div className="soundboard-grid">
              {allSounds.map((sound) => (
                <div key={sound.key} className="sound-card">
                  <button
                    className="sound-button"
                    onClick={() => {
                      setSelectedSoundKey(sound.key);
                      sendSound(sound.key, 'selected');
                    }}
                  >
                    <span className="emoji">{sound.emoji}</span>
                    <span>{sound.label}</span>
                  </button>
                  <button className="tiny test-button" onClick={() => {
                    setSelectedSoundKey(sound.key);
                    playLocalPreview(sound.key);
                  }}>Tester moi-même</button>
                </div>
              ))}
            </div>

            <div className="action-row">
              <button className="primary" onClick={() => sendSound(selectedSoundKey, 'all')}>Envoyer à toute la salle</button>
              <button className="secondary" onClick={() => setSelectedTargets([])}>Réinitialiser</button>
            </div>

            <div className="upload-box">
              <label className="uploadLabel">
                <span>Ajouter un son perso</span>
                <input type="file" accept="audio/*" onChange={handleUpload} />
              </label>
              {uploading ? <p>Téléversement...</p> : null}
            </div>

            <div className="vote-box">
              <h3>Vote de restriction</h3>
              <div className="vote-meta">
                <span>{vote.targetNickname ? `Cible : ${vote.targetNickname}` : 'Aucun scrutin actif'}</span>
                {vote.endsAt ? <strong>{formatCountdown(vote.endsAt - Date.now())}</strong> : null}
              </div>
              <div className="vote-stats">
                <span>Pour: {vote.favourable}</span>
                <span>Contre: {vote.against}</span>
                <span>Votes: {vote.votesExpressed}</span>
              </div>
              {vote.id ? (
                <div className="vote-actions">
                  <button className="primary small" onClick={() => castVoteNow('for')}>Pour</button>
                  <button className="secondary small" onClick={() => castVoteNow('against')}>Contre</button>
                </div>
              ) : null}
              <div className="vote-foot">{vote.status === 'active' ? `Quorum: ${vote.quorumReached ? 'atteint' : 'non atteint'} • ${vote.supportRate}%` : message}</div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

export default App;
