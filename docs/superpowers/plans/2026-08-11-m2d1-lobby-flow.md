# M2D1：大廳流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用開頭頁面／暱稱輸入／大廳列表／等候室取代目前陽春的 `LobbyScreen.jsx`，並補上必要的後端機制（房主離開時解散整個大廳、可瀏覽的大廳列表），手機橫向螢幕為主要目標裝置。

**Architecture:** 後端在既有 `lobbyManager.js`/`socketHandlers.js` 上新增 3 個能力（查房主暱稱、解散房間、列出可加入房間），前端把畫面拆成 5 個小元件（`client/src/lobby/` 資料夾）＋ 1 個負責串接 socket 事件與畫面狀態機的協調層（沿用 `LobbyScreen.jsx` 這個既有進入點，內容整個改寫）。

**Tech Stack:** 後端 Node.js + Express + Socket.IO，CommonJS；前端 React + Vite，純 CSS（不引入 UI 元件庫/CSS-in-JS，維持既有的零額外前端依賴）；測試：後端用 Jest（沿用既有慣例），前端目前這個專案沒有自動化測試框架，前端任務改用「啟動 dev server、在瀏覽器手動操作驗證」。

## Global Constraints

- 所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串（既有慣例）
- 後端每個任務都要先寫測試、跑過確認失敗、再實作、再跑過確認通過（TDD）
- `server/test/socketHandlers.test.js` 執行要加 `--forceExit`（已知環境問題，跟本次改動無關）：`npx jest --forceExit`（在 `server/` 目錄下）
- 前端目標裝置＝手機橫向螢幕；開發驗證時要把瀏覽器視窗模擬成手機橫向尺寸（例如寬 812 高 375）
- 不引入任何新的 npm 套件（前端維持零額外依賴，後端也不需要新套件）
- 不做房主權限轉移；房主離開（主動或斷線）＝整個大廳解散，所有人被踢回開頭頁面
- 大廳列表只在進入畫面時拉一次＋手動刷新按鈕，不做即時廣播更新

---

### Task 1：`LobbyManager` 新增能力

**Files:**
- Modify: `server/src/lobbyManager.js`
- Modify: `server/test/lobbyManager.test.js`

**Interfaces:**
- Produces：
  - `getPlayers(roomCode)` 回傳的每個玩家物件新增 `isHost` 布林欄位（**破壞性變更既有回傳形狀**，見下方 Step 1）
  - `getHostName(roomCode)`：回傳房主暱稱字串，房間不存在回傳 `null`
  - `closeRoom(roomCode)`：直接刪除該房間的所有資料
  - `listJoinableRooms(isRoomInProgress, maxPlayers)`：回傳 `[{roomCode, hostName, playerCount, maxPlayers}]`，排除 `isRoomInProgress(roomCode)` 為真或人數已達 `maxPlayers` 的房間

- [ ] **Step 1：更新既有測試，反映 `getPlayers` 新增 `isHost` 欄位**

修改 `server/test/lobbyManager.test.js`，把下面 4 處的期望值加上 `isHost`：

第 8 行（`createRoom creates a room with the host as first player`）：
```js
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name: 'Alice', isHost: true }]);
```

第 32 行（`leaveRoom removes a player, and removes the room once empty`，Bob 離開後只剩 Alice）：
```js
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name: 'Alice', isHost: true }]);
```

第 49 行（`createRoom trims a valid name with surrounding whitespace`）：
```js
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name: 'Alice', isHost: true }]);
```

第 68 行（`createRoom accepts a name at the 20-character length cap`）：
```js
  expect(manager.getPlayers(roomCode)).toEqual([{ playerId, name, isHost: true }]);
```

（第 17 行 `joinRoom adds a second player...` 只用 `.map(p => p.name)` 取名字，不受影響，不用改）

- [ ] **Step 2：新增這次要測的 4 個新行為的測試**

在 `server/test/lobbyManager.test.js` 檔案最後面新增：

