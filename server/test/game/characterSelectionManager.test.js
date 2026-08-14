const {
  createCharacterSelectionManager,
  startSelection,
  getSelection,
  endSelection,
} = require('../../src/game/characterSelectionManager');

function makeCharacters(count = 6) {
  const characters = [];
  for (let i = 1; i <= count; i++) {
    characters.push({ id: `char_00${i}` });
  }
  return characters;
}

test('startSelection creates an entry with a characterSelectionState and a promptState', () => {
  const manager = createCharacterSelectionManager();
  const entry = startSelection(manager, 'ROOM1', ['p1', 'p2'], makeCharacters());

  expect(entry.characterSelectionState.order.slice().sort()).toEqual(['p1', 'p2']);
  expect(entry.promptState).toEqual({ pending: null });
  expect(getSelection(manager, 'ROOM1')).toBe(entry);
});

test('startSelection throws SELECTION_ALREADY_STARTED for a roomCode already in progress', () => {
  const manager = createCharacterSelectionManager();
  startSelection(manager, 'ROOM1', ['p1', 'p2'], makeCharacters());
  expect(() => startSelection(manager, 'ROOM1', ['p3', 'p4'], makeCharacters())).toThrow(
    'SELECTION_ALREADY_STARTED'
  );
});

test('startSelection propagates TOO_FEW_PLAYERS from characterSelection.js', () => {
  const manager = createCharacterSelectionManager();
  expect(() => startSelection(manager, 'ROOM1', [], makeCharacters())).toThrow('TOO_FEW_PLAYERS');
});

test('startSelection propagates INVALID_CHARACTER_LIST from characterSelection.js', () => {
  const manager = createCharacterSelectionManager();
  expect(() => startSelection(manager, 'ROOM1', ['p1', 'p2'], [])).toThrow('INVALID_CHARACTER_LIST');
});

test('getSelection returns undefined for an unknown roomCode', () => {
  const manager = createCharacterSelectionManager();
  expect(getSelection(manager, 'UNKNOWN')).toBeUndefined();
});

test('endSelection removes the entry and is a no-op for an unknown roomCode', () => {
  const manager = createCharacterSelectionManager();
  startSelection(manager, 'ROOM1', ['p1', 'p2'], makeCharacters());
  endSelection(manager, 'ROOM1');
  expect(getSelection(manager, 'ROOM1')).toBeUndefined();
  expect(() => endSelection(manager, 'NEVER_STARTED')).not.toThrow();
});
