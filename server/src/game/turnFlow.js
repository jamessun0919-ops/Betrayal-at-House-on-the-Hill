const { SIDES, OPPOSITE_SIDE } = require('./doorLayout');
const { canMoveBetween, placeNewRoom, coordKey, DIRECTION_DELTA } = require('./boardGenerator');
const { drawRoom, hasRoomForFloor } = require('./roomDeck');
const { getPlayer } = require('./gameState');
const { movePlayerTo, resetActionPoints, getStatValue } = require('./playerEntity');
const { rollDice, applyModifiers } = require('./effectPipeline');
const { findInterjectionOptions } = require('./diceInterjection');

const ACTION_TYPES = ['item', 'attack', 'room_action'];

function requirePlayer(gameState, playerId) {
  const player = getPlayer(gameState, playerId);
  if (!player) {
    throw new Error('PLAYER_NOT_FOUND');
  }
  return player;
}

function hasModifierEffect(player, hookType) {
  return (player.modifiers || []).some((m) => m.effects.some((e) => e.hookType === hookType));
}

function getAvailableDirections(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const grid = gameState.board[player.floor];
  const room = grid.get(coordKey(player.x, player.y));
  const results = [];
  const doorSides = Array.isArray(room.doorSides) ? room.doorSides : [];
  const blockedFromOpeningDoors = hasModifierEffect(player, 'blocksOpenDoor');
  for (const direction of SIDES) {
    if (!doorSides.includes(direction)) continue;
    const delta = DIRECTION_DELTA[direction];
    const neighborCoord = { x: player.x + delta.dx, y: player.y + delta.dy };
    const neighborRoom = grid.get(coordKey(neighborCoord.x, neighborCoord.y));
    if (neighborRoom) {
      if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, direction)) {
        results.push({ direction, kind: 'move' });
      }
    } else if (!blockedFromOpeningDoors && hasRoomForFloor(gameState.roomDeck, player.floor)) {
      results.push({ direction, kind: 'open_door' });
    }
  }
  return results;
}

function moveToRoom(gameState, playerId, direction, leaveCheck = null, rollOptions = {}) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (player.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const available = getAvailableDirections(gameState, playerId);
  const choice = available.find((a) => a.direction === direction);
  if (!choice) {
    throw new Error('INVALID_MOVE_DIRECTION');
  }

  if (leaveCheck) {
    // e.g. 塔橋/雜亂的房間/藤蔓糾纏的溫室 -- leaving this room (either to an
    // already-placed neighbor or by opening a new door) requires a stat
    // check first. A failed check costs the same 1 AP a normal move
    // attempt would, and never draws/places a new room -- the player never
    // actually left, so nothing about the door they tried is revealed.
    const { itemCatalog, resolvedRoll, rng } = rollOptions;
    let rolled;
    if (resolvedRoll !== undefined) {
      rolled = resolvedRoll;
    } else {
      const options = findInterjectionOptions(player, itemCatalog || [], null);
      if (options.length > 0) {
        // Mirrors handleDiceCheck's pending shape -- caller opens a
        // pendingRollChoice and resumes with a resolvedRoll instead.
        return { kind: 'leaveCheckPending', rollChoice: true, options, leaveCheck, direction };
      }
      const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
      const modifiers = [...(player.modifiers || []), ...(room.modifiers || [])];
      const diceCount = getStatValue(player, leaveCheck.stat);
      const adjustedCount = Math.max(1, Math.min(8, applyModifiers(diceCount, modifiers, 'onBeforeRoll', {})));
      rolled = applyModifiers(rollDice(adjustedCount, rng || Math.random), modifiers, 'onAfterRoll', {});
    }
    if (rolled < leaveCheck.min) {
      player.actionPoints -= 1;
      return { kind: 'leaveCheckFailed', rolled, required: leaveCheck.min };
    }
  }

  const delta = DIRECTION_DELTA[direction];
  const targetCoord = { x: player.x + delta.dx, y: player.y + delta.dy };

  if (choice.kind === 'move') {
    movePlayerTo(player, player.floor, targetCoord.x, targetCoord.y, OPPOSITE_SIDE[direction]);
    player.actionPoints -= 1;
    return { kind: 'move', x: targetCoord.x, y: targetCoord.y };
  }

  const roomDefinition = drawRoom(gameState.roomDeck, player.floor);
  const placedRoom = placeNewRoom(
    gameState.board,
    player.floor,
    { x: player.x, y: player.y },
    direction,
    roomDefinition
  );
  movePlayerTo(player, player.floor, placedRoom.x, placedRoom.y, OPPOSITE_SIDE[direction]);
  player.actionPoints = 0;
  const pendingCardDraw =
    roomDefinition.drawType && roomDefinition.drawType !== 'none'
      ? { deck: roomDefinition.drawType }
      : null;
  return {
    kind: 'open_door',
    x: placedRoom.x,
    y: placedRoom.y,
    roomId: placedRoom.roomId,
    pendingCardDraw,
  };
}

