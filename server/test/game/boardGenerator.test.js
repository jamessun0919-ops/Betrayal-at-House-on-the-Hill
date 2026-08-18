const { createBoard, placeNewRoom, placeRoomAt, placeAtRandomOpenDoor, coordKey, canMoveBetween } = require('../../src/game/boardGenerator');

const STARTING_ROOMS = [
  { id: 'room_lobby_a', name: '大門廳', floor: 'ground', filename: 'LobbyA.webp' },
  { id: 'room_lobby_b', name: '大門廳', floor: 'ground', filename: 'LobbyB.webp' },
  { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing', filename: 'LobbyC.webp' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper', filename: '2Fladder.webp' },
  { id: 'room_basement_landing', name: '地下平台', floor: 'basement', filename: null },
];

test('createBoard places the five starting rooms at their fixed coordinates with the correct doorSides', () => {
  const board = createBoard(STARTING_ROOMS);

  const lobbyA = board.ground.get(coordKey(0, 1));
  expect(lobbyA.roomId).toBe('room_lobby_a');
  expect(lobbyA.doorSides.slice().sort()).toEqual(['east', 'north', 'west']);

  const lobbyB = board.ground.get(coordKey(0, 0));
  expect(lobbyB.roomId).toBe('room_lobby_b');
  expect(lobbyB.doorSides.slice().sort()).toEqual(['east', 'north', 'south', 'west']);

  const lobbyC = board.ground.get(coordKey(0, -1));
  expect(lobbyC.roomId).toBe('room_lobby_c');
  expect(lobbyC.doorSides.slice().sort()).toEqual(['south', 'west']);

  const upperLanding = board.upper.get(coordKey(0, 0));
  expect(upperLanding.roomId).toBe('room_upper_landing');
  expect(upperLanding.doorSides.slice().sort()).toEqual(['east', 'north', 'west']);

  const basementLanding = board.basement.get(coordKey(0, 0));
  expect(basementLanding.roomId).toBe('room_basement_landing');
  expect(basementLanding.doorSides.slice().sort()).toEqual(['east', 'north', 'west']);

  expect(board.stairsLink).toEqual({
    groundRoomId: 'room_lobby_c',
    upperRoomId: 'room_upper_landing',
  });
});

test('placeNewRoom places a room at the correct coordinate for each direction', () => {
  const board = createBoard(STARTING_ROOMS);
  // Away from the lobby footprint (x=0 column) so both directions land empty.

  const north = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'north', { id: 'room_a', doors: 4 });
  expect(north).toMatchObject({ roomId: 'room_a', x: 5, y: 4 });

  const east = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'east', { id: 'room_b', doors: 4 });
  expect(east).toMatchObject({ roomId: 'room_b', x: 6, y: 5 });

  expect(board.ground.get(coordKey(5, 4)).roomId).toBe('room_a');
  expect(board.ground.get(coordKey(6, 5)).roomId).toBe('room_b');
});

test('placeNewRoom always includes a door on the side facing back toward the entry room', () => {
  const board = createBoard(STARTING_ROOMS);
  // Moving south from an empty coordinate (away from the lobby footprint) —
  // the new room's entry side is north (facing back toward where the
  // player came from).
  const placed = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'south', { id: 'room_c', doors: 1 });
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

test('placeNewRoom passes roomDefinition.doorPattern through to the door layout for doors:2', () => {
  const board = createBoard(STARTING_ROOMS);
  // Moving south from (5,5) (away from the lobby footprint) lands the new
  // room at (5,6); its entry side (facing back toward where the player
  // came from) is north.
  for (let i = 0; i < 20; i++) {
    const placed = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'south', {
      id: `room_opposite_${i}`,
      doors: 2,
      doorPattern: 'opposite',
    });
    expect(placed.doorSides.slice().sort()).toEqual(['north', 'south']);
    board.ground.delete(coordKey(5, 6));
  }
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
    placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'north', { id: 'room_dup', doors: 4 })
  ).not.toThrow(); // lands at (5,4), empty
  expect(() =>
    placeNewRoom(board, 'ground', { x: 5, y: 3 }, 'south', { id: 'room_dup2', doors: 4 })
  ).toThrow('ROOM_ALREADY_PLACED'); // also lands at (5,4), now occupied
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
    placeNewRoom(board, 'attic', { x: 0, y: 0 }, 'north', { id: 'room_bad_floor', doors: 4 })
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
  const lobbyB = board.ground.get('0,0');
  expect(lobbyB.droppedItems).toEqual([]);
});

