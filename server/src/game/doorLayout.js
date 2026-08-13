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

// All distinct k-length combinations of `array` (order within each
// combination preserved from `array`; array is small — at most 3 elements
// in this module's usage — so a simple recursive generator is sufficient.
function combinations(array, k) {
  if (k === 0) return [[]];
  if (k > array.length) return [];
  const result = [];
  function helper(start, combo) {
    if (combo.length === k) {
      result.push(combo.slice());
      return;
    }
    for (let i = start; i < array.length; i++) {
      combo.push(array[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return result;
}

function computeDoorLayout(doorCount, entrySide, getNeighborRequirement, doorPattern = null) {
  if (!Number.isInteger(doorCount) || doorCount < 1 || doorCount > 4) {
    throw new Error('INVALID_DOOR_COUNT');
  }
  if (!SIDES.includes(entrySide)) {
    throw new Error('INVALID_ENTRY_SIDE');
  }
  if (typeof getNeighborRequirement !== 'function') {
    throw new Error('INVALID_NEIGHBOR_REQUIREMENT_FN');
  }
  if (doorPattern !== null && doorPattern !== 'opposite' && doorPattern !== 'adjacent') {
    throw new Error('INVALID_DOOR_PATTERN');
  }
  const otherSides = SIDES.filter((side) => side !== entrySide);

  // A declared doorPattern only disambiguates the 2-door case (opposite vs.
  // adjacent are two genuinely different shapes that can't be reached from
  // one another by rotation -- see the room-art generation prompt doc). For
  // any other door count, or when no pattern is declared, every other side
  // stays a candidate, preserving the original unrestricted behavior.
  let candidateSides = otherSides;
  if (doorCount === 2 && doorPattern) {
    const opposite = OPPOSITE_SIDE[entrySide];
    candidateSides = doorPattern === 'opposite'
      ? otherSides.filter((side) => side === opposite)
      : otherSides.filter((side) => side !== opposite);
  }

  // Exhaustively try every distinct way to pick the extra doors (at most 3
  // possible sides, so at most 3 combinations), in random order, so a
  // satisfiable layout is never missed just because a shuffle-with-replacement
  // happened not to sample it within a fixed number of attempts.
  const candidateCombos = shuffle(combinations(candidateSides, doorCount - 1));

  for (const combo of candidateCombos) {
    const extraDoors = new Set(combo);
    const hasConflict = otherSides.some((side) => {
      const requirement = getNeighborRequirement(side);
      if (requirement === null) return false;
      if (requirement !== 'door' && requirement !== 'wall') {
        throw new Error('INVALID_NEIGHBOR_REQUIREMENT_VALUE');
      }
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
