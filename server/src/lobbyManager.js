const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_PLAYER_NAME_LENGTH = 20;

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

class LobbyManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> { players: Map(playerId -> { name, socketId }) }
  }

  createRoom(hostName, hostSocketId) {
    const name = normalizePlayerName(hostName);
    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (this.rooms.has(roomCode));

    const playerId = generatePlayerId();
    this.rooms.set(roomCode, {
      players: new Map([[playerId, { name, socketId: hostSocketId }]]),
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
    }));
  }

  findRoomByPlayerId(playerId) {
    for (const [roomCode, room] of this.rooms.entries()) {
      if (room.players.has(playerId)) return roomCode;
    }
    return null;
  }
}

module.exports = { LobbyManager };
