const { createBoard, placeNewRoom, coordKey, canMoveBetween } = require('../../src/game/boardGenerator');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

test('createBoard places the four starting rooms at their fixed coordinates', () => {
  const board = createBoard(STARTING_ROOMS);

  expect(board.ground.get(coordKey(0, 0)).roomId).toBe('room_entrance_hall');
  expect(board.ground.get(coordKey(4, 0)).roomId).toBe('room_foyer');
  expect(board.ground.get(coordKey(-4, 0)).roomId).toBe('room_grand_staircase');
  expect(board.upper.get(coordKey(0, 0)).roomId).toBe('room_upper_landing');
  expect(board.stairsLink).toEqual({
    groundRoomId: 'room_grand_staircase',
    upperRoomId: 'room_upper_landing',
  });
});

test('placeNewRoom places a room at the correct coordinate for each direction', () => {
  const board = createBoard(STARTING_ROOMS);

  const north = placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'north', { id: 'room_a', doors: 4 });
  expect(north).toMatchObject({ roomId: 'room_a', x: 0, y: -1 });

  const east = placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'east', { id: 'room_b', doors: 4 });
  expect(east).toMatchObject({ roomId: 'room_b', x: 1, y: 0 });

  expect(board.ground.get(coordKey(0, -1)).roomId).toBe('room_a');
  expect(board.ground.get(coordKey(1, 0)).roomId).toBe('room_b');
});

test('placeNewRoom always includes a door on the side facing back toward the entry room', () => {
  const board = createBoard(STARTING_ROOMS);
  // Moving south from entrance hall — the new room's entry side is north
  // (the side facing back toward where the player came from).
  const placed = placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'south', { id: 'room_c', doors: 1 });
  expect(placed.doorSides).toEqual(['north']);
});

test('placeNewRoom resolves conflicts against an already-placed neighbor', () => {
  const board = createBoard(STARTING_ROOMS);
  // Manually place a neighbor at (1,-1) with no door on its south side.
  // That south side faces the room we're about to place at (1,0).
  board.ground.set(coordKey(1, -1), { roomId: 'room_neighbor', x: 1, y: -1, doorSides: ['west'] });

  // Place a new room east of entrance hall (0,0) -> lands at (1,0).
  // Entry side (west, facing entrance hall) is always a door. Requesting
  // doors: 4 would normally put a door on every side, but the north side
  // conflicts with room_neighbor's wall there on every attempt (doors: 4
  // always wants all three non-entry sides), so the fallback drops every
  // non-entry side instead of just the conflicting one.
  const placed = placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'east', { id: 'room_c', doors: 4 });
  expect(placed.doorSides).toContain('west');
  expect(placed.doorSides).not.toContain('north');
});

test('placeNewRoom throws INVALID_ROOM_DOORS for a malformed door count', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() =>
    placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'north', { id: 'room_bad', doors: null })
  ).toThrow('INVALID_ROOM_DOORS');
});

test('placeNewRoom throws ROOM_ALREADY_PLACED when the target coordinate is occupied', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() =>
    placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'north', { id: 'room_dup', doors: 4 })
  ).not.toThrow(); // lands at (0,-1), empty
  expect(() =>
    placeNewRoom(board, 'ground', { x: 0, y: -2 }, 'south', { id: 'room_dup2', doors: 4 })
  ).toThrow('ROOM_ALREADY_PLACED'); // also lands at (0,-1), now occupied
});

test('placeNewRoom throws INVALID_DIRECTION for invalid direction', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() =>
    placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'northwest', { id: 'room_bad_dir', doors: 4 })
  ).toThrow('INVALID_DIRECTION');
});

test('placeNewRoom throws INVALID_FLOOR for invalid floor', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() =>
    placeNewRoom(board, 'basement', { x: 0, y: 0 }, 'north', { id: 'room_bad_floor', doors: 4 })
  ).toThrow('INVALID_FLOOR');
});

test('placeNewRoom throws INVALID_ROOM_ID when roomDefinition lacks an id', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() =>
    placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'north', { doors: 4 })
  ).toThrow('INVALID_ROOM_ID');
});

test('placeNewRoom throws INVALID_FROM_COORD for a malformed fromCoord', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() =>
    placeNewRoom(board, 'ground', { x: 'a', y: 0 }, 'north', { id: 'room_bad_coord', doors: 4 })
  ).toThrow('INVALID_FROM_COORD');
  expect(() =>
    placeNewRoom(board, 'ground', { x: 0, y: NaN }, 'north', { id: 'room_bad_coord2', doors: 4 })
  ).toThrow('INVALID_FROM_COORD');
});

test('createBoard places starting rooms with an empty droppedItems array', () => {
  const board = createBoard(STARTING_ROOMS);
  const entranceHall = board.ground.get('0,0');
  expect(entranceHall.droppedItems).toEqual([]);
});

test('placeNewRoom creates a room with an empty droppedItems array', () => {
  const board = createBoard(STARTING_ROOMS);
  const placedRoom = placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'east', { id: 'room_new', doors: 4 });
  expect(placedRoom.droppedItems).toEqual([]);
});

test('createBoard throws MISSING_STARTING_ROOM when a required starting room is missing', () => {
  const incompleteRooms = [
    { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
    { id: 'room_foyer', name: '廊廳', floor: 'ground' },
    // Missing room_grand_staircase and room_upper_landing
  ];
  expect(() => createBoard(incompleteRooms)).toThrow('MISSING_STARTING_ROOM');
});

test('canMoveBetween returns true when both rooms agree there is a door on the shared side', () => {
  const board = createBoard(STARTING_ROOMS);
  // entrance hall (0,0) has doors on all 4 sides (fixed starting room).
  // Place a room to its north with doors:4 -> it will also have a door facing south (entry side).
  placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'north', { id: 'room_a', doors: 4 });
  expect(canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'north')).toBe(true);
});

test('canMoveBetween returns false when the neighbor has no door facing back (one-way mismatch)', () => {
  const board = createBoard(STARTING_ROOMS);
  // Manually place a neighbor at (0,-1) whose doorSides do NOT include 'south'
  // (i.e. it does not have a door facing back toward the entrance hall).
  board.ground.set(coordKey(0, -1), { roomId: 'room_b', x: 0, y: -1, doorSides: ['north'] });
  expect(canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'north')).toBe(false);
});

test('canMoveBetween returns false when the origin room itself has no door on that side', () => {
  const board = createBoard(STARTING_ROOMS);
  board.ground.set(coordKey(0, 0), { roomId: 'room_entrance_hall', x: 0, y: 0, doorSides: ['east'] });
  board.ground.set(coordKey(0, -1), { roomId: 'room_b', x: 0, y: -1, doorSides: ['north', 'south'] });
  expect(canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'north')).toBe(false);
});

test('canMoveBetween returns false when the target coordinate is unexplored', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'north')).toBe(false);
});

test('canMoveBetween throws ROOM_NOT_FOUND when there is no room at fromCoord', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() => canMoveBetween(board, 'ground', { x: 99, y: 99 }, 'north')).toThrow('ROOM_NOT_FOUND');
});

test('canMoveBetween throws INVALID_DIRECTION/INVALID_FLOOR/INVALID_FROM_COORD for malformed input', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() => canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'sideways')).toThrow('INVALID_DIRECTION');
  expect(() => canMoveBetween(board, 'basement', { x: 0, y: 0 }, 'north')).toThrow('INVALID_FLOOR');
  expect(() => canMoveBetween(board, 'ground', { x: 'a', y: 0 }, 'north')).toThrow('INVALID_FROM_COORD');
});
