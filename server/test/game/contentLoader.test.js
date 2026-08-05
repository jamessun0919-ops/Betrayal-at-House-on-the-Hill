const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadRooms,
  loadStartingRooms,
  loadCharacters,
  loadEventCards,
  loadItemCards,
  loadOmenCards,
} = require('../../src/game/contentLoader');

function makeFixtureDataDir(rooms, startingRooms, characters) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-test-'));
  fs.mkdirSync(path.join(dir, 'rooms'));
  fs.writeFileSync(path.join(dir, 'rooms', 'rooms.json'), JSON.stringify(rooms));
  fs.writeFileSync(path.join(dir, 'rooms', 'starting-rooms.json'), JSON.stringify(startingRooms));
  if (characters !== undefined) {
    fs.mkdirSync(path.join(dir, 'characters'));
    fs.writeFileSync(path.join(dir, 'characters', 'characters.json'), JSON.stringify(characters));
  }
  return dir;
}

test('loadRooms reads and parses rooms.json from the given data directory', () => {
  const dataDir = makeFixtureDataDir(
    [{ id: 'room_a', name: '測試房間A', floor: 'ground', size: '1x1', doors: 2 }],
    []
  );
  const rooms = loadRooms(dataDir);
  expect(rooms).toEqual([
    { id: 'room_a', name: '測試房間A', floor: 'ground', size: '1x1', doors: 2 },
  ]);
});

test('loadStartingRooms reads and parses starting-rooms.json from the given data directory', () => {
  const dataDir = makeFixtureDataDir(
    [],
    [{ id: 'room_entrance_hall', name: '大門廳', floor: 'ground' }]
  );
  const startingRooms = loadStartingRooms(dataDir);
  expect(startingRooms).toEqual([
    { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  ]);
});

test('loadCharacters reads and parses characters.json from the given data directory', () => {
  const dataDir = makeFixtureDataDir([], [], [
    { id: 'char_001', codename: '測試角色', gender: '', age: null, occupation: '', stats: {} },
  ]);
  const characters = loadCharacters(dataDir);
  expect(characters).toEqual([
    { id: 'char_001', codename: '測試角色', gender: '', age: null, occupation: '', stats: {} },
  ]);
});

test('loadRooms throws CONTENT_DATA_LOAD_FAILED when the file does not exist', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-empty-'));
  expect(() => loadRooms(dataDir)).toThrow('CONTENT_DATA_LOAD_FAILED');
});

test('loadCharacters throws CONTENT_DATA_LOAD_FAILED when the file does not exist', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-no-characters-'));
  expect(() => loadCharacters(dataDir)).toThrow('CONTENT_DATA_LOAD_FAILED');
});

test('loadRooms throws CONTENT_DATA_LOAD_FAILED when the file contains malformed JSON', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-bad-json-'));
  fs.mkdirSync(path.join(dataDir, 'rooms'));
  fs.writeFileSync(path.join(dataDir, 'rooms', 'rooms.json'), '{not valid json');
  expect(() => loadRooms(dataDir)).toThrow('CONTENT_DATA_LOAD_FAILED');
});

function makeCardsFixtureDataDir(eventCards, itemCards, omenCards) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-cards-test-'));
  fs.mkdirSync(path.join(dir, 'cards'));
  if (eventCards !== undefined) {
    fs.writeFileSync(path.join(dir, 'cards', 'event-cards.json'), JSON.stringify(eventCards));
  }
  if (itemCards !== undefined) {
    fs.writeFileSync(path.join(dir, 'cards', 'item-cards.json'), JSON.stringify(itemCards));
  }
  if (omenCards !== undefined) {
    fs.writeFileSync(path.join(dir, 'cards', 'omen-cards.json'), JSON.stringify(omenCards));
  }
  return dir;
}

test('loadEventCards reads and parses event-cards.json from the given data directory', () => {
  const dataDir = makeCardsFixtureDataDir(
    [{ id: 'event_001', name: '測試事件', text: '', effects: [], needsCustomLogic: true }],
    [],
    []
  );
  expect(loadEventCards(dataDir)).toEqual([
    { id: 'event_001', name: '測試事件', text: '', effects: [], needsCustomLogic: true },
  ]);
});

test('loadItemCards reads and parses item-cards.json from the given data directory', () => {
  const dataDir = makeCardsFixtureDataDir(
    [],
    [{ id: 'item_001', name: '測試道具', text: '', effects: [], needsCustomLogic: true }],
    []
  );
  expect(loadItemCards(dataDir)).toEqual([
    { id: 'item_001', name: '測試道具', text: '', effects: [], needsCustomLogic: true },
  ]);
});

test('loadOmenCards reads and parses omen-cards.json from the given data directory', () => {
  const dataDir = makeCardsFixtureDataDir(
    [],
    [],
    [{ id: 'omen_001', name: '測試預兆', text: '', effects: [] }]
  );
  expect(loadOmenCards(dataDir)).toEqual([
    { id: 'omen_001', name: '測試預兆', text: '', effects: [] },
  ]);
});

test('loadEventCards throws CONTENT_DATA_LOAD_FAILED when the file does not exist', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-no-cards-'));
  expect(() => loadEventCards(dataDir)).toThrow('CONTENT_DATA_LOAD_FAILED');
});

test('loadItemCards throws CONTENT_DATA_LOAD_FAILED when the file does not exist', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-no-items-'));
  expect(() => loadItemCards(dataDir)).toThrow('CONTENT_DATA_LOAD_FAILED');
});

test('loadOmenCards throws CONTENT_DATA_LOAD_FAILED when the file does not exist', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-no-omens-'));
  expect(() => loadOmenCards(dataDir)).toThrow('CONTENT_DATA_LOAD_FAILED');
});
