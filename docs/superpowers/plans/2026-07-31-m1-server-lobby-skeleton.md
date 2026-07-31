# M1：伺服器與大廳骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Node.js/Express/Socket.IO 伺服器與最簡 React 前端，讓多位玩家可以建立/加入同一個房間，並即時看到彼此在線——這階段完全沒有遊戲規則，純粹驗證多人連線骨架。

**Architecture:** 單一 Node.js 伺服器（Express + Socket.IO）持有房間/玩家名冊狀態（`LobbyManager`），Socket 事件層薄薄一層轉呼叫 `LobbyManager`；React 前端用 `socket.io-client` 連線，顯示大廳畫面。伺服器與前端是兩個獨立資料夾（`server/`、`client/`），開發時分別啟動，正式環境由伺服器一併靜態伺服前端建置產物。

**Tech Stack:** Node.js（>=18）+ Express + Socket.IO（伺服器）；React + Vite（前端）；Jest + Supertest + socket.io-client（測試）；純 JavaScript，不使用 TypeScript。

## Global Constraints

- 對應設計文件：`docs/superpowers/specs/2026-07-31-web-multiplayer-design.md` 第 3、5 節（整體架構、伺服器端元件）
- 伺服器需監聽 `0.0.0.0`（而非僅 `localhost`），才能供同區網其他裝置連線
- 不使用 TypeScript、不使用狀態管理函式庫（React 內建 `useState`/`useEffect` 即可）——保持新手可讀性
- 所有 UI 文字使用繁體中文
- 本階段（M1）**不實作任何遊戲規則**，只做房間建立/加入/離開與玩家名冊同步
- 前端不做自動化測試（依 spec 第 11 節既定範圍），改以明確的手動驗證步驟收尾

---

## 檔案結構

```
server/
  package.json
  src/
    createServer.js     # 建立 Express app + http server + Socket.IO instance（不呼叫 listen）
    index.js            # 進入點：呼叫 createServer 並 listen
    lobbyManager.js      # LobbyManager class：房間/玩家名冊的核心邏輯
    socketHandlers.js    # 把 Socket.IO 事件轉呼叫 LobbyManager
  test/
    health.test.js
    lobbyManager.test.js
    socketHandlers.test.js

client/
  package.json
  vite.config.js
  index.html
  .env.development
  src/
    main.jsx
    socket.js            # 建立 socket.io-client 連線
    LobbyScreen.jsx       # 大廳畫面：建立/加入房間、顯示玩家名冊
```

---

### Task 1: 專案骨架與伺服器健康檢查

**Files:**
- Create: `server/package.json`
- Create: `server/src/createServer.js`
- Create: `server/src/index.js`
- Test: `server/test/health.test.js`

**Interfaces:**
- Produces: `createApp(): { app }`（Express app，含 `GET /health`）；`createServer(): { app, httpServer, io }`（`io` 是尚未 listen 的 Socket.IO Server 實例，`cors: { origin: '*' }`）

- [ ] **Step 1: Write the failing test**

`server/test/health.test.js`
```js
const request = require('supertest');
const { createApp } = require('../src/createServer');

test('GET /health returns 200 with status ok', async () => {
  const { app } = createApp();
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});
```

- [ ] **Step 2: Run test to verify it fails**

先建立 `server/package.json`：
```json
{
  "name": "betrayal-server",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "socket.io-client": "^4.7.5"
  }
}
```

Run（在 `server/` 目錄下）：
```bash
npm install
npx jest test/health.test.js
```
Expected: FAIL，因為 `../src/createServer` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/createServer.js`
```js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

function createApp() {
  const app = express();
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  return { app };
}

function createServer() {
  const { app } = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });
  return { app, httpServer, io };
}

module.exports = { createApp, createServer };
```

`server/src/index.js`
```js
const { createServer } = require('./createServer');

