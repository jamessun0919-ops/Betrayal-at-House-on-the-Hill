const { OPPOSITE_SIDE, computeDoorLayout } = require('./doorLayout');

const DIRECTION_DELTA = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

const ALL_SIDES = ['north', 'east', 'south', 'west'];

function coordKey(x, y) {
  return `${x},${y}`;
}

function placeFixedRoom(grid, roomId, x, y) {
  grid.set(coordKey(x, y), { roomId, x, y, doorSides: ALL_SIDES.slice() });
}

function createBoard(startingRooms) {
  const ground = new Map();
  const upper = new Map();

  const entranceHall = startingRooms.find((r) => r.id === 'room_entrance_hall');
  const foyer = startingRooms.find((r) => r.id === 'room_foyer');
  const grandStaircase = startingRooms.find((r) => r.id === 'room_grand_staircase');
  const upperLanding = startingRooms.find((r) => r.id === 'room_upper_landing');

  if (!entranceHall || !foyer || !grandStaircase || !upperLanding) {
    throw new Error('MISSING_STARTING_ROOM');
  }

  placeFixedRoom(ground, entranceHall.id, 0, 0);
  placeFixedRoom(ground, foyer.id, 4, 0);
  placeFixedRoom(ground, grandStaircase.id, -4, 0);
  placeFixedRoom(upper, upperLanding.id, 0, 0);

  return {
    ground,
    upper,
    stairsLink: { groundRoomId: grandStaircase.id, upperRoomId: upperLanding.id },
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
  const grid = board[floor];
  const delta = DIRECTION_DELTA[direction];
  const newCoord = { x: fromCoord.x + delta.dx, y: fromCoord.y + delta.dy };
  const key = coordKey(newCoord.x, newCoord.y);
  if (grid.has(key)) {
    throw new Error('ROOM_ALREADY_PLACED');
  }

  const entrySide = OPPOSITE_SIDE[direction];
  const getNeighborRequirement = makeNeighborRequirementReader(grid, newCoord);
  const doorSides = computeDoorLayout(roomDefinition.doors, entrySide, getNeighborRequirement);

  const placedRoom = {
    roomId: roomDefinition.id,
    x: newCoord.x,
    y: newCoord.y,
    doorSides: Array.from(doorSides),
  };
  grid.set(key, placedRoom);
  return placedRoom;
}

module.exports = { createBoard, placeNewRoom, coordKey };
