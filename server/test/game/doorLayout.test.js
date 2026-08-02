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
