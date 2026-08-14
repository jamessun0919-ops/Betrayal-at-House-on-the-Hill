const { OPPOSITE_SIDE, computeDoorLayout } = require('./doorLayout');

const DIRECTION_DELTA = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

function coordKey(x, y) {
  return `${x},${y}`;
}

function placeFixedRoom(grid, roomId, x, y, doorSides) {
  grid.set(coordKey(x, y), { roomId, x, y, doorSides: doorSides.slice(), droppedItems: [] });
}

function createBoard(startingRooms) {
  const ground = new Map();
  const upper = new Map();

  const lobbyA = startingRooms.find((r) => r.id === 'room_lobby_a');
  const lobbyB = startingRooms.find((r) => r.id === 'room_lobby_b');
  const lobbyC = startingRooms.find((r) => r.id === 'room_lobby_c');
  const upperLanding = startingRooms.find((r) => r.id === 'room_upper_landing');

  if (!lobbyA || !lobbyB || !lobbyC || !upperLanding) {
    throw new Error('MISSING_STARTING_ROOM');
  }

  // The three-room entrance hall is drawn as one continuous space with no
  // walls between adjacent lobby tiles (see the room-art prompts) -- it's
  // placed vertically, lobbyB at the origin, lobbyA to its south (below),
  // lobbyC to its north (above, leading up to the upper landing).
  placeFixedRoom(ground, lobbyA.id, 0, 1, ['north', 'east', 'west']);
  placeFixedRoom(ground, lobbyB.id, 0, 0, ['north', 'south', 'east', 'west']);
  placeFixedRoom(ground, lobbyC.id, 0, -1, ['west', 'south']);
  placeFixedRoom(upper, upperLanding.id, 0, 0, ['north', 'east', 'west']);

  return {
    ground,
    upper,
    stairsLink: { groundRoomId: lobbyC.id, upperRoomId: upperLanding.id },
  };
}

function makeNeighborRequirementReader(grid, coord) {
  return function getNeighborRequirement(side) {
    const delta = DIRECTION_DELTA[side];
    const neighbor = grid.get(coordKey(coord.x + delta.dx, coord.y + delta.dy));
    if (!neighbor) return null;
    const facingSide = OPPOSITE_SIDE[side];
    return neighbor.doorSides.includes(facingSide) ? 'door' : 'wall';
  };
}

function placeNewRoom(board, floor, fromCoord, direction, roomDefinition) {
  if (!Number.isInteger(roomDefinition.doors) || roomDefinition.doors < 1 || roomDefinition.doors > 4) {
    throw new Error('INVALID_ROOM_DOORS');
  }
  if (!DIRECTION_DELTA[direction]) {
    throw new Error('INVALID_DIRECTION');
  }
  if (floor !== 'ground' && floor !== 'upper') {
    throw new Error('INVALID_FLOOR');
  }
  if (!roomDefinition.id) {
    throw new Error('INVALID_ROOM_ID');
  }
  if (!Number.isInteger(fromCoord.x) || !Number.isInteger(fromCoord.y)) {
    throw new Error('INVALID_FROM_COORD');
  }
  const grid = board[floor];
  const delta = DIRECTION_DELTA[direction];
  const newCoord = { x: fromCoord.x + delta.dx, y: fromCoord.y + delta.dy };
  const key = coordKey(newCoord.x, newCoord.y);
  if (grid.has(key)) {
    throw new Error('ROOM_ALREADY_PLACED');
  }

  const entrySide = OPPOSITE_SIDE[direction];
  const getNeighborRequirement = makeNeighborRequirementReader(grid, newCoord);
  const doorSides = computeDoorLayout(
    roomDefinition.doors,
    entrySide,
    getNeighborRequirement,
    roomDefinition.doorPattern || null
  );

  const placedRoom = {
    roomId: roomDefinition.id,
    x: newCoord.x,
    y: newCoord.y,
    doorSides: Array.from(doorSides),
    droppedItems: [],
  };
  grid.set(key, placedRoom);
  return placedRoom;
}

function canMoveBetween(board, floor, fromCoord, direction) {
  if (!DIRECTION_DELTA[direction]) {
    throw new Error('INVALID_DIRECTION');
  }
  if (floor !== 'ground' && floor !== 'upper') {
    throw new Error('INVALID_FLOOR');
  }
  if (!Number.isInteger(fromCoord.x) || !Number.isInteger(fromCoord.y)) {
    throw new Error('INVALID_FROM_COORD');
  }
  const grid = board[floor];
  const fromRoom = grid.get(coordKey(fromCoord.x, fromCoord.y));
  if (!fromRoom) {
    throw new Error('ROOM_NOT_FOUND');
  }
  if (!fromRoom.doorSides.includes(direction)) {
    return false;
  }
  const delta = DIRECTION_DELTA[direction];
  const toCoord = { x: fromCoord.x + delta.dx, y: fromCoord.y + delta.dy };
  const toRoom = grid.get(coordKey(toCoord.x, toCoord.y));
  if (!toRoom) {
    return false;
  }
  const facingSide = OPPOSITE_SIDE[direction];
  return toRoom.doorSides.includes(facingSide);
}

module.exports = { createBoard, placeNewRoom, coordKey, canMoveBetween, DIRECTION_DELTA };
