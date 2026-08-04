# M2b-2：Socket.IO 事件層整合＋除錯用測試頁面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 M2b-1 建好的純邏輯模組（`characterSelection.js`、`promptState.js`、`gameManager.js`、`turnFlow.js`、`roomDeck.js`、`gameState.js`）接上 Socket.IO 事件層，讓一整條路徑——大廳 → 房主觸發選角色 → 逐位玩家選角色（含逾時代選）→ 開局 → 回合行動（移動/開門/道具/襲擊/操作/樓梯）→ 廣播最新狀態——第一次可以被真實 client 觸發並運作。新增一個簡易除錯用測試頁面，讓開發者能在正式遊戲介面完成前實際點選驗證。

**Architecture:** 新增 `server/src/game/characterSelectionManager.js`（`roomCode -> {characterSelectionState, promptState}`，選角色完成即丟棄），跟既有的 `LobbyManager`（管大廳）、`GameManager`（管已開局的 `gameState`）三者並列，各自職責單一。內容資料（角色/房間）在伺服器啟動時載入一次，以參數傳入 `registerSocketHandlers`，不在每次事件觸發時重新讀檔（也讓測試可以注入 fixture 資料，不用碰真實 `data/` 檔案）。回合內動作（移動/選動作/樓梯）本次採直接事件呼叫，不套用兩層 20 秒倒數提問流程（那是之後的階段）。

**Tech Stack:** Node.js（>=18）、Express、Socket.IO、純 JavaScript（CommonJS，server 端）、React (Vite)（client 端）、Jest。延續 M1/M2a/M2b-1 的檔案結構與防呆慣例。

## Global Constraints

- 純 JavaScript（CommonJS `require`/`module.exports`，server 端），不使用 TypeScript
- 所有函式對不合法輸入要拋出清楚的 `Error`（訊息用大寫底線字串），不要靜默失敗或回傳 `undefined`——延續 M1/M2a/M2b-1 建立、開發者已明確裁定優先於任何計畫附帶程式碼的專案慣例
- 純邏輯模組（`characterSelectionManager.js`）的測試一律使用自建 fixture，不讀真實 `data/` 檔案；Socket.IO 事件層測試延續 M1 建立的「起真實 server + 多個 client 連線互動」整合測試模式
- **選角色階段狀態存放（本次會話確認）**：`characterSelectionManager.js` 只在選角色期間存在，選完即丟棄；`promptState` 只在選角色階段使用，`gameState` 本次不掛 `promptState` 欄位（回合流程尚未套用提問系統）
- **回合行動事件本次採直接呼叫，不套兩層 20 秒提問流程**（`turn-flow-and-action-points.md` 描述的完整提問式回合流程留給之後的階段）
- **`pendingCardDraw`／`selectAction` 的 `pending:true`不塞進通用狀態廣播**，各自對應獨立命名的廣播事件（`game:pendingCardDraw`／`game:pendingAction`），供 M2c/M3 之後接手
- 完整背景與所有決策記錄見 [docs/superpowers/specs/2026-08-04-m2b2-socket-integration-design.md](../specs/2026-08-04-m2b2-socket-integration-design.md)

---

## 檔案結構

```
server/src/lobbyManager.js                       # M1 既有，本次擴充：房主追蹤
server/src/index.js                               # M1 既有，本次擴充：載入內容資料、建立新的 Manager
server/src/socketHandlers.js                      # M1 既有，本次擴充：選角色事件、回合行動事件
server/src/game/characterSelectionManager.js      # 新增：選角色階段狀態容器

server/test/lobbyManager.test.js                  # M1 既有，本次擴充
server/test/socketHandlers.test.js                # M1 既有，本次擴充
server/test/game/characterSelectionManager.test.js # 新增

client/src/DebugGameScreen.jsx                    # 新增：除錯用測試頁面
client/src/LobbyScreen.jsx                        # M1 既有，本次擴充：捕捉 playerId、切換到除錯頁面
```

---

### Task 1: LobbyManager 房主追蹤

**Files:**
- Modify: `server/src/lobbyManager.js`
- Test: `server/test/lobbyManager.test.js`

**Interfaces:**
- Consumes: 無
- Produces（既有介面不變，新增）: `isHost(roomCode: string, playerId: string): boolean`——房間不存在或 `playerId` 不是該房間的 `hostPlayerId` 時回傳 `false`；房間物件內部新增 `hostPlayerId` 欄位（`createRoom` 時設為建立者的 `playerId`）

**現有檔案內容**（`server/src/lobbyManager.js`，供對照修改）：
```js
const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_PLAYER_NAME_LENGTH = 20;

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

function normalizePlayerName(name) {
  if (typeof name !== 'string') {
    throw new Error('INVALID_NAME');
  }
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_PLAYER_NAME_LENGTH) {
    throw new Error('INVALID_NAME');
  }
  return trimmed;
}

class LobbyManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> { players: Map(playerId -> { name, socketId }) }
  }

  createRoom(hostName, hostSocketId) {
    const name = normalizePlayerName(hostName);
    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (this.rooms.has(roomCode));

    const playerId = generatePlayerId();
    this.rooms.set(roomCode, {
      players: new Map([[playerId, { name, socketId: hostSocketId }]]),
    });
    return { roomCode, playerId };
  }

  joinRoom(roomCode, playerName, socketId) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new Error('ROOM_NOT_FOUND');
    }
    const name = normalizePlayerName(playerName);
    const playerId = generatePlayerId();
    room.players.set(playerId, { name, socketId });
    return { playerId };
  }

  leaveRoom(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    room.players.delete(playerId);
    if (room.players.size === 0) {
      this.rooms.delete(roomCode);
    }
  }

  getPlayers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    return Array.from(room.players.entries()).map(([playerId, p]) => ({
      playerId,
      name: p.name,
    }));
  }

  findRoomByPlayerId(playerId) {
    for (const [roomCode, room] of this.rooms.entries()) {
      if (room.players.has(playerId)) return roomCode;
    }
    return null;
  }
}

module.exports = { LobbyManager };
```

