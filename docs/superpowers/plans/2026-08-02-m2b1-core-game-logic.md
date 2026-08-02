# M2b-1：核心邏輯模組（房間磚牌庫、提問狀態機、選角色、回合流程） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M2a 的資料層（`contentLoader.js`/`doorLayout.js`/`boardGenerator.js`/`playerEntity.js`/`gameState.js`）之上，建立 M2b 需要的純邏輯模組：房間磚牌庫、單一待處理提問狀態機、選角色狀態機、遊戲狀態容器生命週期管理（`GameManager`）、回合行動流程（移動/開門/道具/襲擊/操作的第一層選擇與 AP 記帳）。這個階段完成後，能在測試中把一整局遊戲從「選角色」推進到「玩家可以移動、開門、扣行動力」——但還沒有接上 Socket.IO 事件（那是 M2b-2 的範圍，要等這份計畫的模組介面實際定案後才會撰寫）。

**Architecture:** 延續 M2a 的原則——純邏輯模組，不依賴 Socket.IO 或 Express，全部可在 Node.js 環境下直接單元測試。新模組各自單一職責：`roomDeck.js`（房間磚抽牌）、`promptState.js`（提問狀態機，跟具體提問內容無關，M2c 之後也會重用）、`characterSelection.js`（選角色順序/鎖定）、`gameManager.js`（`roomCode -> gameState` 生命週期）、`turnFlow.js`（移動/開門/行動力記帳，整合前面幾個模組）。

**Tech Stack:** Node.js（>=18）、純 JavaScript（CommonJS）、Jest。延續 M1/M2a 的檔案結構與防呆慣例。

## Global Constraints

- 純 JavaScript（CommonJS `require`/`module.exports`），不使用 TypeScript
- 所有函式對不合法輸入要拋出清楚的 `Error`（訊息用大寫底線字串，例如 `INVALID_DIRECTION`），不要靜默失敗或回傳 `undefined`——這是 M1/M2a 建立、開發者已明確裁定優先於任何計畫附帶程式碼的專案慣例
- 測試一律使用自建的 fixture 資料，不要在自動化測試裡直接讀取 `data/` 底下的真實內容檔（`data/characters/characters.json` 目前是佔位資料，`data/rooms/rooms.json` 內容也還在持續調整）
- 房間座標系統、方向命名（`north`/`east`/`south`/`west`，`y`增加＝南，`x`增加＝東）延續 M2a 已定案的規則，不重新設計
- **移動的門鄰接判定規則（本次新定案）**：兩間已探索房間之間能不能通行，看**雙方**在共用邊上是否都列出門——出發房間那一側要有門，目的地房間面對的那一側也要有門，兩者都同意才算通行；已放置房間的 `doorSides` 資料本身不會因為這個判定被竄改
- **房間磚牌庫抽完之後的規則（本次新定案）**：牌庫抽完後，「開門」這個選項直接從可選動作清單消失（不會等玩家選了才擋下來），所有還連接著未探索座標的門視為牆，遊戲用現有版圖繼續進行到結束
- 這個階段**不處理**：Socket.IO 事件（M2b-2 範圍）、卡片/房間效果實際解析（M2c 範圍）、戰鬥（M3 範圍）、AI 玩家（Phase 2，僅記錄設計意圖見 [design doc](../specs/2026-08-02-m2b-turn-flow-design.md) 第 2 節備註）
- 完整背景與所有決策記錄見 [docs/superpowers/specs/2026-08-02-m2b-turn-flow-design.md](../specs/2026-08-02-m2b-turn-flow-design.md)

---

## 檔案結構

```
data/characters/
  characters.json              # 已存在：6 個佔位角色

server/src/game/
  contentLoader.js              # M2a 既有，本次擴充：loadCharacters
  boardGenerator.js             # M2a 既有，本次擴充：canMoveBetween、匯出 DIRECTION_DELTA
  gameState.js                  # M2a 既有，本次擴充：roomDeck 欄位、serializeGameState
  roomDeck.js                   # 新增：房間磚牌庫
  promptState.js                # 新增：單一待處理提問狀態機
  characterSelection.js         # 新增：選角色順序/鎖定狀態機
  gameManager.js                # 新增：roomCode -> gameState 生命週期
  turnFlow.js                   # 新增：移動/開門/行動力記帳

server/test/game/
  contentLoader.test.js         # M2a 既有，本次擴充
  boardGenerator.test.js        # M2a 既有，本次擴充
  gameState.test.js             # M2a 既有，本次擴充
  roomDeck.test.js
  promptState.test.js
  characterSelection.test.js
  gameManager.test.js
  turnFlow.test.js
```

---

### Task 1: 內容載入器擴充（contentLoader.js：新增 loadCharacters）

**Files:**
- Modify: `server/src/game/contentLoader.js`
- Test: `server/test/game/contentLoader.test.js`

**Interfaces:**
- Consumes: 無
- Produces: `loadCharacters(dataDir?: string): Array<object>`——讀取 `data/characters/characters.json`，回傳解析後的陣列；同時把既有的 `ROOM_DATA_LOAD_FAILED` 錯誤代碼改名為 `CONTENT_DATA_LOAD_FAILED`（因為這個模組現在載入的不只是房間資料，`ROOM_DATA_LOAD_FAILED` 這個名字已經不準確）

**現有檔案內容**（`server/src/game/contentLoader.js`，供對照修改）：
```js
const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.join(__dirname, '../../../data');

function loadJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('ROOM_DATA_LOAD_FAILED');
  }
}

function loadRooms(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'rooms', 'rooms.json'));
}

function loadStartingRooms(dataDir = DEFAULT_DATA_DIR) {
  return loadJsonFile(path.join(dataDir, 'rooms', 'starting-rooms.json'));
}

module.exports = { loadRooms, loadStartingRooms, DEFAULT_DATA_DIR };
```

**現有測試檔內容**（`server/test/game/contentLoader.test.js`，供對照）：
```js
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
  expect(() => loadRooms(dataDir)).toThrow('ROOM_DATA_LOAD_FAILED');
});

test('loadRooms throws ROOM_DATA_LOAD_FAILED when the file contains malformed JSON', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loader-bad-json-'));
  fs.mkdirSync(path.join(dataDir, 'rooms'));
  fs.writeFileSync(path.join(dataDir, 'rooms', 'rooms.json'), '{not valid json');
  expect(() => loadRooms(dataDir)).toThrow('ROOM_DATA_LOAD_FAILED');
});
```

- [ ] **Step 1: Update the test file (rename error assertions, add loadCharacters tests)**

Replace `server/test/game/contentLoader.test.js` entirely with:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/contentLoader.test.js
```
Expected: FAIL——`loadCharacters` 尚未匯出；既有測試斷言的錯誤字串已改成 `CONTENT_DATA_LOAD_FAILED`，跟目前程式碼丟出的 `ROOM_DATA_LOAD_FAILED` 不符。

- [ ] **Step 3: Update the implementation**

Replace `server/src/game/contentLoader.js` entirely with:
```js
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

module.exports = { loadRooms, loadStartingRooms, loadCharacters, DEFAULT_DATA_DIR };
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/contentLoader.test.js
```
Expected: PASS（6 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/contentLoader.js server/test/game/contentLoader.test.js
git commit -m "feat(m2b1): add loadCharacters and rename content-load error to CONTENT_DATA_LOAD_FAILED"
```

---

### Task 2: 房間磚牌庫（roomDeck.js）

**Files:**
- Create: `server/src/game/roomDeck.js`
- Test: `server/test/game/roomDeck.test.js`

