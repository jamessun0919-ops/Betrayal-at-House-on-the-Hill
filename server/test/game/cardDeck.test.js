const { createCardDeck, hasCards, drawCard, drawFeasibleCard, getRemainingCount } = require('../../src/game/cardDeck');

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

test('drawFeasibleCard returns the first card matching isFeasible, cycling non-matches to the back', () => {
  const cards = [
    { id: 'bad_1' },
    { id: 'ok' },
    { id: 'bad_2' },
  ];
  const deck = createCardDeck(cards);
  const drawn = drawFeasibleCard(deck, (card) => card.id === 'ok');
  expect(drawn.id).toBe('ok');
  expect(getRemainingCount(deck)).toBe(2);
  expect(deck.cards.some((c) => c.id === 'bad_1')).toBe(true);
  expect(deck.cards.some((c) => c.id === 'bad_2')).toBe(true);
});

test('drawFeasibleCard falls back to a plain draw when no remaining card satisfies isFeasible', () => {
  const deck = createCardDeck(makeCards(3));
  const drawn = drawFeasibleCard(deck, () => false); // nothing is ever feasible
  expect(['card_0', 'card_1', 'card_2']).toContain(drawn.id);
  expect(getRemainingCount(deck)).toBe(2);
});

test('drawFeasibleCard throws CARD_DECK_EMPTY when the deck starts empty', () => {
  const deck = createCardDeck([]);
  expect(() => drawFeasibleCard(deck, () => true)).toThrow('CARD_DECK_EMPTY');
});