const PORT = process.env.PORT || 3001;
const { httpServer } = createServer();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`伺服器已啟動：http://0.0.0.0:${PORT}`);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/health.test.js
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/src/createServer.js server/src/index.js server/test/health.test.js
git commit -m "feat: add server skeleton with health check endpoint"
```

---

### Task 2: LobbyManager 核心邏輯

**Files:**
- Create: `server/src/lobbyManager.js`
- Test: `server/test/lobbyManager.test.js`

**Interfaces:**
- Consumes: 無（純邏輯類別，不依賴 Task 1 的檔案）
- Produces: `class LobbyManager` with methods：
  - `createRoom(hostName: string, hostSocketId: string): { roomCode: string, playerId: string }`
  - `joinRoom(roomCode: string, playerName: string, socketId: string): { playerId: string }`（房號不存在時 `throw new Error('ROOM_NOT_FOUND')`）
  - `leaveRoom(roomCode: string, playerId: string): void`（房間玩家歸零時自動移除該房間）
  - `getPlayers(roomCode: string): Array<{ playerId: string, name: string }>`（房號不存在回傳 `[]`）
  - `findRoomByPlayerId(playerId: string): string | null`

- [ ] **Step 1: Write the failing test**

`server/test/lobbyManager.test.js`
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
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/lobbyManager.test.js
```
Expected: FAIL，因為 `../src/lobbyManager` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/lobbyManager.js`
```js
const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

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

class LobbyManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> { players: Map(playerId -> { name, socketId }) }
  }

  createRoom(hostName, hostSocketId) {
    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (this.rooms.has(roomCode));

    const playerId = generatePlayerId();
    this.rooms.set(roomCode, {
      players: new Map([[playerId, { name: hostName, socketId: hostSocketId }]]),
    });
    return { roomCode, playerId };
  }

  joinRoom(roomCode, playerName, socketId) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new Error('ROOM_NOT_FOUND');
    }
    const playerId = generatePlayerId();
    room.players.set(playerId, { name: playerName, socketId });
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

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/lobbyManager.test.js
```
Expected: PASS（5 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/lobbyManager.js server/test/lobbyManager.test.js
git commit -m "feat: add LobbyManager for room create/join/leave logic"
```

---

### Task 3: Socket.IO 事件層與整合測試

**Files:**
- Create: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `createServer()` from Task 1（取得 `httpServer`, `io`）；`LobbyManager` from Task 2
- Produces: `registerSocketHandlers(io, lobbyManager): void`，註冊以下 Socket.IO 事件：
  - Client → Server `lobby:create` `({ playerName }, callback)` → `callback({ roomCode, playerId })`
  - Client → Server `lobby:join` `({ roomCode, playerName }, callback)` → `callback({ playerId })` 或 `callback({ error: 'ROOM_NOT_FOUND' })`
  - Server → Room 廣播 `lobby:players` `({ players })`（每次加入/離開後對該房間所有 socket 廣播）
  - `disconnect` 事件：依 `socket.data.roomCode` / `socket.data.playerId` 呼叫 `lobbyManager.leaveRoom`，並重新廣播 `lobby:players`

- [ ] **Step 1: Write the failing test**

`server/test/socketHandlers.test.js`
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

test('two clients can create/join a room and both see the updated player list', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => {
    clientA.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });
  expect(created.roomCode).toMatch(/^[A-Z]{4}$/);

  const playersPromise = new Promise((resolve) => {
    clientA.once('lobby:players', resolve);
  });

  const clientB = ioClient(url);
  const joined = await new Promise((resolve) => {
    clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve);
  });
  expect(joined.error).toBeUndefined();

  const update = await playersPromise;
  expect(update.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('joining an unknown room code returns an error to the caller', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  const result = await new Promise((resolve) => {
    client.emit('lobby:join', { roomCode: 'ZZZZ', playerName: 'Bob' }, resolve);
  });
  expect(result.error).toBe('ROOM_NOT_FOUND');

  client.close();
  httpServer.close();
});

test('disconnecting removes the player and broadcasts the updated list', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => {
    clientA.emit('lobby:create', { playerName: 'Alice' }, resolve);
  });

  const clientB = ioClient(url);
  await new Promise((resolve) => {
    clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve);
  });

  const afterDisconnect = new Promise((resolve) => {
    clientA.once('lobby:players', resolve);
  });
  clientB.close();

  const update = await afterDisconnect;
  expect(update.players.map((p) => p.name)).toEqual(['Alice']);

  clientA.close();
  httpServer.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run（在 `server/` 目錄下）：
