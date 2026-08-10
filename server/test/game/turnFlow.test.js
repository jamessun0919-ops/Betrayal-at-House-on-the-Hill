const { createGameState, addPlayer } = require('../../src/game/gameState');
const { resetActionPoints, getStatValue } = require('../../src/game/playerEntity');
const { coordKey } = require('../../src/game/boardGenerator');
const {
  getAvailableDirections,
  moveToRoom,
  moveSummon,
  selectAction,
  selectSummonAction,
  isTurnOver,
  getCurrentTurnPlayerId,
  advanceTurn,
  endTurn,
  canUseStairs,
  useStairs,
} = require('../../src/game/turnFlow');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 }, // value 4 at baseIndex
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

function makeGameStateWithPlayer(drawableRooms) {
  const gameState = createGameState(STARTING_ROOMS, drawableRooms || [{ id: 'room_new', doors: 4, floor: 'ground' }]);
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  // Default to a solo turn order so p1 is always the current turn player,
  // unless a test overrides this to specifically exercise turn-order logic.
  gameState.turnOrder = ['p1'];
  gameState.currentPlayerIndex = 0;
  return { gameState, player };
}

test('getAvailableDirections lists an unexplored door as open_door when the deck has cards', () => {
  const { gameState } = makeGameStateWithPlayer();
  // Entrance hall (0,0) is a fixed starting room with doors on all 4 sides.
  const available = getAvailableDirections(gameState, 'p1');
  const eastOption = available.find((a) => a.direction === 'east');
  // East of entrance hall (0,0) is (4,0) foyer, not adjacent -- so 'east' at
  // distance 1 (1,0) is unexplored territory, not the foyer itself.
  expect(eastOption).toEqual({ direction: 'east', kind: 'open_door' });
});

test('getAvailableDirections lists a move to an already-explored, mutually-doored neighbor', () => {
  const { gameState } = makeGameStateWithPlayer();
  // Manually place an explored, fully-doored room north of the entrance hall.
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'] });
  const available = getAvailableDirections(gameState, 'p1');
  expect(available.find((a) => a.direction === 'north')).toEqual({ direction: 'north', kind: 'move' });
});

test('getAvailableDirections omits open_door once the room deck is empty', () => {
  const { gameState } = makeGameStateWithPlayer([{ id: 'room_only', doors: 4, floor: 'ground' }]);
  moveToRoom(gameState, 'p1', 'east'); // draws the only card, deck now empty
  // The player is now in the newly-placed room; check a fresh, still-unexplored side.
  const player = gameState.players.get('p1');
  const available = getAvailableDirections(gameState, 'p1');
  const openDoorOptions = available.filter((a) => a.kind === 'open_door');
  expect(openDoorOptions).toEqual([]);
});

test('getAvailableDirections omits open_door for a player with a blocksOpenDoor modifier, but still lists moves to already-explored neighbors', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'] });
  player.modifiers = [{ effects: [{ hookType: 'blocksOpenDoor' }] }]; // e.g. 電池耗盡
  const available = getAvailableDirections(gameState, 'p1');
  expect(available.filter((a) => a.kind === 'open_door')).toEqual([]);
  expect(available.find((a) => a.direction === 'north')).toEqual({ direction: 'north', kind: 'move' });
});

test('getAvailableDirections throws PLAYER_NOT_FOUND for an unknown player', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => getAvailableDirections(gameState, 'unknown')).toThrow('PLAYER_NOT_FOUND');
});

test('moveToRoom moves the player to an already-explored neighbor and deducts 1 action point', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'] });
  const startingAP = player.actionPoints;
  const result = moveToRoom(gameState, 'p1', 'north');
  expect(result).toEqual({ kind: 'move', x: 0, y: -1 });
  expect(player.x).toBe(0);
  expect(player.y).toBe(-1);
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('moveToRoom opens a door: draws a room, places it, moves the player, and zeroes action points', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, drawType: 'item', floor: 'ground' }]);
  const result = moveToRoom(gameState, 'p1', 'east');
  expect(result.kind).toBe('open_door');
  expect(result.roomId).toBe('room_new');
  expect(result.pendingCardDraw).toEqual({ deck: 'item' });
  expect(player.x).toBe(1);
  expect(player.y).toBe(0);
  expect(player.actionPoints).toBe(0);
});

