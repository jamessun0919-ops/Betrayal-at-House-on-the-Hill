const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRooms, loadStartingRooms } = require('../../src/game/contentLoader');

function makeFixtureDataDir(rooms, startingRooms) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-test-'));
  fs.mkdirSync(path.join(dir, 'rooms'));
  fs.writeFileSync(path.join(dir, 'rooms', 'rooms.json'), JSON.stringify(rooms));
  fs.writeFileSync(path.join(dir, 'rooms', 'starting-rooms.json'), JSON.stringify(startingRooms));
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

test('loadRooms throws a clear error when the file does not exist', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-empty-'));
  expect(() => loadRooms(dataDir)).toThrow();
});