```bash
npx jest test/socketHandlers.test.js
```
Expected: FAIL，因為 `../src/socketHandlers` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

`server/src/socketHandlers.js`
```js
function registerSocketHandlers(io, lobbyManager) {
  io.on('connection', (socket) => {
    socket.on('lobby:create', ({ playerName }, callback) => {
      const { roomCode, playerId } = lobbyManager.createRoom(playerName, socket.id);
      socket.data.roomCode = roomCode;
      socket.data.playerId = playerId;
      socket.join(roomCode);
      callback({ roomCode, playerId });
      broadcastPlayers(io, lobbyManager, roomCode);
    });

    socket.on('lobby:join', ({ roomCode, playerName }, callback) => {
      try {
        const { playerId } = lobbyManager.joinRoom(roomCode, playerName, socket.id);
        socket.data.roomCode = roomCode;
        socket.data.playerId = playerId;
        socket.join(roomCode);
        callback({ playerId });
        broadcastPlayers(io, lobbyManager, roomCode);
      } catch (err) {
        callback({ error: err.message });
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

- [ ] **Step 4: Run test to verify it passes**

Run（在 `server/` 目錄下）：
```bash
npx jest test/socketHandlers.test.js
```
Expected: PASS（3 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: wire Socket.IO events to LobbyManager with integration tests"
```

---

### Task 4: 串接伺服器進入點與 React 大廳畫面

**Files:**
- Modify: `server/src/index.js`（改為呼叫 `registerSocketHandlers`）
- Create: `client/package.json`
- Create: `client/vite.config.js`
- Create: `client/index.html`
- Create: `client/.env.development`
- Create: `client/src/main.jsx`
- Create: `client/src/socket.js`
- Create: `client/src/LobbyScreen.jsx`

**Interfaces:**
- Consumes: `createServer()`、`LobbyManager`、`registerSocketHandlers` from Tasks 1-3；client 消費 Task 3 定義的 `lobby:create` / `lobby:join` / `lobby:players` 事件格式
- Produces: 可在瀏覽器操作的大廳畫面（無對外函式介面，此任務為串接與手動驗證，非自動化測試）

- [ ] **Step 1: 更新伺服器進入點以註冊 Socket 事件**

Modify `server/src/index.js`：
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

- [ ] **Step 2: 建立前端專案骨架**

`client/package.json`
```json
{
  "name": "betrayal-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "socket.io-client": "^4.7.5"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.0"
  }
}
```

`client/vite.config.js`
```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

`client/index.html`
```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <title>山中小屋 - 大廳</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

`client/.env.development`
```
VITE_SERVER_URL=http://localhost:3001
```

- [ ] **Step 3: 建立 socket 連線與大廳畫面元件**

`client/src/socket.js`
```js
import { io } from 'socket.io-client';

export function createSocket() {
  const url = import.meta.env.DEV
    ? (import.meta.env.VITE_SERVER_URL || 'http://localhost:3001')
    : undefined;
  return io(url);
}
```

`client/src/LobbyScreen.jsx`
```jsx
import { useState, useEffect, useRef } from 'react';
import { createSocket } from './socket';

export default function LobbyScreen() {
  const socketRef = useRef(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('lobby:players', ({ players }) => setPlayers(players));
    return () => socket.close();
  }, []);

  function handleCreate() {
    socketRef.current.emit('lobby:create', { playerName: name }, (res) => {
      setRoomCode(res.roomCode);
      setError('');
    });
  }

  function handleJoin() {
    socketRef.current.emit('lobby:join', { roomCode: joinCode, playerName: name }, (res) => {
      if (res.error) {
        setError(res.error);
        return;
      }
      setRoomCode(joinCode);
      setError('');
    });
  }

  if (roomCode) {
    return (
      <div>
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

`client/src/main.jsx`
```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import LobbyScreen from './LobbyScreen';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LobbyScreen />
  </React.StrictMode>
);
```

- [ ] **Step 4: 手動驗證（無自動化前端測試，依既定範圍）**

終端機 1（在 `server/` 目錄下）：
```bash
npm start
```

終端機 2（在 `client/` 目錄下）：
```bash
npm install
npm run dev
```

瀏覽器開兩個分頁到 `http://localhost:5173`：
1. 分頁 1：輸入暱稱「Alice」，點擊「建立房間」，記下房號
2. 分頁 2：輸入暱稱「Bob」，輸入該房號，點擊「加入房間」
3. 確認兩個分頁都顯示玩家名單「Alice」與「Bob」
4. 關閉分頁 2，確認分頁 1 的名單即時更新為只剩「Alice」