**Interfaces:**
- Consumes: 無
- Produces:
  - `createRoomDeck(rooms: Array<object>): RoomDeck`——`RoomDeck = { cards: Array<object>, drawnCount: number }`，`cards` 是洗牌後的 `rooms` 複本；`rooms` 不是陣列或是空陣列時拋出 `INVALID_ROOM_LIST`
  - `drawRoom(deck: RoomDeck): object`——回傳下一張房間、`drawnCount` 加一；牌庫已空時拋出 `ROOM_DECK_EMPTY`
  - `isRoomDeckEmpty(deck: RoomDeck): boolean`
  - `getRemainingCount(deck: RoomDeck): number`

- [ ] **Step 1: Write the failing test**

`server/test/game/roomDeck.test.js`
```js
const { createRoomDeck, drawRoom, isRoomDeckEmpty, getRemainingCount } = require('../../src/game/roomDeck');

function makeRooms(count) {
  const rooms = [];
  for (let i = 0; i < count; i++) {
    rooms.push({ id: `room_${i}`, doors: 2 });
  }
  return rooms;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('createRoomDeck builds a deck containing every room, none drawn yet', () => {
  const deck = createRoomDeck(makeRooms(3));
  expect(deck.cards).toHaveLength(3);
  expect(deck.drawnCount).toBe(0);
  expect(isRoomDeckEmpty(deck)).toBe(false);
  expect(getRemainingCount(deck)).toBe(3);
});

test('createRoomDeck shuffles the rooms (does not just copy the input order every time)', () => {
  // Force a no-op shuffle once, then a reversing pattern once, and compare —
  // this only proves shuffling is applied, not a specific algorithm.
  const rooms = makeRooms(20);
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const deckA = createRoomDeck(rooms);
  jest.spyOn(Math, 'random').mockReturnValue(0.999);
  const deckB = createRoomDeck(rooms);
  expect(deckA.cards.map((r) => r.id)).not.toEqual(deckB.cards.map((r) => r.id));
});

test('drawRoom returns rooms one at a time and increments drawnCount', () => {
  const deck = createRoomDeck(makeRooms(2));
  const first = drawRoom(deck);
  expect(deck.drawnCount).toBe(1);
  const second = drawRoom(deck);
  expect(deck.drawnCount).toBe(2);
  expect(first.id).not.toBe(second.id);
  expect(isRoomDeckEmpty(deck)).toBe(true);
  expect(getRemainingCount(deck)).toBe(0);
});

test('drawRoom never draws the same room twice', () => {
  const deck = createRoomDeck(makeRooms(5));
  const drawnIds = new Set();
  for (let i = 0; i < 5; i++) {
    const room = drawRoom(deck);
    expect(drawnIds.has(room.id)).toBe(false);
    drawnIds.add(room.id);
  }
});

test('drawRoom throws ROOM_DECK_EMPTY once every room has been drawn', () => {
  const deck = createRoomDeck(makeRooms(1));
  drawRoom(deck);
  expect(() => drawRoom(deck)).toThrow('ROOM_DECK_EMPTY');
});

test('createRoomDeck throws INVALID_ROOM_LIST for a non-array or empty input', () => {
  expect(() => createRoomDeck(null)).toThrow('INVALID_ROOM_LIST');
  expect(() => createRoomDeck([])).toThrow('INVALID_ROOM_LIST');
  expect(() => createRoomDeck('not an array')).toThrow('INVALID_ROOM_LIST');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/roomDeck.test.js
```
Expected: FAIL，因為 `../../src/game/roomDeck` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/game/roomDeck.js`
```js
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

function createRoomDeck(rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) {
    throw new Error('INVALID_ROOM_LIST');
  }
  return { cards: shuffle(rooms), drawnCount: 0 };
}

function isRoomDeckEmpty(deck) {
  return deck.drawnCount >= deck.cards.length;
}

function getRemainingCount(deck) {
  return deck.cards.length - deck.drawnCount;
}

function drawRoom(deck) {
  if (isRoomDeckEmpty(deck)) {
    throw new Error('ROOM_DECK_EMPTY');
  }
  const room = deck.cards[deck.drawnCount];
  deck.drawnCount += 1;
  return room;
}

module.exports = { createRoomDeck, drawRoom, isRoomDeckEmpty, getRemainingCount };
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/roomDeck.test.js
```
Expected: PASS（6 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/roomDeck.js server/test/game/roomDeck.test.js
git commit -m "feat(m2b1): add room-tile deck with shuffle, sequential draw, no repeats"
```

---

### Task 3: 移動鄰接判定（boardGenerator.js 擴充）

**Files:**
- Modify: `server/src/game/boardGenerator.js`
- Test: `server/test/game/boardGenerator.test.js`

**Interfaces:**
- Consumes: 無新依賴（沿用既有的 `OPPOSITE_SIDE` from `./doorLayout`）
- Produces（新增，既有的 `createBoard`/`placeNewRoom`/`coordKey` 不變）:
  - `canMoveBetween(board, floor: 'ground'|'upper', fromCoord: {x,y}, direction: 'north'|'east'|'south'|'west'): boolean`——出發房間那一側跟目的地房間面對的那一側都要有門才回傳 `true`；目的地座標還沒有房間（未探索）回傳 `false`（不拋錯，這是正常情境，呼叫者要另外判斷「是否可以開門」）；`floor`/`direction`/`fromCoord` 不合法時拋出跟 `placeNewRoom` 一致的 `INVALID_FLOOR`/`INVALID_DIRECTION`/`INVALID_FROM_COORD`；`fromCoord` 那個座標本身沒有房間時拋出 `ROOM_NOT_FOUND`
  - 額外從 `module.exports` 匯出既有的內部常數 `DIRECTION_DELTA`（`{north:{dx,dy}, ...}`），供 Task 8 的 `turnFlow.js` 計算鄰居座標時共用，不必重複定義一份

**現有檔案內容**（`server/src/game/boardGenerator.js`，供對照修改）：
```js
const { OPPOSITE_SIDE, computeDoorLayout } = require('./doorLayout');

const DIRECTION_DELTA = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

const ALL_SIDES = ['north', 'east', 'south', 'west'];

function coordKey(x, y) {
  return `${x},${y}`;
}

function placeFixedRoom(grid, roomId, x, y) {
  grid.set(coordKey(x, y), { roomId, x, y, doorSides: ALL_SIDES.slice() });
}

function createBoard(startingRooms) {
  const ground = new Map();
  const upper = new Map();

  const entranceHall = startingRooms.find((r) => r.id === 'room_entrance_hall');
  const foyer = startingRooms.find((r) => r.id === 'room_foyer');
  const grandStaircase = startingRooms.find((r) => r.id === 'room_grand_staircase');
  const upperLanding = startingRooms.find((r) => r.id === 'room_upper_landing');

  if (!entranceHall || !foyer || !grandStaircase || !upperLanding) {
    throw new Error('MISSING_STARTING_ROOM');
  }

  placeFixedRoom(ground, entranceHall.id, 0, 0);
  placeFixedRoom(ground, foyer.id, 4, 0);
  placeFixedRoom(ground, grandStaircase.id, -4, 0);
  placeFixedRoom(upper, upperLanding.id, 0, 0);

  return {
    ground,
    upper,
    stairsLink: { groundRoomId: grandStaircase.id, upperRoomId: upperLanding.id },
  };
}

function makeNeighborRequirementReader(grid, coord) {
  return function getNeighborRequirement(side) {
    const delta = DIRECTION_DELTA[side];
    const neighbor = grid.get(coordKey(coord.x + delta.dx, coord.y + delta.dy));
    if (!neighbor) return null;
    const facingSide = OPPOSITE_SIDE[side];
    return neighbor.doorSides.includes(facingSide) ? 'door' : 'wall';
  };
}

function placeNewRoom(board, floor, fromCoord, direction, roomDefinition) {
  if (!Number.isInteger(roomDefinition.doors) || roomDefinition.doors < 1 || roomDefinition.doors > 4) {
    throw new Error('INVALID_ROOM_DOORS');
  }
  if (!DIRECTION_DELTA[direction]) {
    throw new Error('INVALID_DIRECTION');
  }
  if (floor !== 'ground' && floor !== 'upper') {
    throw new Error('INVALID_FLOOR');
  }
  if (!roomDefinition.id) {
    throw new Error('INVALID_ROOM_ID');
  }
  if (!Number.isInteger(fromCoord.x) || !Number.isInteger(fromCoord.y)) {
    throw new Error('INVALID_FROM_COORD');
  }
  const grid = board[floor];
  const delta = DIRECTION_DELTA[direction];
  const newCoord = { x: fromCoord.x + delta.dx, y: fromCoord.y + delta.dy };
  const key = coordKey(newCoord.x, newCoord.y);
  if (grid.has(key)) {
    throw new Error('ROOM_ALREADY_PLACED');
  }

  const entrySide = OPPOSITE_SIDE[direction];
  const getNeighborRequirement = makeNeighborRequirementReader(grid, newCoord);
  const doorSides = computeDoorLayout(roomDefinition.doors, entrySide, getNeighborRequirement);

  const placedRoom = {
    roomId: roomDefinition.id,
    x: newCoord.x,
    y: newCoord.y,
    doorSides: Array.from(doorSides),
  };
  grid.set(key, placedRoom);
  return placedRoom;
}

module.exports = { createBoard, placeNewRoom, coordKey };
```

