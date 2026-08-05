const { createCardDeck, hasCards, drawCard, getRemainingCount } = require('../../src/game/cardDeck');

function makeCards(count) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    cards.push({ id: `card_${i}`, name: `卡片${i}` });
  }
  return cards;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('createCardDeck builds a deck containing every card', () => {
  const deck = createCardDeck(makeCards(3));
  expect(deck.cards).toHaveLength(3);
  expect(hasCards(deck)).toBe(true);
  expect(getRemainingCount(deck)).toBe(3);
});

test('createCardDeck shuffles the cards (does not just copy the input order every time)', () => {
  const cards = makeCards(20);
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const deckA = createCardDeck(cards);
  jest.spyOn(Math, 'random').mockReturnValue(0.999);
  const deckB = createCardDeck(cards);
  expect(deckA.cards.map((c) => c.id)).not.toEqual(deckB.cards.map((c) => c.id));
});

test('createCardDeck accepts an empty array without throwing (empty deck is a valid state)', () => {
  const deck = createCardDeck([]);
  expect(hasCards(deck)).toBe(false);
  expect(getRemainingCount(deck)).toBe(0);
});

test('createCardDeck throws INVALID_CARD_LIST for a non-array input', () => {
  expect(() => createCardDeck(null)).toThrow('INVALID_CARD_LIST');
  expect(() => createCardDeck('not an array')).toThrow('INVALID_CARD_LIST');
  expect(() => createCardDeck(undefined)).toThrow('INVALID_CARD_LIST');
});

test('drawCard returns cards one at a time and shrinks the deck', () => {
  const deck = createCardDeck(makeCards(2));
  const first = drawCard(deck);
  expect(getRemainingCount(deck)).toBe(1);
  const second = drawCard(deck);
  expect(getRemainingCount(deck)).toBe(0);
  expect(first.id).not.toBe(second.id);
  expect(hasCards(deck)).toBe(false);
});

test('drawCard never draws the same card twice', () => {
  const deck = createCardDeck(makeCards(5));
  const drawnIds = new Set();
  for (let i = 0; i < 5; i++) {
    const card = drawCard(deck);
    expect(drawnIds.has(card.id)).toBe(false);
    drawnIds.add(card.id);
  }
});

test('drawCard throws CARD_DECK_EMPTY once every card has been drawn', () => {
  const deck = createCardDeck(makeCards(1));
  drawCard(deck);
  expect(() => drawCard(deck)).toThrow('CARD_DECK_EMPTY');
});

test('drawCard throws CARD_DECK_EMPTY immediately for a deck created empty', () => {
  const deck = createCardDeck([]);
  expect(() => drawCard(deck)).toThrow('CARD_DECK_EMPTY');
});