test('moveToRoom sets pendingCardDraw to null when the room has no draw type', () => {
  const { gameState } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, drawType: 'none', floor: 'ground' }]);
  const result = moveToRoom(gameState, 'p1', 'east');
  expect(result.pendingCardDraw).toBeNull();
});

test('moveToRoom throws INVALID_MOVE_DIRECTION for a direction not currently available', () => {
  const gameState2 = createGameState(STARTING_ROOMS, [{ id: 'room_only', doors: 4, floor: 'ground' }]);
  const player2 = addPlayer(gameState2, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  gameState2.turnOrder = ['p1'];
  gameState2.currentPlayerIndex = 0;
  moveToRoom(gameState2, 'p1', 'east'); // exhausts the deck, player now at (1,0), AP=0
  resetActionPoints(player2); // simulate starting a new turn
  // North of (1,0) is unexplored and the deck is empty, so it's neither a
  // valid move (no room there) nor a valid door-open (no cards left).
  expect(() => moveToRoom(gameState2, 'p1', 'north')).toThrow('INVALID_MOVE_DIRECTION');
});

test('moveToRoom throws NOT_ENOUGH_ACTION_POINTS when the player has 0 action points', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'] });
  player.actionPoints = 0;
  expect(() => moveToRoom(gameState, 'p1', 'north')).toThrow('NOT_ENOUGH_ACTION_POINTS');
});

test('moveToRoom throws NOT_ENOUGH_ACTION_POINTS before checking direction validity', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_only', doors: 4, floor: 'ground' }]);
  // Move east to exhaust the deck and set AP to 0
  moveToRoom(gameState, 'p1', 'east');
  // AP is now 0, and we're at (1,0). North is unexplored and deck is empty (invalid direction).
  // The check for NOT_ENOUGH_ACTION_POINTS should fire before INVALID_MOVE_DIRECTION.
  expect(() => moveToRoom(gameState, 'p1', 'north')).toThrow('NOT_ENOUGH_ACTION_POINTS');
});

test('moveToRoom with a leaveCheck: passing the roll moves the player and costs exactly the normal 1 action point', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'] });
  const startingAP = player.actionPoints;
  const rng = () => 0.99; // every die -> face 2; might value 3 -> sum 6, passes min:3
  const result = moveToRoom(gameState, 'p1', 'north', { stat: 'might', min: 3 }, rng);
  expect(result).toEqual({ kind: 'move', x: 0, y: -1 });
  expect(player.x).toBe(0);
  expect(player.y).toBe(-1);
  expect(player.actionPoints).toBe(startingAP - 1); // not double-charged
});

test('moveToRoom with a leaveCheck: failing the roll blocks the move, costs exactly 1 action point, and is retryable', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'] });
  const startingAP = player.actionPoints;
  const failRng = () => 0; // every die -> face 0; might value 3 -> sum 0, fails min:3
  const failResult = moveToRoom(gameState, 'p1', 'north', { stat: 'might', min: 3 }, failRng);
  expect(failResult).toEqual({ kind: 'leaveCheckFailed', rolled: 0, required: 3 });
  expect(player.x).toBe(0); // unmoved
  expect(player.y).toBe(0);
  expect(player.actionPoints).toBe(startingAP - 1);

  const passRng = () => 0.99;
  const retryResult = moveToRoom(gameState, 'p1', 'north', { stat: 'might', min: 3 }, passRng);
  expect(retryResult).toEqual({ kind: 'move', x: 0, y: -1 });
  expect(player.actionPoints).toBe(startingAP - 2);
});

test('moveToRoom with a leaveCheck also gates opening a new door: failure does not draw or zero action points beyond the normal 1', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, drawType: 'item', floor: 'ground' }]);
  const startingAP = player.actionPoints;
  const failRng = () => 0;
  const failResult = moveToRoom(gameState, 'p1', 'east', { stat: 'might', min: 3 }, failRng);
  expect(failResult).toEqual({ kind: 'leaveCheckFailed', rolled: 0, required: 3 });
  expect(player.x).toBe(0); // unmoved -- no room was drawn or placed
  expect(player.y).toBe(0);
  expect(player.actionPoints).toBe(startingAP - 1); // not zeroed -- opening never happened

  const passRng = () => 0.99;
  const passResult = moveToRoom(gameState, 'p1', 'east', { stat: 'might', min: 3 }, passRng);
  expect(passResult.kind).toBe('open_door');
  expect(player.x).toBe(1);
  expect(player.actionPoints).toBe(0); // successful door-open still zeroes AP as normal
});

