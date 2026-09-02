const { getPlayer } = require('./gameState');
const { resetActionPoints } = require('./playerEntity');

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

function resetPhaseLocks(gameState, phase) {
  for (const p of getParticipants(gameState, phase)) {
    p.phaseLocked = false;
  }
}

function enterPhase(gameState, phase) {
  gameState.currentPhase = phase;
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
  if (isNpcPhase(phase) || player.isNPC) {
    // Real players never act during an NPC phase, and an NPC entity has no
    // socket connection of its own to call this from -- NPC-phase locking
    // (an owner locking their controlled NPC) is Handover item 8's "NPC 回合
    // 的操控權授權" piece, deliberately deferred, see the design doc.
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
  if (player.isNPC || gameState.currentPhase !== expectedPhase) {
    throw new Error('NOT_YOUR_PHASE');
  }
  if (player.phaseLocked) {
    throw new Error('ALREADY_LOCKED');
  }
}

module.exports = { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase, requirePhase };