- [ ] **Step 1: Write the failing test**

Append to `server/test/game/boardGenerator.test.js` (add this `require` of `canMoveBetween` to the existing top-of-file import, and append these test cases at the end of the file):

Change the top import line from:
```js
const { createBoard, placeNewRoom, coordKey } = require('../../src/game/boardGenerator');
```
to:
```js
const { createBoard, placeNewRoom, coordKey, canMoveBetween } = require('../../src/game/boardGenerator');
```

Then append at the end of the file:
```js

test('canMoveBetween returns true when both rooms agree there is a door on the shared side', () => {
  const board = createBoard(STARTING_ROOMS);
  // entrance hall (0,0) has doors on all 4 sides (fixed starting room).
  // Place a room to its north with doors:4 -> it will also have a door facing south (entry side).
  placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'north', { id: 'room_a', doors: 4 });
  expect(canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'north')).toBe(true);
});

test('canMoveBetween returns false when the neighbor has no door facing back (one-way mismatch)', () => {
  const board = createBoard(STARTING_ROOMS);
  // Manually place a neighbor at (0,-1) whose doorSides do NOT include 'south'
  // (i.e. it does not have a door facing back toward the entrance hall).
  board.ground.set(coordKey(0, -1), { roomId: 'room_b', x: 0, y: -1, doorSides: ['north'] });
  expect(canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'north')).toBe(false);
});

test('canMoveBetween returns false when the origin room itself has no door on that side', () => {
  const board = createBoard(STARTING_ROOMS);
  board.ground.set(coordKey(0, 0), { roomId: 'room_entrance_hall', x: 0, y: 0, doorSides: ['east'] });
  board.ground.set(coordKey(0, -1), { roomId: 'room_b', x: 0, y: -1, doorSides: ['north', 'south'] });
  expect(canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'north')).toBe(false);
});

test('canMoveBetween returns false when the target coordinate is unexplored', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'north')).toBe(false);
});

test('canMoveBetween throws ROOM_NOT_FOUND when there is no room at fromCoord', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() => canMoveBetween(board, 'ground', { x: 99, y: 99 }, 'north')).toThrow('ROOM_NOT_FOUND');
});

test('canMoveBetween throws INVALID_DIRECTION/INVALID_FLOOR/INVALID_FROM_COORD for malformed input', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() => canMoveBetween(board, 'ground', { x: 0, y: 0 }, 'sideways')).toThrow('INVALID_DIRECTION');
  expect(() => canMoveBetween(board, 'basement', { x: 0, y: 0 }, 'north')).toThrow('INVALID_FLOOR');
  expect(() => canMoveBetween(board, 'ground', { x: 'a', y: 0 }, 'north')).toThrow('INVALID_FROM_COORD');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/boardGenerator.test.js
```
Expected: FAIL——`canMoveBetween` 尚未匯出。

- [ ] **Step 3: Write minimal implementation**

In `server/src/game/boardGenerator.js`, add this function anywhere after `makeNeighborRequirementReader` and before `module.exports`:
```js
function canMoveBetween(board, floor, fromCoord, direction) {
  if (!DIRECTION_DELTA[direction]) {
    throw new Error('INVALID_DIRECTION');
  }
  if (floor !== 'ground' && floor !== 'upper') {
    throw new Error('INVALID_FLOOR');
  }
  if (!Number.isInteger(fromCoord.x) || !Number.isInteger(fromCoord.y)) {
    throw new Error('INVALID_FROM_COORD');
  }
  const grid = board[floor];
  const fromRoom = grid.get(coordKey(fromCoord.x, fromCoord.y));
  if (!fromRoom) {
    throw new Error('ROOM_NOT_FOUND');
  }
  if (!fromRoom.doorSides.includes(direction)) {
    return false;
  }
  const delta = DIRECTION_DELTA[direction];
  const toCoord = { x: fromCoord.x + delta.dx, y: fromCoord.y + delta.dy };
  const toRoom = grid.get(coordKey(toCoord.x, toCoord.y));
  if (!toRoom) {
    return false;
  }
  const facingSide = OPPOSITE_SIDE[direction];
  return toRoom.doorSides.includes(facingSide);
}
```

Then change the final `module.exports` line from:
```js
module.exports = { createBoard, placeNewRoom, coordKey };
```
to:
```js
module.exports = { createBoard, placeNewRoom, coordKey, canMoveBetween, DIRECTION_DELTA };
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/boardGenerator.test.js
```
Expected: PASS（16 個測試全過：既有 10 個＋新增 6 個）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/boardGenerator.js server/test/game/boardGenerator.test.js
git commit -m "feat(m2b1): add canMoveBetween movement adjacency check (mutual-door rule)"
```

---

### Task 4: 遊戲狀態容器擴充（gameState.js：房間磚牌庫＋序列化）

**Files:**
- Modify: `server/src/game/gameState.js`
- Test: `server/test/game/gameState.test.js`

**Interfaces:**
- Consumes: `createRoomDeck`, `isRoomDeckEmpty`, `getRemainingCount` from Task 2 (`./roomDeck`)
- Produces（`createGameState` 簽名變更，其餘既有介面不變）:
  - `createGameState(startingRooms: Array<object>, rooms: Array<object>): GameState`——`GameState = { board, players: Map, hauntStarted: false, omenCount: 0, roomDeck }`，`roomDeck` 由 `createRoomDeck(rooms)` 建立
  - `serializeGameState(gameState: GameState): object`——把 `board.ground`/`board.upper` 的 `Map` 轉成陣列、`players` 的 `Map` 轉成陣列，`roomDeck` 只暴露 `{ remainingCount, isEmpty }`（不外洩牌庫實際內容，避免用 devtools 偷看還沒抽到的房間）

**現有檔案內容**（`server/src/game/gameState.js`，供對照修改）：
```js
const { createBoard } = require('./boardGenerator');
const { createPlayer, resetActionPoints } = require('./playerEntity');

function createGameState(startingRooms) {
  return {
    board: createBoard(startingRooms),
    players: new Map(),
    hauntStarted: false,
    omenCount: 0,
  };
}

