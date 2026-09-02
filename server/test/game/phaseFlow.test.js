const { createGameState, addPlayer } = require('../../src/game/gameState');
const { getStatValue } = require('../../src/game/playerEntity');
const { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase } = require('../../src/game/phaseFlow');

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 }, // value 4 at baseIndex
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

const STARTING_ROOMS = [
  { id: 'room_lobby_a', name: '大門廳', floor: 'ground', filename: 'LobbyA.webp' },
  { id: 'room_lobby_b', name: '大門廳', floor: 'ground', filename: 'LobbyB.webp' },
  { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing', filename: 'LobbyC.webp' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper', filename: '2Fladder.webp' },
  { id: 'room_basement_landing', name: '地下平台', floor: 'basement', filename: null },
];

function makeGameStateWithPlayers(playerIds) {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_new', doors: 4, floor: 'ground' }]);
  for (const playerId of playerIds) {
    addPlayer(gameState, { playerId, name: playerId, stats: makeStats() });
  }
  return gameState;
}

test('PHASE_ORDER is the 5 phases in the fixed order', () => {
  expect(PHASE_ORDER).toEqual(['player_move', 'npc_move', 'player_interact', 'npc_interact', 'settlement']);
});

test('enterPhase sets currentPhase and does not auto-advance when a real player is present and unlocked', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  expect(gameState.currentPhase).toBe('player_move');
});

test('enterPhase resets phaseLocked to false for that phase\'s participants', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.players.get('p1').phaseLocked = true; // simulate a stale lock from a previous phase
  enterPhase(gameState, 'player_move');
  expect(gameState.players.get('p1').phaseLocked).toBe(false);
});

test('enterPhase re-rolls action points for a move phase', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  player.actionPoints = 0; // simulate a spent-down pool from a previous phase
  enterPhase(gameState, 'player_move');
  expect(player.actionPoints).toBe(getStatValue(player, 'speed')); // 4, per makeStats()
});

test('enterPhase does NOT reset action points for an interact phase (movement leftover carries over)', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  player.actionPoints = 1; // leftover after spending 3 of 4 in player_move
  enterPhase(gameState, 'player_interact');
  expect(player.actionPoints).toBe(1);
});

test('enterPhase on an empty NPC phase (no NPCs exist yet) auto-advances to the next non-empty phase, cascading through both NPC phases', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'npc_move'); // zero NPC participants -- auto-advances
  expect(gameState.currentPhase).toBe('player_interact'); // the next phase that actually has participants

  gameState.players.get('p1').phaseLocked = true;
  enterPhase(gameState, 'npc_interact'); // zero NPC participants -- auto-advances
  expect(gameState.currentPhase).toBe('settlement');
});

test('advancePhase moves to the next phase in PHASE_ORDER, wrapping settlement back to player_move', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'settlement');
  advancePhase(gameState);
  expect(gameState.currentPhase).toBe('player_move'); // wrapped around -- a new round
});

test('advancePhase wrapping back to player_move re-rolls action points fresh, discarding any interact-phase leftover', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  enterPhase(gameState, 'settlement');
  player.actionPoints = 1; // leftover the design says must NOT carry into the new round
  advancePhase(gameState);
  expect(player.actionPoints).toBe(getStatValue(player, 'speed')); // 4 -- freshly rolled, not 1
});

test('lockPlayerPhase locks the player and does not advance while another participant is still unlocked', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  enterPhase(gameState, 'player_move');
  lockPlayerPhase(gameState, 'p1');
  expect(gameState.players.get('p1').phaseLocked).toBe(true);
  expect(gameState.currentPhase).toBe('player_move'); // p2 hasn't locked yet
});

test('lockPlayerPhase advances the phase once the last participant locks, cascading past the empty npc_move phase', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  enterPhase(gameState, 'player_move');
  lockPlayerPhase(gameState, 'p1');
  lockPlayerPhase(gameState, 'p2');
  // Both real players locked -> advances to npc_move -> zero NPC participants -> cascades to player_interact.
  expect(gameState.currentPhase).toBe('player_interact');
});

test('lockPlayerPhase throws PLAYER_NOT_FOUND for an unknown playerId', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  expect(() => lockPlayerPhase(gameState, 'ghost')).toThrow('PLAYER_NOT_FOUND');
});

test('lockPlayerPhase throws NOT_YOUR_PHASE when called during an NPC phase', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.currentPhase = 'npc_move'; // force the state directly, bypassing enterPhase's auto-cascade, to test the guard in isolation
  expect(() => lockPlayerPhase(gameState, 'p1')).toThrow('NOT_YOUR_PHASE');
});

test('lockPlayerPhase throws ALREADY_LOCKED when the same player locks twice in the same phase', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  enterPhase(gameState, 'player_move');
  lockPlayerPhase(gameState, 'p1');
  expect(() => lockPlayerPhase(gameState, 'p1')).toThrow('ALREADY_LOCKED');
});
