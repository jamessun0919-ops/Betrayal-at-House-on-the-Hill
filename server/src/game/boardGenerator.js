const { SIDES, OPPOSITE_SIDE, computeDoorLayout, computeRotation } = require('./doorLayout');

const FLOORS = ['ground', 'upper', 'basement'];

const DIRECTION_DELTA = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

function coordKey(x, y) {
  return `${x},${y}`;
}

function cloneRoomItem(item) {
  if (Array.isArray(item)) return item.slice();
  return item === undefined ? null : item;
}

function placeFixedRoom(grid, roomId, x, y, doorSides) {
  grid.set(coordKey(x, y), { roomId, x, y, doorSides: doorSides.slice(), droppedItems: [], item: null });
}

function createBoard(startingRooms) {
  const ground = new Map();
  const upper = new Map();
  const basement = new Map();

  const lobbyA = startingRooms.find((r) => r.id === 'room_lobby_a');
  const lobbyB = startingRooms.find((r) => r.id === 'room_lobby_b');
  const lobbyC = startingRooms.find((r) => r.id === 'room_lobby_c');
  const upperLanding = startingRooms.find((r) => r.id === 'room_upper_landing');
  const basementLanding = startingRooms.find((r) => r.id === 'room_basement_landing');

  if (!lobbyA || !lobbyB || !lobbyC || !upperLanding || !basementLanding) {
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
  // Same 3-door shape as the upper landing -- lets the basement floor be
  // explored laterally once something can get a player onto it. How a
  // player actually arrives here is a separate, not-yet-designed mechanism
  // (coordinate-based room connections), out of scope for this change.
  placeFixedRoom(basement, basementLanding.id, 0, 0, ['north', 'east', 'west']);

  return {
    ground,
    upper,
    basement,
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
  if (!FLOORS.includes(floor)) {
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
  const rotation = computeRotation(roomDefinition.canonicalDoors, doorSides);

  const placedRoom = {
    roomId: roomDefinition.id,
    x: newCoord.x,
    y: newCoord.y,
    doorSides: Array.from(doorSides),
    rotation,
    droppedItems: [],
    item: cloneRoomItem(roomDefinition.item),
  };
  grid.set(key, placedRoom);
  return placedRoom;
}

// Places a room at an absolute (x, y), not relative to a neighbor + a
// direction the player walked in from. Used for vertical connections
// (falling/jumping between floors at the same coordinate) where there is no
// lateral "entry side" -- guaranteedSide is the caller's choice of which
// side computeDoorLayout should treat as always-open (its usual fallback
// guarantee against a fully-walled, unreachable room), picked however the
// caller wants (e.g. randomly) rather than derived from a direction of travel.
function placeRoomAt(board, floor, x, y, roomDefinition, guaranteedSide) {
  if (!Number.isInteger(roomDefinition.doors) || roomDefinition.doors < 1 || roomDefinition.doors > 4) {
    throw new Error('INVALID_ROOM_DOORS');
  }
  if (!SIDES.includes(guaranteedSide)) {
    throw new Error('INVALID_GUARANTEED_SIDE');
  }
  if (!FLOORS.includes(floor)) {
    throw new Error('INVALID_FLOOR');
  }
  if (!roomDefinition.id) {
    throw new Error('INVALID_ROOM_ID');
  }
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error('INVALID_COORD');
  }
  const grid = board[floor];
  const key = coordKey(x, y);
  if (grid.has(key)) {
    throw new Error('ROOM_ALREADY_PLACED');
  }

  const getNeighborRequirement = makeNeighborRequirementReader(grid, { x, y });
  const doorSides = computeDoorLayout(
    roomDefinition.doors,
    guaranteedSide,
    getNeighborRequirement,
    roomDefinition.doorPattern || null
  );
  const rotation = computeRotation(roomDefinition.canonicalDoors, doorSides);

  const placedRoom = {
    roomId: roomDefinition.id,
    x,
    y,
    doorSides: Array.from(doorSides),
    rotation,
    droppedItems: [],
    item: cloneRoomItem(roomDefinition.item),
  };
  grid.set(key, placedRoom);
  return placedRoom;
}

// 檢查「如果把一個 doors/doorPattern 這樣的房型放在 fromCoord+direction 這個位置，
// computeDoorLayout 會不會需要退化成只剩入口一扇門」。直接重用 computeDoorLayout
// 本身當可行性檢查器（跟 placeNewRoom/placeRoomAt 用的是同一套引擎），不是另外實作
// 一套判斷邏輯，這樣可行性判斷永遠跟實際放置時的引擎結果一致。
function isDoorLayoutFeasible(board, floor, fromCoord, direction, doors, doorPattern) {
  const grid = board[floor];
  const delta = DIRECTION_DELTA[direction];
  const targetCoord = { x: fromCoord.x + delta.dx, y: fromCoord.y + delta.dy };
  const entrySide = OPPOSITE_SIDE[direction];
  const getNeighborRequirement = makeNeighborRequirementReader(grid, targetCoord);
  const doorSides = computeDoorLayout(doors, entrySide, getNeighborRequirement, doorPattern || null);
  return doorSides.size === doors;
}

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

// Places a room adjacent to a randomly chosen already-placed room on the
// given floor, through one of that room's own genuinely open doors (not an
// arbitrary coordinate) -- so the result is always reachable via normal
// exploration, same as anything placeNewRoom produces. Used for the rare
// ballroom/gallery pairing exception (last card for a floor, paired
// coordinate already occupied) where the pair can't go at its "natural"
// same-coordinate spot.
function placeAtRandomOpenDoor(board, floor, roomDefinition) {
  if (!FLOORS.includes(floor)) {
    throw new Error('INVALID_FLOOR');
  }
  const grid = board[floor];
  const candidateRooms = shuffle(Array.from(grid.values()));
  for (const room of candidateRooms) {
    const openDirections = shuffle(room.doorSides.slice());
    for (const direction of openDirections) {
      const delta = DIRECTION_DELTA[direction];
      const targetCoord = { x: room.x + delta.dx, y: room.y + delta.dy };
      if (!grid.has(coordKey(targetCoord.x, targetCoord.y))) {
        return placeNewRoom(board, floor, { x: room.x, y: room.y }, direction, roomDefinition);
      }
    }
  }
  throw new Error('NO_OPEN_COORD_FOUND');
}

function canMoveBetween(board, floor, fromCoord, direction) {
  if (!DIRECTION_DELTA[direction]) {
    throw new Error('INVALID_DIRECTION');
  }
  if (!FLOORS.includes(floor)) {
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

module.exports = {
  createBoard,
  placeNewRoom,
  placeRoomAt,
  placeAtRandomOpenDoor,
  coordKey,
  canMoveBetween,
  isDoorLayoutFeasible,
  DIRECTION_DELTA,
  FLOORS,
};