**現有測試檔內容**（`server/test/lobbyManager.test.js`，供對照）：
```js
const { LobbyManager } = require('../src/lobbyManager');

test('createRoom creates a room with the host as first player', () => {
  const manager = new LobbyManager();
  const { roomCode, playerId } = manager.createRoom('Alice', 'socket-1');

  expect(roomCode).toMatch(/^[A-Z]{4}$/);
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name: 'Alice' }]);
});

test('joinRoom adds a second player to an existing room', () => {
  const manager = new LobbyManager();
  const { roomCode } = manager.createRoom('Alice', 'socket-1');
  const { playerId: bobId } = manager.joinRoom(roomCode, 'Bob', 'socket-2');

  const names = manager.getPlayers(roomCode).map((p) => p.name).sort();
  expect(names).toEqual(['Alice', 'Bob']);
  expect(bobId).toBeTruthy();
});

test('joinRoom throws ROOM_NOT_FOUND for an unknown room code', () => {
  const manager = new LobbyManager();
  expect(() => manager.joinRoom('ZZZZ', 'Bob', 'socket-2')).toThrow('ROOM_NOT_FOUND');
});

test('leaveRoom removes a player, and removes the room once empty', () => {
  const manager = new LobbyManager();
  const { roomCode, playerId } = manager.createRoom('Alice', 'socket-1');
  const { playerId: bobId } = manager.joinRoom(roomCode, 'Bob', 'socket-2');

  manager.leaveRoom(roomCode, bobId);
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name: 'Alice' }]);

  manager.leaveRoom(roomCode, playerId);
  expect(manager.getPlayers(roomCode)).toEqual([]);
});

test('findRoomByPlayerId finds the room a player belongs to, or null', () => {
  const manager = new LobbyManager();
  const { roomCode, playerId } = manager.createRoom('Alice', 'socket-1');

  expect(manager.findRoomByPlayerId(playerId)).toBe(roomCode);
  expect(manager.findRoomByPlayerId('unknown-id')).toBeNull();
});

test('createRoom trims a valid name with surrounding whitespace', () => {
  const manager = new LobbyManager();
  const { roomCode, playerId } = manager.createRoom('  Alice  ', 'socket-1');
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name: 'Alice' }]);
});

test.each([
  ['undefined', undefined],
  ['null', null],
  ['empty string', ''],
  ['whitespace only', '   '],
  ['non-string', 42],
  ['too long', 'a'.repeat(21)],
])('createRoom rejects an invalid name (%s)', (_label, badName) => {
  const manager = new LobbyManager();
  expect(() => manager.createRoom(badName, 'socket-1')).toThrow('INVALID_NAME');
});

test('createRoom accepts a name at the 20-character length cap', () => {
  const manager = new LobbyManager();
  const name = 'a'.repeat(20);
  const { roomCode, playerId } = manager.createRoom(name, 'socket-1');
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name }]);
});

test('joinRoom rejects an invalid name', () => {
  const manager = new LobbyManager();
  const { roomCode } = manager.createRoom('Alice', 'socket-1');
  expect(() => manager.joinRoom(roomCode, '   ', 'socket-2')).toThrow('INVALID_NAME');
});
```

- [ ] **Step 1: Write the failing test**

Append to `server/test/lobbyManager.test.js` at the end of the file:
```js

test('isHost returns true only for the player who created the room', () => {
  const manager = new LobbyManager();
  const { roomCode, playerId: hostId } = manager.createRoom('Alice', 'socket-1');
  const { playerId: bobId } = manager.joinRoom(roomCode, 'Bob', 'socket-2');

  expect(manager.isHost(roomCode, hostId)).toBe(true);
  expect(manager.isHost(roomCode, bobId)).toBe(false);
});

test('isHost returns false for an unknown room code', () => {
  const manager = new LobbyManager();
  expect(manager.isHost('ZZZZ', 'anyone')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/lobbyManager.test.js
```
Expected: FAIL——`isHost` 尚未定義。

- [ ] **Step 3: Write minimal implementation**

In `server/src/lobbyManager.js`, change `createRoom` from:
```js
  createRoom(hostName, hostSocketId) {
    const name = normalizePlayerName(hostName);
    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (this.rooms.has(roomCode));

    const playerId = generatePlayerId();
    this.rooms.set(roomCode, {
      players: new Map([[playerId, { name, socketId: hostSocketId }]]),
    });
    return { roomCode, playerId };
  }
```
to:
```js
  createRoom(hostName, hostSocketId) {
    const name = normalizePlayerName(hostName);
    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (this.rooms.has(roomCode));

    const playerId = generatePlayerId();
    this.rooms.set(roomCode, {
      players: new Map([[playerId, { name, socketId: hostSocketId }]]),
      hostPlayerId: playerId,
    });
    return { roomCode, playerId };
  }
```

Then add this method anywhere inside the `LobbyManager` class (e.g. right after `findRoomByPlayerId`):
```js
  isHost(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;
    return room.hostPlayerId === playerId;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/lobbyManager.test.js
```
Expected: PASS（11 個測試全過：既有 9 個＋新增 2 個）

- [ ] **Step 5: Commit**

```bash
git add server/src/lobbyManager.js server/test/lobbyManager.test.js
git commit -m "feat(m2b2): track room host in LobbyManager"
```

---

### Task 2: 選角色階段狀態容器（characterSelectionManager.js）

**Files:**
- Create: `server/src/game/characterSelectionManager.js`
- Test: `server/test/game/characterSelectionManager.test.js`

**Interfaces:**
- Consumes: `createCharacterSelectionState` from `./characterSelection`；`createPromptState` from `./promptState`
- Produces:
  - `createCharacterSelectionManager(): Manager`——`{ selections: Map<string, Entry> }`
  - `startSelection(manager, roomCode: string, playerIds: Array<string>, characters: Array<object>): Entry`——`Entry = { characterSelectionState, promptState }`；`roomCode` 已經有進行中的選角色時拋出 `SELECTION_ALREADY_STARTED`；`playerIds`/`characters` 不合法時，直接讓 `createCharacterSelectionState` 拋出的 `TOO_FEW_PLAYERS`/`INVALID_CHARACTER_LIST` 往外傳（不重複驗證）
  - `getSelection(manager, roomCode): Entry | undefined`
  - `endSelection(manager, roomCode): void`——找不到也不報錯

- [ ] **Step 1: Write the failing test**

