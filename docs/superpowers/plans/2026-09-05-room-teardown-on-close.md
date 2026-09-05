# 房間清空時資源回收 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 房間真正清空（`closeLobbyRoom`執行完畢）時，把該房間在`gameManager.games`／`effectResolverManager.resolvers`／階段逾時計時器／角色選擇逾時計時器這4處累積的資源全部清乾淨，修掉「計時器永遠不停」跟「房號用完不會釋放導致新房間開不了局」這兩個真實問題。

**Architecture:** 新增一個`teardownRoom`輔助函式收斂4個既有的清理動作（`endGame`／`endResolver`／`clearTimeout`+delete兩個Map的entry），掛在`closeLobbyRoom`函式尾端——這是唯一一個保證執行完後io房間真正清空的函式，不需要在其他分支（非房主離開）額外檢查，因為在現有架構下那些分支永遠不會是「房間變空」的最後一刻。

**Tech Stack:** Node.js + Socket.IO（後端），Jest（測試）。這次改動不涉及前端。

## Global Constraints

- 只掛在`closeLobbyRoom`，不修改`lobby:leave`／`disconnect`的非房主分支——設計文件已論證那個分支在目前架構下不可能是房間真正清空的時刻，加了會是測不到的死分支
- `gameManager.js`／`effectResolverManager.js`本身不需要改動，`endGame`／`endResolver`已經匯出且已有各自的單元測試涵蓋自身行為
- 不處理房間/遊戲生命週期清理的其餘子項目（房主中途斷線的踢人行為、非房主斷線留下幽靈玩家、重連機制、遊戲結束判定邏輯）——這次範圍只有「資源回收」
- 設計文件：[docs/superpowers/specs/2026-09-05-room-teardown-on-close-design.md](../specs/2026-09-05-room-teardown-on-close-design.md)

---

## Task 1: `closeLobbyRoom` 觸發完整資源回收

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `endGame(gameManager, roomCode)`（`server/src/game/gameManager.js`既有匯出）、`endResolver(effectResolverManager, roomCode)`（`server/src/game/effectResolverManager.js`既有匯出）
- Produces: `closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, phaseTimeouts, characterSelectTimeouts)`——簽名新增4個參數，其餘行為（廣播`lobby:closed`、踢出所有socket、清空`lobbyManager`房間記錄）完全不變

- [ ] **Step 1: 寫失敗測試 —— 遊戲進行中房主斷線，驗證完整資源回收＋房號可重用**

在 `server/test/socketHandlers.test.js` 頂部，把現有這一行：

```javascript
const { getGameState } = require('../src/game/gameManager');
```

改成：

```javascript
const { getGameState, startGame } = require('../src/game/gameManager');
```

（既有的 `require('../src/game/gameManager')` 有兩處，這裡改的是取用 `getGameState` 的那一個；另一處 `require('../src/game/gameManager')` 取用的是 `createGameManager`，不用動）

接著在檔案裡任一個既有的 `disconnect`/`lobby:leave` 測試附近（例如緊接在第399行`'the host disconnecting (not an explicit lobby:leave) also closes the room for everyone else'`測試之後）新增：

```javascript
test('closeLobbyRoom during an active game also tears down gameManager/effectResolverManager state and clears the phase timer, freeing the room code for reuse', async () => {
  const { httpServer, clientA, clientB, roomCode, gameManager, effectResolverManager } = await setUpStartedGameWithContent(makeContent());

  expect(getGameState(gameManager, roomCode)).toBeDefined();
  expect(getResolver(effectResolverManager, roomCode)).toBeDefined();

  const closedPromise = new Promise((resolve) => clientB.once('lobby:closed', resolve));
  clientA.close(); // host disconnects mid-game, not an explicit lobby:leave
  await closedPromise;

  expect(getGameState(gameManager, roomCode)).toBeUndefined();
  expect(getResolver(effectResolverManager, roomCode)).toBeUndefined();

  // Regression: before this fix, gameManager.games still held the torn-down
  // game under this exact roomCode forever, so a brand new game reusing the
  // same (randomly generated) room code would fail with GAME_ALREADY_STARTED.
  const content = makeContent();
  expect(() => startGame(gameManager, roomCode, {
    startingRooms: content.startingRooms,
    rooms: content.rooms,
    cards: content.cards,
    characters: content.characters,
    players: [{ playerId: 'p_new', name: 'Carol', characterId: 'char_001' }],
  })).not.toThrow();

  clientB.close();
  httpServer.close();
});
```