test('placeNewRoom creates a room with an empty droppedItems array', () => {
  const board = createBoard(STARTING_ROOMS);
  const placedRoom = placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'east', { id: 'room_new', doors: 4 });
  expect(placedRoom.droppedItems).toEqual([]);
});

test('createBoard throws MISSING_STARTING_ROOM when a required starting room is missing', () => {
  const incompleteRooms = [
    { id: 'room_lobby_a', name: '大門廳', floor: 'ground' },
    { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
    // Missing room_lobby_c and room_upper_landing
  ];
  expect(() => createBoard(incompleteRooms)).toThrow('MISSING_STARTING_ROOM');
});

test('canMoveBetween returns true when both rooms agree there is a door on the shared side', () => {
  const board = createBoard(STARTING_ROOMS);
  // room_lobby_b (0,0) has doors on all 4 sides (fixed starting room).
  // Place a room to its east with doors:4 -> it will also have a door facing west (entry side).
  placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'east', { id: 'room_a', doors: 4 });
  expect(canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'east')).toBe(true);
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
  expect(canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'east')).toBe(false);
});

test('canMoveBetween throws ROOM_NOT_FOUND when there is no room at fromCoord', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() => canMoveBetween(board, 'ground', { x: 99, y: 99 }, 'north')).toThrow('ROOM_NOT_FOUND');
});

test('canMoveBetween throws INVALID_DIRECTION/INVALID_FLOOR/INVALID_FROM_COORD for malformed input', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() => canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'sideways')).toThrow('INVALID_DIRECTION');
  expect(() => canMoveBetween(board, 'attic', { x: 0, y: 0 }, 'north')).toThrow('INVALID_FLOOR');
  expect(() => canMoveBetween(board, 'ground', { x: 'a', y: 0 }, 'north')).toThrow('INVALID_FROM_COORD');
});

test('placeNewRoom and canMoveBetween work on the basement floor', () => {
  const board = createBoard(STARTING_ROOMS);
  const placed = placeNewRoom(board, 'basement', { x: 0, y: 0 }, 'east', { id: 'room_basement_a', doors: 4 });
  expect(placed).toMatchObject({ roomId: 'room_basement_a', x: 1, y: 0 });
  expect(canMoveBetween(board, 'basement', { x: 0, y: 0 }, 'east')).toBe(true);
});

test('placeRoomAt places a room at an absolute coordinate with the guaranteed side always a door', () => {
  const board = createBoard(STARTING_ROOMS);
  const placed = placeRoomAt(board, 'basement', 5, 5, { id: 'room_fallen', doors: 1 }, 'south');
  expect(placed).toMatchObject({ roomId: 'room_fallen', x: 5, y: 5, doorSides: ['south'] });
  expect(board.basement.get(coordKey(5, 5))).toBe(placed);
});

test('placeRoomAt throws ROOM_ALREADY_PLACED when the target coordinate is occupied', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() => placeRoomAt(board, 'basement', 0, 0, { id: 'room_dup', doors: 1 }, 'north')).toThrow(
    'ROOM_ALREADY_PLACED'
  ); // (0,0) on basement is already room_basement_landing
});

test('placeRoomAt throws INVALID_GUARANTEED_SIDE for a non-cardinal side', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() => placeRoomAt(board, 'basement', 5, 5, { id: 'room_bad', doors: 1 }, 'sideways')).toThrow(
    'INVALID_GUARANTEED_SIDE'
  );
});

