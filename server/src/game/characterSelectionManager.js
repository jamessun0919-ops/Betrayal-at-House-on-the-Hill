const { createCharacterSelectionState } = require('./characterSelection');
const { createPromptState } = require('./promptState');

function createCharacterSelectionManager() {
  return { selections: new Map() };
}

function startSelection(manager, roomCode, playerIds, characters) {
  if (manager.selections.has(roomCode)) {
    throw new Error('SELECTION_ALREADY_STARTED');
  }
  const entry = {
    characterSelectionState: createCharacterSelectionState(playerIds, characters),
    promptState: createPromptState(),
  };
  manager.selections.set(roomCode, entry);
  return entry;
}

function getSelection(manager, roomCode) {
  return manager.selections.get(roomCode);
}

function endSelection(manager, roomCode) {
  manager.selections.delete(roomCode);
}

module.exports = { createCharacterSelectionManager, startSelection, getSelection, endSelection };