`server/test/game/characterSelectionManager.test.js`
```js
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
  expect(() => startSelection(manager, 'ROOM1', ['p1'], makeCharacters())).toThrow('TOO_FEW_PLAYERS');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/characterSelectionManager.test.js
```
Expected: FAIL，因為 `../../src/game/characterSelectionManager` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/game/characterSelectionManager.js`
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/game/characterSelectionManager.test.js
```
Expected: PASS（6 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/characterSelectionManager.js server/test/game/characterSelectionManager.test.js
git commit -m "feat(m2b2): add character selection phase state container"
```

---

### Task 3: Socket.IO 選角色事件（socketHandlers.js 擴充＋index.js 佈線）

**Files:**
- Modify: `server/src/socketHandlers.js`
- Modify: `server/src/index.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `isHost` from Task 1 (`./lobbyManager`)；`createCharacterSelectionManager`, `startSelection`, `getSelection`, `endSelection` from Task 2 (`./game/characterSelectionManager`)；`getCurrentPicker`, `getAvailableCharacterIds`, `confirmCharacterChoice`, `assignRandomCharacter`, `isCharacterSelectionComplete`, `getAssignments` from `./game/characterSelection`（M2b-1 既有）；`createPrompt`, `respondToPrompt`, `resolvePromptTimeout` from `./game/promptState`（M2b-1 既有）；`createGameManager`, `startGame`, `getGameState` from `./game/gameManager`（M2b-1 既有）；`serializeGameState` from `./game/gameState`（M2b-1 既有）
- Produces:
  - `registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, content: {characters, rooms, startingRooms}, options?: {characterSelectTimeoutMs?: number})`——**簽名變更**（新增 `gameManager`、`characterSelectionManager`、`content`、`options` 四個參數）；`content` 由呼叫端（`index.js`）在伺服器啟動時讀檔一次後傳入，事件處理不重新讀檔；`options.characterSelectTimeoutMs` 預設 `30000`，供測試注入較短的逾時秒數
  - Socket 事件（新增）：`game:startCharacterSelect`（client→server，房主限定）、`game:promptRespond`（client→server，沿用通用提問協定）、`game:prompt`／`game:promptResolved`／`game:characterSelectUpdate`／`game:started`（server→room 廣播）

**現有檔案內容**（`server/src/socketHandlers.js`，供對照修改）：
```js
function registerSocketHandlers(io, lobbyManager) {
  io.on('connection', (socket) => {
    socket.on('lobby:create', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { playerName } = payload || {};
        if (socket.data.roomCode) {
          return ack({ error: 'ALREADY_IN_ROOM' });
        }
        const { roomCode, playerId } = lobbyManager.createRoom(playerName, socket.id);
        socket.data.roomCode = roomCode;
        socket.data.playerId = playerId;
        socket.join(roomCode);
        ack({ roomCode, playerId });
        broadcastPlayers(io, lobbyManager, roomCode);
      } catch (err) {
        console.error('lobby:create error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('lobby:join', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerName } = payload || {};
        if (socket.data.roomCode) {
          return ack({ error: 'ALREADY_IN_ROOM' });
        }
        const { playerId } = lobbyManager.joinRoom(roomCode, playerName, socket.id);
        socket.data.roomCode = roomCode;
        socket.data.playerId = playerId;
        socket.join(roomCode);
        ack({ playerId, roomCode });
        broadcastPlayers(io, lobbyManager, roomCode);
      } catch (err) {
        console.error('lobby:join error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('disconnect', () => {
      const { roomCode, playerId } = socket.data;
      if (roomCode && playerId) {
        lobbyManager.leaveRoom(roomCode, playerId);
        broadcastPlayers(io, lobbyManager, roomCode);
      }
    });
  });
}

function broadcastPlayers(io, lobbyManager, roomCode) {
  io.to(roomCode).emit('lobby:players', { players: lobbyManager.getPlayers(roomCode) });
}

module.exports = { registerSocketHandlers };
```

**現有檔案內容**（`server/src/index.js`，供對照修改）：
```js
const { createServer } = require('./createServer');
const { LobbyManager } = require('./lobbyManager');
const { registerSocketHandlers } = require('./socketHandlers');

const PORT = process.env.PORT || 3001;
const { httpServer, io } = createServer();
const lobbyManager = new LobbyManager();
registerSocketHandlers(io, lobbyManager);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`伺服器已啟動：http://0.0.0.0:${PORT}`);
});
```

**現有測試檔內容**（`server/test/socketHandlers.test.js`，供對照——本任務只在檔案最上方的 `startTestServer` helper 加參數，其餘既有測試不動；完整既有測試內容略，實作者請直接讀取現有檔案）

- [ ] **Step 1: Write the failing test**

First, modify the top of `server/test/socketHandlers.test.js` — change the imports and `startTestServer` helper from:
```js
const ioClient = require('socket.io-client');
const { createServer } = require('../src/createServer');
const { LobbyManager } = require('../src/lobbyManager');
const { registerSocketHandlers } = require('../src/socketHandlers');

function startTestServer() {
  const { httpServer, io } = createServer();
  const lobbyManager = new LobbyManager();
  registerSocketHandlers(io, lobbyManager);
  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      resolve({ httpServer, port: httpServer.address().port });
    });
  });
}
```
to:
```js
const ioClient = require('socket.io-client');
const { createServer } = require('../src/createServer');
const { LobbyManager } = require('../src/lobbyManager');
const { registerSocketHandlers } = require('../src/socketHandlers');
const { createGameManager } = require('../src/game/gameManager');
const { createCharacterSelectionManager } = require('../src/game/characterSelectionManager');

function makeContent(overrides = {}) {
  return {
    characters: [
      { id: 'char_001', codename: 'Alice-character', stats: makeStats() },
      { id: 'char_002', codename: 'Bob-character', stats: makeStats() },
    ],
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    startingRooms: [
      { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
      { id: 'room_foyer', name: '廊廳', floor: 'ground' },
      { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
    ],
    ...overrides,
  };
}

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 },
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

function startTestServer(content, options) {
  const { httpServer, io } = createServer();
  const lobbyManager = new LobbyManager();
  const gameManager = createGameManager();
  const characterSelectionManager = createCharacterSelectionManager();
  registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, content || makeContent(), options);
  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      resolve({ httpServer, port: httpServer.address().port, lobbyManager, gameManager, characterSelectionManager });
    });
  });
}
```

**Note:** every existing test in this file calls `startTestServer()` with no arguments — since the new signature's parameters are optional (defaulting to `makeContent()`), those existing calls keep working unchanged.

Then append these new tests at the end of the file:
```js

