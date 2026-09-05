const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_PLAYER_NAME_LENGTH = 20;
const MIN_PHASE_TIMEOUT_SECONDS = 20;
const MAX_PHASE_TIMEOUT_SECONDS = 90;
const DEFAULT_PHASE_TIMEOUT_SECONDS = 30;

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

function normalizePlayerName(name) {
  if (typeof name !== 'string') {
    throw new Error('INVALID_NAME');
  }
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_PLAYER_NAME_LENGTH) {
    throw new Error('INVALID_NAME');
  }
  return trimmed;
}

function normalizePhaseTimeoutSeconds(seconds) {
  if (seconds === undefined) {
    return DEFAULT_PHASE_TIMEOUT_SECONDS;
  }
  if (!Number.isInteger(seconds) || seconds < MIN_PHASE_TIMEOUT_SECONDS || seconds > MAX_PHASE_TIMEOUT_SECONDS) {
    throw new Error('INVALID_PHASE_TIMEOUT');
  }
  return seconds;
}

class LobbyManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> { players: Map(playerId -> { name, socketId }) }
  }

  createRoom(hostName, hostSocketId, phaseTimeoutSeconds) {
    const name = normalizePlayerName(hostName);
    const phaseTimeoutMs = normalizePhaseTimeoutSeconds(phaseTimeoutSeconds) * 1000;
    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (this.rooms.has(roomCode));

    const playerId = generatePlayerId();
    this.rooms.set(roomCode, {
      players: new Map([[playerId, { name, socketId: hostSocketId }]]),
      hostPlayerId: playerId,
      phaseTimeoutMs,
    });
    return { roomCode, playerId };
  }

  joinRoom(roomCode, playerName, socketId) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new Error('ROOM_NOT_FOUND');
    }
    const name = normalizePlayerName(playerName);
    const playerId = generatePlayerId();
    room.players.set(playerId, { name, socketId });
    return { playerId };
  }

  leaveRoom(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    room.players.delete(playerId);
    if (room.players.size === 0) {
      this.rooms.delete(roomCode);
    }
  }

  getPlayers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    return Array.from(room.players.entries()).map(([playerId, p]) => ({
      playerId,
      name: p.name,
      isHost: playerId === room.hostPlayerId,
    }));
  }

  findRoomByPlayerId(playerId) {
    for (const [roomCode, room] of this.rooms.entries()) {
      if (room.players.has(playerId)) return roomCode;
    }
    return null;
  }

  isHost(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;
    return room.hostPlayerId === playerId;
  }

  getHostName(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    const host = room.players.get(room.hostPlayerId);
    return host ? host.name : null;
  }

  getPhaseTimeoutMs(roomCode) {
    const room = this.rooms.get(roomCode);
    return room ? room.phaseTimeoutMs : null;
  }

  closeRoom(roomCode) {
    this.rooms.delete(roomCode);
  }

  listJoinableRooms(isRoomInProgress, maxPlayers) {
    const result = [];
    for (const [roomCode, room] of this.rooms.entries()) {
      if (isRoomInProgress(roomCode)) continue;
      const playerCount = room.players.size;
      if (playerCount >= maxPlayers) continue;
      result.push({ roomCode, hostName: this.getHostName(roomCode), playerCount, maxPlayers });
    }
    return result;
  }
}

module.exports = { LobbyManager };
