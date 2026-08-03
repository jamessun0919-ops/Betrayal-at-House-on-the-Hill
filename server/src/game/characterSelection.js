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

function createCharacterSelectionState(playerIds, characters) {
  if (!Array.isArray(playerIds) || playerIds.length < 2) {
    throw new Error('TOO_FEW_PLAYERS');
  }
  if (!Array.isArray(characters) || characters.length === 0) {
    throw new Error('INVALID_CHARACTER_LIST');
  }
  return {
    order: shuffle(playerIds),
    currentTurnIndex: 0,
    lockedCharacterIds: new Set(),
    assignments: new Map(),
    characters,
  };
}

function getCurrentPicker(state) {
  if (state.currentTurnIndex >= state.order.length) {
    return null;
  }
  return state.order[state.currentTurnIndex];
}

function getAvailableCharacterIds(state) {
  return state.characters
    .map((c) => c.id)
    .filter((id) => !state.lockedCharacterIds.has(id));
}

function lockCharacterFor(state, playerId, characterId) {
  state.lockedCharacterIds.add(characterId);
  state.assignments.set(playerId, characterId);
  state.currentTurnIndex += 1;
}

function confirmCharacterChoice(state, { playerId, characterId }) {
  const currentPicker = getCurrentPicker(state);
  if (playerId !== currentPicker) {
    throw new Error('CHARACTER_SELECT_NOT_YOUR_TURN');
  }
  if (!state.characters.some((c) => c.id === characterId)) {
    throw new Error('UNKNOWN_CHARACTER');
  }
  if (state.lockedCharacterIds.has(characterId)) {
    throw new Error('CHARACTER_ALREADY_TAKEN');
  }
  lockCharacterFor(state, playerId, characterId);
}

function assignRandomCharacter(state, playerId) {
  const currentPicker = getCurrentPicker(state);
  if (playerId !== currentPicker) {
    throw new Error('CHARACTER_SELECT_NOT_YOUR_TURN');
  }
  const available = getAvailableCharacterIds(state);
  if (available.length === 0) {
    throw new Error('NO_CHARACTERS_AVAILABLE');
  }
  const characterId = available[Math.floor(Math.random() * available.length)];
  lockCharacterFor(state, playerId, characterId);
  return characterId;
}

function isCharacterSelectionComplete(state) {
  return state.currentTurnIndex >= state.order.length;
}

function getAssignments(state) {
  return state.assignments;
}

module.exports = {
  createCharacterSelectionState,
  getCurrentPicker,
  getAvailableCharacterIds,
  confirmCharacterChoice,
  assignRandomCharacter,
  isCharacterSelectionComplete,
  getAssignments,
};
