const { dropToBasement } = require('../../src/game/collapseFall');
const { createGameState, addPlayer } = require('../../src/game/gameState');
const { coordKey } = require('../../src/game/boardGenerator');

const STARTING_ROOMS = [
  { id: 'room_lobby_a', name: '大門廳', floor: 'ground' },
  { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
  { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
  { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
];

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 },
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

test('dropToBasement places a new basement room at the same (x,y), links it, and moves the player there', () => {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_basement_new', doors: 4, floor: 'basement' }]);
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  const currentRoom = { roomId: 'room_current', x: 5, y: 5, doorSides: ['north'], droppedItems: [], item: null };
  gameState.board.ground.set('5,5', currentRoom);
  player.floor = 'ground';
  player.x = 5;
  player.y = 5;

  const result = dropToBasement(gameState, player, currentRoom);

  expect(player.floor).toBe('basement');
  expect(player.x).toBe(5);
  expect(player.y).toBe(5);
  expect(currentRoom.collapseLink).toEqual({ x: 5, y: 5 });
  expect(gameState.board.basement.get('5,5').roomId).toBe('room_basement_new');
  expect(result).toEqual({ basementRoomId: 'room_basement_new', x: 5, y: 5 });
});

test('dropToBasement throws ROOM_DECK_EMPTY when no basement room remains in the deck', () => {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_ground_only', doors: 4, floor: 'ground' }]);
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  const currentRoom = { roomId: 'room_current', x: 5, y: 5, doorSides: ['north'], droppedItems: [], item: null };
  gameState.board.ground.set('5,5', currentRoom);
  expect(() => dropToBasement(gameState, player, currentRoom)).toThrow('ROOM_DECK_EMPTY');
});

test('dropToBasement reuses an already-placed basement room at the target coordinate instead of drawing a new one', () => {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_basement_new', doors: 4, floor: 'basement' }]);
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  const currentRoom = { roomId: 'room_current', x: 7, y: 7, doorSides: ['north'], droppedItems: [], item: null };
  gameState.board.ground.set('7,7', currentRoom);
  player.floor = 'ground';
  player.x = 7;
  player.y = 7;
  gameState.board.basement.set(coordKey(7, 7), {
    roomId: 'room_existing_basement',
    x: 7,
    y: 7,
    doorSides: ['south'],
    droppedItems: [],
    item: null,
  });
  const deckCountBefore = gameState.roomDeck.cards.length;

  const result = dropToBasement(gameState, player, currentRoom);

  expect(player.floor).toBe('basement');
  expect(player.x).toBe(7);
  expect(player.y).toBe(7);
  expect(gameState.board.basement.get(coordKey(7, 7)).roomId).toBe('room_existing_basement');
  expect(result).toEqual({ basementRoomId: 'room_existing_basement', x: 7, y: 7 });
  expect(currentRoom.collapseLink).toEqual({ x: 7, y: 7 });
  expect(gameState.roomDeck.cards.length).toBe(deckCountBefore); // not drawn from
});