```js
test('getPlayers marks isHost true only for the host', () => {
  const manager = new LobbyManager();
  const { roomCode, playerId: hostId } = manager.createRoom('Alice', 'socket-1');
  const { playerId: bobId } = manager.joinRoom(roomCode, 'Bob', 'socket-2');

  const players = manager.getPlayers(roomCode);
  expect(players.find((p) => p.playerId === hostId).isHost).toBe(true);
  expect(players.find((p) => p.playerId === bobId).isHost).toBe(false);
});

test('getHostName returns the host player\'s name', () => {
  const manager = new LobbyManager();
  const { roomCode } = manager.createRoom('Alice', 'socket-1');
  manager.joinRoom(roomCode, 'Bob', 'socket-2');

  expect(manager.getHostName(roomCode)).toBe('Alice');
});

test('getHostName returns null for an unknown room code', () => {
  const manager = new LobbyManager();
  expect(manager.getHostName('ZZZZ')).toBeNull();
});

test('closeRoom removes the room entirely', () => {
  const manager = new LobbyManager();
  const { roomCode } = manager.createRoom('Alice', 'socket-1');
  manager.closeRoom(roomCode);
  expect(manager.getPlayers(roomCode)).toEqual([]);
  expect(manager.isHost(roomCode, 'anyone')).toBe(false);
});

test('listJoinableRooms excludes rooms the isRoomInProgress callback flags', () => {
  const manager = new LobbyManager();
  const { roomCode: openRoom } = manager.createRoom('Alice', 'socket-1');
  const { roomCode: startedRoom } = manager.createRoom('Bob', 'socket-2');

  const result = manager.listJoinableRooms((roomCode) => roomCode === startedRoom, 6);
  expect(result).toEqual([{ roomCode: openRoom, hostName: 'Alice', playerCount: 1, maxPlayers: 6 }]);
});

test('listJoinableRooms excludes rooms that are already at maxPlayers', () => {
  const manager = new LobbyManager();
  const { roomCode } = manager.createRoom('Alice', 'socket-1');
  manager.joinRoom(roomCode, 'Bob', 'socket-2');

  const result = manager.listJoinableRooms(() => false, 2);
  expect(result).toEqual([]);
});

test('listJoinableRooms reports playerCount and maxPlayers for an open room', () => {
  const manager = new LobbyManager();
  const { roomCode } = manager.createRoom('Alice', 'socket-1');
  manager.joinRoom(roomCode, 'Bob', 'socket-2');

  const result = manager.listJoinableRooms(() => false, 6);
  expect(result).toEqual([{ roomCode, hostName: 'Alice', playerCount: 2, maxPlayers: 6 }]);
});
```

- [ ] **Step 3：執行測試，確認全部（既有＋新增）都失敗**

Run（在 `server/` 目錄下）: `npx jest test/lobbyManager.test.js`
Expected: 既有 4 個測試因為缺 `isHost` 欄位而 FAIL；新增 7 個測試因為方法不存在而 FAIL

- [ ] **Step 4：實作**

修改 `server/src/lobbyManager.js`：

`getPlayers` 方法改成：

```js
  getPlayers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    return Array.from(room.players.entries()).map(([playerId, p]) => ({
      playerId,
      name: p.name,
      isHost: playerId === room.hostPlayerId,
    }));
  }
```

在 `isHost` 方法之後新增：

```js
  getHostName(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    const host = room.players.get(room.hostPlayerId);
    return host ? host.name : null;
  }

  closeRoom(roomCode) {
    this.rooms.delete(roomCode);
  }

  listJoinableRooms(isRoomInProgress, maxPlayers) {
    const result = [];
    for (const [roomCode, room] of this.rooms.entries()) {
      if (isRoomInProgress(roomCode)) continue;
      const playerCount = room.players.size;
      if (playerCount >= maxPlayers) continue;
      result.push({ roomCode, hostName: this.getHostName(roomCode), playerCount, maxPlayers });
    }
    return result;
  }
```

- [ ] **Step 5：執行測試，確認全部通過**

Run: `npx jest test/lobbyManager.test.js`
Expected: 全數 PASS

- [ ] **Step 6：Commit**

```bash
git add server/src/lobbyManager.js server/test/lobbyManager.test.js
git commit -m "feat(m2d1): LobbyManager gains isHost/getHostName/closeRoom/listJoinableRooms"
```

---

### Task 2：`lobby:list` socket 事件

**Files:**
- Modify: `server/src/socketHandlers.js`
- Modify: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes：Task 1 的 `lobbyManager.listJoinableRooms(isRoomInProgress, maxPlayers)`
- Produces：新的 `lobby:list` socket 事件，`ack({ rooms: [{roomCode, hostName, playerCount, maxPlayers}] })`；`maxPlayers` 一律是 `content.characters.length`；「進行中」的判斷跟既有 `lobby:join` 的 `ROOM_IN_PROGRESS` 判斷共用同一個條件（`getCharacterSelection(characterSelectionManager, roomCode) || getGameState(gameManager, roomCode)`）

- [ ] **Step 1：寫失敗測試**

在 `server/test/socketHandlers.test.js` 裡，找到 `test('lobby:join is rejected with ROOM_IN_PROGRESS once character selection has started for that room'...)`（約第 406 行），在它之後插入：