test('game:startCharacterSelect full flow: host triggers, both players get prompted in turn, game starts', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => {
    clientA.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });
  const roomCode = created.roomCode;
  const aliceId = created.playerId;

  const clientB = ioClient(url);
  const joined = await new Promise((resolve) => {
    clientB.emit('lobby:join', { roomCode, playerName: 'Bob' }, resolve);
  });
  const bobId = joined.playerId;

  // Non-host (Bob) cannot start selection.
  const rejected = await new Promise((resolve) => {
    clientB.emit('game:startCharacterSelect', {}, resolve);
  });
  expect(rejected.error).toBe('NOT_HOST');

  // game:prompt is a room-wide broadcast — both clients' sockets receive it
  // independently. Wait for BOTH to confirm receipt of prompt #1 before
  // attaching a fresh .once listener for "the next prompt" on whichever
  // client turns out to be the second picker below. A single-client wait
  // here raced against the other client's still-in-flight delivery of this
  // same broadcast (confirmed during this milestone's implementation via
  // repeated diagnostic runs) and made this test fail deterministically
  // whenever Alice was the first picker.
  const firstPromptA = new Promise((resolve) => clientA.once('game:prompt', resolve));
  const firstPromptB = new Promise((resolve) => clientB.once('game:prompt', resolve));
  const startResult = await new Promise((resolve) => {
    clientA.emit('game:startCharacterSelect', {}, resolve);
  });
  expect(startResult.error).toBeUndefined();

  const [prompt1] = await Promise.all([firstPromptA, firstPromptB]);
  expect(['char_001', 'char_002']).toContain(prompt1.options[0]);
  const firstPickerId = prompt1.targetPlayerId;
  const firstPickerClient = firstPickerId === aliceId ? clientA : clientB;
  const secondPickerClient = firstPickerId === aliceId ? clientB : clientA;

  const secondPrompt = new Promise((resolve) => secondPickerClient.once('game:prompt', resolve));
  const gameStarted = new Promise((resolve) => clientA.once('game:started', resolve));

  const respondResult = await new Promise((resolve) => {
    firstPickerClient.emit(
      'game:promptRespond',
      { promptId: prompt1.promptId, optionId: prompt1.options[0] },
      resolve
    );
  });
  expect(respondResult.error).toBeUndefined();

  const prompt2 = await secondPrompt;
  expect(prompt2.options).toHaveLength(1); // only one character left

  await new Promise((resolve) => {
    secondPickerClient.emit(
      'game:promptRespond',
      { promptId: prompt2.promptId, optionId: prompt2.options[0] },
      resolve
    );
  });

  const startedPayload = await gameStarted;
  expect(startedPayload.players).toHaveLength(2);
  expect(startedPayload.turnOrder.slice().sort()).toEqual([aliceId, bobId].sort());

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:startCharacterSelect rejects when fewer than 2 players are in the room', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  await new Promise((resolve) => {
    client.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });

  const result = await new Promise((resolve) => {
    client.emit('game:startCharacterSelect', {}, resolve);
  });
  expect(result.error).toBe('TOO_FEW_PLAYERS');

  client.close();
  httpServer.close();
});

test('game:startCharacterSelect rejects when there are more players than characters', async () => {
  const content = {
    characters: [{ id: 'char_001', codename: 'Solo', stats: makeStats() }],
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    startingRooms: makeContent().startingRooms,
  };
  const { httpServer, port } = await startTestServer(content);
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  const clientB = ioClient(url);
  await new Promise((resolve) =>
    clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve)
  );

  const result = await new Promise((resolve) => {
    clientA.emit('game:startCharacterSelect', {}, resolve);
  });
  expect(result.error).toBe('TOO_MANY_PLAYERS');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('character selection timeout auto-assigns a character and continues the flow', async () => {
  const { httpServer, port } = await startTestServer(makeContent(), { characterSelectTimeoutMs: 50 });
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  const roomCode = created.roomCode;
  const clientB = ioClient(url);
  await new Promise((resolve) => clientB.emit('lobby:join', { roomCode, playerName: 'Bob' }, resolve));

  const resolvedPromise = new Promise((resolve) => clientA.once('game:promptResolved', resolve));
  const secondPromptPromise = new Promise((resolve) => {
    clientA.on('game:prompt', (p) => {
      if (p !== undefined) resolve(p);
    });
  });

  await new Promise((resolve) => clientA.emit('game:startCharacterSelect', {}, resolve));

  const resolved = await resolvedPromise;
  expect(resolved.wasTimeout).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/socketHandlers.test.js
```
Expected: FAIL——`game:startCharacterSelect`/`game:promptRespond` 尚未存在，`registerSocketHandlers` 也還沒接受新參數。

- [ ] **Step 3: Write minimal implementation**

Replace `server/src/socketHandlers.js` entirely with:
```js
const {
  startSelection,
  getSelection: getCharacterSelection,
  endSelection,
} = require('./game/characterSelectionManager');
const {
  getCurrentPicker,
  getAvailableCharacterIds,
  confirmCharacterChoice,
  assignRandomCharacter,
  isCharacterSelectionComplete,
  getAssignments,
} = require('./game/characterSelection');
const { createPrompt, respondToPrompt, resolvePromptTimeout } = require('./game/promptState');
const { startGame, getGameState } = require('./game/gameManager');
const { serializeGameState } = require('./game/gameState');

const DEFAULT_CHARACTER_SELECT_TIMEOUT_MS = 30000;
const characterSelectTimeouts = new Map(); // roomCode -> Timeout handle

function registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, content, options = {}) {
  const characterSelectTimeoutMs = options.characterSelectTimeoutMs || DEFAULT_CHARACTER_SELECT_TIMEOUT_MS;

  io.on('connection', (socket) => {
    socket.on('lobby:create', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { playerName } = payload || {};
        if (socket.data.roomCode) {
          return ack({ error: 'ALREADY_IN_ROOM' });
        }
        const { roomCode, playerId } = lobbyManager.createRoom(playerName, socket.id);
        socket.data.roomCode = roomCode;
        socket.data.playerId = playerId;
        socket.join(roomCode);
        ack({ roomCode, playerId });
        broadcastPlayers(io, lobbyManager, roomCode);
      } catch (err) {
        console.error('lobby:create error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('lobby:join', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerName } = payload || {};
        if (socket.data.roomCode) {
          return ack({ error: 'ALREADY_IN_ROOM' });
        }
        const { playerId } = lobbyManager.joinRoom(roomCode, playerName, socket.id);
        socket.data.roomCode = roomCode;
        socket.data.playerId = playerId;
        socket.join(roomCode);
        ack({ playerId, roomCode });
        broadcastPlayers(io, lobbyManager, roomCode);
      } catch (err) {
        console.error('lobby:join error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:startCharacterSelect', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        if (!lobbyManager.isHost(roomCode, playerId)) {
          return ack({ error: 'NOT_HOST' });
        }
        const players = lobbyManager.getPlayers(roomCode);
        if (players.length < 2) {
          return ack({ error: 'TOO_FEW_PLAYERS' });
        }
        if (players.length > content.characters.length) {
          return ack({ error: 'TOO_MANY_PLAYERS' });
        }
        startSelection(
          characterSelectionManager,
          roomCode,
          players.map((p) => p.playerId),
          content.characters
        );
        ack({});
        advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode, characterSelectTimeoutMs);
      } catch (err) {
        console.error('game:startCharacterSelect error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:promptRespond', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const { promptId, optionId } = payload || {};
        const entry = getCharacterSelection(characterSelectionManager, roomCode);
        if (!entry) {
          return ack({ error: 'NO_ACTIVE_PROMPT' });
        }
        // This handler currently only ever serves character-selection prompts
        // (M2b-2 doesn't add turn-flow prompts yet) — respondToPrompt's own
        // promptId/target-player checks are what actually guard correctness.
        const result = respondToPrompt(entry.promptState, { promptId, playerId, optionId });
        clearCharacterSelectTimeout(roomCode);
        confirmCharacterChoice(entry.characterSelectionState, { playerId, characterId: optionId });
        ack({});
        io.to(roomCode).emit('game:promptResolved', result);
        advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode, characterSelectTimeoutMs);
      } catch (err) {
        console.error('game:promptRespond error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('disconnect', () => {
      const { roomCode, playerId } = socket.data;
      if (roomCode && playerId) {
        lobbyManager.leaveRoom(roomCode, playerId);
        broadcastPlayers(io, lobbyManager, roomCode);
      }
    });
  });
}

function advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode, characterSelectTimeoutMs) {
  const entry = getCharacterSelection(characterSelectionManager, roomCode);
  if (isCharacterSelectionComplete(entry.characterSelectionState)) {
    finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode);
    return;
  }
  const picker = getCurrentPicker(entry.characterSelectionState);
  const available = getAvailableCharacterIds(entry.characterSelectionState);
  const prompt = createPrompt(entry.promptState, {
    type: 'character_select',
    targetPlayerId: picker,
    description: '請選擇角色',
    options: available,
    timeoutMs: characterSelectTimeoutMs,
    now: Date.now(),
  });
  io.to(roomCode).emit('game:prompt', prompt);
  io.to(roomCode).emit('game:characterSelectUpdate', serializeCharacterSelection(entry.characterSelectionState));
  const handle = setTimeout(() => {
    handleCharacterSelectTimeout(
      io,
      lobbyManager,
      gameManager,
      characterSelectionManager,
      content,
      roomCode,
      prompt.promptId,
      picker,
      characterSelectTimeoutMs
    );
  }, characterSelectTimeoutMs);
  characterSelectTimeouts.set(roomCode, handle);
}

function clearCharacterSelectTimeout(roomCode) {
  const handle = characterSelectTimeouts.get(roomCode);
  if (handle) {
    clearTimeout(handle);
    characterSelectTimeouts.delete(roomCode);
  }
}

function handleCharacterSelectTimeout(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode, promptId, playerId, characterSelectTimeoutMs) {
  const entry = getCharacterSelection(characterSelectionManager, roomCode);
  if (!entry) return;
  characterSelectTimeouts.delete(roomCode);
  const characterId = assignRandomCharacter(entry.characterSelectionState, playerId);
  const result = resolvePromptTimeout(entry.promptState, { promptId, defaultOptionId: characterId });
  if (result) {
    io.to(roomCode).emit('game:promptResolved', result);
  }
  advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode, characterSelectTimeoutMs);
}

function finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, content, roomCode) {
  const entry = getCharacterSelection(characterSelectionManager, roomCode);
  const lobbyPlayers = lobbyManager.getPlayers(roomCode);
  const assignments = getAssignments(entry.characterSelectionState);
  const players = lobbyPlayers.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    characterId: assignments.get(p.playerId),
  }));
  endSelection(characterSelectionManager, roomCode);
  const gameState = startGame(gameManager, roomCode, {
    startingRooms: content.startingRooms,
    rooms: content.rooms,
    characters: content.characters,
    players,
  });
  io.to(roomCode).emit('game:started', serializeGameState(gameState));
}

function serializeCharacterSelection(characterSelectionState) {
  return {
    order: characterSelectionState.order,
    currentPicker: getCurrentPicker(characterSelectionState),
    lockedCharacterIds: Array.from(characterSelectionState.lockedCharacterIds),
    assignments: Array.from(characterSelectionState.assignments.entries()).map(([playerId, characterId]) => ({
      playerId,
      characterId,
    })),
    characters: characterSelectionState.characters,
  };
}

function broadcastPlayers(io, lobbyManager, roomCode) {
  io.to(roomCode).emit('lobby:players', { players: lobbyManager.getPlayers(roomCode) });
}

module.exports = { registerSocketHandlers };
```

Then replace `server/src/index.js` entirely with:
```js
const { createServer } = require('./createServer');
const { LobbyManager } = require('./lobbyManager');
const { registerSocketHandlers } = require('./socketHandlers');
const { createGameManager } = require('./game/gameManager');
const { createCharacterSelectionManager } = require('./game/characterSelectionManager');
const { loadCharacters, loadRooms, loadStartingRooms } = require('./game/contentLoader');

const PORT = process.env.PORT || 3001;
const { httpServer, io } = createServer();
const lobbyManager = new LobbyManager();
const gameManager = createGameManager();
const characterSelectionManager = createCharacterSelectionManager();
const content = {
  characters: loadCharacters(),
  rooms: loadRooms(),
  startingRooms: loadStartingRooms(),
};
registerSocketHandlers(io, lobbyManager, gameManager, characterSelectionManager, content);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`伺服器已啟動：http://0.0.0.0:${PORT}`);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/socketHandlers.test.js
```
Expected: PASS（既有 11 個＋新增 4 個＝15 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/socketHandlers.js server/src/index.js server/test/socketHandlers.test.js
git commit -m "feat(m2b2): wire character selection flow into Socket.IO events"
```

---

### Task 4: Socket.IO 回合行動事件（socketHandlers.js 擴充）

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `moveToRoom`, `selectAction`, `useStairs`, `isTurnOver`, `advanceTurn` from `./game/turnFlow`（M2b-1 既有）
- Produces: Socket 事件（新增）：`game:move`、`game:selectAction`、`game:useStairs`（client→server）；`game:stateUpdate`、`game:pendingCardDraw`、`game:pendingAction`（server→room 廣播）

- [ ] **Step 1: Write the failing test**