function getRoomAt(gameState, floor, x, y) {
  return gameState.board[floor].get(coordKey(x, y));
}

function moveSummon(gameState, playerId, direction) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  const summon = player.summons;
  if (!summon) {
    throw new Error('NO_ACTIVE_SUMMON');
  }
  if (summon.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
  const doorSides = Array.isArray(room.doorSides) ? room.doorSides : [];
  if (
    !doorSides.includes(direction) ||
    !canMoveBetween(gameState.board, summon.floor, { x: summon.x, y: summon.y }, direction)
  ) {
    // Summons can only move into already-placed neighbor rooms -- never open a
    // new door, regardless of whether the room deck has cards left.
    throw new Error('INVALID_MOVE_DIRECTION');
  }
  const delta = DIRECTION_DELTA[direction];
  summon.x += delta.dx;
  summon.y += delta.dy;
  summon.actionPoints -= 1;
  return { kind: 'move', x: summon.x, y: summon.y };
}

const SUMMON_ITEM_MODES = ['pickup', 'leave'];

function selectSummonAction(gameState, playerId, actionType, options = {}) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  const summon = player.summons;
  if (!summon) {
    throw new Error('NO_ACTIVE_SUMMON');
  }
  if (actionType === 'dissipate') {
    if (summon.carryingItemId) {
      const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
      room.droppedItems.push({ id: summon.carryingItemId });
    }
    player.summons = null;
    return { kind: 'dissipate' };
  }
  if (actionType !== 'item' || !SUMMON_ITEM_MODES.includes(options.mode)) {
    throw new Error('INVALID_ACTION_TYPE');
  }
  if (summon.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const { itemId, mode } = options;
  const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
  if (mode === 'leave') {
    if (summon.carryingItemId !== itemId) {
      throw new Error('ITEM_NOT_HELD');
    }
    room.droppedItems.push({ id: itemId });
    summon.carryingItemId = null;
    summon.actionPoints -= 1;
    return { kind: 'item', mode: 'leave', itemId };
  }
  // mode === 'pickup'
  if (summon.carryingItemId) {
    throw new Error('SUMMON_ALREADY_CARRYING');
  }
  const index = room.droppedItems.findIndex((i) => i.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_IN_ROOM');
  }
  room.droppedItems.splice(index, 1);
  summon.carryingItemId = itemId;
  summon.actionPoints -= 1;
  return { kind: 'item', mode: 'pickup', itemId };
}

function giveItemAction(gameState, player, itemId, targetPlayerId) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_HELD');
  }
  const targetPlayer = requirePlayer(gameState, targetPlayerId);
  if (
    targetPlayer.floor !== player.floor ||
    targetPlayer.x !== player.x ||
    targetPlayer.y !== player.y
  ) {
    throw new Error('TARGET_NOT_IN_ROOM');
  }
  const [item] = player.inventory.splice(index, 1);
  targetPlayer.inventory.push(item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'give', itemId, targetPlayerId };
}

function leaveItemAction(gameState, player, itemId) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_HELD');
  }
  const [item] = player.inventory.splice(index, 1);
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  room.droppedItems.push(item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'leave', itemId };
}

function pickupItemAction(gameState, player, itemId) {
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  const index = room.droppedItems.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_IN_ROOM');
  }
  const [item] = room.droppedItems.splice(index, 1);
  player.inventory.push(item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'pickup', itemId };
}