```js
test('lobby:list returns open rooms with host name and player count, excluding full or in-progress rooms', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const openRoom = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));

  const clientB = ioClient(url);
  const startedRoom = await new Promise((resolve) => clientB.emit('lobby:create', { playerName: 'Carol' }, resolve));
  const clientC = ioClient(url);
  await new Promise((resolve) => clientC.emit('lobby:join', { roomCode: startedRoom.roomCode, playerName: 'Dave' }, resolve));
  await new Promise((resolve) => clientB.emit('game:startCharacterSelect', {}, resolve));

  const result = await new Promise((resolve) => clientC.emit('lobby:list', {}, resolve));

  expect(result.error).toBeUndefined();
  expect(result.rooms).toEqual([
    { roomCode: openRoom.roomCode, hostName: 'Alice', playerCount: 1, maxPlayers: 2 },
  ]);
  expect(result.rooms.find((r) => r.roomCode === startedRoom.roomCode)).toBeUndefined();

  clientA.close();
  clientB.close();
  clientC.close();
  httpServer.close();
});

test('lobby:list can be called by a socket not currently in any room', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  const result = await new Promise((resolve) => client.emit('lobby:list', {}, resolve));
  expect(result.error).toBeUndefined();
  expect(result.rooms).toEqual([]);

  client.close();
  httpServer.close();
});
```

（`clientC` 先加入 `startedRoom` 湊滿 2 人，`game:startCharacterSelect` 才不會被 `TOO_FEW_PLAYERS` 擋下；`clientC` 雖然已經在 `startedRoom` 裡，`lobby:list` 沒有「必須不在任何房間」這個前提，一樣可以呼叫，不用額外開第 4 個 client。預設測試內容 `makeContent()` 的 `characters` 陣列長度是 2，所以 `maxPlayers` 期望值是 2）

- [ ] **Step 2：執行測試，確認失敗**

Run（在 `server/` 目錄下）: `npx jest --forceExit -t "lobby:list"`
Expected: FAIL（`lobby:list` 事件還不存在，ack 永遠不會被呼叫，測試逾時或收到 `undefined`）

- [ ] **Step 3：實作**

在 `server/src/socketHandlers.js` 的 `socket.on('disconnect', ...)` 之前（或任何一個既有 `lobby:` 開頭的 handler 附近）新增：

```js
    socket.on('lobby:list', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const maxPlayers = content.characters.length;
      const rooms = lobbyManager.listJoinableRooms(
        (roomCode) => Boolean(getCharacterSelection(characterSelectionManager, roomCode) || getGameState(gameManager, roomCode)),
        maxPlayers
      );
      ack({ rooms });
    });
```

- [ ] **Step 4：執行測試，確認通過**

Run: `npx jest --forceExit -t "lobby:list"`
Expected: PASS

- [ ] **Step 5：執行整個測試套件，確認沒有破壞既有測試**

Run: `npx jest --forceExit`
Expected: 全數 PASS

- [ ] **Step 6：Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(m2d1): add lobby:list socket event"
```

---

### Task 3：房主解散大廳（`lobby:leave` ＋ `disconnect` 補上房主判斷）

**Files:**
- Modify: `server/src/socketHandlers.js`
- Modify: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes：Task 1 的 `lobbyManager.closeRoom(roomCode)`
- Produces：新函式 `closeLobbyRoom(io, lobbyManager, roomCode)`（`async`，清空房內每個還連著的 socket 的 `socket.data`、讓它們離開 io room、廣播 `lobby:closed`、呼叫 `lobbyManager.closeRoom`）；新的 `lobby:leave` socket 事件（一般玩家＝移除自己＋廣播更新後名單；房主＝呼叫 `closeLobbyRoom`）；`disconnect` handler 補上房主判斷（房主斷線比照房主主動 `lobby:leave`）

- [ ] **Step 1：寫失敗測試**

在 `server/test/socketHandlers.test.js` 裡，找到 `test('disconnecting removes the player and broadcasts the updated list'...)`（約第 264-289 行）附近，在它之後插入：

```js
test('lobby:leave by a non-host player removes only that player and broadcasts the updated list', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));

  const clientB = ioClient(url);
  await new Promise((resolve) => clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve));

  const updatePromise = new Promise((resolve) => {
    clientA.on('lobby:players', (update) => {
      if (update.players.length === 1) resolve(update);
    });
  });
  const leaveResult = await new Promise((resolve) => clientB.emit('lobby:leave', {}, resolve));
  expect(leaveResult.error).toBeUndefined();

  const update = await updatePromise;
  expect(update.players.map((p) => p.name)).toEqual(['Alice']);

  // clientB is free to create/join a new room now that its socket.data was cleared.
  const rejoin = await new Promise((resolve) => clientB.emit('lobby:create', { playerName: 'Bob2' }, resolve));
  expect(rejoin.error).toBeUndefined();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('lobby:leave rejects a socket that is not currently in any room', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const client = ioClient(url);
  const result = await new Promise((resolve) => client.emit('lobby:leave', {}, resolve));
  expect(result.error).toBe('NOT_IN_ROOM');

  client.close();
  httpServer.close();
});

