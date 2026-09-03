const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.join(__dirname, '../../../data');

function loadJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('CONTENT_DATA_LOAD_FAILED');
  }
}

function loadRooms(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'rooms', 'rooms.json'));
}

function loadStartingRooms(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'rooms', 'starting-rooms.json'));
}

function loadCharacters(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'characters', 'characters.json'));
}

function loadNpcs(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'characters', 'npcs.json'));
}

function loadEventCards(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'cards', 'event-cards.json'));
}

function loadItemCards(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'cards', 'item-cards.json'));
}

function loadOmenCards(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'cards', 'omen-cards.json'));
}

module.exports = {
  loadRooms,
  loadStartingRooms,
  loadCharacters,
  loadNpcs,
  loadEventCards,
  loadItemCards,
  loadOmenCards,
  DEFAULT_DATA_DIR,
};
