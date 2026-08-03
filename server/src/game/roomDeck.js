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

function createRoomDeck(rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) {
    throw new Error('INVALID_ROOM_LIST');
  }
  return { cards: shuffle(rooms) };
}

function isRoomDeckEmpty(deck) {
  return deck.cards.length === 0;
}

function getRemainingCount(deck) {
  return deck.cards.length;
}

function hasRoomForFloor(deck, floor) {
  if (floor !== 'ground' && floor !== 'upper') {
    throw new Error('INVALID_FLOOR');
  }
  return deck.cards.some((room) => room.floor === floor || room.floor === 'any');
}

function drawRoom(deck, floor) {
  if (floor !== 'ground' && floor !== 'upper') {
    throw new Error('INVALID_FLOOR');
  }
  if (isRoomDeckEmpty(deck)) {
    throw new Error('ROOM_DECK_EMPTY');
  }
  const attempts = deck.cards.length;
  for (let i = 0; i < attempts; i++) {
    const room = deck.cards.shift();
    if (room.floor === floor || room.floor === 'any') {
      return room;
    }
    deck.cards.push(room); // put back at bottom, try the next card
  }
  // Cycled through every remaining card and none matched this floor.
  throw new Error('ROOM_DECK_EMPTY');
}

module.exports = { createRoomDeck, drawRoom, isRoomDeckEmpty, getRemainingCount, hasRoomForFloor };