test('lobby:leave by the host closes the room: every remaining player receives lobby:closed and can create/join a new room', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));

  const clientB = ioClient(url);
  await new Promise((resolve) => clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve));

  const closedPromise = new Promise((resolve) => clientB.once('lobby:closed', resolve));
  const leaveResult = await new Promise((resolve) => clientA.emit('lobby:leave', {}, resolve));
  expect(leaveResult.error).toBeUndefined();
  await closedPromise;

  // Both sockets' data were cleared -- both are free to create a new room.
  const bobRejoin = await new Promise((resolve) => clientB.emit('lobby:create', { playerName: 'Bob2' }, resolve));
  expect(bobRejoin.error).toBeUndefined();
  const aliceRejoin = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice2' }, resolve));
  expect(aliceRejoin.error).toBeUndefined();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('the host disconnecting (not an explicit lobby:leave) also closes the room for everyone else', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));

  const clientB = ioClient(url);
  await new Promise((resolve) => clientB.emit('lobby:join', { roomCode: created.roomCode, playerName: 'Bob' }, resolve));

  const closedPromise = new Promise((resolve) => clientB.once('lobby:closed', resolve));
  clientA.close(); // host disconnects without an explicit lobby:leave
  await closedPromise;

  const bobRejoin = await new Promise((resolve) => clientB.emit('lobby:create', { playerName: 'Bob2' }, resolve));
  expect(bobRejoin.error).toBeUndefined();

  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2：執行測試，確認失敗**

Run（在 `server/` 目錄下）: `npx jest --forceExit -t "lobby:leave"`
Expected: FAIL（`lobby:leave` 事件不存在）；`npx jest --forceExit -t "host disconnecting"` 也 FAIL（`disconnect` 還沒有房主判斷，`lobby:closed` 永遠不會被送出）

- [ ] **Step 3：實作**

在 `server/src/socketHandlers.js` 裡，把現有的 `socket.on('disconnect', ...)`（約第 411-417 行）改成：

```js
    socket.on('lobby:leave', async (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) {
        return ack({ error: 'NOT_IN_ROOM' });
      }
      if (lobbyManager.isHost(roomCode, playerId)) {
        await closeLobbyRoom(io, lobbyManager, roomCode);
      } else {
        lobbyManager.leaveRoom(roomCode, playerId);
        socket.leave(roomCode);
        socket.data.roomCode = null;
        socket.data.playerId = null;
        broadcastPlayers(io, lobbyManager, roomCode);
      }
      ack({});
    });

    socket.on('disconnect', async () => {
      const { roomCode, playerId } = socket.data;
      if (roomCode && playerId) {
        if (lobbyManager.isHost(roomCode, playerId)) {
          await closeLobbyRoom(io, lobbyManager, roomCode);
        } else {
          lobbyManager.leaveRoom(roomCode, playerId);
          broadcastPlayers(io, lobbyManager, roomCode);
        }
      }
    });
```

（`lobby:leave` 一定要放在 `socket.on('disconnect', ...)` 之前或之後都可以，只要在同一個 `io.on('connection', (socket) => { ... })` 區塊內即可；緊接著加在 `disconnect` 前面是為了跟它放在一起方便閱讀）

在 `broadcastPlayers` 函式定義之前（檔案接近尾端）新增：

```js
async function closeLobbyRoom(io, lobbyManager, roomCode) {
  const sockets = await io.in(roomCode).fetchSockets();
  for (const s of sockets) {
    s.data.roomCode = null;
    s.data.playerId = null;
    s.leave(roomCode);
  }
  io.to(roomCode).emit('lobby:closed', {});
  lobbyManager.closeRoom(roomCode);
}
```

- [ ] **Step 4：執行測試，確認通過**

Run: `npx jest --forceExit -t "lobby:leave"` 與 `npx jest --forceExit -t "host disconnecting"`
Expected: 全數 PASS

- [ ] **Step 5：執行整個測試套件，確認沒有破壞既有測試**

Run: `npx jest --forceExit`
Expected: 全數 PASS

