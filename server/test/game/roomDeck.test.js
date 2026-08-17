const { createRoomDeck, drawRoom, isRoomDeckEmpty, getRemainingCount, hasRoomForFloor, removeRoomById } = require('../../src/game/roomDeck');

function makeRooms(count, floor = 'ground') {
  const rooms = [];
  for (let i = 0; i < count; i++) {
    rooms.push({ id: `room_${i}`, doors: 2, floor });
  }
  return rooms;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('createRoomDeck builds a deck containing every room, none drawn yet', () => {
  const deck = createRoomDeck(makeRooms(3));
  expect(deck.cards).toHaveLength(3);
  expect(isRoomDeckEmpty(deck)).toBe(false);
  expect(getRemainingCount(deck)).toBe(3);
});

test('createRoomDeck shuffles the rooms (does not just copy the input order every time)', () => {
  // Force a no-op shuffle once, then a reversing pattern once, and compare —
  // this only proves shuffling is applied, not a specific algorithm.
  const rooms = makeRooms(20);
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const deckA = createRoomDeck(rooms);
  jest.spyOn(Math, 'random').mockReturnValue(0.999);
  const deckB = createRoomDeck(rooms);
  expect(deckA.cards.map((r) => r.id)).not.toEqual(deckB.cards.map((r) => r.id));
});

test('drawRoom returns rooms one at a time and shrinks the deck', () => {
  const deck = createRoomDeck(makeRooms(2));
  const first = drawRoom(deck, 'ground');
  expect(getRemainingCount(deck)).toBe(1);
  const second = drawRoom(deck, 'ground');
  expect(getRemainingCount(deck)).toBe(0);
  expect(first.id).not.toBe(second.id);
  expect(isRoomDeckEmpty(deck)).toBe(true);
});

test('drawRoom never draws the same room twice', () => {
  const deck = createRoomDeck(makeRooms(5));
  const drawnIds = new Set();
  for (let i = 0; i < 5; i++) {
    const room = drawRoom(deck, 'ground');
    expect(drawnIds.has(room.id)).toBe(false);
    drawnIds.add(room.id);
  }
});

test('drawRoom throws ROOM_DECK_EMPTY once every room has been drawn', () => {
  const deck = createRoomDeck(makeRooms(1));
  drawRoom(deck, 'ground');
  expect(() => drawRoom(deck, 'ground')).toThrow('ROOM_DECK_EMPTY');
});

test('createRoomDeck throws INVALID_ROOM_LIST for a non-array or empty input', () => {
  expect(() => createRoomDeck(null)).toThrow('INVALID_ROOM_LIST');
  expect(() => createRoomDeck([])).toThrow('INVALID_ROOM_LIST');
  expect(() => createRoomDeck('not an array')).toThrow('INVALID_ROOM_LIST');
});

test('drawRoom(deck, floor) only ever returns rooms matching that floor or "any", cycling mismatches to the bottom', () => {
  const rooms = [
    { id: 'g1', doors: 2, floor: 'ground' },
    { id: 'u1', doors: 2, floor: 'upper' },
    { id: 'g2', doors: 2, floor: 'ground' },
    { id: 'a1', doors: 2, floor: 'any' },
    { id: 'u2', doors: 2, floor: 'upper' },
  ];
  const deck = createRoomDeck(rooms);
  const groundOrAnyIds = new Set(['g1', 'g2', 'a1']);
  const drawnGroundIds = new Set();

  for (let i = 0; i < groundOrAnyIds.size; i++) {
    const room = drawRoom(deck, 'ground');
    expect(['ground', 'any']).toContain(room.floor);
    drawnGroundIds.add(room.id);
  }

  expect(drawnGroundIds).toEqual(groundOrAnyIds);
  // The upper-only rooms are still in the deck, untouched.
  expect(getRemainingCount(deck)).toBe(2);
  expect(deck.cards.every((room) => room.floor === 'upper')).toBe(true);
});

test('drawRoom throws INVALID_FLOOR for an unrecognized floor value', () => {
  const deck = createRoomDeck(makeRooms(2));
  expect(() => drawRoom(deck, 'attic')).toThrow('INVALID_FLOOR');
  expect(() => drawRoom(deck, undefined)).toThrow('INVALID_FLOOR');
});

test('drawRoom(deck, "basement") only ever returns basement or "any" rooms', () => {
  const rooms = [
    { id: 'b1', doors: 2, floor: 'basement' },
    { id: 'g1', doors: 2, floor: 'ground' },
  ];
  const deck = createRoomDeck(rooms);
  const room = drawRoom(deck, 'basement');
  expect(room.id).toBe('b1');
});

test('hasRoomForFloor returns true when a matching card remains and false when none do', () => {
  const upperOnlyDeck = createRoomDeck(makeRooms(2, 'upper'));
  expect(hasRoomForFloor(upperOnlyDeck, 'upper')).toBe(true);
  expect(hasRoomForFloor(upperOnlyDeck, 'ground')).toBe(false);

  const anyDeck = createRoomDeck(makeRooms(1, 'any'));
  expect(hasRoomForFloor(anyDeck, 'ground')).toBe(true);
  expect(hasRoomForFloor(anyDeck, 'upper')).toBe(true);
});

test('hasRoomForFloor does not mutate the deck', () => {
  const deck = createRoomDeck(makeRooms(3, 'ground'));
  hasRoomForFloor(deck, 'ground');
  hasRoomForFloor(deck, 'upper');
  expect(getRemainingCount(deck)).toBe(3);
});

test('hasRoomForFloor throws INVALID_FLOOR for a bad floor argument', () => {
  const deck = createRoomDeck(makeRooms(2));
  expect(() => hasRoomForFloor(deck, 'attic')).toThrow('INVALID_FLOOR');
});

test('removeRoomById pulls a specific room out of the deck regardless of floor, and shrinks the deck', () => {
  const rooms = [
    { id: 'g1', doors: 2, floor: 'ground' },
    { id: 'u1', doors: 2, floor: 'upper' },
  ];
  const deck = createRoomDeck(rooms);
  const removed = removeRoomById(deck, 'u1');
  expect(removed).toEqual({ id: 'u1', doors: 2, floor: 'upper' });
  expect(getRemainingCount(deck)).toBe(1);
  expect(deck.cards.some((r) => r.id === 'u1')).toBe(false);
});

test('removeRoomById returns null and does not mutate the deck when the id is not present', () => {
  const deck = createRoomDeck(makeRooms(2));
  const removed = removeRoomById(deck, 'not_in_deck');
  expect(removed).toBeNull();
  expect(getRemainingCount(deck)).toBe(2);
});