test('getAvailableDirections omits directions where neighbor room exists but has no door facing back', () => {
  const { gameState } = makeGameStateWithPlayer();
  // Manually place an explored room north of the entrance hall, but with no door facing south (back toward player).
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'west'] });
  const available = getAvailableDirections(gameState, 'p1');
  // North should NOT be in the available directions because the neighbor lacks a south-facing door.
  expect(available.find((a) => a.direction === 'north')).toBeUndefined();
});

test('moveToRoom throws NOT_YOUR_TURN when called by a player who is not the current turn player', () => {
  const { gameState } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0; // p1's turn
  expect(() => moveToRoom(gameState, 'p2', 'east')).toThrow('NOT_YOUR_TURN');
});

test('selectAction deducts 1 action point and returns a pending marker for attack (still a stub)', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'attack');
  expect(result).toEqual({ kind: 'attack', pending: true });
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('selectAction throws INVALID_ACTION_TYPE for an unrecognized type', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => selectAction(gameState, 'p1', 'dance')).toThrow('INVALID_ACTION_TYPE');
});

test('selectAction throws NOT_ENOUGH_ACTION_POINTS when the player has 0 action points', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.actionPoints = 0;
  expect(() => selectAction(gameState, 'p1', 'attack')).toThrow('NOT_ENOUGH_ACTION_POINTS');
});

test('selectAction throws NOT_YOUR_TURN when called by a player who is not the current turn player', () => {
  const { gameState } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0; // p1's turn
  expect(() => selectAction(gameState, 'p2', 'item')).toThrow('NOT_YOUR_TURN');
});

test('isTurnOver reflects whether action points have reached 0', () => {
  const { player } = makeGameStateWithPlayer();
  expect(isTurnOver(player)).toBe(false);
  player.actionPoints = 0;
  expect(isTurnOver(player)).toBe(true);
});

test('getCurrentTurnPlayerId returns the player at the current index', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2', 'p3'];
  gameState.currentPlayerIndex = 1;
  expect(getCurrentTurnPlayerId(gameState)).toBe('p2');
});

test('getCurrentTurnPlayerId throws NO_TURN_ORDER when turnOrder is missing or empty', () => {
  const { gameState } = makeGameStateWithPlayer();
  delete gameState.turnOrder;
  expect(() => getCurrentTurnPlayerId(gameState)).toThrow('NO_TURN_ORDER');
  gameState.turnOrder = [];
  expect(() => getCurrentTurnPlayerId(gameState)).toThrow('NO_TURN_ORDER');
});

test('advanceTurn moves to the next player and wraps around at the end', () => {
  const { gameState } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  addPlayer(gameState, { playerId: 'p3', name: 'Carl', stats: makeStats() });
  gameState.turnOrder = ['p1', 'p2', 'p3'];
  gameState.currentPlayerIndex = 0;
  expect(advanceTurn(gameState)).toBe('p2');
  expect(gameState.currentPlayerIndex).toBe(1);
  expect(advanceTurn(gameState)).toBe('p3');
  expect(advanceTurn(gameState)).toBe('p1'); // wraps back to the start
  expect(gameState.currentPlayerIndex).toBe(0);
});

test('advanceTurn throws NO_TURN_ORDER when turnOrder is missing or empty', () => {
  const { gameState } = makeGameStateWithPlayer();
  delete gameState.turnOrder;
  expect(() => advanceTurn(gameState)).toThrow('NO_TURN_ORDER');
});

test('advanceTurn resets the next player action points to their speed stat value', () => {
  const { gameState } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  // Simulate p2 having already spent all their action points in a prior round.
  player2.actionPoints = 0;
  expect(advanceTurn(gameState)).toBe('p2');
  expect(player2.actionPoints).toBe(getStatValue(player2, 'speed'));
  expect(player2.actionPoints).toBe(4);
});