function addPlayer(gameState, { playerId, name, stats }) {
  if (gameState.players.has(playerId)) {
    throw new Error('DUPLICATE_PLAYER_ID');
  }
  const player = createPlayer({
    playerId,
    name,
    floor: 'ground',
    x: 0,
    y: 0,
    stats,
    actionPoints: 0,
  });
  resetActionPoints(player);
  gameState.players.set(playerId, player);
  return player;
}

function getPlayer(gameState, playerId) {
  return gameState.players.get(playerId);
}

module.exports = { createGameState, addPlayer, getPlayer };
```

- [ ] **Step 1: Write the failing test**

Replace `server/test/game/gameState.test.js` entirely with:
```js
const { createGameState, addPlayer, getPlayer, serializeGameState } = require('../../src/game/gameState');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

function makeDrawableRooms(count = 3) {
  const rooms = [];
  for (let i = 0; i < count; i++) {
    rooms.push({ id: `room_${i}`, doors: 2 });
  }
  return rooms;
}

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 },
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

test('createGameState builds a board, an empty player map, and a room deck', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms(3));
  expect(gameState.players.size).toBe(0);
  expect(gameState.hauntStarted).toBe(false);
  expect(gameState.omenCount).toBe(0);
  expect(gameState.board.ground.get('0,0').roomId).toBe('room_entrance_hall');
  expect(gameState.roomDeck.cards).toHaveLength(3);
  expect(gameState.roomDeck.drawnCount).toBe(0);
});

test('addPlayer places the new player at the entrance hall with action points set', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms());
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  expect(player.floor).toBe('ground');
  expect(player.x).toBe(0);
  expect(player.y).toBe(0);
  expect(player.actionPoints).toBe(4); // equals speed track value at baseIndex
  expect(gameState.players.get('p1')).toBe(player);
});

test('addPlayer throws DUPLICATE_PLAYER_ID when the playerId is already registered', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms());
  addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  expect(() =>
    addPlayer(gameState, { playerId: 'p1', name: 'Bob', stats: makeStats() })
  ).toThrow('DUPLICATE_PLAYER_ID');
  // The original player must be untouched.
  expect(getPlayer(gameState, 'p1').name).toBe('Alice');
});

test('getPlayer returns the player by id, or undefined if not found', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms());
  addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  expect(getPlayer(gameState, 'p1').name).toBe('Alice');
  expect(getPlayer(gameState, 'unknown')).toBeUndefined();
});

test('serializeGameState converts the board and players Maps into plain arrays', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms());
  addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });

  const serialized = serializeGameState(gameState);

  expect(Array.isArray(serialized.board.ground)).toBe(true);
  expect(Array.isArray(serialized.board.upper)).toBe(true);
  expect(serialized.board.ground.some((r) => r.roomId === 'room_entrance_hall')).toBe(true);
  expect(serialized.board.stairsLink).toEqual({
    groundRoomId: 'room_grand_staircase',
    upperRoomId: 'room_upper_landing',
  });
  expect(Array.isArray(serialized.players)).toBe(true);
  expect(serialized.players[0].playerId).toBe('p1');
  expect(serialized.hauntStarted).toBe(false);
  expect(serialized.omenCount).toBe(0);

  // Must survive an actual JSON round-trip (the real reason this function exists).
  expect(() => JSON.stringify(serialized)).not.toThrow();
  expect(JSON.parse(JSON.stringify(serialized)).players[0].playerId).toBe('p1');
});

test('serializeGameState exposes only remainingCount/isEmpty for the room deck, not its contents', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms(3));
  const serialized = serializeGameState(gameState);
  expect(serialized.roomDeck).toEqual({ remainingCount: 3, isEmpty: false });
  expect(serialized.roomDeck.cards).toBeUndefined();
});

test('serializeGameState includes turnOrder/currentPlayerIndex when GameManager has set them, or null before that', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms());
  // Before GameManager.startGame runs (Task 7), these fields don't exist yet.
  expect(serializeGameState(gameState).turnOrder).toBeNull();
  expect(serializeGameState(gameState).currentPlayerIndex).toBeNull();

  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 1;
  const serialized = serializeGameState(gameState);
  expect(serialized.turnOrder).toEqual(['p1', 'p2']);
  expect(serialized.currentPlayerIndex).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/gameState.test.js
```
Expected: FAIL——`createGameState` 目前只接受一個參數、沒有 `roomDeck`；`serializeGameState` 尚未匯出。

- [ ] **Step 3: Write minimal implementation**

Replace `server/src/game/gameState.js` entirely with:
```js
const { createBoard } = require('./boardGenerator');
const { createPlayer, resetActionPoints } = require('./playerEntity');
const { createRoomDeck, isRoomDeckEmpty, getRemainingCount } = require('./roomDeck');

function createGameState(startingRooms, rooms) {
  return {
    board: createBoard(startingRooms),
    players: new Map(),
    hauntStarted: false,
    omenCount: 0,
    roomDeck: createRoomDeck(rooms),
  };
}

function addPlayer(gameState, { playerId, name, stats }) {
  if (gameState.players.has(playerId)) {
    throw new Error('DUPLICATE_PLAYER_ID');
  }
  const player = createPlayer({
    playerId,
    name,
    floor: 'ground',
    x: 0,
    y: 0,
    stats,
    actionPoints: 0,
  });
  resetActionPoints(player);
  gameState.players.set(playerId, player);
  return player;
}

function getPlayer(gameState, playerId) {
  return gameState.players.get(playerId);
}

function serializeGameState(gameState) {
  return {
    board: {
      ground: Array.from(gameState.board.ground.values()),
      upper: Array.from(gameState.board.upper.values()),
      stairsLink: gameState.board.stairsLink,
    },
    players: Array.from(gameState.players.values()),
    hauntStarted: gameState.hauntStarted,
    omenCount: gameState.omenCount,
    roomDeck: {
      remainingCount: getRemainingCount(gameState.roomDeck),
      isEmpty: isRoomDeckEmpty(gameState.roomDeck),
    },
    // Set by GameManager.startGame (Task 7) once character selection is
    // done; null before that so this function stays safe to call any time.
    turnOrder: gameState.turnOrder || null,
    currentPlayerIndex: gameState.currentPlayerIndex ?? null,
  };
}

module.exports = { createGameState, addPlayer, getPlayer, serializeGameState };
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/gameState.test.js
```
Expected: PASS（7 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/gameState.js server/test/game/gameState.test.js
git commit -m "feat(m2b1): add room deck and JSON-safe serialization to gameState"
```

---

### Task 5: 提問狀態機（promptState.js）

**Files:**
- Create: `server/src/game/promptState.js`
- Test: `server/test/game/promptState.test.js`

**Interfaces:**
- Consumes: 無
- Produces:
  - `createPromptState(): PromptStateContainer`——`{ pending: null }`
  - `createPrompt(container, { type, targetPlayerId, description, options, timeoutMs, now }): Prompt`——`Prompt = { promptId, type, targetPlayerId, description, options, deadline }`；已經有待處理提問時（`container.pending !== null`）拋出 `PROMPT_ALREADY_PENDING`；`options` 不是非空陣列時拋出 `INVALID_PROMPT_OPTIONS`；`timeoutMs` 不是正整數時拋出 `INVALID_TIMEOUT`；`deadline = now + timeoutMs`（`now` 由呼叫者傳入毫秒時間戳，方便測試不必依賴真實時鐘）
  - `respondToPrompt(container, { promptId, playerId, optionId }): { promptId, chosenOptionId, wasTimeout: false }`——驗證 `promptId` 是目前待處理的那一個（不符拋 `PROMPT_MISMATCH`）、`playerId` 是該提問的目標玩家（不符拋 `PROMPT_FORBIDDEN`）、`optionId` 在 `options` 清單內（不符拋 `INVALID_PROMPT_OPTION`）；驗證通過後清空 `container.pending` 並回傳結果
  - `resolvePromptTimeout(container, { promptId, defaultOptionId })`——由呼叫端在自己設定的真實計時器到期時呼叫；如果 `container.pending` 已經是 `null` 或 `promptId` 跟目前待處理的不一致（代表已經被 `respondToPrompt` 處理掉，是正常的競態情況，不是錯誤），回傳 `null`、不拋錯；否則清空 `container.pending` 並回傳 `{ promptId, chosenOptionId: defaultOptionId, wasTimeout: true }`
  - `getPendingPrompt(container): Prompt | null`