若以上 4 點都符合，此任務通過驗證。

- [ ] **Step 5: Commit**

```bash
git add server/src/index.js client/package.json client/vite.config.js client/index.html client/.env.development client/src/socket.js client/src/LobbyScreen.jsx client/src/main.jsx
git commit -m "feat: add React lobby screen wired to Socket.IO"
```

---

### Task 5: 正式環境靜態檔案伺服與區網啟動說明

**Files:**
- Modify: `server/src/createServer.js`（加入靜態檔案伺服 middleware）
- Create: `server/README.md`

**Interfaces:**
- Consumes: `client/dist`（`npm run build` 產出的靜態檔案，需在此任務手動執行一次以驗證）
- Produces: 無新函式介面；`createApp()` 行為擴充為同時伺服 `client/dist` 靜態檔案

- [ ] **Step 1: 加入靜態檔案伺服**

Modify `server/src/createServer.js`：
```js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

function createApp() {
  const app = express();
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(express.static(path.join(__dirname, '../../client/dist')));
  return { app };
}

function createServer() {
  const { app } = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });
  return { app, httpServer, io };
}

module.exports = { createApp, createServer };
```

- [ ] **Step 2: 確認既有測試仍然通過**

Run（在 `server/` 目錄下）：
```bash
npx jest
```
Expected: PASS（Task 1-3 的測試全部維持通過，`express.static` 在 `client/dist` 不存在時不影響 `/health`）

- [ ] **Step 3: 建置前端並手動驗證正式環境路徑**

Run（在 `client/` 目錄下）：
```bash
npm run build
```

Run（在 `server/` 目錄下，關閉先前的 `npm start` 再重新啟動）：
```bash
npm start
```

瀏覽器開啟 `http://localhost:3001`（注意：**不是** 5173），確認大廳畫面可正常運作（建立房間、加入房間、玩家名單同步），與 Task 4 手動驗證步驟相同。

- [ ] **Step 4: 撰寫區網啟動說明**

`server/README.md`
```markdown
# 啟動方式

## 開發模式（前後端分開跑）
1. 終端機 1：`cd server && npm install && npm start`
2. 終端機 2：`cd client && npm install && npm run dev`
3. 瀏覽器開啟 `http://localhost:5173`

## 正式/區網模式（伺服器一併伺服前端）
1. `cd client && npm run build`
2. `cd server && npm start`
3. 瀏覽器開啟 `http://localhost:3001`

## 讓同區網的朋友加入
1. 在執行伺服器的電腦上，用 `ipconfig`（Windows）查詢區網 IP（例如 `192.168.1.42`）
2. 朋友的瀏覽器開啟 `http://192.168.1.42:3001`（需先完成上方「正式/區網模式」建置步驟）
3. 若無法連線，檢查 Windows 防火牆是否詢問是否允許 Node.js 連入，選擇允許
```

- [ ] **Step 5: Commit**

```bash
git add server/src/createServer.js server/README.md
git commit -m "feat: serve built client from server and document LAN setup"
```

---

## 完成後的整體驗收

- [ ] `cd server && npx jest` 全部通過（Task 1-3 共 9 個測試）
- [ ] 依 Task 4 手動驗證步驟，兩分頁能建立/加入房間並即時同步玩家名單
- [ ] 依 Task 5 手動驗證步驟，`http://localhost:3001` 能在不啟動 Vite dev server 的情況下正常運作
- [ ] M1 完成後，下一步是撰寫 M2（探索引擎）的詳細實作計畫，屆時會依 M1 實際完成的程式碼介面（`LobbyManager`、Socket 事件命名慣例）為基礎延伸