test('endTurn advances the turn even when the current player still has unspent actionPoints', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.actionPoints = 3; // deliberately not exhausted
  const result = endTurn(gameState, 'p1');
  expect(result).toBe('p2');
  expect(gameState.turnOrder[gameState.currentPlayerIndex]).toBe('p2');
});

test('endTurn throws NOT_YOUR_TURN when called by a player who is not the current turn player', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  expect(() => endTurn(gameState, 'p2')).toThrow('NOT_YOUR_TURN');
});

test('endTurn throws SUMMON_ACTIVE when the player has an active summon', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: null };
  expect(() => endTurn(gameState, 'p1')).toThrow('SUMMON_ACTIVE');
});

test('canUseStairs returns true in the Grand Staircase room on the ground floor', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.x = -4;
  player.y = 0; // fixed position of room_grand_staircase
  expect(canUseStairs(gameState, 'p1')).toBe(true);
});

test('canUseStairs returns true in the Upper Landing room on the upper floor', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.floor = 'upper';
  player.x = 0;
  player.y = 0; // fixed position of room_upper_landing
  expect(canUseStairs(gameState, 'p1')).toBe(true);
});

test('canUseStairs returns false when the player is not at a stairs-linked room', () => {
  const { gameState } = makeGameStateWithPlayer();
  // Default player position is the entrance hall (0,0), not the stairs room.
  expect(canUseStairs(gameState, 'p1')).toBe(false);
});

test('useStairs moves the player to the linked room on the other floor without spending action points', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.x = -4;
  player.y = 0; // Grand Staircase
  const startingAP = player.actionPoints;
  const result = useStairs(gameState, 'p1');
  expect(result).toEqual({ kind: 'stairs', floor: 'upper', x: 0, y: 0 });
  expect(player.floor).toBe('upper');
  expect(player.x).toBe(0);
  expect(player.y).toBe(0);
  expect(player.actionPoints).toBe(startingAP); // free action, unchanged
});

test('useStairs throws STAIRS_NOT_AVAILABLE when the player is not at a stairs-linked room', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => useStairs(gameState, 'p1')).toThrow('STAIRS_NOT_AVAILABLE');
});

test('useStairs throws NOT_YOUR_TURN when called by a player who is not the current turn player', () => {
  const { gameState } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player2.x = -4;
  player2.y = 0; // Grand Staircase
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0; // p1's turn
  expect(() => useStairs(gameState, 'p2')).toThrow('NOT_YOUR_TURN');
});

test('useStairs throws SUMMON_ACTIVE when the player is controlling a summon', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.x = -4;
  player.y = 0; // Grand Staircase -- stairs would otherwise be available
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: null };
  expect(() => useStairs(gameState, 'p1')).toThrow('SUMMON_ACTIVE');
});

test('selectAction item: succeeds when the player holds the item, defaults target to self', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_003' });
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_003' });
  expect(result).toEqual({ kind: 'item', itemId: 'item_003', targetPlayerId: 'p1' });
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('selectAction item: throws ITEM_NOT_HELD when the player does not have the item', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => selectAction(gameState, 'p1', 'item', { itemId: 'item_003' })).toThrow('ITEM_NOT_HELD');
});

test('selectAction item: succeeds targeting another player in the same room when itemCanTargetOthers is true', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  // addPlayer always places new players at the entrance hall (0,0), same as p1.
  player.inventory.push({ id: 'item_003' });
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_003', targetPlayerId: 'p2', itemCanTargetOthers: true });
  expect(result).toEqual({ kind: 'item', itemId: 'item_003', targetPlayerId: 'p2' });
  expect(player2.floor).toBe('ground'); // sanity check target resolved correctly
});

test('selectAction item: throws ITEM_CANNOT_TARGET_OTHERS when targeting another player without permission', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.inventory.push({ id: 'item_010' });
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_010', targetPlayerId: 'p2', itemCanTargetOthers: false })
  ).toThrow('ITEM_CANNOT_TARGET_OTHERS');
});