- [ ] **Step 6：Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(m2d1): host leaving (explicitly or via disconnect) closes the lobby for everyone"
```

---

### Task 4：前端基礎設施＋開頭頁面／暱稱視窗／角色選擇佔位畫面

**Files:**
- Create: `client/public/images/gate.png`（複製自 `img/Gate.png`，原檔不動）
- Modify: `client/index.html`（補 viewport meta）
- Create: `client/src/lobby/lobby.css`
- Create: `client/src/lobby/StartScreen.jsx`
- Create: `client/src/lobby/NicknameModal.jsx`
- Create: `client/src/lobby/CharacterSelectPlaceholder.jsx`

**Interfaces:**
- Produces：
  - `<StartScreen onCreateClick={fn} onJoinClick={fn} />`
  - `<NicknameModal onConfirm={(name) => void} onCancel={fn} error={string|null} />`（`onConfirm` 只在暱稱非空白時才會被呼叫；元件自己 trim 並擋空白送出）
  - `<CharacterSelectPlaceholder />`（無 props）
  - CSS class：`lobby-viewport`／`lobby-start-screen`／`lobby-start-buttons`／`lobby-watermark-screen`／`lobby-center-panel`／`lobby-button`／`lobby-modal-overlay`／`lobby-modal`／`lobby-modal-input`／`lobby-modal-buttons`／`lobby-error`

- [ ] **Step 1：複製圖片素材**

```bash
mkdir -p client/public/images
cp img/Gate.png client/public/images/gate.png
```

- [ ] **Step 2：補上手機響應式必要的 viewport meta**

修改 `client/index.html`，在 `<meta charset="UTF-8" />` 之後加入：

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

- [ ] **Step 3：建立共用樣式**

建立 `client/src/lobby/lobby.css`：

```css
.lobby-viewport {
  width: 100%;
  min-height: 100vh;
  font-family: sans-serif;
  color: #f5f5f0;
}

