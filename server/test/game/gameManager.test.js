const { createGameManager, startGame, getGameState, endGame } = require('../../src/game/gameManager');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

function makeDrawableRooms() {
  return [{ id: 'room_0', doors: 2 }, { id: 'room_1', doors: 2 }];
}

function makeCharacters() {
  const stats = {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 },
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
  return [
    { id: 'char_001', codename: 'Alice-character', stats },
    { id: 'char_002', codename: 'Bob-character', stats },
  ];
}

function baseStartArgs(overrides = {}) {
  return {
    startingRooms: STARTING_ROOMS,
    rooms: makeDrawableRooms(),
    characters: makeCharacters(),
    players: [
      { playerId: 'p1', name: 'Alice', characterId: 'char_001' },
      { playerId: 'p2', name: 'Bob', characterId: 'char_002' },
    ],
    ...overrides,
  };
}

test('startGame builds a gameState with both players added, keyed by roomCode', () => {
  const manager = createGameManager();
  const gameState = startGame(manager, 'ROOM1', baseStartArgs());
  expect(gameState.players.size).toBe(2);
  expect(gameState.players.get('p1').name).toBe('Alice');
  expect(getGameState(manager, 'ROOM1')).toBe(gameState);
});

test('startGame resolves each player stats from their assigned character', () => {
  const manager = createGameManager();
  const gameState = startGame(manager, 'ROOM1', baseStartArgs());
  expect(gameState.players.get('p1').stats.might.track).toEqual([1, 2, 3, 4, 5]);
});

test('startGame generates a random turn order covering every player, independent of join/character order', () => {
  const manager = createGameManager();
  const gameState = startGame(manager, 'ROOM1', baseStartArgs());
  expect(gameState.turnOrder.slice().sort()).toEqual(['p1', 'p2']);
  expect(gameState.currentPlayerIndex).toBe(0);
});

test('startGame throws UNKNOWN_CHARACTER when a player references a characterId not in the list', () => {
  const manager = createGameManager();
  const args = baseStartArgs({
    players: [{ playerId: 'p1', name: 'Alice', characterId: 'not_a_real_character' }],
  });
  expect(() => startGame(manager, 'ROOM1', args)).toThrow('UNKNOWN_CHARACTER');
});

test('startGame throws GAME_ALREADY_STARTED for a roomCode that already has a game', () => {
  const manager = createGameManager();
  startGame(manager, 'ROOM1', baseStartArgs());
  expect(() => startGame(manager, 'ROOM1', baseStartArgs())).toThrow('GAME_ALREADY_STARTED');
});

test('getGameState returns undefined for an unknown roomCode', () => {
  const manager = createGameManager();
  expect(getGameState(manager, 'UNKNOWN')).toBeUndefined();
});

test('endGame removes the game and is a no-op for an unknown roomCode', () => {
  const manager = createGameManager();
  startGame(manager, 'ROOM1', baseStartArgs());
  endGame(manager, 'ROOM1');
  expect(getGameState(manager, 'ROOM1')).toBeUndefined();
  expect(() => endGame(manager, 'NEVER_STARTED')).not.toThrow();
});