- [ ] **Step 1: Write the failing test**

`server/test/game/promptState.test.js`
```js
const {
  createPromptState,
  createPrompt,
  respondToPrompt,
  resolvePromptTimeout,
  getPendingPrompt,
} = require('../../src/game/promptState');

function makePromptInput(overrides = {}) {
  return {
    type: 'character_select',
    targetPlayerId: 'p1',
    description: '請選擇角色',
    options: ['char_001', 'char_002'],
    timeoutMs: 30000,
    now: 1000,
    ...overrides,
  };
}

test('createPromptState starts with no pending prompt', () => {
  const container = createPromptState();
  expect(getPendingPrompt(container)).toBeNull();
});

test('createPrompt sets the pending prompt with a computed deadline', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  expect(prompt.targetPlayerId).toBe('p1');
  expect(prompt.deadline).toBe(31000); // now(1000) + timeoutMs(30000)
  expect(getPendingPrompt(container)).toEqual(prompt);
});

test('createPrompt throws PROMPT_ALREADY_PENDING when one is already pending', () => {
  const container = createPromptState();
  createPrompt(container, makePromptInput());
  expect(() => createPrompt(container, makePromptInput({ targetPlayerId: 'p2' }))).toThrow('PROMPT_ALREADY_PENDING');
});

test('createPrompt throws INVALID_PROMPT_OPTIONS for missing or empty options', () => {
  const container = createPromptState();
  expect(() => createPrompt(container, makePromptInput({ options: [] }))).toThrow('INVALID_PROMPT_OPTIONS');
  expect(() => createPrompt(container, makePromptInput({ options: undefined }))).toThrow('INVALID_PROMPT_OPTIONS');
});

test('createPrompt throws INVALID_TIMEOUT for a non-positive-integer timeoutMs', () => {
  const container = createPromptState();
  expect(() => createPrompt(container, makePromptInput({ timeoutMs: 0 }))).toThrow('INVALID_TIMEOUT');
  expect(() => createPrompt(container, makePromptInput({ timeoutMs: -5 }))).toThrow('INVALID_TIMEOUT');
  expect(() => createPrompt(container, makePromptInput({ timeoutMs: 1.5 }))).toThrow('INVALID_TIMEOUT');
});

test('respondToPrompt resolves the prompt and clears pending state', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  const result = respondToPrompt(container, { promptId: prompt.promptId, playerId: 'p1', optionId: 'char_002' });
  expect(result).toEqual({ promptId: prompt.promptId, chosenOptionId: 'char_002', wasTimeout: false });
  expect(getPendingPrompt(container)).toBeNull();
});

test('respondToPrompt throws PROMPT_MISMATCH for a stale or wrong promptId', () => {
  const container = createPromptState();
  createPrompt(container, makePromptInput());
  expect(() =>
    respondToPrompt(container, { promptId: 'not-the-real-id', playerId: 'p1', optionId: 'char_001' })
  ).toThrow('PROMPT_MISMATCH');
});

test('respondToPrompt throws PROMPT_FORBIDDEN when the responder is not the target player', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  expect(() =>
    respondToPrompt(container, { promptId: prompt.promptId, playerId: 'someone-else', optionId: 'char_001' })
  ).toThrow('PROMPT_FORBIDDEN');
});

test('respondToPrompt throws INVALID_PROMPT_OPTION for an option not in the list', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  expect(() =>
    respondToPrompt(container, { promptId: prompt.promptId, playerId: 'p1', optionId: 'not_an_option' })
  ).toThrow('INVALID_PROMPT_OPTION');
});

test('resolvePromptTimeout resolves with the default option and clears pending state', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  const result = resolvePromptTimeout(container, { promptId: prompt.promptId, defaultOptionId: 'char_001' });
  expect(result).toEqual({ promptId: prompt.promptId, chosenOptionId: 'char_001', wasTimeout: true });
  expect(getPendingPrompt(container)).toBeNull();
});

test('resolvePromptTimeout is a no-op (returns null) if the prompt was already resolved by a real response', () => {
  const container = createPromptState();
  const prompt = createPrompt(container, makePromptInput());
  respondToPrompt(container, { promptId: prompt.promptId, playerId: 'p1', optionId: 'char_001' });
  // The real timer for the same prompt fires late, after the response already resolved it.
  const result = resolvePromptTimeout(container, { promptId: prompt.promptId, defaultOptionId: 'char_002' });
  expect(result).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/promptState.test.js
```
Expected: FAIL，因為 `../../src/game/promptState` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/game/promptState.js`
```js
let promptCounter = 0;

