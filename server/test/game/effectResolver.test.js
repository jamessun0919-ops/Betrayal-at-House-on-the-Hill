const { resolveEffects } = require('../../src/game/effectResolver');
const { createGameState, addPlayer } = require('../../src/game/gameState');
const { createPromptState } = require('../../src/game/promptState');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 },
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

function makeGameStateWithPlayer(playerId = 'p1') {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_x', doors: 2 }]);
  addPlayer(gameState, { playerId, name: 'Alice', stats: makeStats() });
  return gameState;
}

test('resolveEffects applies a stat_change delta', () => {
  const gameState = makeGameStateWithPlayer();
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', delta: 1 },
  ]);
  expect(result).toEqual({ pending: false });
  expect(gameState.players.get('p1').stats.might.currentIndex).toBe(3); // baseIndex 2 + 1
});

test('resolveEffects restores a stat to its baseIndex when restoreToBase is set', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.stats.might.currentIndex = 0; // dropped below base (baseIndex 2)
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', restoreToBase: true },
  ]);
  expect(player.stats.might.currentIndex).toBe(2);
});

test('resolveEffects processes multiple effects in order', () => {
  const gameState = makeGameStateWithPlayer();
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'stat_change', stat: 'might', delta: 1 },
    { type: 'stat_change', stat: 'speed', delta: -1 },
  ]);
  const player = gameState.players.get('p1');
  expect(player.stats.might.currentIndex).toBe(3);
  expect(player.stats.speed.currentIndex).toBe(1);
});

test('resolveEffects grant_item adds the item to the player inventory', () => {
  const gameState = makeGameStateWithPlayer();
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'grant_item', itemId: 'item_001' },
  ]);
  expect(gameState.players.get('p1').inventory).toEqual([{ id: 'item_001' }]);
});

test('resolveEffects lose_item removes the item from the player inventory', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_001' });
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'lose_item', itemId: 'item_001' },
  ]);
  expect(player.inventory).toEqual([]);
});

test('resolveEffects lose_item propagates ITEM_NOT_FOUND when the player does not hold it', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'lose_item', itemId: 'not_held' }])
  ).toThrow('ITEM_NOT_FOUND');
});

test('resolveEffects persistent_modifier attaches to the player by default', () => {
  const gameState = makeGameStateWithPlayer();
  resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'persistent_modifier',
      appliesTo: 'player',
      effects: [{ hookType: 'onEventCardCheck', delta: 1, checkContext: 'event' }],
      removeWhen: { type: 'holdsItem', itemId: 'item_010' },
    },
  ]);
  expect(gameState.players.get('p1').modifiers).toHaveLength(1);
});

test('resolveEffects persistent_modifier attaches to the room the player currently stands in', () => {
  const gameState = makeGameStateWithPlayer();
  resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'persistent_modifier',
      appliesTo: 'room',
      effects: [{ hookType: 'onBeforeRoll', delta: -1 }],
      removeWhen: { type: 'leavesRoom' },
    },
  ]);
  const room = gameState.board.ground.get('0,0'); // player starts at entrance hall (0,0)
  expect(room.modifiers).toHaveLength(1);
});

test('resolveEffects throws INVALID_EFFECTS_LIST for a non-array effects argument', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() => resolveEffects(gameState, createPromptState(), 'p1', null)).toThrow('INVALID_EFFECTS_LIST');
});

test('resolveEffects throws PLAYER_NOT_FOUND for an unknown playerId', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'unknown', [{ type: 'stat_change', stat: 'might', delta: 1 }])
  ).toThrow('PLAYER_NOT_FOUND');
});

test('resolveEffects throws UNSUPPORTED_EFFECT_TYPE for an unknown effect type', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'not_a_real_type' }])
  ).toThrow('UNSUPPORTED_EFFECT_TYPE');
});

test('resolveEffects throws UNSUPPORTED_EFFECT_TYPE for peek_and_reorder (not implemented in M2c-1)', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'peek_and_reorder', deckType: 'item', count: 2 }])
  ).toThrow('UNSUPPORTED_EFFECT_TYPE');
});