test('selectAction item: throws TARGET_NOT_IN_ROOM when the target is elsewhere, even with itemCanTargetOthers', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player2.x = 5; // move p2 out of the entrance hall
  player.inventory.push({ id: 'item_003' });
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_003', targetPlayerId: 'p2', itemCanTargetOthers: true })
  ).toThrow('TARGET_NOT_IN_ROOM');
});

test('selectAction item mode:give transfers the item to a same-room target player', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_003' });
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  other.floor = player.floor;
  other.x = player.x;
  other.y = player.y;
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'give', targetPlayerId: 'p2' });
  expect(result).toEqual({ kind: 'item', mode: 'give', itemId: 'item_003', targetPlayerId: 'p2' });
  expect(player.inventory).toEqual([]);
  expect(other.inventory).toEqual([{ id: 'item_003' }]);
  expect(player.actionPoints).toBe(3); // addPlayer resets AP to speed value (4, per makeStats' speed baseIndex) minus the 1 spent here
});

test('selectAction item mode:give throws TARGET_NOT_IN_ROOM when the target is elsewhere', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_003' });
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  other.floor = player.floor;
  other.x = player.x + 99;
  other.y = player.y;
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'give', targetPlayerId: 'p2' })
  ).toThrow('TARGET_NOT_IN_ROOM');
});

test('selectAction item mode:leave removes the item from inventory and adds it to the current room\'s droppedItems', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_003' });
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'leave' });
  expect(result).toEqual({ kind: 'item', mode: 'leave', itemId: 'item_003' });
  expect(player.inventory).toEqual([]);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  expect(room.droppedItems).toEqual([{ id: 'item_003' }]);
});

test('selectAction item mode:leave preserves the item object\'s extra fields (e.g. an activated mask\'s active flag)', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'omen_008', active: true });
  selectAction(gameState, 'p1', 'item', { itemId: 'omen_008', mode: 'leave' });
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  expect(room.droppedItems).toEqual([{ id: 'omen_008', active: true }]);
});

test('selectAction item mode:leave then mode:pickup round-trips the item object without losing extra fields', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'omen_008', active: true });
  selectAction(gameState, 'p1', 'item', { itemId: 'omen_008', mode: 'leave' });
  selectAction(gameState, 'p1', 'item', { itemId: 'omen_008', mode: 'pickup' });
  expect(player.inventory).toEqual([{ id: 'omen_008', active: true }]);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  expect(room.droppedItems).toEqual([]);
});

test('selectAction item mode:leave throws ITEM_NOT_HELD when the player does not hold it', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'not_held', mode: 'leave' })
  ).toThrow('ITEM_NOT_HELD');
});

test('selectAction item mode:pickup moves a dropped item from the room into inventory', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push({ id: 'item_003' });
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'pickup' });
  expect(result).toEqual({ kind: 'item', mode: 'pickup', itemId: 'item_003' });
  expect(player.inventory).toEqual([{ id: 'item_003' }]);
  expect(room.droppedItems).toEqual([]);
});

test('selectAction item mode:pickup throws ITEM_NOT_IN_ROOM when the room has no such dropped item', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'pickup' })
  ).toThrow('ITEM_NOT_IN_ROOM');
});

test('selectAction room_action: succeeds when hasRoomAction is true', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'room_action', { hasRoomAction: true });
  expect(result).toEqual({ kind: 'room_action' });
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('selectAction room_action: throws NO_ROOM_ACTION_AVAILABLE when hasRoomAction is false or omitted', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => selectAction(gameState, 'p1', 'room_action', { hasRoomAction: false })).toThrow('NO_ROOM_ACTION_AVAILABLE');
  expect(() => selectAction(gameState, 'p1', 'room_action')).toThrow('NO_ROOM_ACTION_AVAILABLE');
});

test('moveSummon moves the summon to an already-explored neighbor room and spends 1 of its own actionPoints', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [] });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: null };
  const result = moveSummon(gameState, 'p1', 'north');
  expect(result).toEqual({ kind: 'move', x: 0, y: -1 });
  expect(player.summons.x).toBe(0);
  expect(player.summons.y).toBe(-1);
  expect(player.summons.actionPoints).toBe(5);
});