Append to `server/test/socketHandlers.test.js` at the end of the file (this reuses the `startTestServer`/`makeContent`/`makeStats` helpers from Task 3 — do not redefine them):
```js

async function setUpStartedGame() {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  const roomCode = created.roomCode;
  const aliceId = created.playerId;

  const clientB = ioClient(url);
  const joined = await new Promise((resolve) =>
    clientB.emit('lobby:join', { roomCode, playerName: 'Bob' }, resolve)
  );
  const bobId = joined.playerId;

  const started = new Promise((resolve) => clientA.once('game:started', resolve));
  // Same room-wide-broadcast race as the "full flow" test above: wait for
  // BOTH clients to receive prompt #1 before treating a later fresh .once
  // on either client as scoped to "the next prompt only."
  const firstPromptA = new Promise((resolve) => clientA.once('game:prompt', resolve));
  const firstPromptB = new Promise((resolve) => clientB.once('game:prompt', resolve));
  await new Promise((resolve) => clientA.emit('game:startCharacterSelect', {}, resolve));
  const [prompt1] = await Promise.all([firstPromptA, firstPromptB]);
  const firstPickerClient = prompt1.targetPlayerId === aliceId ? clientA : clientB;
  const secondPickerClient = prompt1.targetPlayerId === aliceId ? clientB : clientA;

  const secondPrompt = new Promise((resolve) => secondPickerClient.once('game:prompt', resolve));
  await new Promise((resolve) =>
    firstPickerClient.emit('game:promptRespond', { promptId: prompt1.promptId, optionId: prompt1.options[0] }, resolve)
  );
  const prompt2 = await secondPrompt;
  await new Promise((resolve) =>
    secondPickerClient.emit('game:promptRespond', { promptId: prompt2.promptId, optionId: prompt2.options[0] }, resolve)
  );

  const startedPayload = await started;
  const currentPlayerId = startedPayload.turnOrder[startedPayload.currentPlayerIndex];
  const currentClient = currentPlayerId === aliceId ? clientA : clientB;
  const otherClient = currentPlayerId === aliceId ? clientB : clientA;

  return { httpServer, clientA, clientB, roomCode, aliceId, bobId, currentClient, otherClient, currentPlayerId, startedPayload };
}

test('game:move to open a door places a room, zeroes AP, and broadcasts game:stateUpdate', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => {
    currentClient.emit('game:move', { direction: 'east' }, resolve);
  });
  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('open_door');

  const update = await updatePromise;
  const movedPlayer = update.players.find((p) => p.x === 1 && p.y === 0);
  expect(movedPlayer).toBeTruthy();
  expect(movedPlayer.actionPoints).toBe(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move rejects a caller who is not the current turn player', async () => {
  const { httpServer, clientA, clientB, otherClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    otherClient.emit('game:move', { direction: 'east' }, resolve);
  });
  expect(result.error).toBe('NOT_YOUR_TURN');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction spends 1 action point, broadcasts game:pendingAction, and updates state', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const pendingActionPromise = new Promise((resolve) => currentClient.once('game:pendingAction', resolve));
  const result = await new Promise((resolve) => {
    currentClient.emit('game:selectAction', { actionType: 'item' }, resolve);
  });
  expect(result.error).toBeUndefined();
  expect(result).toEqual({ kind: 'item', pending: true });

  const pendingAction = await pendingActionPromise;
  expect(pendingAction.actionType).toBe('item');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:useStairs is rejected when the player is not standing at the stairs link', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    currentClient.emit('game:useStairs', {}, resolve);
  });
  expect(result.error).toBe('STAIRS_NOT_AVAILABLE');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('when a move exhausts action points, the turn automatically advances to the next player', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGame();

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // zeroes AP
  const update = await updatePromise;

  expect(update.turnOrder[update.currentPlayerIndex]).not.toBe(currentPlayerId);
  // The new current player's action points must have been reset (advanceTurn's job).
  const newCurrentPlayer = update.players.find((p) => p.playerId === update.turnOrder[update.currentPlayerIndex]);
  expect(newCurrentPlayer.actionPoints).toBeGreaterThan(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/socketHandlers.test.js
```
Expected: FAIL——`game:move`/`game:selectAction`/`game:useStairs` 尚未存在。

- [ ] **Step 3: Write minimal implementation**

In `server/src/socketHandlers.js`, add this line to the top requires (alongside the existing ones):
```js
const { moveToRoom, selectAction, useStairs, isTurnOver, advanceTurn } = require('./game/turnFlow');
```

Also change the existing gameState require line from:
```js
const { serializeGameState } = require('./game/gameState');
```
to:
```js
const { serializeGameState, getPlayer } = require('./game/gameState');
```

Then, inside `registerSocketHandlers`'s `io.on('connection', (socket) => { ... })` block, add these three handlers (placed after the existing `game:promptRespond` handler and before `socket.on('disconnect', ...)`):
```js
    socket.on('game:move', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const gameState = getGameState(gameManager, roomCode);
        if (!gameState) {
          return ack({ error: 'GAME_NOT_STARTED' });
        }
        const { direction } = payload || {};
        const result = moveToRoom(gameState, playerId, direction);
        ack(result);
        if (result.pendingCardDraw) {
          io.to(roomCode).emit('game:pendingCardDraw', {
            playerId,
            roomId: result.roomId,
            deck: result.pendingCardDraw.deck,
          });
        }
        advanceTurnIfOver(gameState, playerId);
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:move error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:selectAction', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const gameState = getGameState(gameManager, roomCode);
        if (!gameState) {
          return ack({ error: 'GAME_NOT_STARTED' });
        }
        const { actionType } = payload || {};
        const result = selectAction(gameState, playerId, actionType);
        ack(result);
        if (result.pending) {
          io.to(roomCode).emit('game:pendingAction', { playerId, actionType: result.kind });
        }
        advanceTurnIfOver(gameState, playerId);
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:selectAction error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });

    socket.on('game:useStairs', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const gameState = getGameState(gameManager, roomCode);
        if (!gameState) {
          return ack({ error: 'GAME_NOT_STARTED' });
        }
        const result = useStairs(gameState, playerId);
        ack(result);
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:useStairs error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });
```

Then add this helper function anywhere at module level (e.g. right after `clearCharacterSelectTimeout`):
```js
function advanceTurnIfOver(gameState, playerId) {
  const player = getPlayer(gameState, playerId);
  if (isTurnOver(player)) {
    advanceTurn(gameState);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/socketHandlers.test.js
```
Expected: PASS（20 個測試全過：Task 3 完成後的 15 個＋新增 5 個）

- [ ] **Step 5: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(m2b2): wire turn-flow actions (move/selectAction/useStairs) into Socket.IO events"
```

---

### Task 5: 除錯用測試頁面（client）

**Files:**
- Create: `client/src/DebugGameScreen.jsx`
- Modify: `client/src/LobbyScreen.jsx`

**Interfaces:**
- Consumes: 既有的 `createSocket` from `./socket`；Task 3/4 定義的 Socket 事件名稱（`game:startCharacterSelect`/`game:promptRespond`/`game:move`/`game:selectAction`/`game:useStairs`，以及 `game:prompt`/`game:promptResolved`/`game:characterSelectUpdate`/`game:started`/`game:stateUpdate`/`game:pendingCardDraw`/`game:pendingAction`）
- Produces: `DebugGameScreen` React 元件，props：`{ socket, roomCode, playerId }`

這個任務沒有自動化測試（純 UI，人工點選驗證），但完成後請照下方「Step 4」的操作步驟親自跑一次確認畫面運作正常。

**現有檔案內容**（`client/src/LobbyScreen.jsx`，供對照修改）：
```jsx
import { useState, useEffect, useRef } from 'react';
import { createSocket } from './socket';

