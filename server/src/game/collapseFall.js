const { placeRoomAt } = require('./boardGenerator');
const { drawRoom } = require('./roomDeck');
const { movePlayerTo } = require('./playerEntity');
const { SIDES } = require('./doorLayout');

// Shared by the dice-check-gated collapsed-room fall (turnFlow.js's
// applyCollapseCheck) and the unconditional fall_to_basement effect
// (effectResolver.js, event_016) -- both drop a player through the floor
// into a freshly drawn basement room at the same (x, y). No physical
// damage is applied here (M3 damage-distribution system doesn't exist yet
// -- this is a known, deliberate gap, not an oversight).
function dropToBasement(gameState, player, currentRoom) {
  const guaranteedSide = SIDES[Math.floor(Math.random() * SIDES.length)];
  const basementRoomDefinition = drawRoom(gameState.roomDeck, 'basement');
  const basementRoom = placeRoomAt(
    gameState.board,
    'basement',
    currentRoom.x,
    currentRoom.y,
    basementRoomDefinition,
    guaranteedSide
  );
  currentRoom.collapseLink = { x: basementRoom.x, y: basementRoom.y };
  movePlayerTo(player, 'basement', basementRoom.x, basementRoom.y, null);
  return { basementRoomId: basementRoom.roomId, x: basementRoom.x, y: basementRoom.y };
}

module.exports = { dropToBasement };
