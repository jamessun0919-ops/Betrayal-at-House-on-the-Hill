# M2a：遊戲核心狀態與房間版圖系統 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立探索引擎的核心資料層——房間內容載入、房間版圖生成（含門的動態計算與衝突處理）、玩家實體（屬性/位置/行動力）、把兩者綁在一起的遊戲狀態容器。這階段做完後，能在測試中生成一張完整版圖、把玩家放上去、正確追蹤屬性——但還沒有回合流程、Socket.IO 事件、卡牌效果（那些是 M2b、M2c）。

**Architecture:** 純邏輯模組，不依賴 Socket.IO 或 Express，全部可在 Node.js 環境下直接單元測試。內容資料（`data/rooms/*.json`）與遊戲邏輯（`server/src/game/*.js`）分離；房間放置演算法拆成「門朝向計算」（純函式，好測試）與「版圖狀態管理」（持有 Map 狀態）兩個檔案。

**Tech Stack:** Node.js（>=18）、純 JavaScript（CommonJS）、Jest。延續 M1 的檔案結構與防呆慣例。

## Global Constraints

- 純 JavaScript（CommonJS `require`/`module.exports`），不使用 TypeScript
- 所有函式對不合法輸入要拋出清楚的 `Error`（訊息用大寫底線字串，例如 `INVALID_DOOR_COUNT`），不要靜默失敗或回傳 `undefined`——這是延續 M1 final review 建立的「不信任輸入、防呆」原則
- 測試一律使用自建的 fixture 資料（小型、寫在測試檔裡的假房間/假屬性），**不要在自動化測試裡直接讀取 `data/rooms/rooms.json` 這個真實內容檔**——因為該檔案的 `doors` 欄位目前尚未由開發者填寫（仍是 `null`），拿它跑測試會不穩定。內容載入器本身（會讀取真實檔案）只測試「能不能正確讀取任意 JSON 檔」這件事，用測試專屬的暫存 fixture 檔案驗證，不依賴 `data/` 資料夾目前的實際內容完整度
- 房間座標系統：一樓、二樓是**兩個獨立的座標網格**（不是同一平面），彼此之間唯一的固定連接是「梯廳↔二樓平台」的特殊通道
- 四個方向固定命名：`north`/`east`/`south`/`west`，座標系統 `y` 增加＝往南（south，數值變大），`x` 增加＝往東（east）
- 這個階段**不處理**：Socket.IO 事件、回合流程、卡牌效果解析、傷害系統、戰鬥——那些分別是 M2b、M2c、M3 的範圍

---

## 檔案結構

```
data/rooms/
  starting-rooms.json         # 已存在：4 塊固定起始房間

server/src/game/
  contentLoader.js            # 讀取 data/rooms/*.json
  doorLayout.js                # 純函式：計算房間門朝向（含衝突處理）
  boardGenerator.js            # 版圖狀態管理：建立初始版圖、放置新房間
  playerEntity.js               # 玩家實體：屬性軌、位置、行動力
  gameState.js                  # 把版圖與玩家綁在一起的容器

server/test/game/
  contentLoader.test.js
  doorLayout.test.js
  boardGenerator.test.js
  playerEntity.test.js
  gameState.test.js
```

---

### Task 1: 內容載入器（contentLoader.js）

**Files:**
- Create: `server/src/game/contentLoader.js`
- Test: `server/test/game/contentLoader.test.js`

**Interfaces:**
- Consumes: 無（第一個任務）
- Produces: `loadRooms(dataDir?: string): Array<object>`、`loadStartingRooms(dataDir?: string): Array<object>`——兩者都是「讀取 JSON 檔並回傳解析後的陣列」，`dataDir` 省略時預設指向專案根目錄的 `data/` 資料夾

- [ ] **Step 1: Write the failing test**

`server/test/game/contentLoader.test.js`
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
  expect(() => loadRooms(dataDir)).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/contentLoader.test.js
```
Expected: FAIL，因為 `../../src/game/contentLoader` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/game/contentLoader.js`
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/contentLoader.test.js
```
Expected: PASS（3 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/contentLoader.js server/test/game/contentLoader.test.js
git commit -m "feat(m2a): add content loader for room data files"
```

