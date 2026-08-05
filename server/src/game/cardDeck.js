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

function createCardDeck(cards) {
  if (!Array.isArray(cards)) {
    throw new Error('INVALID_CARD_LIST');
  }
  return { cards: shuffle(cards) };
}

function hasCards(deck) {
  return deck.cards.length > 0;
}

function drawCard(deck) {
  if (!hasCards(deck)) {
    throw new Error('CARD_DECK_EMPTY');
  }
  return deck.cards.shift();
}

function getRemainingCount(deck) {
  return deck.cards.length;
}

module.exports = { createCardDeck, hasCards, drawCard, getRemainingCount };