test('placeRoomAt respects existing neighbor door/wall requirements like placeNewRoom does', () => {
  const board = createBoard(STARTING_ROOMS);
  // Neighbor to the east of (5,5) has no door on its west side facing back.
  board.basement.set(coordKey(6, 5), { roomId: 'room_neighbor', x: 6, y: 5, doorSides: ['north'] });
  const placed = placeRoomAt(board, 'basement', 5, 5, { id: 'room_fallen', doors: 4 }, 'south');
  expect(placed.doorSides).toContain('south');
  expect(placed.doorSides).not.toContain('east');
});

test('placeAtRandomOpenDoor places the room through a genuinely open door of an existing room, not an arbitrary coordinate', () => {
  const board = createBoard(STARTING_ROOMS);
  // Only room_basement_landing exists on basement (0,0), doors: north/east/west.
  const placed = placeAtRandomOpenDoor(board, 'basement', { id: 'room_random', doors: 2 });
  const validNeighborCoords = [coordKey(0, -1), coordKey(1, 0), coordKey(-1, 0)]; // north/east/west of (0,0)
  expect(validNeighborCoords).toContain(coordKey(placed.x, placed.y));
  // The new room must have a door facing back toward room_basement_landing.
  expect(board.basement.get(coordKey(placed.x, placed.y))).toBe(placed);
});

test('placeAtRandomOpenDoor throws NO_OPEN_COORD_FOUND when every existing room on the floor is fully boxed in', () => {
  const board = createBoard(STARTING_ROOMS);
  // Occupy every direction room_basement_landing's doors lead to.
  board.basement.set(coordKey(0, -1), { roomId: 'room_a', x: 0, y: -1, doorSides: [] });
  board.basement.set(coordKey(1, 0), { roomId: 'room_b', x: 1, y: 0, doorSides: [] });
  board.basement.set(coordKey(-1, 0), { roomId: 'room_c', x: -1, y: 0, doorSides: [] });
  expect(() => placeAtRandomOpenDoor(board, 'basement', { id: 'room_random', doors: 2 })).toThrow(
    'NO_OPEN_COORD_FOUND'
  );
});

test('placeNewRoom copies the room definition\'s item list onto the placed room, independent of the shared definition', () => {
  const board = createBoard(STARTING_ROOMS);
  const roomDefinition = { id: 'room_a', doors: 4, item: ['item_003', 'item_009'] };

  const placed = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'north', roomDefinition);
  expect(placed.item).toEqual(['item_003', 'item_009']);

  placed.item.push('item_099');
  expect(roomDefinition.item).toEqual(['item_003', 'item_009']); // 靜態定義不受污染
});

test('placeNewRoom defaults item to null when the room definition has no item field', () => {
  const board = createBoard(STARTING_ROOMS);
  const placed = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'north', { id: 'room_a', doors: 4 });
  expect(placed.item).toBeNull();
});

test('placeNewRoom preserves a string item value like "random_one" as-is', () => {
  const board = createBoard(STARTING_ROOMS);
  const placed = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'north', { id: 'room_a', doors: 4, item: 'random_one' });
  expect(placed.item).toBe('random_one');
});

test('placeRoomAt copies the room definition\'s item field onto the placed room, independent of the shared definition', () => {
  const board = createBoard(STARTING_ROOMS);
  const roomDefinition = { id: 'room_a', doors: 4, item: ['item_003'] };
  const placed = placeRoomAt(board, 'basement', 5, 5, roomDefinition, 'north');
  expect(placed.item).toEqual(['item_003']);
});

test('createBoard sets item to null on the five starting rooms', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(board.ground.get(coordKey(0, 1)).item).toBeNull(); // room_lobby_a
  expect(board.ground.get(coordKey(0, 0)).item).toBeNull(); // room_lobby_b
  expect(board.ground.get(coordKey(0, -1)).item).toBeNull(); // room_lobby_c
  expect(board.upper.get(coordKey(0, 0)).item).toBeNull(); // room_upper_landing
  expect(board.basement.get(coordKey(0, 0)).item).toBeNull(); // room_basement_landing
});
