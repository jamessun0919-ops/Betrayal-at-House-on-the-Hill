const { FLOORS } = require('./boardGenerator');

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
  if (!FLOORS.includes(floor)) {
    throw new Error('INVALID_FLOOR');
  }
  return deck.cards.some((room) => room.floor === floor || room.floor === 'any');
}

function drawRoom(deck, floor) {
  if (!FLOORS.includes(floor)) {
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

// 跟 drawRoom 一樣依片庫（洗牌後）順序依序檢查，只是多一個 isFeasible(room) 判斷
// 條件（樓層跟可行性都要符合才會被抽出）。整副牌試過一輪都找不到符合的卡時，直接
// 呼叫既有的 drawRoom(deck, floor) 退回原本行為（只看樓層），讓後續的門位配置演算法
// 依原本的退化 fallback 處理。這一輪失敗的搜尋不會弄亂牌堆順序：每張牌被 shift()
// 之後如果不符合就 push() 回尾端，一輪跑完（attempts 次）陣列會剛好繞回原本的順序。
function drawFeasibleRoom(deck, floor, isFeasible) {
  const attempts = deck.cards.length;
  for (let i = 0; i < attempts; i++) {
    const room = deck.cards.shift();
    if ((room.floor === floor || room.floor === 'any') && isFeasible(room)) {
      return room;
    }
    deck.cards.push(room);
  }
  return drawRoom(deck, floor);
}

// Pulls a specific room out of the deck by id, wherever it currently sits,
// without regard to floor -- used for the ballroom/gallery pairing, where
// placing one auto-places (and consumes) the other's card directly rather
// than through a normal door-opening draw. Returns null if it isn't in the
// deck (already drawn/placed some other way).
function removeRoomById(deck, id) {
  const index = deck.cards.findIndex((room) => room.id === id);
  if (index === -1) {
    return null;
  }
  const [room] = deck.cards.splice(index, 1);
  return room;
}

module.exports = { createRoomDeck, drawRoom, drawFeasibleRoom, isRoomDeckEmpty, getRemainingCount, hasRoomForFloor, removeRoomById };
