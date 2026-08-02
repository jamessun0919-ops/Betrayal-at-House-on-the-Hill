const { createGameState, addPlayer, getPlayer } = require('../../src/game/gameState');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

function makeStats() {
  return {
    might: { current: 3, max: 5, skullValue: 0 },
    speed: { current: 4, max: 5, skullValue: 0 },
    knowledge: { current: 2, max: 5, skullValue: 0 },
    sanity: { current: 3, max: 5, skullValue: 0 },
  };
}

test('createGameState builds a board and an empty player map', () => {
  const gameState = createGameState(STARTING_ROOMS);
  expect(gameState.players.size).toBe(0);
  expect(gameState.hauntStarted).toBe(false);
  expect(gameState.omenCount).toBe(0);
  expect(gameState.board.ground.get('0,0').roomId).toBe('room_entrance_hall');
});

test('addPlayer places the new player at the entrance hall with action points set', () => {
  const gameState = createGameState(STARTING_ROOMS);
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  expect(player.floor).toBe('ground');
  expect(player.x).toBe(0);
  expect(player.y).toBe(0);
  expect(player.actionPoints).toBe(4); // equals speed.current
  expect(gameState.players.get('p1')).toBe(player);
});

test('getPlayer returns the player by id, or undefined if not found', () => {
  const gameState = createGameState(STARTING_ROOMS);
  addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  expect(getPlayer(gameState, 'p1').name).toBe('Alice');
  expect(getPlayer(gameState, 'unknown')).toBeUndefined();
});
