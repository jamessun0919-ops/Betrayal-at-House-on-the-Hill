const { createGameState, addPlayer } = require('../../src/game/gameState');
const { getStatValue, changeStat } = require('../../src/game/playerEntity');
const { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase, requirePhase, resolveActingEntity } = require('../../src/game/phaseFlow');

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

test('lockPlayerPhase throws ALREADY_LOCKED when the same player locks twice in the same phase', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  enterPhase(gameState, 'player_move');
  lockPlayerPhase(gameState, 'p1');
  expect(() => lockPlayerPhase(gameState, 'p1')).toThrow('ALREADY_LOCKED');
});

test('requirePhase does not throw when the player is in the expected phase and unlocked', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  expect(() => requirePhase(gameState, 'p1', 'player_move')).not.toThrow();
});

test('requirePhase throws PLAYER_NOT_FOUND for an unknown playerId', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  expect(() => requirePhase(gameState, 'ghost', 'player_move')).toThrow('PLAYER_NOT_FOUND');
});

test('requirePhase throws NOT_YOUR_PHASE when the current phase does not match expectedPhase', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  expect(() => requirePhase(gameState, 'p1', 'player_interact')).toThrow('NOT_YOUR_PHASE');
});

test('requirePhase throws ALREADY_LOCKED when the player has already locked the current phase', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']); // 2 players so p1 locking alone doesn't auto-advance the phase
  enterPhase(gameState, 'player_move');
  lockPlayerPhase(gameState, 'p1');
  expect(() => requirePhase(gameState, 'p1', 'player_move')).toThrow('ALREADY_LOCKED');
});

test('requirePhase and lockPlayerPhase treat an NPC playerId exactly like a real player once phase/lock match', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.players.set('npc_1', { playerId: 'npc_1', isNPC: true, controlledBy: 'p1', phaseLocked: false });
  gameState.currentPhase = 'npc_move';
  expect(() => requirePhase(gameState, 'npc_1', 'npc_move')).not.toThrow();
  expect(() => lockPlayerPhase(gameState, 'npc_1')).not.toThrow();
  expect(gameState.players.get('npc_1').phaseLocked).toBe(true);
});

test('lockPlayerPhase throws NOT_YOUR_PHASE when a real (non-NPC) player locks during npc_move/npc_interact', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.currentPhase = 'npc_move';
  expect(() => lockPlayerPhase(gameState, 'p1')).toThrow('NOT_YOUR_PHASE');
  gameState.currentPhase = 'npc_interact';
  expect(() => lockPlayerPhase(gameState, 'p1')).toThrow('NOT_YOUR_PHASE');
});

test('resolveActingEntity returns the caller\'s own id when actingAsNpcId is not given', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  expect(resolveActingEntity(gameState, 'p1', undefined)).toBe('p1');
  expect(resolveActingEntity(gameState, 'p1', null)).toBe('p1');
});

test('resolveActingEntity returns the NPC\'s own id when it is controlled by the caller', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.players.set('npc_1', { playerId: 'npc_1', isNPC: true, controlledBy: 'p1' });
  expect(resolveActingEntity(gameState, 'p1', 'npc_1')).toBe('npc_1');
});

test('resolveActingEntity throws NPC_NOT_CONTROLLED_BY_YOU for an NPC controlled by someone else', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  gameState.players.set('npc_1', { playerId: 'npc_1', isNPC: true, controlledBy: 'p2' });
  expect(() => resolveActingEntity(gameState, 'p1', 'npc_1')).toThrow('NPC_NOT_CONTROLLED_BY_YOU');
});

test('resolveActingEntity throws NPC_NOT_CONTROLLED_BY_YOU for a non-existent NPC id', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  expect(() => resolveActingEntity(gameState, 'p1', 'no_such_npc')).toThrow('NPC_NOT_CONTROLLED_BY_YOU');
});

test('resolveActingEntity throws NPC_NOT_CONTROLLED_BY_YOU when actingAsNpcId points at a real player, not an NPC', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  expect(() => resolveActingEntity(gameState, 'p1', 'p2')).toThrow('NPC_NOT_CONTROLLED_BY_YOU');
});

