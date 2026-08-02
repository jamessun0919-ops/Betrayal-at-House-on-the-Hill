const { SIDES, OPPOSITE_SIDE, computeDoorLayout } = require('../../src/game/doorLayout');

function noNeighbors() {
  return () => null;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('SIDES and OPPOSITE_SIDE are defined correctly', () => {
  expect(SIDES).toEqual(['north', 'east', 'south', 'west']);
  expect(OPPOSITE_SIDE).toEqual({ north: 'south', south: 'north', east: 'west', west: 'east' });
});

test('doorCount=1 with no neighbors: only the entry side has a door', () => {
  const layout = computeDoorLayout(1, 'north', noNeighbors());
  expect(layout).toEqual(new Set(['north']));
});

test('doorCount=4 with no neighbors: every side has a door', () => {
  const layout = computeDoorLayout(4, 'north', noNeighbors());
  expect(layout).toEqual(new Set(['north', 'east', 'south', 'west']));
});

test('doorCount=2 with no neighbors: entry side plus exactly one other side', () => {
  const layout = computeDoorLayout(2, 'north', noNeighbors());
  expect(layout.has('north')).toBe(true);
  expect(layout.size).toBe(2);
});

test('throws INVALID_DOOR_COUNT for an out-of-range door count', () => {
  expect(() => computeDoorLayout(0, 'north', noNeighbors())).toThrow('INVALID_DOOR_COUNT');
  expect(() => computeDoorLayout(5, 'north', noNeighbors())).toThrow('INVALID_DOOR_COUNT');
  expect(() => computeDoorLayout(1.5, 'north', noNeighbors())).toThrow('INVALID_DOOR_COUNT');
});

test('finds a conflict-free layout when one is possible, respecting neighbor requirements', () => {
  // east must be a wall (a neighbor already has no door facing us there).
  // The only valid picks for the single extra door (doorCount=2) are south or west.
  // Mock Math.random so the shuffle is deterministic and this test never flakes:
  // with Math.random always 0, Fisher-Yates on ['east','south','west'] yields
  // ['south','west','east'], and slice(0,1) picks 'south' — a valid, non-conflicting pick.
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const getNeighborRequirement = (side) => (side === 'east' ? 'wall' : null);
  const layout = computeDoorLayout(2, 'north', getNeighborRequirement);
  expect(layout.has('north')).toBe(true);
  expect(layout.has('east')).toBe(false);
  expect(layout.size).toBe(2);
});

test('falls back to entry-only when no rotation can satisfy conflicting neighbor requirements', () => {
  // east AND south both require a door, but doorCount=2 only allows one extra pick,
  // so no single choice can satisfy both — every attempt conflicts.
  const getNeighborRequirement = (side) => {
    if (side === 'east') return 'door';
    if (side === 'south') return 'door';
    return null;
  };
  const layout = computeDoorLayout(2, 'north', getNeighborRequirement);
  // Fallback rule: entry side stays a door, every other side becomes a wall,
  // regardless of what a neighbor wanted.
  expect(layout).toEqual(new Set(['north']));
});

test('throws INVALID_ENTRY_SIDE for an invalid entry side', () => {
  expect(() => computeDoorLayout(1, 'northeast', noNeighbors())).toThrow('INVALID_ENTRY_SIDE');
  expect(() => computeDoorLayout(1, 'North', noNeighbors())).toThrow('INVALID_ENTRY_SIDE');
  expect(() => computeDoorLayout(1, undefined, noNeighbors())).toThrow('INVALID_ENTRY_SIDE');
  expect(() => computeDoorLayout(1, 'invalid', noNeighbors())).toThrow('INVALID_ENTRY_SIDE');
});

test('throws INVALID_NEIGHBOR_REQUIREMENT_FN when getNeighborRequirement is not a function', () => {
  expect(() => computeDoorLayout(1, 'north', undefined)).toThrow('INVALID_NEIGHBOR_REQUIREMENT_FN');
  expect(() => computeDoorLayout(1, 'north', null)).toThrow('INVALID_NEIGHBOR_REQUIREMENT_FN');
  expect(() => computeDoorLayout(1, 'north', 'not a function')).toThrow('INVALID_NEIGHBOR_REQUIREMENT_FN');
  expect(() => computeDoorLayout(1, 'north', {})).toThrow('INVALID_NEIGHBOR_REQUIREMENT_FN');
});

test('throws INVALID_NEIGHBOR_REQUIREMENT_VALUE when getNeighborRequirement returns something other than door/wall/null', () => {
  const getNeighborRequirement = (side) => (side === 'east' ? 'DOOR' : null);
  expect(() => computeDoorLayout(2, 'north', getNeighborRequirement)).toThrow(
    'INVALID_NEIGHBOR_REQUIREMENT_VALUE'
  );

  const getNeighborRequirementUndefined = (side) => (side === 'east' ? undefined : null);
  expect(() => computeDoorLayout(2, 'north', getNeighborRequirementUndefined)).toThrow(
    'INVALID_NEIGHBOR_REQUIREMENT_VALUE'
  );
});

test('regression: exhaustively finds the single satisfiable layout every time (no spurious fallback)', () => {
  // Only one of the three possible single-extra-door combinations for
  // doorCount=2 is conflict-free: extraDoors={south}.
  // - east must be a wall (picking east as the extra door always conflicts)
  // - south must be a door (not picking south as the extra door always conflicts)
  // - west has no requirement
  // Previously, the shuffle-and-retry-up-to-4-times approach (sampling with
  // replacement from 3 equally likely single-side picks) missed this valid
  // layout roughly (2/3)^4 ~= 20% of the time. Exhaustive enumeration of all
  // 3 combinations must find it 100% of the time.
  const getNeighborRequirement = (side) => {
    if (side === 'east') return 'wall';
    if (side === 'south') return 'door';
    return null;
  };

  for (let i = 0; i < 50; i++) {
    const layout = computeDoorLayout(2, 'north', getNeighborRequirement);
    expect(layout).toEqual(new Set(['north', 'south']));
  }
});
