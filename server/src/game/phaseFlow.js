const { getPlayer } = require('./gameState');
const { resetActionPoints, changeStat } = require('./playerEntity');

const PHASE_ORDER = ['player_move', 'npc_move', 'player_interact', 'npc_interact', 'settlement'];

function requirePlayer(gameState, playerId) {
  const player = getPlayer(gameState, playerId);
  if (!player) {
    throw new Error('PLAYER_NOT_FOUND');
  }
  return player;
}

function isNpcPhase(phase) {
  return phase === 'npc_move' || phase === 'npc_interact';
}

function isMovePhase(phase) {
  return phase === 'player_move' || phase === 'npc_move';
}

// Real players participate in player_move/player_interact/settlement; NPCs
// (Handover item 8 -- not implemented in this codebase yet, so this always
// returns an empty array for npc_move/npc_interact today) participate in
// npc_move/npc_interact. There is no independent NPC confirmation step for
// settlement -- see the 2026-09-02 design doc's "結算階段" section.
function getParticipants(gameState, phase) {
  const allPlayers = Array.from(gameState.players.values());
  if (isNpcPhase(phase)) {
    return allPlayers.filter((p) => p.isNPC);
  }
  return allPlayers.filter((p) => !p.isNPC);
}

function allParticipantsLocked(gameState, phase) {
  return getParticipants(gameState, phase).every((p) => p.phaseLocked);
}

// A real player is disconnected via its own connected field; an NPC has no
// connected field of its own and is judged by its controller's instead (see
// playerEntity.js's createNpc). Exported so any other code path that needs
// to know "is this participant effectively disconnected" (e.g.
// socketHandlers.js's handlePhaseTimeout sweep) uses this exact same check,
// instead of re-deriving a second copy that can drift out of sync with it.
function isParticipantDisconnected(gameState, p) {
  return p.isNPC
    ? !(getPlayer(gameState, p.controlledBy)?.connected ?? true)
    : !p.connected;
}

function resetPhaseLocks(gameState, phase) {
  for (const p of getParticipants(gameState, phase)) {
    p.phaseLocked = isParticipantDisconnected(gameState, p);
  }
}

function enterPhase(gameState, phase) {
  gameState.currentPhase = phase;
  gameState.phaseDeadline = Date.now() + gameState.phaseTimeoutMs;
  resetPhaseLocks(gameState, phase);
  if (isMovePhase(phase)) {
    // Only a move phase re-rolls action points -- this is how each entity
    // type's "round" begins fresh, and how interact-phase leftover from the
    // previous round is discarded (the roll below overwrites it) without a
    // separate reset step.
    for (const p of getParticipants(gameState, phase)) {
      resetActionPoints(p);
    }
  }
  if (phase === 'player_move') {
    // These three per-round resets used to live in turnFlow.js's advanceTurn
    // (2026-09-03 regression: nothing calls advanceTurn anymore now that the
    // client's phase-end button emits game:lockPhase instead of
    // game:endTurn, so they'd never fire again). Moved here so they fire
    // once per round, for every real player, when a new round's player_move
    // begins.
    for (const p of getParticipants(gameState, phase)) {
      // Deliberately AFTER resetActionPoints above: resetActionPoints reads
      // the stat value BEFORE it gets reverted here, so a temporary buff
      // like item_038's speed boost still grants its extra action point on
      // the very turn it wears off. Reordering this would make that half of
      // the card's effect worthless.
      for (const revert of p.pendingStatReverts || []) {
        changeStat(p, revert.stat, revert.delta, gameState.hauntStarted);
      }
      p.pendingStatReverts = [];
      p.diceInterjectionUsedThisTurn = [];
      p.searchedThisTurn = false;
    }
  }
  // A phase with zero eligible participants can never receive a lock, so it
  // must auto-advance immediately -- this cascades through consecutive empty
  // phases (e.g. npc_move directly into npc_interact) via the recursive call.
  if (allParticipantsLocked(gameState, phase)) {
    advancePhase(gameState);
  }
}

function advancePhase(gameState) {
  const currentIndex = PHASE_ORDER.indexOf(gameState.currentPhase);
  const nextPhase = PHASE_ORDER[(currentIndex + 1) % PHASE_ORDER.length];
  enterPhase(gameState, nextPhase);
}

function lockPlayerPhase(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const phase = gameState.currentPhase;
  if (isNpcPhase(phase) && !player.isNPC) {
    throw new Error('NOT_YOUR_PHASE');
  }
  if (player.phaseLocked) {
    throw new Error('ALREADY_LOCKED');
  }
  player.phaseLocked = true;
  if (allParticipantsLocked(gameState, phase)) {
    advancePhase(gameState);
  }
}

// Gate for the existing action functions in turnFlow.js (moveToRoom,
// useStairs, and eventually selectAction's sub-branches) -- replaces the old
// getCurrentTurnPlayerId ownership check with a phase-based one. Reuses the
// same two error codes lockPlayerPhase already throws (NOT_YOUR_PHASE,
// ALREADY_LOCKED) rather than inventing new ones, since both mean the same
// thing to a caller: the current phase state doesn't allow this right now.
function requirePhase(gameState, playerId, expectedPhase) {
  const player = requirePlayer(gameState, playerId);
  if (gameState.currentPhase !== expectedPhase) {
    throw new Error('NOT_YOUR_PHASE');
  }
  if (player.phaseLocked) {
    throw new Error('ALREADY_LOCKED');
  }
}

// Authorization boundary for NPC-driven actions -- socketHandlers.js calls
// this once per relevant event with the caller's own (trusted, from
// socket.data) playerId and the optional actingAsNpcId from the payload,
// then treats the returned id as "the playerId this action applies to" for
// every existing function below (requirePhase/lockPlayerPhase/turnFlow.js's
// moveToRoom/selectAction, or npcFlow.js for an NPC). Those functions no
// longer need their own isNPC check -- this is the only place that decides
// whether a caller is allowed to act as a given NPC.
function resolveActingEntity(gameState, callerId, actingAsNpcId) {
  if (!actingAsNpcId) {
    return callerId;
  }
  const npc = getPlayer(gameState, actingAsNpcId);
  if (!npc || !npc.isNPC || npc.controlledBy !== callerId) {
    throw new Error('NPC_NOT_CONTROLLED_BY_YOU');
  }
  return actingAsNpcId;
}

module.exports = { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase, requirePhase, resolveActingEntity, allParticipantsLocked, getParticipants, isParticipantDisconnected };
