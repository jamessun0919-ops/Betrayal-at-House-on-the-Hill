const { SIDES } = require('./doorLayout');
const { canMoveBetween, placeNewRoom, coordKey, DIRECTION_DELTA } = require('./boardGenerator');
const { drawRoom, hasRoomForFloor } = require('./roomDeck');
const { getPlayer } = require('./gameState');
const { movePlayerTo, resetActionPoints } = require('./playerEntity');

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

function moveToRoom(gameState, playerId, direction) {
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
  const delta = DIRECTION_DELTA[direction];
  const targetCoord = { x: player.x + delta.dx, y: player.y + delta.dy };

  if (choice.kind === 'move') {
    movePlayerTo(player, player.floor, targetCoord.x, targetCoord.y);
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
  movePlayerTo(player, player.floor, placedRoom.x, placedRoom.y);
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
  player.inventory.splice(index, 1);
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  room.droppedItems.push({ id: itemId });
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'leave', itemId };
}

function pickupItemAction(gameState, player, itemId) {
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  const index = room.droppedItems.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_IN_ROOM');
  }
  room.droppedItems.splice(index, 1);
  player.inventory.push({ id: itemId });
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
    player.actionPoints -= 1;
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
  gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.turnOrder.length;
  const nextPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
  const nextPlayer = getPlayer(gameState, nextPlayerId);
  resetActionPoints(nextPlayer);
  return nextPlayerId;
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
  requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (!canUseStairs(gameState, playerId)) {
    throw new Error('STAIRS_NOT_AVAILABLE');
  }
  const player = requirePlayer(gameState, playerId);
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
  selectAction,
  isTurnOver,
  getCurrentTurnPlayerId,
  advanceTurn,
  canUseStairs,
  useStairs,
};