---

### Task 2: 房間門朝向計算（doorLayout.js，純函式）

**Files:**
- Create: `server/src/game/doorLayout.js`
- Test: `server/test/game/doorLayout.test.js`

**Interfaces:**
- Consumes: 無
- Produces: `SIDES: string[]`（`['north','east','south','west']`）、`OPPOSITE_SIDE: object`（例如 `OPPOSITE_SIDE.north === 'south'`）、`computeDoorLayout(doorCount: number, entrySide: string, getNeighborRequirement: (side: string) => 'door'|'wall'|null): Set<string>`——`getNeighborRequirement` 是呼叫者提供的函式，對每個非進入側的方位回答「鄰居已放置且要求這裡是門/牆」或 `null`（該側還沒有鄰居，自由選擇）

- [ ] **Step 1: Write the failing test**

`server/test/game/doorLayout.test.js`
```js
const { SIDES, OPPOSITE_SIDE, computeDoorLayout } = require('../../src/game/doorLayout');

function noNeighbors() {
  return () => null;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('SIDES and OPPOSITE_SIDE are defined correctly', () => {
  expect(SIDES).toEqual(['north', 'east', 'south', 'west']);
  expect(OPPOSITE_SIDE).toEqual({ north: 'south', south: 'north', east: 'west', west: 'east' });
});

test('doorCount=1 with no neighbors: only the entry side has a door', () => {
  const layout = computeDoorLayout(1, 'north', noNeighbors());
  expect(layout).toEqual(new Set(['north']));
});

test('doorCount=4 with no neighbors: every side has a door', () => {
  const layout = computeDoorLayout(4, 'north', noNeighbors());
  expect(layout).toEqual(new Set(['north', 'east', 'south', 'west']));
});

test('doorCount=2 with no neighbors: entry side plus exactly one other side', () => {
  const layout = computeDoorLayout(2, 'north', noNeighbors());
  expect(layout.has('north')).toBe(true);
  expect(layout.size).toBe(2);
});

test('throws INVALID_DOOR_COUNT for an out-of-range door count', () => {
  expect(() => computeDoorLayout(0, 'north', noNeighbors())).toThrow('INVALID_DOOR_COUNT');
  expect(() => computeDoorLayout(5, 'north', noNeighbors())).toThrow('INVALID_DOOR_COUNT');
  expect(() => computeDoorLayout(1.5, 'north', noNeighbors())).toThrow('INVALID_DOOR_COUNT');
});

test('finds a conflict-free layout when one is possible, respecting neighbor requirements', () => {
  // east must be a wall (a neighbor already has no door facing us there).
  // The only valid picks for the single extra door (doorCount=2) are south or west.
  // Mock Math.random so the shuffle is deterministic and this test never flakes:
  // with Math.random always 0, Fisher-Yates on ['east','south','west'] yields
  // ['south','west','east'], and slice(0,1) picks 'south' — a valid, non-conflicting pick.
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const getNeighborRequirement = (side) => (side === 'east' ? 'wall' : null);
  const layout = computeDoorLayout(2, 'north', getNeighborRequirement);
  expect(layout.has('north')).toBe(true);
  expect(layout.has('east')).toBe(false);
  expect(layout.size).toBe(2);
});

test('falls back to entry-only when no rotation can satisfy conflicting neighbor requirements', () => {
  // east AND south both require a door, but doorCount=2 only allows one extra pick,
  // so no single choice can satisfy both — every attempt conflicts.
  const getNeighborRequirement = (side) => {
    if (side === 'east') return 'door';
    if (side === 'south') return 'door';
    return null;
  };
  const layout = computeDoorLayout(2, 'north', getNeighborRequirement);
  // Fallback rule: entry side stays a door, every other side becomes a wall,
  // regardless of what a neighbor wanted.
  expect(layout).toEqual(new Set(['north']));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/doorLayout.test.js
```
Expected: FAIL，因為 `../../src/game/doorLayout` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/game/doorLayout.js`
```js
const SIDES = ['north', 'east', 'south', 'west'];
const OPPOSITE_SIDE = { north: 'south', south: 'north', east: 'west', west: 'east' };

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

