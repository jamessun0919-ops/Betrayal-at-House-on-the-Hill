const { LobbyManager } = require('../src/lobbyManager');

test('createRoom creates a room with the host as first player', () => {
  const manager = new LobbyManager();
  const { roomCode, playerId } = manager.createRoom('Alice', 'socket-1');

  expect(roomCode).toMatch(/^[A-Z]{4}$/);
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name: 'Alice' }]);
});

test('joinRoom adds a second player to an existing room', () => {
  const manager = new LobbyManager();
  const { roomCode } = manager.createRoom('Alice', 'socket-1');
  const { playerId: bobId } = manager.joinRoom(roomCode, 'Bob', 'socket-2');

  const names = manager.getPlayers(roomCode).map((p) => p.name).sort();
  expect(names).toEqual(['Alice', 'Bob']);
  expect(bobId).toBeTruthy();
});

test('joinRoom throws ROOM_NOT_FOUND for an unknown room code', () => {
  const manager = new LobbyManager();
  expect(() => manager.joinRoom('ZZZZ', 'Bob', 'socket-2')).toThrow('ROOM_NOT_FOUND');
});

test('leaveRoom removes a player, and removes the room once empty', () => {
  const manager = new LobbyManager();
  const { roomCode, playerId } = manager.createRoom('Alice', 'socket-1');
  const { playerId: bobId } = manager.joinRoom(roomCode, 'Bob', 'socket-2');

  manager.leaveRoom(roomCode, bobId);
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name: 'Alice' }]);

  manager.leaveRoom(roomCode, playerId);
  expect(manager.getPlayers(roomCode)).toEqual([]);
});

test('findRoomByPlayerId finds the room a player belongs to, or null', () => {
  const manager = new LobbyManager();
  const { roomCode, playerId } = manager.createRoom('Alice', 'socket-1');

  expect(manager.findRoomByPlayerId(playerId)).toBe(roomCode);
  expect(manager.findRoomByPlayerId('unknown-id')).toBeNull();
});

test('createRoom trims a valid name with surrounding whitespace', () => {
  const manager = new LobbyManager();
  const { roomCode, playerId } = manager.createRoom('  Alice  ', 'socket-1');
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name: 'Alice' }]);
});

test.each([
  ['undefined', undefined],
  ['null', null],
  ['empty string', ''],
  ['whitespace only', '   '],
  ['non-string', 42],
  ['too long', 'a'.repeat(21)],
])('createRoom rejects an invalid name (%s)', (_label, badName) => {
  const manager = new LobbyManager();
  expect(() => manager.createRoom(badName, 'socket-1')).toThrow('INVALID_NAME');
});

test('createRoom accepts a name at the 20-character length cap', () => {
  const manager = new LobbyManager();
  const name = 'a'.repeat(20);
  const { roomCode, playerId } = manager.createRoom(name, 'socket-1');
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name }]);
});

test('joinRoom rejects an invalid name', () => {
  const manager = new LobbyManager();
  const { roomCode } = manager.createRoom('Alice', 'socket-1');
  expect(() => manager.joinRoom(roomCode, '   ', 'socket-2')).toThrow('INVALID_NAME');
});