function selectAction(gameState, playerId, actionType, options = {}) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (!ACTION_TYPES.includes(actionType)) {
    throw new Error('INVALID_ACTION_TYPE');
  }
  if (player.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }

  if (actionType === 'item') {
    const { itemId, targetPlayerId, mode } = options;
    if (mode === 'give') {
      return giveItemAction(gameState, player, itemId, targetPlayerId);
    }
    if (mode === 'leave') {
      return leaveItemAction(gameState, player, itemId);
    }
    if (mode === 'pickup') {
      return pickupItemAction(gameState, player, itemId);
    }
    if (!player.inventory.some((item) => item.id === itemId)) {
      throw new Error('ITEM_NOT_HELD');
    }
    const effectTargetId = targetPlayerId || playerId;
    if (effectTargetId !== playerId && !options.itemCanTargetOthers) {
      throw new Error('ITEM_CANNOT_TARGET_OTHERS');
    }
    const targetPlayer = requirePlayer(gameState, effectTargetId);
    if (
      targetPlayer.floor !== player.floor ||
      targetPlayer.x !== player.x ||
      targetPlayer.y !== player.y
    ) {
      throw new Error('TARGET_NOT_IN_ROOM');
    }
    player.actionPoints -= 1;
    return { kind: 'item', itemId, targetPlayerId: effectTargetId };
  }

  if (actionType === 'room_action') {
    if (!options.hasRoomAction) {
      throw new Error('NO_ROOM_ACTION_AVAILABLE');
    }
    // Some room actions (e.g. the entrance-hall stairs rooms) are declared
    // free, matching the pre-existing "stairs cost no action points" rule --
    // most room actions (e.g. the vault's dice check) still cost 1.
    if (!options.freeRoomAction) {
      player.actionPoints -= 1;
    }
    return { kind: 'room_action' };
  }

  player.actionPoints -= 1;
  // "attack" is still a stub — M3 (combat) resolves it.
  return { kind: actionType, pending: true };
}

function isTurnOver(player) {
  return player.actionPoints <= 0;
}

function requireTurnOrder(gameState) {
  if (!Array.isArray(gameState.turnOrder) || gameState.turnOrder.length === 0) {
    throw new Error('NO_TURN_ORDER');
  }
}

function getCurrentTurnPlayerId(gameState) {
  requireTurnOrder(gameState);
  return gameState.turnOrder[gameState.currentPlayerIndex];
}

function advanceTurn(gameState) {
  requireTurnOrder(gameState);
  const outgoingPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
  const outgoingPlayer = getPlayer(gameState, outgoingPlayerId);
  if (outgoingPlayer) {
    const summon = outgoingPlayer.summons;
    if (summon && summon.carryingItemId) {
      const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
      room.droppedItems.push({ id: summon.carryingItemId });
    }
    outgoingPlayer.summons = null; // safety net -- should already be null before a turn can end
    outgoingPlayer.summonUsedThisTurn = false;
    outgoingPlayer.diceInterjectionUsedThisTurn = [];
  }
  gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.turnOrder.length;
  const nextPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
  const nextPlayer = getPlayer(gameState, nextPlayerId);
  resetActionPoints(nextPlayer);
  return nextPlayerId;
}

function endTurn(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (player.summons) {
    throw new Error('SUMMON_ACTIVE');
  }
  return advanceTurn(gameState);
}

function canUseStairs(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const grid = gameState.board[player.floor];
  const room = grid.get(coordKey(player.x, player.y));
  if (!room) return false;
  const { stairsLink } = gameState.board;
  if (player.floor === 'ground') {
    return room.roomId === stairsLink.groundRoomId;
  }
  return room.roomId === stairsLink.upperRoomId;
}

function useStairs(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (player.summons) {
    throw new Error('SUMMON_ACTIVE');
  }
  if (!canUseStairs(gameState, playerId)) {
    throw new Error('STAIRS_NOT_AVAILABLE');
  }
  const targetFloor = player.floor === 'ground' ? 'upper' : 'ground';
  const targetRoomId =
    player.floor === 'ground' ? gameState.board.stairsLink.upperRoomId : gameState.board.stairsLink.groundRoomId;
  const targetGrid = gameState.board[targetFloor];
  let targetRoom;
  for (const room of targetGrid.values()) {
    if (room.roomId === targetRoomId) {
      targetRoom = room;
      break;
    }
  }
  movePlayerTo(player, targetFloor, targetRoom.x, targetRoom.y);
  return { kind: 'stairs', floor: targetFloor, x: targetRoom.x, y: targetRoom.y };
}

module.exports = {
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
};