function computeDoorLayout(doorCount, entrySide, getNeighborRequirement) {
  if (!Number.isInteger(doorCount) || doorCount < 1 || doorCount > 4) {
    throw new Error('INVALID_DOOR_COUNT');
  }
  const otherSides = SIDES.filter((side) => side !== entrySide);

  for (let attempt = 0; attempt < 4; attempt++) {
    const shuffled = shuffle(otherSides);
    const extraDoors = new Set(shuffled.slice(0, doorCount - 1));
    const hasConflict = otherSides.some((side) => {
      const requirement = getNeighborRequirement(side);
      if (requirement === null) return false;
      const wantsDoor = extraDoors.has(side);
      return (requirement === 'door') !== wantsDoor;
    });
    if (!hasConflict) {
      return new Set([entrySide, ...extraDoors]);
    }
  }

  // Fallback: entry side is guaranteed a door; every other side becomes a
  // wall, regardless of what a neighbor wanted. This is a deliberate,
  // rare-case rule confirmed with the developer.
  return new Set([entrySide]);
}

module.exports = { SIDES, OPPOSITE_SIDE, computeDoorLayout };
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/doorLayout.test.js
```
Expected: PASS（7 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/doorLayout.js server/test/game/doorLayout.test.js
git commit -m "feat(m2a): add door layout calculation with conflict fallback"
```

---

### Task 3: 版圖狀態管理（boardGenerator.js）

**Files:**
- Create: `server/src/game/boardGenerator.js`
- Test: `server/test/game/boardGenerator.test.js`

**Interfaces:**
- Consumes: `SIDES`、`OPPOSITE_SIDE`、`computeDoorLayout` from Task 2 (`./doorLayout`)
- Produces:
  - `coordKey(x: number, y: number): string`（格式 `"x,y"`）
  - `createBoard(startingRooms: Array<{id, name, floor, stairsTo?}>): { ground: Map, upper: Map, stairsLink: { groundRoomId, upperRoomId } }`——`ground`/`upper` 的 Map 是 `coordKey → { roomId, x, y, doorSides: string[] }`，起始房間固定放置：大門廳 `(0,0)`、廊廳 `(4,0)`、梯廳 `(-4,0)`（皆一樓），二樓平台 `(0,0)`（二樓），四個起始房間的 `doorSides` 都是全部 4 個方向
  - `placeNewRoom(board, floor: 'ground'|'upper', fromCoord: {x,y}, direction: 'north'|'east'|'south'|'west', roomDefinition: {id, doors}): { roomId, x, y, doorSides: string[] }`——把 `roomDefinition` 放置到 `fromCoord` 往 `direction`方向的下一格，回傳放置後的房間物件，同時把它加進對應樓層的 Map 裡；`roomDefinition.doors` 不是 1~4 的整數時拋出 `INVALID_ROOM_DOORS`；目標座標已經有房間時拋出 `ROOM_ALREADY_PLACED`

- [ ] **Step 1: Write the failing test**