`setUpStartedGameWithContent`（既有helper，位於同檔案）用`clientA`建房（永遠是房主），走完整流程開局；`makeContent()`（既有helper）提供測試用的房間/卡片/角色資料。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest socketHandlers.test.js -t "closeLobbyRoom during an active game"`
Expected: FAIL——`clientA.close()`之後`getGameState(gameManager, roomCode)`仍然回傳原本的`gameState`（目前沒有任何程式碼會在房主斷線時清掉它），斷言`toBeUndefined()`失敗

- [ ] **Step 3: 實作 —— `socketHandlers.js`**

在檔案開頭的import區塊，把：

```javascript
const { startGame, getGameState } = require('./game/gameManager');
```

改成：

```javascript
const { startGame, getGameState, endGame } = require('./game/gameManager');
```

把：

```javascript
const { startResolver, getResolver } = require('./game/effectResolverManager');
```

改成：

```javascript
const { startResolver, getResolver, endResolver } = require('./game/effectResolverManager');
```

在既有的`clearCharacterSelectTimeout`函式（約696行）後面新增：

```javascript
function clearPhaseTimeout(roomCode, phaseTimeouts) {
  const existing = phaseTimeouts.get(roomCode);
  if (existing) {
    clearTimeout(existing.handle);
    phaseTimeouts.delete(roomCode);
  }
}

function teardownRoom(gameManager, effectResolverManager, phaseTimeouts, characterSelectTimeouts, roomCode) {
  endGame(gameManager, roomCode);
  endResolver(effectResolverManager, roomCode);
  clearPhaseTimeout(roomCode, phaseTimeouts);
  clearCharacterSelectTimeout(roomCode, characterSelectTimeouts);
}
```

把`closeLobbyRoom`（約1460行）從：

```javascript
async function closeLobbyRoom(io, lobbyManager, roomCode) {
  const sockets = await io.in(roomCode).fetchSockets();
  // Broadcast before any socket leaves the io room: once a socket calls
  // .leave(roomCode), io.to(roomCode).emit(...) can no longer reach it, so
  // emitting after the leave loop would drop lobby:closed for everyone.
  io.to(roomCode).emit('lobby:closed', {});
  for (const s of sockets) {
    s.data.roomCode = null;
    s.data.playerId = null;
    s.leave(roomCode);
  }
  lobbyManager.closeRoom(roomCode);
}
```

改成：

```javascript
async function closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, phaseTimeouts, characterSelectTimeouts) {
  const sockets = await io.in(roomCode).fetchSockets();
  // Broadcast before any socket leaves the io room: once a socket calls
  // .leave(roomCode), io.to(roomCode).emit(...) can no longer reach it, so
  // emitting after the leave loop would drop lobby:closed for everyone.
  io.to(roomCode).emit('lobby:closed', {});
  for (const s of sockets) {
    s.data.roomCode = null;
    s.data.playerId = null;
    s.leave(roomCode);
  }
  lobbyManager.closeRoom(roomCode);
  // This function is the only place a room's io membership is guaranteed to
  // reach zero (every socket above just got kicked, regardless of who was
  // still connected) -- so it's the right, and only, place to release
  // everything else this roomCode ever accumulated.
  teardownRoom(gameManager, effectResolverManager, phaseTimeouts, characterSelectTimeouts, roomCode);
}
```

最後修正`closeLobbyRoom`的兩個呼叫點。第一處在`lobby:leave`（約634行），從：

```javascript
        await closeLobbyRoom(io, lobbyManager, roomCode);
```

改成：

```javascript
        await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, phaseTimeouts, characterSelectTimeouts);
```

第二處在`disconnect`（約649行），同樣的替換：

```javascript
          await closeLobbyRoom(io, lobbyManager, roomCode);
```

改成：

```javascript
          await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, phaseTimeouts, characterSelectTimeouts);
```

（`gameManager`／`effectResolverManager`／`phaseTimeouts`／`characterSelectTimeouts`這4個名稱在這兩處呼叫點都已經在`registerSocketHandlers`的閉包作用域內，不需要額外傳遞）

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest socketHandlers.test.js -t "closeLobbyRoom during an active game"`
Expected: PASS

- [ ] **Step 5: 執行完整後端測試套件，確認既有的4個大廳階段host-leave/disconnect測試沒有回歸**

Run: `cd server && npx jest`
Expected: 全部PASS，包含既有的`'lobby:leave by the host closes the room...'`／`'the host disconnecting...'`等測試（[socketHandlers.test.js:373](../../../server/test/socketHandlers.test.js)、[socketHandlers.test.js:399](../../../server/test/socketHandlers.test.js)）——這些測試只驗證大廳階段行為，`closeLobbyRoom`新增的4個參數屬於函式簽名擴充，不影響它們原本的斷言

- [ ] **Step 6: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "fix: release gameManager/effectResolverManager/timer state when a room's io membership reaches zero"
```

---

## 自我檢查

- **設計文件涵蓋度**：`teardownRoom`的4個清理動作、只掛在`closeLobbyRoom`的理由、房號重用的回歸測試，都對應到這個任務的具體步驟
- **無占位符**：所有程式碼片段皆為完整可執行內容
- **型別/介面一致性**：`teardownRoom(gameManager, effectResolverManager, phaseTimeouts, characterSelectTimeouts, roomCode)`的參數順序、`closeLobbyRoom`新增的4個參數順序，跟兩個呼叫點的引數順序一致
- **範圍單一**：只有這一個任務，因為整個改動集中在同一個檔案的同一段邏輯，拆成多個任務只會讓同一批程式碼被分兩次改，沒有實質切分價值
