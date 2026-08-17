const DIRECTION_DELTA = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

const OPPOSITE_SIDE = { north: 'south', south: 'north', east: 'west', west: 'east' };

// Mirrors server/src/game/turnFlow.js's getAvailableDirections. Keep this in
// sync if the server logic ever changes -- the server remains authoritative
// (game:move still validates for real), this is only for deciding which
// buttons to show.
function hasBlocksOpenDoorModifier(player) {
  return (player.modifiers || []).some((m) =>
    (m.effects || []).some((e) => e.hookType === 'blocksOpenDoor')
  );
}

function getAvailableDirections(player, currentRoom, boardRooms) {
  const blockedFromOpeningDoors = hasBlocksOpenDoorModifier(player);
  const doorSides = Array.isArray(currentRoom.doorSides) ? currentRoom.doorSides : [];
  const results = [];
  for (const direction of Object.keys(DIRECTION_DELTA)) {
    if (!doorSides.includes(direction)) continue;
    const delta = DIRECTION_DELTA[direction];
    const neighborX = currentRoom.x + delta.dx;
    const neighborY = currentRoom.y + delta.dy;
    const neighborRoom = boardRooms.find((r) => r.x === neighborX && r.y === neighborY);
    if (neighborRoom) {
      const facingSide = OPPOSITE_SIDE[direction];
      if (Array.isArray(neighborRoom.doorSides) && neighborRoom.doorSides.includes(facingSide)) {
        results.push({ direction, kind: 'move', neighborRoom });
      }
    } else if (!blockedFromOpeningDoors) {
      results.push({ direction, kind: 'open_door' });
    }
  }
  return results;
}

function findRoomInfo(roomId, roomContent) {
  if (!roomContent) return null;
  return (
    roomContent.rooms.find((r) => r.id === roomId) ||
    roomContent.startingRooms.find((r) => r.id === roomId) ||
    null
  );
}

function findCardInfo(cardId, cardContent) {
  if (!cardContent) return null;
  return (
    (cardContent.items || []).find((c) => c.id === cardId) ||
    (cardContent.events || []).find((c) => c.id === cardId) ||
    (cardContent.omens || []).find((c) => c.id === cardId) ||
    null
  );
}

export { DIRECTION_DELTA, OPPOSITE_SIDE, getAvailableDirections, findRoomInfo, findCardInfo };
