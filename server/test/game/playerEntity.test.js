const { STATS, createPlayer, changeStat, resetActionPoints, movePlayerTo, getStatValue, isBelowBase, addItem, removeItem, countHeldItems } = require('../../src/game/playerEntity');

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    // speed has a repeated entry (index 2 and 3 both = 4) to exercise the
    // "index moves but the effective value doesn't change" mechanic.
    speed: { track: [2, 3, 4, 4, 5, 6], baseIndex: 2, skullIndex: 0 },
    knowledge: { track: [1, 1, 2, 3, 4], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

test('STATS lists the four attribute names', () => {
  expect(STATS).toEqual(['might', 'speed', 'knowledge', 'sanity']);
});

test('createPlayer builds a player with the given stat tracks, position, and action points', () => {
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
  expect(player.stats.might).toEqual({
    track: [1, 2, 3, 4, 5],
    currentIndex: 2,
    baseIndex: 2,
    skullIndex: 0,
    overflow: 0,
  });
  expect(player.inventory).toEqual([]);
  expect(player.characterId).toBeNull(); // not supplied
});

test('createPlayer stores the given characterId (used by the client to look up portrait/icon assets)', () => {
  const player = createPlayer({
    playerId: 'p1',
    name: 'Alice',
    characterId: 'char_001',
    floor: 'ground',
    x: 0,
    y: 0,
    stats: makeStats(),
    actionPoints: 0,
  });
  expect(player.characterId).toBe('char_001');
});

test('getStatValue reads the track value at the current index', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(getStatValue(player, 'might')).toBe(3); // track[2] = 3
});

test('baseIndex stays fixed at the character sheet starting position even as currentIndex moves', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'might', 2, false); // currentIndex moves, baseIndex must not
  expect(player.stats.might.baseIndex).toBe(2);
  expect(player.stats.might.currentIndex).toBe(4);
});

test('isBelowBase reflects whether the current index has dropped below the starting position', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(isBelowBase(player, 'might')).toBe(false); // at base
  changeStat(player, 'might', -1, false);
  expect(isBelowBase(player, 'might')).toBe(true); // below base
  changeStat(player, 'might', 2, false);
  expect(isBelowBase(player, 'might')).toBe(false); // above base
});

test('isBelowBase throws UNKNOWN_STAT for an invalid stat name', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(() => isBelowBase(player, 'agility')).toThrow('UNKNOWN_STAT');
});

test('changeStat moves the index up by delta levels', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'might', 1, false);
  expect(player.stats.might.currentIndex).toBe(3);
  expect(getStatValue(player, 'might')).toBe(4); // track[3] = 4
});

test('changeStat can move the index without changing the effective value, when the track repeats', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  // speed track [2,3,4,4,5,6], baseIndex 2 -> value 4
  changeStat(player, 'speed', 1, false); // index 2 -> 3, both value 4
  expect(player.stats.speed.currentIndex).toBe(3);
  expect(getStatValue(player, 'speed')).toBe(4); // unchanged face value
});

test('changeStat records overflow when increasing past the last index', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  // speed track length 6 (indices 0-5), baseIndex 2, room to max = 3
  changeStat(player, 'speed', 5, false); // 3 levels to reach index 5, 2 levels overflow
  expect(player.stats.speed.currentIndex).toBe(5);
  expect(player.stats.speed.overflow).toBe(2);
  expect(getStatValue(player, 'speed')).toBe(8); // track[5]=6 + overflow 2
});

test('changeStat consumes overflow before reducing the index', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'speed', 5, false); // currentIndex=5, overflow=2
  changeStat(player, 'speed', -1, false); // consumes 1 from overflow, index unchanged
  expect(player.stats.speed.currentIndex).toBe(5);
  expect(player.stats.speed.overflow).toBe(1);
});

test('changeStat does not drop a stat below skullIndex+1 before the haunt starts', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'knowledge', -10, false);
  expect(player.stats.knowledge.currentIndex).toBe(1); // skullIndex(0) + 1, floored
});

test('changeStat allows a stat to reach skullIndex after the haunt starts', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'knowledge', -10, true);
  expect(player.stats.knowledge.currentIndex).toBe(0); // skullIndex itself, floored
});

test('changeStat throws UNKNOWN_STAT for an invalid stat name', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(() => changeStat(player, 'agility', 1, false)).toThrow('UNKNOWN_STAT');
});

test('changeStat throws INVALID_STAT_DELTA for a non-integer delta', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(() => changeStat(player, 'might', '1', false)).toThrow('INVALID_STAT_DELTA');
  expect(() => changeStat(player, 'might', NaN, false)).toThrow('INVALID_STAT_DELTA');
  expect(() => changeStat(player, 'might', 1.5, false)).toThrow('INVALID_STAT_DELTA');
});

test('changeStat throws INVALID_HAUNT_FLAG for a missing or non-boolean hauntStarted', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(() => changeStat(player, 'might', 1, undefined)).toThrow('INVALID_HAUNT_FLAG');
  expect(() => changeStat(player, 'might', 1, 'false')).toThrow('INVALID_HAUNT_FLAG');
  expect(() => changeStat(player, 'might', 1, 0)).toThrow('INVALID_HAUNT_FLAG');
});

test('resetActionPoints sets action points to the current speed value', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'speed', 1, false); // index 2 -> 3, value stays 4 (repeated track entry)
  resetActionPoints(player);
  expect(player.actionPoints).toBe(4);
});

