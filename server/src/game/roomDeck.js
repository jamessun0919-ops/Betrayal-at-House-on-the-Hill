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
  return { cards: shuffle(rooms), drawnCount: 0 };
}

function isRoomDeckEmpty(deck) {
  return deck.drawnCount >= deck.cards.length;
}

function getRemainingCount(deck) {
  return deck.cards.length - deck.drawnCount;
}

function drawRoom(deck) {
  if (isRoomDeckEmpty(deck)) {
    throw new Error('ROOM_DECK_EMPTY');
  }
  const room = deck.cards[deck.drawnCount];
  deck.drawnCount += 1;
  return room;
}

module.exports = { createRoomDeck, drawRoom, isRoomDeckEmpty, getRemainingCount };
