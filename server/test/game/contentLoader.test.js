const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRooms, loadStartingRooms, loadCharacters } = require('../../src/game/contentLoader');

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