function generatePromptId() {
  promptCounter += 1;
  return `prompt_${promptCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPromptState() {
  return { pending: null };
}

function createPrompt(container, { type, targetPlayerId, description, options, timeoutMs, now }) {
  if (container.pending !== null) {
    throw new Error('PROMPT_ALREADY_PENDING');
  }
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('INVALID_PROMPT_OPTIONS');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('INVALID_TIMEOUT');
  }
  const prompt = {
    promptId: generatePromptId(),
    type,
    targetPlayerId,
    description,
    options,
    deadline: now + timeoutMs,
  };
  container.pending = prompt;
  return prompt;
}

function respondToPrompt(container, { promptId, playerId, optionId }) {
  const pending = container.pending;
  if (!pending || pending.promptId !== promptId) {
    throw new Error('PROMPT_MISMATCH');
  }
  if (pending.targetPlayerId !== playerId) {
    throw new Error('PROMPT_FORBIDDEN');
  }
  if (!pending.options.includes(optionId)) {
    throw new Error('INVALID_PROMPT_OPTION');
  }
  container.pending = null;
  return { promptId, chosenOptionId: optionId, wasTimeout: false };
}

function resolvePromptTimeout(container, { promptId, defaultOptionId }) {
  const pending = container.pending;
  if (!pending || pending.promptId !== promptId) {
    return null;
  }
  container.pending = null;
  return { promptId, chosenOptionId: defaultOptionId, wasTimeout: true };
}

function getPendingPrompt(container) {
  return container.pending;
}

module.exports = {
  createPromptState,
  createPrompt,
  respondToPrompt,
  resolvePromptTimeout,
  getPendingPrompt,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/promptState.test.js
```
Expected: PASS（11 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/promptState.js server/test/game/promptState.test.js
git commit -m "feat(m2b1): add single-pending-prompt state machine with timeout resolution"
```

---

### Task 6: 選角色狀態機（characterSelection.js）

**Files:**
- Create: `server/src/game/characterSelection.js`
- Test: `server/test/game/characterSelection.test.js`

**Interfaces:**
- Consumes: 無
- Produces:
  - `createCharacterSelectionState(playerIds: Array<string>, characters: Array<{id}>): SelectionState`——`SelectionState = { order: Array<string>, currentTurnIndex: number, lockedCharacterIds: Set<string>, assignments: Map<string,string>, characters }`；`order` 是 `playerIds` 洗牌後的複本；`playerIds.length < 2` 時拋出 `TOO_FEW_PLAYERS`；`characters` 不是非空陣列時拋出 `INVALID_CHARACTER_LIST`
  - `getCurrentPicker(state): string | null`——回傳目前輪到誰選，全部選完回傳 `null`
  - `getAvailableCharacterIds(state): Array<string>`——尚未被鎖定的角色 id
  - `confirmCharacterChoice(state, { playerId, characterId }): void`——`playerId` 不是目前輪到的人拋出 `CHARACTER_SELECT_NOT_YOUR_TURN`；`characterId` 不存在於 `characters` 拋出 `UNKNOWN_CHARACTER`；`characterId` 已被鎖定拋出 `CHARACTER_ALREADY_TAKEN`；驗證通過後鎖定該角色、記錄 `assignments`、`currentTurnIndex` 前進一格
  - `assignRandomCharacter(state, playerId): string`——逾時預設行為用：從目前仍可選的角色中隨機選一個並代替該玩家確認（內部呼叫跟 `confirmCharacterChoice` 一樣的鎖定邏輯），回傳被指定的 `characterId`；全部角色都已被鎖定時（理論上不會發生，角色數固定 6 個、人數不會超過 6）拋出 `NO_CHARACTERS_AVAILABLE`
  - `isCharacterSelectionComplete(state): boolean`
  - `getAssignments(state): Map<string,string>`——`playerId -> characterId`

- [ ] **Step 1: Write the failing test**

`server/test/game/characterSelection.test.js`
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/characterSelection.test.js
```
Expected: FAIL，因為 `../../src/game/characterSelection` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/game/characterSelection.js`
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/characterSelection.test.js
```
Expected: PASS（10 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/characterSelection.js server/test/game/characterSelection.test.js
git commit -m "feat(m2b1): add character selection state machine (random order, lock-on-confirm)"
```

---

### Task 7: 遊戲狀態生命週期管理（gameManager.js）

**Files:**
- Create: `server/src/game/gameManager.js`
- Test: `server/test/game/gameManager.test.js`

**Interfaces:**
- Consumes: `createGameState`, `addPlayer` from Task 4 (`./gameState`)
- Produces:
  - `createGameManager(): GameManager`——`{ games: Map<string, GameState> }`
  - `startGame(manager, roomCode, { startingRooms, rooms, characters, players }): GameState`——`players` 格式 `Array<{ playerId, name, characterId }>`；依 `characterId` 從 `characters`（格式同 `data/characters/characters.json`：`{id, stats, ...}`）查出該玩家的 `stats`，找不到拋出 `UNKNOWN_CHARACTER`；建立 `gameState`（`createGameState(startingRooms, rooms)`）、對每位玩家呼叫 `addPlayer`，存進 `manager.games`；**全部玩家加入後，額外產生一份獨立的隨機回合順序**（跟選角色順序無關，各自骰各自的——這是[設計文件](../specs/2026-08-02-m2b-turn-flow-design.md)第3節定案的規則），寫進 `gameState.turnOrder`（`Array<playerId>`）與 `gameState.currentPlayerIndex`（`0`）；`roomCode` 已經存在對應遊戲時拋出 `GAME_ALREADY_STARTED`
  - `getGameState(manager, roomCode): GameState | undefined`
  - `endGame(manager, roomCode): void`——從 `manager.games` 移除，找不到也不報錯（本來就沒有就當作已經結束）

- [ ] **Step 1: Write the failing test**

`server/test/game/gameManager.test.js`
```js
const { createGameManager, startGame, getGameState, endGame } = require('../../src/game/gameManager');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

function makeDrawableRooms() {
  return [{ id: 'room_0', doors: 2 }, { id: 'room_1', doors: 2 }];
}

function makeCharacters() {
  const stats = {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 },
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
  return [
    { id: 'char_001', codename: 'Alice-character', stats },
    { id: 'char_002', codename: 'Bob-character', stats },
  ];
}

function baseStartArgs(overrides = {}) {
  return {
    startingRooms: STARTING_ROOMS,
    rooms: makeDrawableRooms(),
    characters: makeCharacters(),
    players: [
      { playerId: 'p1', name: 'Alice', characterId: 'char_001' },
      { playerId: 'p2', name: 'Bob', characterId: 'char_002' },
    ],
    ...overrides,
  };
}

test('startGame builds a gameState with both players added, keyed by roomCode', () => {
  const manager = createGameManager();
  const gameState = startGame(manager, 'ROOM1', baseStartArgs());
  expect(gameState.players.size).toBe(2);
  expect(gameState.players.get('p1').name).toBe('Alice');
  expect(getGameState(manager, 'ROOM1')).toBe(gameState);
});

test('startGame resolves each player stats from their assigned character', () => {
  const manager = createGameManager();
  const gameState = startGame(manager, 'ROOM1', baseStartArgs());
  expect(gameState.players.get('p1').stats.might.track).toEqual([1, 2, 3, 4, 5]);
});

test('startGame generates a random turn order covering every player, independent of join/character order', () => {
  const manager = createGameManager();
  const gameState = startGame(manager, 'ROOM1', baseStartArgs());
  expect(gameState.turnOrder.slice().sort()).toEqual(['p1', 'p2']);
  expect(gameState.currentPlayerIndex).toBe(0);
});

test('startGame throws UNKNOWN_CHARACTER when a player references a characterId not in the list', () => {
  const manager = createGameManager();
  const args = baseStartArgs({
    players: [{ playerId: 'p1', name: 'Alice', characterId: 'not_a_real_character' }],
  });
  expect(() => startGame(manager, 'ROOM1', args)).toThrow('UNKNOWN_CHARACTER');
});

test('startGame throws GAME_ALREADY_STARTED for a roomCode that already has a game', () => {
  const manager = createGameManager();
  startGame(manager, 'ROOM1', baseStartArgs());
  expect(() => startGame(manager, 'ROOM1', baseStartArgs())).toThrow('GAME_ALREADY_STARTED');
});

test('getGameState returns undefined for an unknown roomCode', () => {
  const manager = createGameManager();
  expect(getGameState(manager, 'UNKNOWN')).toBeUndefined();
});

test('endGame removes the game and is a no-op for an unknown roomCode', () => {
  const manager = createGameManager();
  startGame(manager, 'ROOM1', baseStartArgs());
  endGame(manager, 'ROOM1');
  expect(getGameState(manager, 'ROOM1')).toBeUndefined();
  expect(() => endGame(manager, 'NEVER_STARTED')).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/gameManager.test.js
```
Expected: FAIL，因為 `../../src/game/gameManager` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/game/gameManager.js`
```js
const { createGameState, addPlayer } = require('./gameState');

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

function createGameManager() {
  return { games: new Map() };
}

function startGame(manager, roomCode, { startingRooms, rooms, characters, players }) {
  if (manager.games.has(roomCode)) {
    throw new Error('GAME_ALREADY_STARTED');
  }
  const gameState = createGameState(startingRooms, rooms);
  for (const player of players) {
    const character = characters.find((c) => c.id === player.characterId);
    if (!character) {
      throw new Error('UNKNOWN_CHARACTER');
    }
    addPlayer(gameState, {
      playerId: player.playerId,
      name: player.name,
      stats: character.stats,
    });
  }
  // Turn order is independent of character-pick order — a fresh, separate
  // shuffle, per the developer's explicit ruling (see M2b design doc §3).
  gameState.turnOrder = shuffle(players.map((p) => p.playerId));
  gameState.currentPlayerIndex = 0;
  manager.games.set(roomCode, gameState);
  return gameState;
}

function getGameState(manager, roomCode) {
  return manager.games.get(roomCode);
}

function endGame(manager, roomCode) {
  manager.games.delete(roomCode);
}

module.exports = { createGameManager, startGame, getGameState, endGame };
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/gameManager.test.js
```
Expected: PASS（7 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/gameManager.js server/test/game/gameManager.test.js
git commit -m "feat(m2b1): add GameManager for roomCode-to-gameState lifecycle"
```

---

### Task 8: 回合行動流程（turnFlow.js：移動／開門／行動力記帳）

**Files:**
- Create: `server/src/game/turnFlow.js`
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: `SIDES` from `./doorLayout`；`canMoveBetween`, `placeNewRoom`, `coordKey`, `DIRECTION_DELTA` from Task 3 (`./boardGenerator`)；`drawRoom`, `isRoomDeckEmpty` from Task 2 (`./roomDeck`)；`getPlayer` from Task 4 (`./gameState`)；`movePlayerTo` from `./playerEntity`
- Produces:
  - `getAvailableDirections(gameState, playerId): Array<{direction: string, kind: 'move'|'open_door'}>`——列出玩家目前所在房間，哪些方向可以走（`kind:'move'`，已探索且雙方都同意有門）、哪些方向可以開門（`kind:'open_door'`，該側有門但目的地未探索**且**房間磚牌庫還沒抽完）；玩家不存在拋出 `PLAYER_NOT_FOUND`
  - `moveToRoom(gameState, playerId, direction): MoveResult`——依 `getAvailableDirections` 的結果執行移動或開門；玩家不存在拋出 `PLAYER_NOT_FOUND`；行動力不足拋出 `NOT_ENOUGH_ACTION_POINTS`；`direction` 不在目前可選清單裡拋出 `INVALID_MOVE_DIRECTION`。`kind:'move'`：更新玩家座標、行動力 -1，回傳 `{ kind:'move', x, y }`。`kind:'open_door'`：從房間磚牌庫抽一張、呼叫 `placeNewRoom` 擺上板圖、玩家移動過去、行動力歸零，回傳 `{ kind:'open_door', x, y, roomId, pendingCardDraw: {deck} | null }`（`pendingCardDraw` 是留給 M2c 接手解析事件/道具/預兆卡效果的訊號，房間 `drawType` 是 `"none"` 或缺漏時為 `null`）
  - `selectAction(gameState, playerId, actionType: 'item'|'attack'|'room_action'): ActionResult`——道具/襲擊/操作的第一層選擇；本階段（M2b）只做「選了哪一類、扣 1 點行動力」的記帳殼子，實際效果解析是 M2c（道具/事件效果）與 M3（戰鬥）的範圍，回傳 `{ kind: actionType, pending: true }` 讓上層（Socket.IO 層／未來的 M2c）知道這裡還沒真正處理完；`actionType` 不合法拋出 `INVALID_ACTION_TYPE`；玩家不存在拋出 `PLAYER_NOT_FOUND`；行動力不足拋出 `NOT_ENOUGH_ACTION_POINTS`
  - `isTurnOver(player): boolean`——`player.actionPoints <= 0`
  - `getCurrentTurnPlayerId(gameState): string`——回傳 `gameState.turnOrder[gameState.currentPlayerIndex]`；`gameState.turnOrder` 是空陣列或未設定時拋出 `NO_TURN_ORDER`
  - `advanceTurn(gameState): string`——把 `gameState.currentPlayerIndex` 前進一格（超過陣列尾端時繞回 `0`，回合順序是循環的），回傳新的目前玩家 id；`gameState.turnOrder` 是空陣列或未設定時拋出 `NO_TURN_ORDER`

- [ ] **Step 1: Write the failing test**

`server/test/game/turnFlow.test.js`
```js
const { createGameState, addPlayer } = require('../../src/game/gameState');
const {
  getAvailableDirections,
  moveToRoom,
  selectAction,
  isTurnOver,
  getCurrentTurnPlayerId,
  advanceTurn,
} = require('../../src/game/turnFlow');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 }, // value 4 at baseIndex
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

function makeGameStateWithPlayer(drawableRooms) {
  const gameState = createGameState(STARTING_ROOMS, drawableRooms || [{ id: 'room_new', doors: 4 }]);
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  return { gameState, player };
}

test('getAvailableDirections lists an unexplored door as open_door when the deck has cards', () => {
  const { gameState } = makeGameStateWithPlayer();
  // Entrance hall (0,0) is a fixed starting room with doors on all 4 sides.
  const available = getAvailableDirections(gameState, 'p1');
  const eastOption = available.find((a) => a.direction === 'east');
  // East of entrance hall (0,0) is (4,0) foyer, not adjacent -- so 'east' at
  // distance 1 (1,0) is unexplored territory, not the foyer itself.
  expect(eastOption).toEqual({ direction: 'east', kind: 'open_door' });
});

test('getAvailableDirections lists a move to an already-explored, mutually-doored neighbor', () => {
  const { gameState } = makeGameStateWithPlayer();
  // Manually place an explored, fully-doored room north of the entrance hall.
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'] });
  const available = getAvailableDirections(gameState, 'p1');
  expect(available.find((a) => a.direction === 'north')).toEqual({ direction: 'north', kind: 'move' });
});

test('getAvailableDirections omits open_door once the room deck is empty', () => {
  const { gameState } = makeGameStateWithPlayer([{ id: 'room_only', doors: 4 }]);
  moveToRoom(gameState, 'p1', 'east'); // draws the only card, deck now empty
  // The player is now in the newly-placed room; check a fresh, still-unexplored side.
  const player = gameState.players.get('p1');
  const available = getAvailableDirections(gameState, 'p1');
  const openDoorOptions = available.filter((a) => a.kind === 'open_door');
  expect(openDoorOptions).toEqual([]);
});

test('getAvailableDirections throws PLAYER_NOT_FOUND for an unknown player', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => getAvailableDirections(gameState, 'unknown')).toThrow('PLAYER_NOT_FOUND');
});

