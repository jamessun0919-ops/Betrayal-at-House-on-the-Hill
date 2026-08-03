const {
  createCharacterSelectionState,
  getCurrentPicker,
  getAvailableCharacterIds,
  confirmCharacterChoice,
  assignRandomCharacter,
  isCharacterSelectionComplete,
  getAssignments,
} = require('../../src/game/characterSelection');

function makeCharacters(count = 6) {
  const characters = [];
  for (let i = 1; i <= count; i++) {
    characters.push({ id: `char_00${i}` });
  }
  return characters;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('createCharacterSelectionState builds a randomized pick order covering every player', () => {
  const state = createCharacterSelectionState(['p1', 'p2', 'p3'], makeCharacters());
  expect(state.order.slice().sort()).toEqual(['p1', 'p2', 'p3']);
  expect(state.currentTurnIndex).toBe(0);
  expect(state.lockedCharacterIds.size).toBe(0);
  expect(isCharacterSelectionComplete(state)).toBe(false);
});

test('createCharacterSelectionState throws TOO_FEW_PLAYERS for fewer than 2 players', () => {
  expect(() => createCharacterSelectionState(['p1'], makeCharacters())).toThrow('TOO_FEW_PLAYERS');
  expect(() => createCharacterSelectionState([], makeCharacters())).toThrow('TOO_FEW_PLAYERS');
});

test('createCharacterSelectionState throws INVALID_CHARACTER_LIST for a non-array or empty character list', () => {
  expect(() => createCharacterSelectionState(['p1', 'p2'], [])).toThrow('INVALID_CHARACTER_LIST');
  expect(() => createCharacterSelectionState(['p1', 'p2'], null)).toThrow('INVALID_CHARACTER_LIST');
});

test('getCurrentPicker returns the player at the front of the order', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const state = createCharacterSelectionState(['p1', 'p2'], makeCharacters());
  expect(getCurrentPicker(state)).toBe(state.order[0]);
});

test('confirmCharacterChoice locks the character, records the assignment, and advances the turn', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const state = createCharacterSelectionState(['p1', 'p2'], makeCharacters());
  const firstPicker = getCurrentPicker(state);
  confirmCharacterChoice(state, { playerId: firstPicker, characterId: 'char_001' });
  expect(state.lockedCharacterIds.has('char_001')).toBe(true);
  expect(getAssignments(state).get(firstPicker)).toBe('char_001');
  expect(getCurrentPicker(state)).not.toBe(firstPicker);
  expect(getAvailableCharacterIds(state)).not.toContain('char_001');
});

test('confirmCharacterChoice throws CHARACTER_SELECT_NOT_YOUR_TURN for the wrong player', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const state = createCharacterSelectionState(['p1', 'p2'], makeCharacters());
  const notPicker = state.order[1];
  expect(() =>
    confirmCharacterChoice(state, { playerId: notPicker, characterId: 'char_001' })
  ).toThrow('CHARACTER_SELECT_NOT_YOUR_TURN');
});

test('confirmCharacterChoice throws CHARACTER_ALREADY_TAKEN for a locked character', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const state = createCharacterSelectionState(['p1', 'p2'], makeCharacters());
  const first = getCurrentPicker(state);
  confirmCharacterChoice(state, { playerId: first, characterId: 'char_001' });
  const second = getCurrentPicker(state);
  expect(() =>
    confirmCharacterChoice(state, { playerId: second, characterId: 'char_001' })
  ).toThrow('CHARACTER_ALREADY_TAKEN');
});

test('confirmCharacterChoice throws UNKNOWN_CHARACTER for a characterId not in the list', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const state = createCharacterSelectionState(['p1', 'p2'], makeCharacters());
  const first = getCurrentPicker(state);
  expect(() =>
    confirmCharacterChoice(state, { playerId: first, characterId: 'not_a_real_character' })
  ).toThrow('UNKNOWN_CHARACTER');
});

test('isCharacterSelectionComplete becomes true once every player has picked', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const state = createCharacterSelectionState(['p1', 'p2'], makeCharacters());
  confirmCharacterChoice(state, { playerId: getCurrentPicker(state), characterId: 'char_001' });
  expect(isCharacterSelectionComplete(state)).toBe(false);
  confirmCharacterChoice(state, { playerId: getCurrentPicker(state), characterId: 'char_002' });
  expect(isCharacterSelectionComplete(state)).toBe(true);
  expect(getCurrentPicker(state)).toBeNull();
});

test('assignRandomCharacter locks a currently-available character for the given player', () => {
  const state = createCharacterSelectionState(['p1', 'p2'], makeCharacters(2));
  const picker = getCurrentPicker(state);
  const assigned = assignRandomCharacter(state, picker);
  expect(['char_001', 'char_002']).toContain(assigned);
  expect(getAssignments(state).get(picker)).toBe(assigned);
  expect(state.lockedCharacterIds.has(assigned)).toBe(true);
});

test('assignRandomCharacter advances the turn after locking a character', () => {
  const state = createCharacterSelectionState(['p1', 'p2'], makeCharacters(2));
  const firstPicker = getCurrentPicker(state);
  assignRandomCharacter(state, firstPicker);
  expect(getCurrentPicker(state)).not.toBe(firstPicker);
  expect(getCurrentPicker(state)).toBe(state.order[1]);
});

test('assignRandomCharacter throws CHARACTER_SELECT_NOT_YOUR_TURN for the wrong player', () => {
  const state = createCharacterSelectionState(['p1', 'p2'], makeCharacters(2));
  const notPicker = state.order[1];
  expect(() =>
    assignRandomCharacter(state, notPicker)
  ).toThrow('CHARACTER_SELECT_NOT_YOUR_TURN');
});
