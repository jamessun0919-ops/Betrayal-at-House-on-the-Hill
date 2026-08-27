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

// Mirrors roomDeck.js's drawFeasibleRoom -- cycles non-matching cards to the
// bottom across one full pass, then falls back to a plain drawCard() so the
// draw can never deadlock even if every remaining card fails isFeasible.
function drawFeasibleCard(deck, isFeasible) {
  if (!hasCards(deck)) {
    throw new Error('CARD_DECK_EMPTY');
  }
  const attempts = deck.cards.length;
  for (let i = 0; i < attempts; i++) {
    const card = deck.cards.shift();
    if (isFeasible(card)) {
      return card;
    }
    deck.cards.push(card); // put back at bottom, try the next card
  }
  return drawCard(deck);
}

function getRemainingCount(deck) {
  return deck.cards.length;
}

module.exports = { createCardDeck, hasCards, drawCard, drawFeasibleCard, getRemainingCount };