test('moveToRoom moves the player to an already-explored neighbor and deducts 1 action point', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'] });
  const startingAP = player.actionPoints;
  const result = moveToRoom(gameState, 'p1', 'north');
  expect(result).toEqual({ kind: 'move', x: 0, y: -1 });
  expect(player.x).toBe(0);
  expect(player.y).toBe(-1);
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('moveToRoom opens a door: draws a room, places it, moves the player, and zeroes action points', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, drawType: 'item' }]);
  const result = moveToRoom(gameState, 'p1', 'east');
  expect(result.kind).toBe('open_door');
  expect(result.roomId).toBe('room_new');
  expect(result.pendingCardDraw).toEqual({ deck: 'item' });
  expect(player.x).toBe(1);
  expect(player.y).toBe(0);
  expect(player.actionPoints).toBe(0);
});

test('moveToRoom sets pendingCardDraw to null when the room has no draw type', () => {
  const { gameState } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, drawType: 'none' }]);
  const result = moveToRoom(gameState, 'p1', 'east');
  expect(result.pendingCardDraw).toBeNull();
});

test('moveToRoom throws INVALID_MOVE_DIRECTION for a direction not currently available', () => {
  const { gameState } = makeGameStateWithPlayer([]);
  // No drawable rooms at all and no explored neighbor -> every direction invalid.
  // (createGameState requires a non-empty rooms array, so use a deck that's
  // already been fully drawn instead of an empty one.)
  const { gameState: gs2 } = (() => {
    const gameState2 = createGameState(STARTING_ROOMS, [{ id: 'room_only', doors: 4 }]);
    addPlayer(gameState2, { playerId: 'p1', name: 'Alice', stats: makeStats() });
    moveToRoom(gameState2, 'p1', 'east'); // exhausts the deck
    return { gameState: gameState2 };
  })();
  expect(() => moveToRoom(gs2, 'p1', 'west')).toThrow('INVALID_MOVE_DIRECTION');
});

test('moveToRoom throws NOT_ENOUGH_ACTION_POINTS when the player has 0 action points', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'] });
  player.actionPoints = 0;
  expect(() => moveToRoom(gameState, 'p1', 'north')).toThrow('NOT_ENOUGH_ACTION_POINTS');
});

