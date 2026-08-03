const { createGameState, addPlayer } = require('../../src/game/gameState');
const { resetActionPoints, getStatValue } = require('../../src/game/playerEntity');
const {
  getAvailableDirections,
  moveToRoom,
  selectAction,
  isTurnOver,
  getCurrentTurnPlayerId,
  advanceTurn,
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

test('selectAction deducts 1 action point and returns a pending marker', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'item');
  expect(result).toEqual({ kind: 'item', pending: true });
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
