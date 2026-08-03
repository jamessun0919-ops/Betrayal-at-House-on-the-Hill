const { SIDES } = require('./doorLayout');
const { canMoveBetween, placeNewRoom, coordKey, DIRECTION_DELTA } = require('./boardGenerator');
const { drawRoom, isRoomDeckEmpty } = require('./roomDeck');
const { getPlayer } = require('./gameState');
const { movePlayerTo } = require('./playerEntity');

const ACTION_TYPES = ['item', 'attack', 'room_action'];

function requirePlayer(gameState, playerId) {
  const player = getPlayer(gameState, playerId);
  if (!player) {
    throw new Error('PLAYER_NOT_FOUND');
  }
  return player;
}

function getAvailableDirections(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const grid = gameState.board[player.floor];
  const room = grid.get(coordKey(player.x, player.y));
  const results = [];
  const doorSides = Array.isArray(room.doorSides) ? room.doorSides : [];
  for (const direction of SIDES) {
    if (!doorSides.includes(direction)) continue;
    const delta = DIRECTION_DELTA[direction];
    const neighborCoord = { x: player.x + delta.dx, y: player.y + delta.dy };
    const neighborRoom = grid.get(coordKey(neighborCoord.x, neighborCoord.y));
    if (neighborRoom) {
      if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, direction)) {
        results.push({ direction, kind: 'move' });
      }
    } else if (!isRoomDeckEmpty(gameState.roomDeck)) {
      results.push({ direction, kind: 'open_door' });
    }
  }
  return results;
}

function moveToRoom(gameState, playerId, direction) {
  const player = requirePlayer(gameState, playerId);
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

  const roomDefinition = drawRoom(gameState.roomDeck);
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

function selectAction(gameState, playerId, actionType) {
  const player = requirePlayer(gameState, playerId);
  if (!ACTION_TYPES.includes(actionType)) {
    throw new Error('INVALID_ACTION_TYPE');
  }
  if (player.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  player.actionPoints -= 1;
  // M2b only tracks that this action slot was spent. Actual item/attack/room
  // mechanics are resolved by M2c (card effects) and M3 (combat) — this
  // "pending" marker is the hook point for those milestones.
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
  return gameState.turnOrder[gameState.currentPlayerIndex];
}

module.exports = {
  getAvailableDirections,
  moveToRoom,
  selectAction,
  isTurnOver,
  getCurrentTurnPlayerId,
  advanceTurn,
};