test('selectAction deducts 1 action point and returns a pending marker', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'item');
  expect(result).toEqual({ kind: 'item', pending: true });
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('selectAction throws INVALID_ACTION_TYPE for an unrecognized type', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => selectAction(gameState, 'p1', 'dance')).toThrow('INVALID_ACTION_TYPE');
});

test('selectAction throws NOT_ENOUGH_ACTION_POINTS when the player has 0 action points', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.actionPoints = 0;
  expect(() => selectAction(gameState, 'p1', 'attack')).toThrow('NOT_ENOUGH_ACTION_POINTS');
});

test('isTurnOver reflects whether action points have reached 0', () => {
  const { player } = makeGameStateWithPlayer();
  expect(isTurnOver(player)).toBe(false);
  player.actionPoints = 0;
  expect(isTurnOver(player)).toBe(true);
});

test('getCurrentTurnPlayerId returns the player at the current index', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2', 'p3'];
  gameState.currentPlayerIndex = 1;
  expect(getCurrentTurnPlayerId(gameState)).toBe('p2');
});

test('getCurrentTurnPlayerId throws NO_TURN_ORDER when turnOrder is missing or empty', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => getCurrentTurnPlayerId(gameState)).toThrow('NO_TURN_ORDER');
  gameState.turnOrder = [];
  expect(() => getCurrentTurnPlayerId(gameState)).toThrow('NO_TURN_ORDER');
});

test('advanceTurn moves to the next player and wraps around at the end', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2', 'p3'];
  gameState.currentPlayerIndex = 0;
  expect(advanceTurn(gameState)).toBe('p2');
  expect(gameState.currentPlayerIndex).toBe(1);
  expect(advanceTurn(gameState)).toBe('p3');
  expect(advanceTurn(gameState)).toBe('p1'); // wraps back to the start
  expect(gameState.currentPlayerIndex).toBe(0);
});

test('advanceTurn throws NO_TURN_ORDER when turnOrder is missing or empty', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => advanceTurn(gameState)).toThrow('NO_TURN_ORDER');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/turnFlow.test.js
```
Expected: FAIL，因為 `../../src/game/turnFlow` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/game/turnFlow.js`
```js
const { SIDES } = require('./doorLayout');
const { canMoveBetween, placeNewRoom, coordKey, DIRECTION_DELTA } = require('./boardGenerator');
const { drawRoom, isRoomDeckEmpty } = require('./roomDeck');
const { getPlayer } = require('./gameState');
const { movePlayerTo } = require('./playerEntity');

const ACTION_TYPES = ['item', 'attack', 'room_action'];

function requirePlayer(gameState, playerId) {
  const player = getPlayer(gameState, playerId);
  if (!player) {
    throw new Error('PLAYER_NOT_FOUND');
  }
  return player;
}

function getAvailableDirections(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const grid = gameState.board[player.floor];
  const room = grid.get(coordKey(player.x, player.y));
  const results = [];
  for (const direction of SIDES) {
    if (!room.doorSides.includes(direction)) continue;
    const delta = DIRECTION_DELTA[direction];
    const neighborCoord = { x: player.x + delta.dx, y: player.y + delta.dy };
    const neighborRoom = grid.get(coordKey(neighborCoord.x, neighborCoord.y));
    if (neighborRoom) {
      if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, direction)) {
        results.push({ direction, kind: 'move' });
      }
    } else if (!isRoomDeckEmpty(gameState.roomDeck)) {
      results.push({ direction, kind: 'open_door' });
    }
  }
  return results;
}

function moveToRoom(gameState, playerId, direction) {
  const player = requirePlayer(gameState, playerId);
  if (player.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const available = getAvailableDirections(gameState, playerId);
  const choice = available.find((a) => a.direction === direction);
  if (!choice) {
    throw new Error('INVALID_MOVE_DIRECTION');
  }
  const delta = DIRECTION_DELTA[direction];
  const targetCoord = { x: player.x + delta.dx, y: player.y + delta.dy };

  if (choice.kind === 'move') {
    movePlayerTo(player, player.floor, targetCoord.x, targetCoord.y);
    player.actionPoints -= 1;
    return { kind: 'move', x: targetCoord.x, y: targetCoord.y };
  }

  const roomDefinition = drawRoom(gameState.roomDeck);
  const placedRoom = placeNewRoom(
    gameState.board,
    player.floor,
    { x: player.x, y: player.y },
    direction,
    roomDefinition
  );
  movePlayerTo(player, player.floor, placedRoom.x, placedRoom.y);
  player.actionPoints = 0;
  const pendingCardDraw =
    roomDefinition.drawType && roomDefinition.drawType !== 'none'
      ? { deck: roomDefinition.drawType }
      : null;
  return {
    kind: 'open_door',
    x: placedRoom.x,
    y: placedRoom.y,
    roomId: placedRoom.roomId,
    pendingCardDraw,
  };
}

function selectAction(gameState, playerId, actionType) {
  const player = requirePlayer(gameState, playerId);
  if (!ACTION_TYPES.includes(actionType)) {
    throw new Error('INVALID_ACTION_TYPE');
  }
  if (player.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  player.actionPoints -= 1;
  // M2b only tracks that this action slot was spent. Actual item/attack/room
  // mechanics are resolved by M2c (card effects) and M3 (combat) — this
  // "pending" marker is the hook point for those milestones.
  return { kind: actionType, pending: true };
}

function isTurnOver(player) {
  return player.actionPoints <= 0;
}

function requireTurnOrder(gameState) {
  if (!Array.isArray(gameState.turnOrder) || gameState.turnOrder.length === 0) {
    throw new Error('NO_TURN_ORDER');
  }
}

function getCurrentTurnPlayerId(gameState) {
  requireTurnOrder(gameState);
  return gameState.turnOrder[gameState.currentPlayerIndex];
}

function advanceTurn(gameState) {
  requireTurnOrder(gameState);
  gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.turnOrder.length;
  return gameState.turnOrder[gameState.currentPlayerIndex];
}

module.exports = {
  getAvailableDirections,
  moveToRoom,
  selectAction,
  isTurnOver,
  getCurrentTurnPlayerId,
  advanceTurn,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/turnFlow.test.js
```
Expected: PASS（18 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat(m2b1): add turn flow — movement, door-opening, action selection"
```

---

## 完成後的整體驗收

- [ ] `cd server && npx jest test/game` 全部通過
- [ ] `cd server && npx jest` 全部通過（含 M1/M2a 既有測試）
- [ ] M2b-1 完成後，下一步是撰寫 M2b-2（Socket.IO 事件層整合＋除錯用測試頁面）的詳細實作計畫，要以本計畫實際完成的程式碼介面（`gameManager`/`promptState`/`characterSelection`/`turnFlow`/`gameState` 的實際函式簽名）為基礎延伸，不要用本計畫假設的介面

## 已知的範圍外事項（非本計畫要解決，記錄供後續參考）

- Socket.IO 事件層（`socketHandlers.js` 擴充）與除錯用測試頁面：M2b-2 範圍
- 道具/襲擊/操作的實際效果解析：`selectAction` 目前只回傳 `{ kind, pending: true }` 的殼子，真正的卡片效果/戰鬥判定是 M2c／M3 範圍
- AI 玩家（Phase 2）：選角色順序排真人之後、數量不可超過真人數量——見 [design doc](../specs/2026-08-02-m2b-turn-flow-design.md) 第 2 節備註，`characterSelection.js` 目前的 `playerIds` 純粹是字串陣列，之後要分辨真人/AI 時再擴充
- `data/characters/characters.json` 目前是 6 個佔位角色，真實刻度數值尚未由開發者填寫；本計畫測試全部使用自建 fixture，不受影響