test('movePlayerTo updates floor and coordinates', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  movePlayerTo(player, 'upper', 2, -1);
  expect(player.floor).toBe('upper');
  expect(player.x).toBe(2);
  expect(player.y).toBe(-1);
});

test('createPlayer initializes visitedRooms with the starting position', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(player.visitedRooms).toEqual([{ floor: 'ground', x: 0, y: 0 }]);
});

test('movePlayerTo appends the new position to visitedRooms', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  movePlayerTo(player, 'ground', 1, 0);
  expect(player.visitedRooms).toEqual([
    { floor: 'ground', x: 0, y: 0 },
    { floor: 'ground', x: 1, y: 0 },
  ]);
});

test('movePlayerTo does not add a duplicate entry when returning to an already-visited room', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  movePlayerTo(player, 'ground', 1, 0);
  movePlayerTo(player, 'ground', 0, 0);
  expect(player.visitedRooms).toEqual([
    { floor: 'ground', x: 0, y: 0 },
    { floor: 'ground', x: 1, y: 0 },
  ]);
});

test('createPlayer throws MISSING_STAT_DEFINITION if a required stat is missing', () => {
  const incompleteStats = {
    might: { track: [1, 2, 3], baseIndex: 1, skullIndex: 0 },
    speed: { track: [1, 2, 3], baseIndex: 1, skullIndex: 0 },
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

test('createPlayer throws MISSING_STAT_DEFINITION if a stat entry has no valid track', () => {
  const malformedStats = {
    might: {}, // missing track/baseIndex/skullIndex
    speed: { track: [1, 2, 3], baseIndex: 1, skullIndex: 0 },
    knowledge: { track: [1, 2, 3], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3], baseIndex: 1, skullIndex: 0 },
  };
  expect(() => createPlayer({
    playerId: 'p1',
    name: 'Alice',
    floor: 'ground',
    x: 0,
    y: 0,
    stats: malformedStats,
    actionPoints: 0,
  })).toThrow('MISSING_STAT_DEFINITION');
});

test('createPlayer throws INVALID_STAT_TRACK if a track is not non-decreasing', () => {
  const badStats = makeStats();
  badStats.might = { track: [3, 2, 4], baseIndex: 0, skullIndex: 0 };
  expect(() => createPlayer({
    playerId: 'p1',
    name: 'Alice',
    floor: 'ground',
    x: 0,
    y: 0,
    stats: badStats,
    actionPoints: 0,
  })).toThrow('INVALID_STAT_TRACK');
});

test('createPlayer throws INVALID_SKULL_INDEX if skullIndex is out of bounds', () => {
  const badStats = makeStats();
  badStats.might = { track: [1, 2, 3], baseIndex: 1, skullIndex: 5 };
  expect(() => createPlayer({
    playerId: 'p1',
    name: 'Alice',
    floor: 'ground',
    x: 0,
    y: 0,
    stats: badStats,
    actionPoints: 0,
  })).toThrow('INVALID_SKULL_INDEX');
});

test('createPlayer throws INVALID_BASE_INDEX if baseIndex is out of bounds', () => {
  const badStats = makeStats();
  badStats.might = { track: [1, 2, 3], baseIndex: 9, skullIndex: 0 };
  expect(() => createPlayer({
    playerId: 'p1',
    name: 'Alice',
    floor: 'ground',
    x: 0,
    y: 0,
    stats: badStats,
    actionPoints: 0,
  })).toThrow('INVALID_BASE_INDEX');
});

test('addItem pushes the item onto the player inventory', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  addItem(player, { id: 'item_001', name: '左輪手槍' });
  expect(player.inventory).toEqual([{ id: 'item_001', name: '左輪手槍' }]);
});

test('addItem appends without disturbing existing items', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  addItem(player, { id: 'item_001' });
  addItem(player, { id: 'item_002' });
  expect(player.inventory.map((i) => i.id)).toEqual(['item_001', 'item_002']);
});

test('addItem throws INVALID_ITEM for an item missing an id', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(() => addItem(player, { name: '沒有id' })).toThrow('INVALID_ITEM');
  expect(() => addItem(player, null)).toThrow('INVALID_ITEM');
});

test('removeItem removes and returns the matching item', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  addItem(player, { id: 'item_001', name: '左輪手槍' });
  addItem(player, { id: 'item_002', name: '斧頭' });
  const removed = removeItem(player, 'item_001');
  expect(removed).toEqual({ id: 'item_001', name: '左輪手槍' });
  expect(player.inventory.map((i) => i.id)).toEqual(['item_002']);
});

test('removeItem throws ITEM_NOT_FOUND when no inventory item matches', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(() => removeItem(player, 'not_held')).toThrow('ITEM_NOT_FOUND');
});

test('countHeldItems counts only ids that appear in cardContent.items, not omens', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  addItem(player, { id: 'item_001' });
  addItem(player, { id: 'omen_003' });
  addItem(player, { id: 'item_007' });
  const cardContent = {
    items: [{ id: 'item_001' }, { id: 'item_007' }, { id: 'item_099' }],
    omens: [{ id: 'omen_003' }],
  };
  expect(countHeldItems(player, cardContent)).toBe(2);
});

test('countHeldItems returns 0 for an empty inventory', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  const cardContent = { items: [{ id: 'item_001' }], omens: [] };
  expect(countHeldItems(player, cardContent)).toBe(0);
});
