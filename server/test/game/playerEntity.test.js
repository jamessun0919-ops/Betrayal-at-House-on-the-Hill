const { STATS, createPlayer, changeStat, resetActionPoints, movePlayerTo } = require('../../src/game/playerEntity');

function makeStats() {
  return {
    might: { current: 3, max: 5, skullValue: 0 },
    speed: { current: 4, max: 5, skullValue: 0 },
    knowledge: { current: 2, max: 5, skullValue: 0 },
    sanity: { current: 3, max: 5, skullValue: 0 },
  };
}

test('STATS lists the four attribute names', () => {
  expect(STATS).toEqual(['might', 'speed', 'knowledge', 'sanity']);
});

test('createPlayer builds a player with the given stats, position, and action points', () => {
  const player = createPlayer({
    playerId: 'p1',
    name: 'Alice',
    floor: 'ground',
    x: 0,
    y: 0,
    stats: makeStats(),
    actionPoints: 0,
  });
  expect(player.playerId).toBe('p1');
  expect(player.stats.might).toEqual({ current: 3, max: 5, skullValue: 0, overflow: 0 });
  expect(player.inventory).toEqual([]);
});

test('changeStat increases a stat up to its max', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'might', 1, false);
  expect(player.stats.might.current).toBe(4);
});

test('changeStat records overflow when increasing past max', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'speed', 3, false); // current 4 + 3 = 7, max 5 -> current=5, overflow=2
  expect(player.stats.speed.current).toBe(5);
  expect(player.stats.speed.overflow).toBe(2);
});

test('changeStat consumes overflow before reducing current', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'speed', 3, false); // current=5, overflow=2
  changeStat(player, 'speed', -1, false); // consumes 1 from overflow
  expect(player.stats.speed.current).toBe(5);
  expect(player.stats.speed.overflow).toBe(1);
});

test('changeStat does not drop a stat to skull level before the haunt starts', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'knowledge', -10, false);
  expect(player.stats.knowledge.current).toBe(1); // skullValue(0) + 1, floored
});

test('changeStat allows a stat to reach skull level after the haunt starts', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'knowledge', -10, true);
  expect(player.stats.knowledge.current).toBe(0); // skullValue itself, floored
});

test('changeStat throws UNKNOWN_STAT for an invalid stat name', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(() => changeStat(player, 'agility', 1, false)).toThrow('UNKNOWN_STAT');
});

test('resetActionPoints sets action points to the current speed value', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'speed', 1, false); // speed 4 -> 5
  resetActionPoints(player);
  expect(player.actionPoints).toBe(5);
});

test('movePlayerTo updates floor and coordinates', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  movePlayerTo(player, 'upper', 2, -1);
  expect(player.floor).toBe('upper');
  expect(player.x).toBe(2);
  expect(player.y).toBe(-1);
});

test('createPlayer throws MISSING_STAT_DEFINITION if a required stat is missing', () => {
  const incompleteStats = {
    might: { current: 3, max: 5, skullValue: 0 },
    speed: { current: 4, max: 5, skullValue: 0 },
    // missing knowledge and sanity
  };
  expect(() => createPlayer({
    playerId: 'p1',
    name: 'Alice',
    floor: 'ground',
    x: 0,
    y: 0,
    stats: incompleteStats,
    actionPoints: 0,
  })).toThrow('MISSING_STAT_DEFINITION');
});