`server/test/game/boardGenerator.test.js`
```js
const { createBoard, placeNewRoom, coordKey } = require('../../src/game/boardGenerator');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

test('createBoard places the four starting rooms at their fixed coordinates', () => {
  const board = createBoard(STARTING_ROOMS);

  expect(board.ground.get(coordKey(0, 0)).roomId).toBe('room_entrance_hall');
  expect(board.ground.get(coordKey(4, 0)).roomId).toBe('room_foyer');
  expect(board.ground.get(coordKey(-4, 0)).roomId).toBe('room_grand_staircase');
  expect(board.upper.get(coordKey(0, 0)).roomId).toBe('room_upper_landing');
  expect(board.stairsLink).toEqual({
    groundRoomId: 'room_grand_staircase',
    upperRoomId: 'room_upper_landing',
  });
});

test('placeNewRoom places a room at the correct coordinate for each direction', () => {
  const board = createBoard(STARTING_ROOMS);

  const north = placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'north', { id: 'room_a', doors: 4 });
  expect(north).toMatchObject({ roomId: 'room_a', x: 0, y: -1 });

  const east = placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'east', { id: 'room_b', doors: 4 });
  expect(east).toMatchObject({ roomId: 'room_b', x: 1, y: 0 });

  expect(board.ground.get(coordKey(0, -1)).roomId).toBe('room_a');
  expect(board.ground.get(coordKey(1, 0)).roomId).toBe('room_b');
});

test('placeNewRoom always includes a door on the side facing back toward the entry room', () => {
  const board = createBoard(STARTING_ROOMS);
  // Moving south from entrance hall — the new room's entry side is north
  // (the side facing back toward where the player came from).
  const placed = placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'south', { id: 'room_c', doors: 1 });
  expect(placed.doorSides).toEqual(['north']);
});

test('placeNewRoom resolves conflicts against an already-placed neighbor', () => {
  const board = createBoard(STARTING_ROOMS);
  // Manually place a neighbor at (1,-1) with no door on its south side.
  // That south side faces the room we're about to place at (1,0).
  board.ground.set(coordKey(1, -1), { roomId: 'room_neighbor', x: 1, y: -1, doorSides: ['west'] });

  // Place a new room east of entrance hall (0,0) -> lands at (1,0).
  // Entry side (west, facing entrance hall) is always a door. Requesting
  // doors: 4 would normally put a door on every side, but the north side
  // conflicts with room_neighbor's wall there on every attempt (doors: 4
  // always wants all three non-entry sides), so the fallback drops every
  // non-entry side instead of just the conflicting one.
  const placed = placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'east', { id: 'room_c', doors: 4 });
  expect(placed.doorSides).toContain('west');
  expect(placed.doorSides).not.toContain('north');
});

test('placeNewRoom throws INVALID_ROOM_DOORS for a malformed door count', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() =>
    placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'north', { id: 'room_bad', doors: null })
  ).toThrow('INVALID_ROOM_DOORS');
});

test('placeNewRoom throws ROOM_ALREADY_PLACED when the target coordinate is occupied', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(() =>
    placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'north', { id: 'room_dup', doors: 4 })
  ).not.toThrow(); // lands at (0,-1), empty
  expect(() =>
    placeNewRoom(board, 'ground', { x: 0, y: -2 }, 'south', { id: 'room_dup2', doors: 4 })
  ).toThrow('ROOM_ALREADY_PLACED'); // also lands at (0,-1), now occupied
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/boardGenerator.test.js
```
Expected: FAIL，因為 `../../src/game/boardGenerator` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/game/boardGenerator.js`
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

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/boardGenerator.test.js
```
Expected: PASS（6 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/boardGenerator.js server/test/game/boardGenerator.test.js
git commit -m "feat(m2a): add board generator with starting rooms and room placement"
```

---

### Task 4: 玩家實體（playerEntity.js）

**Files:**
- Create: `server/src/game/playerEntity.js`
- Test: `server/test/game/playerEntity.test.js`

**Interfaces:**
- Consumes: 無
- Produces:
  - `STATS: string[]`（`['might', 'speed', 'knowledge', 'sanity']`）
  - `createPlayer({ playerId, name, floor, x, y, stats, actionPoints }): Player`——`stats` 參數格式 `{ might: {current, max, skullValue}, speed: {...}, knowledge: {...}, sanity: {...} }`，回傳的 `Player.stats[stat]` 格式為 `{ current, max, skullValue, overflow }`
  - `changeStat(player: Player, stat: string, delta: number, hauntStarted: boolean): void`——正 `delta` 增加屬性（超過 `max` 的部分累加進 `overflow`）；負 `delta` 減少屬性（優先消耗 `overflow`，屬性不會低於 `hauntStarted ? skullValue : skullValue + 1`）；`stat` 不是 `STATS` 之一時拋出 `UNKNOWN_STAT`
  - `resetActionPoints(player: Player): void`——把 `player.actionPoints` 設為 `player.stats.speed.current`
  - `movePlayerTo(player: Player, floor: string, x: number, y: number): void`

- [ ] **Step 1: Write the failing test**

`server/test/game/playerEntity.test.js`
```js
const { STATS, createPlayer, changeStat, resetActionPoints, movePlayerTo } = require('../../src/game/playerEntity');

