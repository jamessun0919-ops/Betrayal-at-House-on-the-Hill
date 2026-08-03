const { createRoomDeck, drawRoom, isRoomDeckEmpty, getRemainingCount } = require('../../src/game/roomDeck');

function makeRooms(count) {
  const rooms = [];
  for (let i = 0; i < count; i++) {
    rooms.push({ id: `room_${i}`, doors: 2 });
  }
  return rooms;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('createRoomDeck builds a deck containing every room, none drawn yet', () => {
  const deck = createRoomDeck(makeRooms(3));
  expect(deck.cards).toHaveLength(3);
  expect(deck.drawnCount).toBe(0);
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

test('drawRoom returns rooms one at a time and increments drawnCount', () => {
  const deck = createRoomDeck(makeRooms(2));
  const first = drawRoom(deck);
  expect(deck.drawnCount).toBe(1);
  const second = drawRoom(deck);
  expect(deck.drawnCount).toBe(2);
  expect(first.id).not.toBe(second.id);
  expect(isRoomDeckEmpty(deck)).toBe(true);
  expect(getRemainingCount(deck)).toBe(0);
});

test('drawRoom never draws the same room twice', () => {
  const deck = createRoomDeck(makeRooms(5));
  const drawnIds = new Set();
  for (let i = 0; i < 5; i++) {
    const room = drawRoom(deck);
    expect(drawnIds.has(room.id)).toBe(false);
    drawnIds.add(room.id);
  }
});

test('drawRoom throws ROOM_DECK_EMPTY once every room has been drawn', () => {
  const deck = createRoomDeck(makeRooms(1));
  drawRoom(deck);
  expect(() => drawRoom(deck)).toThrow('ROOM_DECK_EMPTY');
});

test('createRoomDeck throws INVALID_ROOM_LIST for a non-array or empty input', () => {
  expect(() => createRoomDeck(null)).toThrow('INVALID_ROOM_LIST');
  expect(() => createRoomDeck([])).toThrow('INVALID_ROOM_LIST');
  expect(() => createRoomDeck('not an array')).toThrow('INVALID_ROOM_LIST');
});