.lobby-start-screen {
  position: relative;
  width: 100%;
  min-height: 100vh;
  background-image: url('/images/gate.png');
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lobby-start-buttons {
  display: flex;
  flex-direction: row;
  gap: 1.5rem;
  background: rgba(0, 0, 0, 0.55);
  padding: 1.5rem 2rem;
  border-radius: 0.75rem;
}

.lobby-watermark-screen {
  position: relative;
  width: 100%;
  min-height: 100vh;
  background-image: linear-gradient(rgba(10, 10, 10, 0.82), rgba(10, 10, 10, 0.82)), url('/images/gate.png');
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  box-sizing: border-box;
}

.lobby-center-panel {
  width: 100%;
  max-width: 28rem;
  background: rgba(20, 20, 20, 0.6);
  border-radius: 0.75rem;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 90vh;
  overflow-y: auto;
  box-sizing: border-box;
}

.lobby-button {
  font-size: 1rem;
  padding: 0.6rem 1.2rem;
  border-radius: 0.5rem;
  border: none;
  background: #6b4f2a;
  color: #f5f5f0;
  cursor: pointer;
}

.lobby-button:disabled {
  background: #4a4a4a;
  cursor: not-allowed;
  opacity: 0.6;
}

.lobby-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.lobby-modal {
  background: #1c1c1c;
  color: #f5f5f0;
  padding: 1.5rem;
  border-radius: 0.75rem;
  width: 90%;
  max-width: 20rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  box-sizing: border-box;
}

.lobby-modal-input {
  font-size: 1rem;
  padding: 0.5rem;
  border-radius: 0.4rem;
  border: 1px solid #666;
}

.lobby-modal-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.lobby-error {
  color: #ff8080;
  margin: 0;
}

.lobby-player-list,
.lobby-room-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.lobby-player-list li {
  padding: 0.4rem 0.6rem;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 0.4rem;
}

.lobby-host-badge {
  margin-left: 0.4rem;
  font-size: 0.85rem;
  color: #ffd27a;
}

.lobby-room-item {
  width: 100%;
  text-align: left;
  font-size: 1rem;
  padding: 0.6rem 0.8rem;
  border-radius: 0.5rem;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: #f5f5f0;
  cursor: pointer;
}

.lobby-room-item:hover {
  background: rgba(255, 255, 255, 0.2);
}

.lobby-waiting-buttons {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
}

@media (min-width: 700px) and (orientation: landscape) {
  .lobby-center-panel {
    max-width: 32rem;
  }
}
```

- [ ] **Step 4：`StartScreen` 元件**

建立 `client/src/lobby/StartScreen.jsx`：

```jsx
export default function StartScreen({ onCreateClick, onJoinClick }) {
  return (
    <div className="lobby-start-screen">
      <div className="lobby-start-buttons">
        <button className="lobby-button" onClick={onCreateClick}>建立大廳</button>
        <button className="lobby-button" onClick={onJoinClick}>進入大廳</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5：`NicknameModal` 元件**

建立 `client/src/lobby/NicknameModal.jsx`：

```jsx
import { useState } from 'react';

export default function NicknameModal({ onConfirm, onCancel, error }) {
  const [name, setName] = useState('');

  function handleConfirm() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }

  return (
    <div className="lobby-modal-overlay">
      <div className="lobby-modal">
        <h2>輸入暱稱</h2>
        <input
          className="lobby-modal-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="你的暱稱"
          maxLength={20}
          autoFocus
        />
        {error && <p className="lobby-error">{error}</p>}
        <div className="lobby-modal-buttons">
          <button className="lobby-button" onClick={onCancel}>取消</button>
          <button className="lobby-button" onClick={handleConfirm} disabled={!name.trim()}>確認</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6：`CharacterSelectPlaceholder` 元件**

建立 `client/src/lobby/CharacterSelectPlaceholder.jsx`：

```jsx
export default function CharacterSelectPlaceholder() {
  return (
    <div className="lobby-watermark-screen">
      <div className="lobby-center-panel">
        <p>角色選擇開發中</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7：手動驗證（沒有前端自動化測試，用瀏覽器實際檢查）**

暫時修改 `client/src/main.jsx`（只是為了這一步驟的視覺檢查，下一個任務會把它改回正式的協調層，這裡的暫時修改不用 commit）：

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import './lobby/lobby.css';
import StartScreen from './lobby/StartScreen';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <div className="lobby-viewport">
      <StartScreen onCreateClick={() => alert('create')} onJoinClick={() => alert('join')} />
    </div>
  </React.StrictMode>
);
```

Run: `npm run dev`（在 `client/` 目錄下），瀏覽器開發者工具切換成手機橫向尺寸（例如 812×375），確認：
- `Gate.png` 背景圖正常顯示、鋪滿螢幕
- 「建立大廳」「進入大廳」兩個按鈕清楚可讀，跟背景對比度足夠
- 點擊按鈕會跳出瀏覽器 alert（暫時驗證用）

確認沒問題後，把 `main.jsx` **改回** Step 1 之前的原始內容（`import LobbyScreen from './LobbyScreen'` 那版），因為正式的協調層會在 Task 6 才處理。

- [ ] **Step 8：Commit**

```bash
git add client/public/images/gate.png client/index.html client/src/lobby/
git commit -m "feat(m2d1): start screen, nickname modal, character-select placeholder, shared lobby styles"
```

---

### Task 5：大廳列表畫面 ＋ 等候室畫面

**Files:**
- Create: `client/src/lobby/LobbyListScreen.jsx`
- Create: `client/src/lobby/WaitingRoomScreen.jsx`

**Interfaces:**
- Consumes：Task 2 的 `lobby:list`、既有的 `lobby:join`；Task 3 的 `lobby:leave`／`lobby:closed`；既有的 `lobby:players`、`game:startCharacterSelect`、`game:characterSelectUpdate`
- Produces：
  - `<LobbyListScreen socket={socket} name={string} onJoined={(roomCode, playerId) => void} onBack={fn} />`
  - `<WaitingRoomScreen socket={socket} roomCode={string} playerId={string} onClosed={fn} onLeft={fn} onCharacterSelectStarted={fn} />`（元件自己判斷「我是不是房主」：從 `lobby:players` 廣播裡找 `playerId === this.playerId` 的那筆的 `isHost`，不用額外從外部傳 `isHost` 進來）

- [ ] **Step 1：`LobbyListScreen` 元件**

建立 `client/src/lobby/LobbyListScreen.jsx`：

```jsx
import { useState, useEffect, useCallback } from 'react';

export default function LobbyListScreen({ socket, name, onJoined, onBack }) {
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchRooms = useCallback(() => {
    setLoading(true);
    socket.emit('lobby:list', {}, (res) => {
      setLoading(false);
      if (res && res.error) {
        setError(res.error);
        return;
      }
      setError('');
      setRooms(res.rooms || []);
    });
  }, [socket]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  function handleJoin(roomCode) {
    socket.emit('lobby:join', { roomCode, playerName: name }, (res) => {
      if (res && res.error) {
        setError(res.error);
        return;
      }
      onJoined(res.roomCode, res.playerId);
    });
  }

  return (
    <div className="lobby-watermark-screen">
      <div className="lobby-center-panel">
        <h2>大廳列表</h2>
        {error && <p className="lobby-error">{error}</p>}
        <button className="lobby-button" onClick={fetchRooms} disabled={loading}>重新整理</button>
        {rooms.length === 0 && !loading && <p>目前沒有開放中的大廳</p>}
        <ul className="lobby-room-list">
          {rooms.map((r) => (
            <li key={r.roomCode}>
              <button className="lobby-room-item" onClick={() => handleJoin(r.roomCode)}>
                {r.hostName} 的大廳（{r.playerCount}/{r.maxPlayers}）
              </button>
            </li>
          ))}
        </ul>
        <button className="lobby-button" onClick={onBack}>返回</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2：`WaitingRoomScreen` 元件**

建立 `client/src/lobby/WaitingRoomScreen.jsx`：

```jsx
import { useState, useEffect } from 'react';

export default function WaitingRoomScreen({ socket, roomCode, playerId, onClosed, onLeft, onCharacterSelectStarted }) {
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    function onPlayers(data) {
      setPlayers(data.players);
    }
    function onLobbyClosed() {
      onClosed();
    }
    function onCharacterSelectUpdate() {
      onCharacterSelectStarted();
    }
    socket.on('lobby:players', onPlayers);
    socket.on('lobby:closed', onLobbyClosed);
    socket.on('game:characterSelectUpdate', onCharacterSelectUpdate);
    return () => {
      socket.off('lobby:players', onPlayers);
      socket.off('lobby:closed', onLobbyClosed);
      socket.off('game:characterSelectUpdate', onCharacterSelectUpdate);
    };
  }, [socket, onClosed, onCharacterSelectStarted]);

  const me = players.find((p) => p.playerId === playerId);
  const isHost = Boolean(me && me.isHost);

  function handleLeave() {
    socket.emit('lobby:leave', {}, (res) => {
      if (res && res.error) {
        setError(res.error);
        return;
      }
      onLeft();
    });
  }

  function handleReady() {
    socket.emit('game:startCharacterSelect', {}, (res) => {
      if (res && res.error) setError(res.error);
    });
  }

  return (
    <div className="lobby-watermark-screen">
      <div className="lobby-center-panel">
        <h2>房號：{roomCode}</h2>
        {error && <p className="lobby-error">{error}</p>}
        <ul className="lobby-player-list">
          {players.map((p) => (
            <li key={p.playerId}>
              {p.name}
              {p.isHost && <span className="lobby-host-badge">（房主）</span>}
            </li>
          ))}
        </ul>
        <div className="lobby-waiting-buttons">
          <button className="lobby-button" onClick={handleLeave}>退出大廳</button>
          {isHost && (
            <button className="lobby-button" onClick={handleReady} disabled={players.length < 2}>
              準備完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3：手動驗證**

沒有自動化測試框架，用實際跑起來的伺服器＋兩個瀏覽器分頁手動檢查（下一個任務把這兩個元件接進正式的協調層之後，才有完整可操作的入口，這裡先靠 code review／目測確認語法正確、`npm run build`（在 `client/` 目錄下）不報錯即可）：

Run: `npm run build`（在 `client/` 目錄下）
Expected: build 成功，沒有語法錯誤

- [ ] **Step 4：Commit**

```bash
git add client/src/lobby/LobbyListScreen.jsx client/src/lobby/WaitingRoomScreen.jsx
git commit -m "feat(m2d1): lobby list and waiting room screens"
```

---

### Task 6：協調層（改寫 `LobbyScreen.jsx`）＋ 完整端對端手動驗證

**Files:**
- Modify: `client/src/LobbyScreen.jsx`（整個內容改寫，檔案位置/名稱不變，`main.jsx` 不用改）

**Interfaces:**
- Consumes：Task 4、Task 5 的全部元件；既有的 `createSocket`（`./socket`）
- Produces：`LobbyScreen`（`main.jsx` 既有的進入點，props 不變，維持無 props）內部管理畫面狀態機：`'start' | 'nickname' | 'lobbyList' | 'waitingRoom' | 'placeholder'`

- [ ] **Step 1：實作**

把 `client/src/LobbyScreen.jsx` 整份內容換成：

```jsx
import { useState, useEffect, useRef } from 'react';
import { createSocket } from './socket';
import StartScreen from './lobby/StartScreen';
import NicknameModal from './lobby/NicknameModal';
import LobbyListScreen from './lobby/LobbyListScreen';
import WaitingRoomScreen from './lobby/WaitingRoomScreen';
import CharacterSelectPlaceholder from './lobby/CharacterSelectPlaceholder';
import './lobby/lobby.css';

const ERROR_MESSAGES = {
  ROOM_NOT_FOUND: '找不到這個房號，請確認後再試一次',
  INVALID_NAME: '暱稱不可為空白，且長度不可超過 20 個字',
  ALREADY_IN_ROOM: '您已經在房間內了',
  ROOM_IN_PROGRESS: '這個大廳已經開始遊戲了，無法加入',
  NOT_IN_ROOM: '您目前不在任何房間內',
  TOO_FEW_PLAYERS: '至少需要 2 位玩家才能開始',
};

function translateError(code) {
  return ERROR_MESSAGES[code] || '發生未知錯誤，請稍後再試';
}

export default function LobbyScreen() {
  const socketRef = useRef(null);
  const [screen, setScreen] = useState('start');
  const [nicknameFlow, setNicknameFlow] = useState(null); // 'create' | 'join'
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [nicknameError, setNicknameError] = useState('');
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('disconnect', () => setDisconnected(true));
    return () => socket.close();
  }, []);

  function resetToStart() {
    setScreen('start');
    setRoomCode(null);
    setPlayerId(null);
    setNicknameError('');
  }

  function handleCreateClick() {
    setNicknameFlow('create');
    setNicknameError('');
    setScreen('nickname');
  }

  function handleJoinClick() {
    setNicknameFlow('join');
    setNicknameError('');
    setScreen('nickname');
  }

  function handleNicknameConfirm(enteredName) {
    setName(enteredName);
    if (nicknameFlow === 'create') {
      socketRef.current.emit('lobby:create', { playerName: enteredName }, (res) => {
        if (res && res.error) {
          setNicknameError(translateError(res.error));
          return;
        }
        setRoomCode(res.roomCode);
        setPlayerId(res.playerId);
        setScreen('waitingRoom');
      });
      return;
    }
    // nicknameFlow === 'join'
    setScreen('lobbyList');
  }

  function handleJoined(joinedRoomCode, joinedPlayerId) {
    setRoomCode(joinedRoomCode);
    setPlayerId(joinedPlayerId);
    setScreen('waitingRoom');
  }

  if (disconnected) {
    return (
      <div className="lobby-viewport">
        <div className="lobby-watermark-screen">
          <div className="lobby-center-panel">
            <p className="lobby-error">連線已中斷，請重新整理頁面</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby-viewport">
      {screen === 'start' && <StartScreen onCreateClick={handleCreateClick} onJoinClick={handleJoinClick} />}

      {screen === 'nickname' && (
        <>
          <StartScreen onCreateClick={handleCreateClick} onJoinClick={handleJoinClick} />
          <NicknameModal
            onConfirm={handleNicknameConfirm}
            onCancel={resetToStart}
            error={nicknameError}
          />
        </>
      )}

      {screen === 'lobbyList' && (
        <LobbyListScreen
          socket={socketRef.current}
          name={name}
          onJoined={handleJoined}
          onBack={resetToStart}
        />
      )}

      {screen === 'waitingRoom' && (
        <WaitingRoomScreen
          socket={socketRef.current}
          roomCode={roomCode}
          playerId={playerId}
          onClosed={resetToStart}
          onLeft={() => setScreen('lobbyList')}
          onCharacterSelectStarted={() => setScreen('placeholder')}
        />
      )}

      {screen === 'placeholder' && <CharacterSelectPlaceholder />}
    </div>
  );
}
```

（`screen === 'nickname'` 底下同時渲染 `StartScreen` 跟浮在上面的 `NicknameModal`，讓暱稱視窗有背景可以疊——`NicknameModal` 本身是 `position: fixed; inset: 0` 的滿版浮層，疊在誰上面都可以，這裡選 `StartScreen` 純粹是因為視覺上背景一致，不影響邏輯）

- [ ] **Step 2：完整端對端手動驗證**

Run（在 `server/` 目錄下）: `npm start`（啟動後端）
Run（在 `client/` 目錄下）: `npm run dev`（啟動前端）

用兩個瀏覽器分頁（模擬手機橫向尺寸），依序驗證：
1. 開頭頁面正常顯示 `Gate.png` 背景＋兩個按鈕
2. 分頁 A 點「建立大廳」→ 輸入暱稱「Alice」→ 確認 → 進入等候室，看到自己（房主標記）
3. 分頁 B 點「進入大廳」→ 輸入暱稱「Bob」→ 確認 → 大廳列表看到「Alice 的大廳（1/2）」→ 點擊加入 → 進入等候室，看到 Alice（房主標記）跟自己
4. 分頁 A 的等候室即時（透過 `lobby:players` 廣播）更新，看到 Bob 也加入了
5. 分頁 B 按「退出大廳」→ 回到大廳列表，這時列表應該（手動按重新整理後）顯示「Alice 的大廳（1/2）」
6. 分頁 B 再次加入該大廳
7. 分頁 A（房主）按「準備完成」→ 兩個分頁都應該同時跳到「角色選擇開發中」佔位畫面
8. 重新整個流程一次，這次分頁 A（房主）在等候室按「退出大廳」→ 兩個分頁都應該被踢回開頭頁面
9. 重新整個流程一次，這次分頁 A（房主）直接關閉分頁（不按退出）→ 分頁 B 應該收到 `lobby:closed`、被踢回開頭頁面

全部驗證通過才算這個任務完成。

- [ ] **Step 3：Commit**

```bash
git add client/src/LobbyScreen.jsx
git commit -m "feat(m2d1): wire lobby flow screens together in LobbyScreen"
```
