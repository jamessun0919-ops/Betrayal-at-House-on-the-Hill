const SIDES = ['north', 'east', 'south', 'west'];
const OPPOSITE_SIDE = { north: 'south', south: 'north', east: 'west', west: 'east' };

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

function computeDoorLayout(doorCount, entrySide, getNeighborRequirement) {
  if (!Number.isInteger(doorCount) || doorCount < 1 || doorCount > 4) {
    throw new Error('INVALID_DOOR_COUNT');
  }
  const otherSides = SIDES.filter((side) => side !== entrySide);

  for (let attempt = 0; attempt < 4; attempt++) {
    const shuffled = shuffle(otherSides);
    const extraDoors = new Set(shuffled.slice(0, doorCount - 1));
    const hasConflict = otherSides.some((side) => {
      const requirement = getNeighborRequirement(side);
      if (requirement === null) return false;
      const wantsDoor = extraDoors.has(side);
      return (requirement === 'door') !== wantsDoor;
    });
    if (!hasConflict) {
      return new Set([entrySide, ...extraDoors]);
    }
  }

  // Fallback: entry side is guaranteed a door; every other side becomes a
  // wall, regardless of what a neighbor wanted. This is a deliberate,
  // rare-case rule confirmed with the developer.
  return new Set([entrySide]);
}

module.exports = { SIDES, OPPOSITE_SIDE, computeDoorLayout };