function makeStats() {
  return {
    might: { current: 3, max: 5, skullValue: 0 },
    speed: { current: 4, max: 5, skullValue: 0 },
    knowledge: { current: 2, max: 5, skullValue: 0 },
    sanity: { current: 3, max: 5, skullValue: 0 },
  };
}

test('STATS lists the four attribute names', () => {
  expect(STATS).toEqual(['might', 'speed', 'knowledge', 'sanity']);
});

test('createPlayer builds a player with the given stats, position, and action points', () => {
  const player = createPlayer({
    playerId: 'p1',
    name: 'Alice',
    floor: 'ground',
    x: 0,
    y: 0,
    stats: makeStats(),
    actionPoints: 0,
  });
  expect(player.playerId).toBe('p1');
  expect(player.stats.might).toEqual({ current: 3, max: 5, skullValue: 0, overflow: 0 });
  expect(player.inventory).toEqual([]);
});

test('changeStat increases a stat up to its max', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'might', 1, false);
  expect(player.stats.might.current).toBe(4);
});

test('changeStat records overflow when increasing past max', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'speed', 3, false); // current 4 + 3 = 7, max 5 -> current=5, overflow=2
  expect(player.stats.speed.current).toBe(5);
  expect(player.stats.speed.overflow).toBe(2);
});

test('changeStat consumes overflow before reducing current', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'speed', 3, false); // current=5, overflow=2
  changeStat(player, 'speed', -1, false); // consumes 1 from overflow
  expect(player.stats.speed.current).toBe(5);
  expect(player.stats.speed.overflow).toBe(1);
});

test('changeStat does not drop a stat to skull level before the haunt starts', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'knowledge', -10, false);
  expect(player.stats.knowledge.current).toBe(1); // skullValue(0) + 1, floored
});

test('changeStat allows a stat to reach skull level after the haunt starts', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'knowledge', -10, true);
  expect(player.stats.knowledge.current).toBe(0); // skullValue itself, floored
});

test('changeStat throws UNKNOWN_STAT for an invalid stat name', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(() => changeStat(player, 'agility', 1, false)).toThrow('UNKNOWN_STAT');
});

test('resetActionPoints sets action points to the current speed value', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'speed', 1, false); // speed 4 -> 5
  resetActionPoints(player);
  expect(player.actionPoints).toBe(5);
});

