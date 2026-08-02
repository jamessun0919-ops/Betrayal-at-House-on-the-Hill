const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.join(__dirname, '../../../data');

function loadJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function loadRooms(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'rooms', 'rooms.json'));
}

function loadStartingRooms(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'rooms', 'starting-rooms.json'));
}

module.exports = { loadRooms, loadStartingRooms, DEFAULT_DATA_DIR };
