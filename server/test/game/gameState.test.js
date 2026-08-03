const { createGameState, addPlayer, getPlayer, serializeGameState } = require('../../src/game/gameState');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

function makeDrawableRooms(count = 3) {
  const rooms = [];
  for (let i = 0; i < count; i++) {
    rooms.push({ id: `room_${i}`, doors: 2 });
  }
  return rooms;
}

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 },
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

test('createGameState builds a board, an empty player map, and a room deck', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms(3));
  expect(gameState.players.size).toBe(0);
  expect(gameState.hauntStarted).toBe(false);
  expect(gameState.omenCount).toBe(0);
  expect(gameState.board.ground.get('0,0').roomId).toBe('room_entrance_hall');
  expect(gameState.roomDeck.cards).toHaveLength(3);
  expect(gameState.roomDeck.drawnCount).toBe(0);
});

test('addPlayer places the new player at the entrance hall with action points set', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms());
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  expect(player.floor).toBe('ground');
  expect(player.x).toBe(0);
  expect(player.y).toBe(0);
  expect(player.actionPoints).toBe(4); // equals speed track value at baseIndex
  expect(gameState.players.get('p1')).toBe(player);
});

test('addPlayer throws DUPLICATE_PLAYER_ID when the playerId is already registered', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms());
  addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  expect(() =>
    addPlayer(gameState, { playerId: 'p1', name: 'Bob', stats: makeStats() })
  ).toThrow('DUPLICATE_PLAYER_ID');
  // The original player must be untouched.
  expect(getPlayer(gameState, 'p1').name).toBe('Alice');
});

test('getPlayer returns the player by id, or undefined if not found', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms());
  addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  expect(getPlayer(gameState, 'p1').name).toBe('Alice');
  expect(getPlayer(gameState, 'unknown')).toBeUndefined();
});

test('serializeGameState converts the board and players Maps into plain arrays', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms());
  addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });

  const serialized = serializeGameState(gameState);

  expect(Array.isArray(serialized.board.ground)).toBe(true);
  expect(Array.isArray(serialized.board.upper)).toBe(true);
  expect(serialized.board.ground.some((r) => r.roomId === 'room_entrance_hall')).toBe(true);
  expect(serialized.board.stairsLink).toEqual({
    groundRoomId: 'room_grand_staircase',
    upperRoomId: 'room_upper_landing',
  });
  expect(Array.isArray(serialized.players)).toBe(true);
  expect(serialized.players[0].playerId).toBe('p1');
  expect(serialized.hauntStarted).toBe(false);
  expect(serialized.omenCount).toBe(0);

  // Must survive an actual JSON round-trip (the real reason this function exists).
  expect(() => JSON.stringify(serialized)).not.toThrow();
  expect(JSON.parse(JSON.stringify(serialized)).players[0].playerId).toBe('p1');
});

test('serializeGameState exposes only remainingCount/isEmpty for the room deck, not its contents', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms(3));
  const serialized = serializeGameState(gameState);
  expect(serialized.roomDeck).toEqual({ remainingCount: 3, isEmpty: false });
  expect(serialized.roomDeck.cards).toBeUndefined();
});

test('serializeGameState includes turnOrder/currentPlayerIndex when GameManager has set them, or null before that', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms());
  // Before GameManager.startGame runs (Task 7), these fields don't exist yet.
  expect(serializeGameState(gameState).turnOrder).toBeNull();
  expect(serializeGameState(gameState).currentPlayerIndex).toBeNull();

  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 1;
  const serialized = serializeGameState(gameState);
  expect(serialized.turnOrder).toEqual(['p1', 'p2']);
  expect(serialized.currentPlayerIndex).toBe(1);
});