test('movePlayerTo updates floor and coordinates', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  movePlayerTo(player, 'upper', 2, -1);
  expect(player.floor).toBe('upper');
  expect(player.x).toBe(2);
  expect(player.y).toBe(-1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/playerEntity.test.js
```
Expected: FAIL，因為 `../../src/game/playerEntity` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/game/playerEntity.js`
```js
const STATS = ['might', 'speed', 'knowledge', 'sanity'];

function createPlayer({ playerId, name, floor, x, y, stats, actionPoints }) {
  const statTracks = {};
  for (const stat of STATS) {
    const def = stats[stat];
    statTracks[stat] = {
      current: def.current,
      max: def.max,
      skullValue: def.skullValue,
      overflow: 0,
    };
  }
  return {
    playerId,
    name,
    floor,
    x,
    y,
    stats: statTracks,
    actionPoints,
    inventory: [],
  };
}

function changeStat(player, stat, delta, hauntStarted) {
  const track = player.stats[stat];
  if (!track) {
    throw new Error('UNKNOWN_STAT');
  }
  if (delta > 0) {
    const room = track.max - track.current;
    if (delta <= room) {
      track.current += delta;
    } else {
      track.current = track.max;
      track.overflow += delta - room;
    }
  } else if (delta < 0) {
    let amount = -delta;
    const fromOverflow = Math.min(track.overflow, amount);
    track.overflow -= fromOverflow;
    amount -= fromOverflow;
    const floor = hauntStarted ? track.skullValue : track.skullValue + 1;
    track.current = Math.max(track.current - amount, floor);
  }
}

function resetActionPoints(player) {
  player.actionPoints = player.stats.speed.current;
}

function movePlayerTo(player, floor, x, y) {
  player.floor = floor;
  player.x = x;
  player.y = y;
}

module.exports = { STATS, createPlayer, changeStat, resetActionPoints, movePlayerTo };
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/playerEntity.test.js
```
Expected: PASS（10 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/playerEntity.js server/test/game/playerEntity.test.js
git commit -m "feat(m2a): add player entity with stat tracks, overflow, and skull-level floor"
```

---

### Task 5: 遊戲狀態容器（gameState.js）

**Files:**
- Create: `server/src/game/gameState.js`
- Test: `server/test/game/gameState.test.js`

**Interfaces:**
- Consumes: `createBoard` from Task 3 (`./boardGenerator`)；`createPlayer`, `resetActionPoints` from Task 4 (`./playerEntity`)
- Produces:
  - `createGameState(startingRooms): GameState`——`GameState = { board, players: Map<playerId, Player>, hauntStarted: false, omenCount: 0 }`
  - `addPlayer(gameState, { playerId, name, stats }): Player`——新玩家固定放在一樓大門廳 `(0,0)`，並呼叫 `resetActionPoints`
  - `getPlayer(gameState, playerId): Player | undefined`

- [ ] **Step 1: Write the failing test**

`server/test/game/gameState.test.js`
```js
const { createGameState, addPlayer, getPlayer } = require('../../src/game/gameState');

const STARTING_ROOMS = [
  { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
  { id: 'room_foyer', name: '廊廳', floor: 'ground' },
  { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
];

function makeStats() {
  return {
    might: { current: 3, max: 5, skullValue: 0 },
    speed: { current: 4, max: 5, skullValue: 0 },
    knowledge: { current: 2, max: 5, skullValue: 0 },
    sanity: { current: 3, max: 5, skullValue: 0 },
  };
}

test('createGameState builds a board and an empty player map', () => {
  const gameState = createGameState(STARTING_ROOMS);
  expect(gameState.players.size).toBe(0);
  expect(gameState.hauntStarted).toBe(false);
  expect(gameState.omenCount).toBe(0);
  expect(gameState.board.ground.get('0,0').roomId).toBe('room_entrance_hall');
});

test('addPlayer places the new player at the entrance hall with action points set', () => {
  const gameState = createGameState(STARTING_ROOMS);
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  expect(player.floor).toBe('ground');
  expect(player.x).toBe(0);
  expect(player.y).toBe(0);
  expect(player.actionPoints).toBe(4); // equals speed.current
  expect(gameState.players.get('p1')).toBe(player);
});

test('getPlayer returns the player by id, or undefined if not found', () => {
  const gameState = createGameState(STARTING_ROOMS);
  addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  expect(getPlayer(gameState, 'p1').name).toBe('Alice');
  expect(getPlayer(gameState, 'unknown')).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/gameState.test.js
```
Expected: FAIL，因為 `../../src/game/gameState` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/game/gameState.js`
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

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/gameState.test.js
```
Expected: PASS（3 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/gameState.js server/test/game/gameState.test.js
git commit -m "feat(m2a): add game state container tying board and players together"
```

---

## 完成後的整體驗收

- [ ] `cd server && npx jest test/game` 全部通過（Task 1-5 共 29 個測試）
- [ ] `cd server && npx jest` 全部通過（含 M1 既有的 26 個測試，共 55 個）
- [ ] M2a 完成後，下一步是撰寫 M2b（提問協定＋回合流程）的詳細實作計畫，屆時會依 M2a 實際完成的程式碼介面（`gameState`、`playerEntity`、`boardGenerator`）為基礎延伸

## 已知的範圍外事項（非本計畫要解決，記錄供後續參考）

- `data/rooms/rooms.json` 的 `doors` 欄位目前仍是 `null`，要等開發者填完才能用真實內容跑完整遊戲；本計畫的測試全部使用自建 fixture，不受影響
- 角色屬性的實際數值（`current`/`max`/`skullValue`）目前是測試用的假資料；真實的角色卡資料（山中小屋有多位可選角色，各自不同的屬性起始值/上限）尚未蒐集，這是後續需要跟開發者一起整理的內容，做法會比照事件/道具/預兆卡（開發者提供實體卡片內容）