test('moveSummon never offers open_door -- throws INVALID_MOVE_DIRECTION toward unexplored territory', () => {
  const { gameState, player } = makeGameStateWithPlayer(); // room deck has cards available for a human player's open_door
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: null };
  expect(() => moveSummon(gameState, 'p1', 'east')).toThrow('INVALID_MOVE_DIRECTION');
});

test('moveSummon throws NO_ACTIVE_SUMMON when the player has no summon', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => moveSummon(gameState, 'p1', 'north')).toThrow('NO_ACTIVE_SUMMON');
});

test('moveSummon throws NOT_ENOUGH_ACTION_POINTS when the summon is out of actionPoints', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [] });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 0, carryingItemId: null };
  expect(() => moveSummon(gameState, 'p1', 'north')).toThrow('NOT_ENOUGH_ACTION_POINTS');
});

test('selectSummonAction item mode:pickup picks up a dropped item at the summon\'s own position, not the player\'s', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [{ id: 'item_003' }] });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: -1, actionPoints: 6, carryingItemId: null };
  const result = selectSummonAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'pickup' });
  expect(result).toEqual({ kind: 'item', mode: 'pickup', itemId: 'item_003' });
  expect(player.summons.carryingItemId).toBe('item_003');
  expect(player.inventory).toEqual([]); // did not go to the player's own inventory
});

test('selectSummonAction item mode:pickup throws SUMMON_ALREADY_CARRYING when already holding something', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const room = gameState.board.ground.get(coordKey(0, 0));
  room.droppedItems.push({ id: 'item_099' });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: 'item_003' };
  expect(() =>
    selectSummonAction(gameState, 'p1', 'item', { itemId: 'item_099', mode: 'pickup' })
  ).toThrow('SUMMON_ALREADY_CARRYING');
});

test('selectSummonAction item mode:leave drops the carried item at the summon\'s current room', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: 'item_003' };
  const result = selectSummonAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'leave' });
  expect(result).toEqual({ kind: 'item', mode: 'leave', itemId: 'item_003' });
  expect(player.summons.carryingItemId).toBeNull();
  const room = gameState.board.ground.get(coordKey(0, 0));
  expect(room.droppedItems).toEqual([{ id: 'item_003' }]);
});

test('selectSummonAction actionType:dissipate clears player.summons and drops the carried item where the summon stood', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [] });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: -1, actionPoints: 0, carryingItemId: 'item_003' };
  const result = selectSummonAction(gameState, 'p1', 'dissipate', {});
  expect(result).toEqual({ kind: 'dissipate' });
  expect(player.summons).toBeNull();
  const room = gameState.board.ground.get(coordKey(0, -1));
  expect(room.droppedItems).toEqual([{ id: 'item_003' }]);
});

test('selectSummonAction actionType:dissipate works even when the summon has 0 actionPoints left', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 0, carryingItemId: null };
  const result = selectSummonAction(gameState, 'p1', 'dissipate', {});
  expect(result).toEqual({ kind: 'dissipate' });
  expect(player.summons).toBeNull();
});

test('selectSummonAction throws NO_ACTIVE_SUMMON when the player has no summon', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => selectSummonAction(gameState, 'p1', 'dissipate', {})).toThrow('NO_ACTIVE_SUMMON');
});

test('advanceTurn clears the outgoing player\'s summons as a safety net', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 3, carryingItemId: null };
  player.summonUsedThisTurn = true;
  advanceTurn(gameState);
  expect(player.summons).toBeNull();
  // The once-per-turn switch allowance resets for the outgoing player's next turn.
  expect(player.summonUsedThisTurn).toBe(false);
});

test('advanceTurn resets the outgoing player\'s diceInterjectionUsedThisTurn to an empty array', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.diceInterjectionUsedThisTurn = ['item_006'];
  advanceTurn(gameState);
  expect(player.diceInterjectionUsedThisTurn).toEqual([]);
});

test('advanceTurn drops the outgoing summon\'s carried item into its room instead of destroying it', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 3, carryingItemId: 'item_003' };
  advanceTurn(gameState);
  expect(player.summons).toBeNull();
  const room = gameState.board.ground.get(coordKey(0, 0));
  expect(room.droppedItems).toEqual([{ id: 'item_003' }]);
});
