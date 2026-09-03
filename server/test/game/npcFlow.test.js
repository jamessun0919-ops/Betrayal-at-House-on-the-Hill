const { createGameState, addPlayer, getPlayer } = require('../../src/game/gameState');
const { createNpc } = require('../../src/game/playerEntity');
const { enterPhase } = require('../../src/game/phaseFlow');
const { moveNpc, npcItemAction } = require('../../src/game/npcFlow');

function makeStats() {
  return {
    might: { track: [1, 2, 3], baseIndex: 1, skullIndex: 0 },
    speed: { track: [2, 3, 4], baseIndex: 1, skullIndex: 0 },
    knowledge: { track: [1, 2, 3], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3], baseIndex: 1, skullIndex: 0 },
  };
}

function makeGameStateWithNpc() {
  const startingRooms = [
    { id: 'room_lobby_b', name: '大門廳', floor: 'ground', filename: 'LobbyB.webp' },
    { id: 'room_lobby_a', name: '大門廳', floor: 'ground', filename: 'LobbyA.webp' },
    { id: 'room_lobby_c', name: '大門廳', floor: 'ground', filename: 'LobbyC.webp' },
    { id: 'room_upper_landing', name: '二樓平台', floor: 'upper', filename: '2Fladder.webp' },
    { id: 'room_basement_landing', name: '地下平台', floor: 'basement', filename: null },
  ];
  const gameState = createGameState(startingRooms, [{ id: 'room_new', doors: 4, floor: 'ground' }], {});
  const controller = addPlayer(gameState, { playerId: 'p1', name: 'Alice', characterId: 'char_001', stats: makeStats() });
  const npc = createNpc({ npcID: 'npc_001', controlledBy: 'p1', linkedImprintId: 'omen_004', floor: controller.floor, x: controller.x, y: controller.y, stats: makeStats() });
  gameState.players.set(npc.playerId, npc);
  enterPhase(gameState, 'npc_move');
  npc.actionPoints = 2;
  return { gameState, controller, npc };
}

test('moveNpc moves into an already-placed neighbor room and spends 1 of the NPC\'s own actionPoints', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  // room_lobby_a (0,1) has a north door to room_lobby_b (0,0) -- see boardGenerator.js createBoard.
  const result = moveNpc(gameState, npc.playerId, 'north');
  expect(result).toEqual({ kind: 'move', x: 0, y: 0 });
  expect(npc.x).toBe(0);
  expect(npc.y).toBe(0);
  expect(npc.actionPoints).toBe(1);
});

test('moveNpc throws INVALID_MOVE_DIRECTION toward a direction with no placed neighbor (never opens a door)', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  // room_lobby_a has doorSides ['north','east','west'] but only north (room_lobby_b) is placed.
  expect(() => moveNpc(gameState, npc.playerId, 'east')).toThrow('INVALID_MOVE_DIRECTION');
});

test('moveNpc throws NOT_ENOUGH_ACTION_POINTS -- reuses NOT_ENOUGH_ACTION_POINTS via requirePhase\'s AP check', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  npc.actionPoints = 0;
  expect(() => moveNpc(gameState, npc.playerId, 'north')).toThrow('NOT_ENOUGH_ACTION_POINTS');
});

test('moveNpc throws NOT_YOUR_PHASE outside npc_move', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  gameState.currentPhase = 'player_move';
  expect(() => moveNpc(gameState, npc.playerId, 'north')).toThrow('NOT_YOUR_PHASE');
});

test('npcItemAction mode:pickup picks up a room-dropped item into the NPC\'s own inventory', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  const room = gameState.board[npc.floor].get(`${npc.x},${npc.y}`);
  room.droppedItems.push({ id: 'item_003' });
  const result = npcItemAction(gameState, npc.playerId, 'item_003', 'pickup');
  expect(result).toEqual({ kind: 'item', mode: 'pickup', itemId: 'item_003' });
  expect(npc.inventory).toEqual([{ id: 'item_003' }]);
  expect(room.droppedItems).toEqual([]);
  expect(npc.actionPoints).toBe(1);
});

test('npcItemAction mode:pickup throws NPC_INVENTORY_FULL when the NPC already carries 1 item', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  npc.inventory.push({ id: 'item_002' });
  const room = gameState.board[npc.floor].get(`${npc.x},${npc.y}`);
  room.droppedItems.push({ id: 'item_003' });
  expect(() => npcItemAction(gameState, npc.playerId, 'item_003', 'pickup')).toThrow('NPC_INVENTORY_FULL');
});

test('npcItemAction mode:pickup throws ITEM_NOT_IN_ROOM when the item isn\'t there (e.g. someone else already took it)', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  expect(() => npcItemAction(gameState, npc.playerId, 'item_003', 'pickup')).toThrow('ITEM_NOT_IN_ROOM');
});

test('npcItemAction mode:leave drops a carried item back into the current room', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  npc.inventory.push({ id: 'item_003' });
  const result = npcItemAction(gameState, npc.playerId, 'item_003', 'leave');
  expect(result).toEqual({ kind: 'item', mode: 'leave', itemId: 'item_003' });
  expect(npc.inventory).toEqual([]);
  const room = gameState.board[npc.floor].get(`${npc.x},${npc.y}`);
  expect(room.droppedItems).toEqual([{ id: 'item_003' }]);
});

test('npcItemAction mode:leave throws ITEM_NOT_HELD when the NPC isn\'t carrying that item', () => {
  const { gameState, npc } = makeGameStateWithNpc();
  expect(() => npcItemAction(gameState, npc.playerId, 'item_003', 'leave')).toThrow('ITEM_NOT_HELD');
});