// 2026-09-03 regression: these three per-round resets used to live in
// turnFlow.js's advanceTurn, which nothing calls anymore now that the
// client's phase-end button emits game:lockPhase instead of game:endTurn.
// Moved here so they fire once per round (entering player_move) instead of
// never firing again.
test('enterPhase resets searchedThisTurn to false for real players entering player_move', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  player.searchedThisTurn = true;
  enterPhase(gameState, 'player_move');
  expect(player.searchedThisTurn).toBe(false);
});

test('enterPhase resets diceInterjectionUsedThisTurn to an empty array for real players entering player_move', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  player.diceInterjectionUsedThisTurn = ['item_005'];
  enterPhase(gameState, 'player_move');
  expect(player.diceInterjectionUsedThisTurn).toEqual([]);
});

test('enterPhase applies and clears pendingStatReverts for real players entering player_move', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  const beforeMight = player.stats.might.currentIndex;
  player.pendingStatReverts = [{ stat: 'might', delta: -1 }];
  enterPhase(gameState, 'player_move');
  expect(player.stats.might.currentIndex).toBe(beforeMight - 1);
  expect(player.pendingStatReverts).toEqual([]);
});

test('enterPhase applies pendingStatReverts after resetActionPoints, so a temporary speed buff still grants its extra action point on the turn it wears off', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  changeStat(player, 'speed', 1, gameState.hauntStarted); // simulate item_038's temporary +1 speed
  const boostedSpeed = getStatValue(player, 'speed'); // 5, per makeStats' speed track at baseIndex+1
  player.pendingStatReverts = [{ stat: 'speed', delta: -1 }]; // scheduled to revert on next player_move entry
  enterPhase(gameState, 'player_move');
  expect(player.actionPoints).toBe(boostedSpeed); // AP rolled against the still-boosted value before the revert applied
  expect(getStatValue(player, 'speed')).toBe(4); // speed itself has now reverted back to base
});

// 2026-09-03: negative counterparts to the four tests above -- entering a
// phase OTHER than player_move must NOT fire any of these three resets.
// Without this coverage, moving the `if (phase === 'player_move')` guard
// (or deleting it) would silently pass every existing test in this file.
test('enterPhase does NOT reset searchedThisTurn/diceInterjectionUsedThisTurn/pendingStatReverts when entering player_interact', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  const beforeMight = player.stats.might.currentIndex;
  player.searchedThisTurn = true;
  player.diceInterjectionUsedThisTurn = ['item_005'];
  player.pendingStatReverts = [{ stat: 'might', delta: -1 }];
  enterPhase(gameState, 'player_interact');
  expect(player.searchedThisTurn).toBe(true);
  expect(player.diceInterjectionUsedThisTurn).toEqual(['item_005']);
  expect(player.pendingStatReverts).toEqual([{ stat: 'might', delta: -1 }]);
  expect(player.stats.might.currentIndex).toBe(beforeMight); // not reverted
});

test('enterPhase does NOT reset searchedThisTurn/diceInterjectionUsedThisTurn/pendingStatReverts when entering settlement', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  const beforeMight = player.stats.might.currentIndex;
  player.searchedThisTurn = true;
  player.diceInterjectionUsedThisTurn = ['item_005'];
  player.pendingStatReverts = [{ stat: 'might', delta: -1 }];
  enterPhase(gameState, 'settlement');
  expect(player.searchedThisTurn).toBe(true);
  expect(player.diceInterjectionUsedThisTurn).toEqual(['item_005']);
  expect(player.pendingStatReverts).toEqual([{ stat: 'might', delta: -1 }]);
  expect(player.stats.might.currentIndex).toBe(beforeMight); // not reverted
});

test('enterPhase sets phaseDeadline to now + gameState.phaseTimeoutMs', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.phaseTimeoutMs = 12345;
  const before = Date.now();
  enterPhase(gameState, 'player_move');
  expect(gameState.phaseDeadline).toBeGreaterThanOrEqual(before + 12345);
  expect(gameState.phaseDeadline).toBeLessThanOrEqual(Date.now() + 12345);
});