const ERROR_MESSAGES = {
  ROOM_NOT_FOUND: '找不到這個房號，請確認後再試一次',
  INVALID_NAME: '暱稱不可為空白，且長度不可超過 20 個字',
  ALREADY_IN_ROOM: '您已經在房間內了',
};

function translateError(code) {
  return ERROR_MESSAGES[code] || '發生未知錯誤，請稍後再試';
}

export default function LobbyScreen() {
  const socketRef = useRef(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('lobby:players', ({ players }) => setPlayers(players));
    socket.on('disconnect', () => setDisconnected(true));
    return () => socket.close();
  }, []);

  function handleCreate() {
    socketRef.current.emit('lobby:create', { playerName: name }, (res) => {
      if (res.error) {
        setError(translateError(res.error));
        return;
      }
      setRoomCode(res.roomCode);
      setError('');
    });
  }

  function handleJoin() {
    socketRef.current.emit('lobby:join', { roomCode: joinCode, playerName: name }, (res) => {
      if (res.error) {
        setError(translateError(res.error));
        return;
      }
      setRoomCode(res.roomCode);
      setError('');
    });
  }

  if (roomCode) {
    return (
      <div>
        {disconnected && (
          <p style={{ color: 'red' }}>連線已中斷，請重新整理頁面</p>
        )}
        <h2>房號：{roomCode}</h2>
        <h3>目前連線玩家：</h3>
        <ul>
          {players.map((p) => (
            <li key={p.playerId}>{p.name}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      {disconnected && (
        <p style={{ color: 'red' }}>連線已中斷，請重新整理頁面</p>
      )}
      <label>
        暱稱：
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div>
        <button onClick={handleCreate} disabled={!name}>建立房間</button>
      </div>
      <div>
        <input
          placeholder="房號"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
        />
        <button onClick={handleJoin} disabled={!name || !joinCode}>加入房間</button>
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 1: Create the debug screen component**

`client/src/DebugGameScreen.jsx`
```jsx
import { useState, useEffect } from 'react';

export default function DebugGameScreen({ socket, roomCode, playerId }) {
  const [phase, setPhase] = useState('character_select');
  const [prompt, setPrompt] = useState(null);
  const [characterSelectState, setCharacterSelectState] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [lastPromptResolved, setLastPromptResolved] = useState(null);
  const [lastPendingCardDraw, setLastPendingCardDraw] = useState(null);
  const [lastPendingAction, setLastPendingAction] = useState(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    function onPrompt(data) {
      setPrompt(data);
    }
    function onPromptResolved(data) {
      setLastPromptResolved(data);
      setPrompt(null);
    }
    function onCharacterSelectUpdate(data) {
      setCharacterSelectState(data);
    }
    function onStarted(data) {
      setPhase('playing');
      setGameState(data);
    }
    function onStateUpdate(data) {
      setGameState(data);
    }
    function onPendingCardDraw(data) {
      setLastPendingCardDraw(data);
    }
    function onPendingAction(data) {
      setLastPendingAction(data);
    }

    socket.on('game:prompt', onPrompt);
    socket.on('game:promptResolved', onPromptResolved);
    socket.on('game:characterSelectUpdate', onCharacterSelectUpdate);
    socket.on('game:started', onStarted);
    socket.on('game:stateUpdate', onStateUpdate);
    socket.on('game:pendingCardDraw', onPendingCardDraw);
    socket.on('game:pendingAction', onPendingAction);

    return () => {
      socket.off('game:prompt', onPrompt);
      socket.off('game:promptResolved', onPromptResolved);
      socket.off('game:characterSelectUpdate', onCharacterSelectUpdate);
      socket.off('game:started', onStarted);
      socket.off('game:stateUpdate', onStateUpdate);
      socket.off('game:pendingCardDraw', onPendingCardDraw);
      socket.off('game:pendingAction', onPendingAction);
    };
  }, [socket]);

  function handleStartCharacterSelect() {
    socket.emit('game:startCharacterSelect', {}, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  function handlePickCharacter(characterId) {
    if (!prompt) return;
    socket.emit('game:promptRespond', { promptId: prompt.promptId, optionId: characterId }, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  function handleMove(direction) {
    socket.emit('game:move', { direction }, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  function handleSelectAction(actionType) {
    socket.emit('game:selectAction', { actionType }, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  function handleUseStairs() {
    socket.emit('game:useStairs', {}, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  return (
    <div>
      <h2>
        除錯測試頁面（房號：{roomCode}，我的 playerId：{playerId}）
      </h2>
      {actionError && <p style={{ color: 'red' }}>錯誤：{actionError}</p>}

      {phase === 'character_select' && (
        <div>
          <button onClick={handleStartCharacterSelect}>開始選角色</button>
          {characterSelectState && (
            <div>
              <p>目前輪到：{characterSelectState.currentPicker}</p>
              <ul>
                {characterSelectState.characters.map((c) => (
                  <li key={c.id}>
                    {c.id} - {c.codename || '(未命名)'}
                    {characterSelectState.lockedCharacterIds.includes(c.id) ? '（已鎖定）' : ''}
                    {prompt &&
                      prompt.targetPlayerId === playerId &&
                      !characterSelectState.lockedCharacterIds.includes(c.id) && (
                        <button onClick={() => handlePickCharacter(c.id)}>選這個</button>
                      )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {prompt && (
            <p>
              提問中：{prompt.description}（目標：{prompt.targetPlayerId}，倒數至{' '}
              {new Date(prompt.deadline).toLocaleTimeString()}）
            </p>
          )}
          {lastPromptResolved && <p>上一個提問結果：{JSON.stringify(lastPromptResolved)}</p>}
        </div>
      )}

      {phase === 'playing' && (
        <div>
          <h3>移動</h3>
          <button onClick={() => handleMove('north')}>北</button>
          <button onClick={() => handleMove('east')}>東</button>
          <button onClick={() => handleMove('south')}>南</button>
          <button onClick={() => handleMove('west')}>西</button>
          <h3>動作</h3>
          <button onClick={() => handleSelectAction('item')}>道具</button>
          <button onClick={() => handleSelectAction('attack')}>襲擊</button>
          <button onClick={() => handleSelectAction('room_action')}>操作</button>
          <button onClick={handleUseStairs}>樓梯（免費）</button>
          <h3>最新遊戲狀態</h3>
          <pre>{JSON.stringify(gameState, null, 2)}</pre>
          {lastPendingCardDraw && <p>待抽卡：{JSON.stringify(lastPendingCardDraw)}</p>}
          {lastPendingAction && <p>待處理動作：{JSON.stringify(lastPendingAction)}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `LobbyScreen.jsx`**

Replace `client/src/LobbyScreen.jsx` entirely with:
```jsx
import { useState, useEffect, useRef } from 'react';
import { createSocket } from './socket';
import DebugGameScreen from './DebugGameScreen';

const ERROR_MESSAGES = {
  ROOM_NOT_FOUND: '找不到這個房號，請確認後再試一次',
  INVALID_NAME: '暱稱不可為空白，且長度不可超過 20 個字',
  ALREADY_IN_ROOM: '您已經在房間內了',
};

function translateError(code) {
  return ERROR_MESSAGES[code] || '發生未知錯誤，請稍後再試';
}

export default function LobbyScreen() {
  const socketRef = useRef(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');
  const [disconnected, setDisconnected] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('lobby:players', ({ players }) => setPlayers(players));
    socket.on('disconnect', () => setDisconnected(true));
    return () => socket.close();
  }, []);

  function handleCreate() {
    socketRef.current.emit('lobby:create', { playerName: name }, (res) => {
      if (res.error) {
        setError(translateError(res.error));
        return;
      }
      setRoomCode(res.roomCode);
      setPlayerId(res.playerId);
      setError('');
    });
  }

  function handleJoin() {
    socketRef.current.emit('lobby:join', { roomCode: joinCode, playerName: name }, (res) => {
      if (res.error) {
        setError(translateError(res.error));
        return;
      }
      setRoomCode(res.roomCode);
      setPlayerId(res.playerId);
      setError('');
    });
  }

  if (roomCode && showDebug) {
    return <DebugGameScreen socket={socketRef.current} roomCode={roomCode} playerId={playerId} />;
  }

  if (roomCode) {
    return (
      <div>
        {disconnected && (
          <p style={{ color: 'red' }}>連線已中斷，請重新整理頁面</p>
        )}
        <h2>房號：{roomCode}</h2>
        <h3>目前連線玩家：</h3>
        <ul>
          {players.map((p) => (
            <li key={p.playerId}>{p.name}</li>
          ))}
        </ul>
        <button onClick={() => setShowDebug(true)}>進入除錯測試模式</button>
      </div>
    );
  }

  return (
    <div>
      {disconnected && (
        <p style={{ color: 'red' }}>連線已中斷，請重新整理頁面</p>
      )}
      <label>
        暱稱：
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div>
        <button onClick={handleCreate} disabled={!name}>建立房間</button>
      </div>
      <div>
        <input
          placeholder="房號"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
        />
        <button onClick={handleJoin} disabled={!name || !joinCode}>加入房間</button>
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Verify the client builds**

Run（在 `client/` 目錄下）：
```bash
npm run build
```
Expected: 成功結束，沒有語法/匯入錯誤。

- [ ] **Step 4: Manual verification**

在兩個瀏覽器分頁（或一般+無痕視窗，避免共用同一個 tab 的 socket 連線）分別開啟開發伺服器（`npm run dev`，兩邊都連到同一個後端）：
1. 分頁A：輸入暱稱、按「建立房間」，記下房號
2. 分頁B：輸入相同暱稱不同名字、輸入房號、按「加入房間」
3. 兩個分頁都按「進入除錯測試模式」
4. 分頁A按「開始選角色」，確認兩分頁都收到提問畫面，被提問的那位選一個角色，確認畫面更新、換下一位提問
5. 兩位都選完後，確認兩分頁自動切到「playing」畫面，顯示遊戲狀態 JSON
6. 點擊移動/道具/樓梯按鈕，確認狀態 JSON 有更新、錯誤訊息（例如不是自己的回合時點擊）有正確顯示

- [ ] **Step 5: Commit**

```bash
git add client/src/DebugGameScreen.jsx client/src/LobbyScreen.jsx
git commit -m "feat(m2b2): add debug test screen for character selection and turn actions"
```

---

## 完成後的整體驗收

- [ ] `cd server && npx jest` 全部通過（含 M1/M2a/M2b-1 既有測試）
- [ ] `cd client && npm run build` 成功
- [ ] 依 Task 5 Step 4 的手動驗證步驟，實際跑過一次完整流程（大廳 → 選角色 → 開局 → 回合行動）
- [ ] M2b-2 完成後，下一步是撰寫 M2c（卡牌牌庫＋效果解析器）的設計與計畫，屆時要以 M2b-2 實際完成的 Socket 事件介面（尤其是 `game:pendingCardDraw`／`game:pendingAction` 的 payload 格式）為基礎延伸

## 已知的範圍外事項（非本計畫要解決，記錄供後續參考）

- 兩層 20 秒倒數的回合行動提問流程（本次確認不實作，見設計文件第4節）
- 道具/襲擊/操作、開門後卡片抽取的實際效果解析：M2b-2 只發出 `game:pendingCardDraw`／`game:pendingAction` 廣播，實際效果留給 M2c/M3
- 房主離開後的房主轉移機制（本次不處理，房主離開就跟其他玩家一樣走既有 `leaveRoom` 邏輯）
- 正式遊戲介面美術：M2b-2 只有除錯用測試頁面
- `data/characters/characters.json` 真實角色資料尚未填寫（仍是 6 個空白刻度的佔位角色），本計畫測試全部使用自建 fixture，不受影響；等開發者填完真實資料後，`index.js` 讀到的就會是真實內容，不需要改程式碼

## 執行時發現並修正的計畫錯誤（記錄供後續參考）

- **`game:prompt` 廣播的 listener 競態**：Task 3「full flow」測試與 Task 4 的 `setUpStartedGame()` 輔助函式，原本都只用 `clientA.once('game:prompt', resolve)` 等第一次提問廣播——但 `game:prompt` 是廣播給整個房間，兩個 client 各自的連線都會獨立收到；如果 `clientA` 不是第二位被詢問的玩家，之後在 `clientB` 上新掛的 `.once('game:prompt', ...)` 可能會誤接到還在傳送中的「第一次」廣播，錯當成第二次提問，造成 `PROMPT_MISMATCH`（依先選到的人是誰而定，具決定性、不是隨機的 flaky）。修正方式是同時對兩個 client 掛 `.once`、用 `Promise.all` 等兩邊都確認收到第一次廣播後才繼續（本文件上方兩處程式碼已經是修正後的版本）。這個問題純粹在測試碼，`socketHandlers.js`／`promptState.js`／`characterSelection.js` 的實際邏輯經過反覆診斷驗證都是正確的，完全沒有修改。之後如果任何計畫要沿用「等待房間廣播事件」這種測試寫法，記得套用「兩邊都等到才繼續」的原則，不要只等單一 client。
