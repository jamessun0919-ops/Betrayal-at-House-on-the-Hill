const { createBoard, placeNewRoom, coordKey } = require('../../src/game/boardGenerator');

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

test('createBoard throws MISSING_STARTING_ROOM when a required starting room is missing', () => {
  const incompleteRooms = [
    { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
    { id: 'room_foyer', name: '廊廳', floor: 'ground' },
    // Missing room_grand_staircase and room_upper_landing
  ];
  expect(() => createBoard(incompleteRooms)).toThrow('MISSING_STARTING_ROOM');
});
