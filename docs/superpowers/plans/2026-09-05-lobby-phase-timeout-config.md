# 大廳階段秒數可調整 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 房主在建立房間時可設定一個秒數（20~90，預設30），套用到既有「一回合5階段」機制的 `gameState.phaseTimeoutMs`；同時清除3個已確認不再有實際作用的舊逾時常數。

**Architecture:** 秒數存在 `LobbyManager` 的房間記錄，經 `finishCharacterSelection` 讀出寫入 `gameState.phaseTimeoutMs`，`phaseFlow.js` 既有邏輯原封不動套用。同時把 `socketHandlers.js`/`effectResolver.js` 裡三個從未被獨立計時器執行過的死逾時常數（`rollChoiceTimeoutMs`/`inventoryChoiceTimeoutMs`/卡片JSON裡的`effect.timeoutMs`）全部改成讀取 `gameState.phaseTimeoutMs`。

**Tech Stack:** Node.js + Express + Socket.IO（後端）、React + Vite（前端）、Jest（後端測試）。前端無自動化測試框架（`client/package.json`無test script），前端任務用手動瀏覽器驗證取代。

## Global Constraints

- 房主可設定範圍：20~90秒（整數），預設30秒——來自開發者明確指示，範圍驗證只在 `lobby:create` socket handler 這個信任邊界，`LobbyManager.createRoom()`本身不設範圍限制（讓內部/測試呼叫可以繼續用任意短值）
- 角色選擇逾時（`characterSelectTimeoutMs`）完全不動——已確認是唯一真正有獨立`setTimeout`執行的機制，不在本次範圍
- 不採用「即時計算階段剩餘時間」（`phaseDeadline - Date.now()`）的做法，一律直接用`gameState.phaseTimeoutMs`本身，避免引入`timeoutMs<=0`的新錯誤
- 設計文件：[docs/superpowers/specs/2026-09-05-lobby-phase-timeout-config-design.md](../specs/2026-09-05-lobby-phase-timeout-config-design.md)

---

## Task 1: LobbyManager 儲存與驗證階段秒數

**Files:**
- Modify: `server/src/lobbyManager.js`
- Test: `server/test/lobbyManager.test.js`

**Interfaces:**
- Produces: `LobbyManager.createRoom(hostName, hostSocketId, phaseTimeoutSeconds)` — 第三參數選填，回傳值不變（`{roomCode, playerId}`）；房間記錄新增`phaseTimeoutMs`欄位（單位ms）
- Produces: `LobbyManager.getPhaseTimeoutMs(roomCode)` — 回傳該房間的`phaseTimeoutMs`（ms），房間不存在回傳`null`
- Produces: 拋出的新錯誤代碼 `INVALID_PHASE_TIMEOUT`

- [ ] **Step 1: 寫失敗測試 —— 預設值、合法值、非法值、`getPhaseTimeoutMs`**

在 `server/test/lobbyManager.test.js` 檔案結尾新增：

```javascript
test('createRoom without phaseTimeoutSeconds defaults phaseTimeoutMs to 30000', () => {
  const manager = new LobbyManager();
  const { roomCode } = manager.createRoom('Alice', 'socket-1');
  expect(manager.getPhaseTimeoutMs(roomCode)).toBe(30000);
});

test.each([
  [20, 20000],
  [90, 90000],
  [45, 45000],
])('createRoom accepts phaseTimeoutSeconds at %i seconds', (seconds, expectedMs) => {
  const manager = new LobbyManager();
  const { roomCode } = manager.createRoom('Alice', 'socket-1', seconds);
  expect(manager.getPhaseTimeoutMs(roomCode)).toBe(expectedMs);
});

test.each([
  ['below minimum', 19],
  ['above maximum', 91],
  ['non-integer', 30.5],
  ['non-number', 'thirty'],
  ['zero', 0],
  ['negative', -20],
])('createRoom rejects an invalid phaseTimeoutSeconds (%s)', (_label, badValue) => {
  const manager = new LobbyManager();
  expect(() => manager.createRoom('Alice', 'socket-1', badValue)).toThrow('INVALID_PHASE_TIMEOUT');
});

test('getPhaseTimeoutMs returns null for an unknown room code', () => {
  const manager = new LobbyManager();
  expect(manager.getPhaseTimeoutMs('ZZZZ')).toBeNull();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest lobbyManager.test.js`
Expected: 新增的測試全部FAIL（`getPhaseTimeoutMs is not a function`／`createRoom`目前只接受2個參數，第3個會被忽略，不會拋錯）

- [ ] **Step 3: 實作 `lobbyManager.js`**

在檔案開頭的常數區塊（`ROOM_CODE_CHARS`／`MAX_PLAYER_NAME_LENGTH`旁邊）新增：

```javascript
const MIN_PHASE_TIMEOUT_SECONDS = 20;
const MAX_PHASE_TIMEOUT_SECONDS = 90;
const DEFAULT_PHASE_TIMEOUT_SECONDS = 30;
```

在 `normalizePlayerName` 函式後面新增：

```javascript
function normalizePhaseTimeoutSeconds(seconds) {
  if (seconds === undefined) {
    return DEFAULT_PHASE_TIMEOUT_SECONDS;
  }
  if (!Number.isInteger(seconds) || seconds < MIN_PHASE_TIMEOUT_SECONDS || seconds > MAX_PHASE_TIMEOUT_SECONDS) {
    throw new Error('INVALID_PHASE_TIMEOUT');
  }
  return seconds;
}
```

修改 `createRoom` 方法：

```javascript
  createRoom(hostName, hostSocketId, phaseTimeoutSeconds) {
    const name = normalizePlayerName(hostName);
    const phaseTimeoutMs = normalizePhaseTimeoutSeconds(phaseTimeoutSeconds) * 1000;
    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (this.rooms.has(roomCode));

    const playerId = generatePlayerId();
    this.rooms.set(roomCode, {
      players: new Map([[playerId, { name, socketId: hostSocketId }]]),
      hostPlayerId: playerId,
      phaseTimeoutMs,
    });
    return { roomCode, playerId };
  }
```

在 `getHostName` 方法後面新增：

```javascript
  getPhaseTimeoutMs(roomCode) {
    const room = this.rooms.get(roomCode);
    return room ? room.phaseTimeoutMs : null;
  }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest lobbyManager.test.js`
Expected: 全部PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lobbyManager.js server/test/lobbyManager.test.js
git commit -m "feat: add per-room configurable phase timeout to LobbyManager"
```

---

## Task 2: `lobby:create` socket handler 接收秒數 + 前端錯誤翻譯

**Files:**
- Modify: `server/src/socketHandlers.js:54-71`（`lobby:create` handler）
- Modify: `client/src/lobby/errorMessages.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `lobbyManager.createRoom(playerName, socketId, phaseTimeoutSeconds)`（Task 1）
- Produces: `lobby:create` payload新增選填欄位 `phaseTimeoutSeconds`；驗證失敗時ack回傳`{error:'INVALID_PHASE_TIMEOUT'}`

- [ ] **Step 1: 寫失敗測試**

在 `server/test/socketHandlers.test.js` 找到既有的 `lobby:create` 測試附近（檔案開頭，`test('two clients can create/join a room...`之後），新增：

```javascript
test('lobby:create accepts a valid phaseTimeoutSeconds and rejects an out-of-range one', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const goodResult = await new Promise((resolve) =>
    clientA.emit('lobby:create', { playerName: 'Alice', phaseTimeoutSeconds: 45 }, resolve)
  );
  expect(goodResult.error).toBeUndefined();
  expect(goodResult.roomCode).toMatch(/^[A-Z]{4}$/);

  const clientB = ioClient(url);
  const badResult = await new Promise((resolve) =>
    clientB.emit('lobby:create', { playerName: 'Bob', phaseTimeoutSeconds: 5 }, resolve)
  );
  expect(badResult.error).toBe('INVALID_PHASE_TIMEOUT');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('lobby:create without phaseTimeoutSeconds still succeeds (defaults to 30s)', async () => {
  const { httpServer, port } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const result = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  expect(result.error).toBeUndefined();

  clientA.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest socketHandlers.test.js -t "phaseTimeoutSeconds"`
Expected: 第一個測試FAIL（`badResult.error`目前是`undefined`，因為`phaseTimeoutSeconds`還沒被傳給`createRoom`，不會觸發驗證）

- [ ] **Step 3: 修改 `lobby:create` handler**

修改 `server/src/socketHandlers.js` 第54-71行：

```javascript
    socket.on('lobby:create', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { playerName, phaseTimeoutSeconds } = payload || {};
        if (socket.data.roomCode) {
          return ack({ error: 'ALREADY_IN_ROOM' });
        }
        const { roomCode, playerId } = lobbyManager.createRoom(playerName, socket.id, phaseTimeoutSeconds);
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
```

（只多解構`phaseTimeoutSeconds`並傳給`createRoom`第三參數，其餘不變；既有的try/catch已經會把`INVALID_PHASE_TIMEOUT`透過`ack({error:err.message})`回傳，不需要額外處理）

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest socketHandlers.test.js -t "phaseTimeoutSeconds"`
Expected: 兩個測試都PASS

- [ ] **Step 5: 新增前端錯誤翻譯**

修改 `client/src/lobby/errorMessages.js`，在 `INVALID_NAME` 那一行後面新增一行：

```javascript
  INVALID_NAME: '暱稱不可為空白，且長度不可超過 20 個字',
  INVALID_PHASE_TIMEOUT: '每階段秒數必須是 20~90 之間的整數',
```

- [ ] **Step 6: 執行完整後端測試套件，確認沒有回歸**

Run: `cd server && npx jest`
Expected: 除了Task 3會處理的3個既有`phaseTimeoutMs`快速逾時測試外，其餘全部PASS（這3個測試目前仍然通過，因為`registerSocketHandlers`的`phaseTimeoutMs`閉包還沒被移除）

- [ ] **Step 7: Commit**

```bash
git add server/src/socketHandlers.js client/src/lobby/errorMessages.js server/test/socketHandlers.test.js
git commit -m "feat: wire phaseTimeoutSeconds through lobby:create"
```

---

## Task 3: 把房間設定的秒數接進 `gameState.phaseTimeoutMs`，並清除死掉的擲骰/道具逾時參數

這個任務把 `socketHandlers.js` 裡三個逾時閉包常數（`phaseTimeoutMs`／`rollChoiceTimeoutMs`／`inventoryChoiceTimeoutMs`）一次處理完，因為它們貫穿同一批函式，分開做會對同一行改兩次。

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `lobbyManager.getPhaseTimeoutMs(roomCode)`（Task 1）
- Produces: `gameState.phaseTimeoutMs` 在遊戲開始時等於房主設定的值（既有`createGameState`介面不變）

- [ ] **Step 1: 執行完整測試套件，記錄基準線**

Run: `cd server && npx jest 2>&1 | tail -20`
Expected: 記下目前的通過數（上一階段worklog記錄是755/755全綠，這裡應該一致），作為這個任務前後比對的基準

- [ ] **Step 2: 刪除三個逾時閉包常數**

修改 `server/src/socketHandlers.js` 第48-50行，從：

```javascript
  const rollChoiceTimeoutMs = options.rollChoiceTimeoutMs || 20000;
  const inventoryChoiceTimeoutMs = options.inventoryChoiceTimeoutMs || 20000;
  const phaseTimeoutMs = options.phaseTimeoutMs; // undefined defers to gameState.js's own 30000 default
```

改成完全刪除這三行（`characterSelectTimeoutMs`／`characterSelectTimeouts`維持不動）。

- [ ] **Step 3: `finishCharacterSelection` 改讀 `lobbyManager`，並跟另外兩個函式一起移除 `phaseTimeoutMs` 參數**

修改 `finishCharacterSelection` 簽名與函式開頭（約第1419行）：

```javascript
function finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, phaseTimeouts) {
  const phaseTimeoutMs = lobbyManager.getPhaseTimeoutMs(roomCode);
  const entry = getCharacterSelection(characterSelectionManager, roomCode);
```

（原本函式體其餘部分不變——`phaseTimeoutMs`這個區域變數名稱維持一樣，後面`startGame({...,phaseTimeoutMs})`那行完全不用改）

修改 `advanceCharacterSelection` 簽名（約第663行），從：

```javascript
function advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts, phaseTimeoutMs, phaseTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs) {
```

改成：

```javascript
function advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts, phaseTimeouts) {
```

同一個函式內部呼叫`finishCharacterSelection`那行（約第666行），從：

```javascript
    finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, phaseTimeoutMs, phaseTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
```

改成：

```javascript
    finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, phaseTimeouts);
```

修改 `handleCharacterSelectTimeout` 簽名（約第1402行），從：

```javascript
function handleCharacterSelectTimeout(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, promptId, playerId, characterSelectTimeoutMs, characterSelectTimeouts, phaseTimeoutMs, phaseTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs) {
```

改成：

```javascript
function handleCharacterSelectTimeout(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, promptId, playerId, characterSelectTimeoutMs, characterSelectTimeouts, phaseTimeouts) {
```

同一個函式內部呼叫`advanceCharacterSelection`那行（約第1413行），從：

```javascript
    advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts, phaseTimeoutMs, phaseTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
```

改成：

```javascript
    advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts, phaseTimeouts);
```

最後，函式內部建立`setTimeout`呼叫`handleCharacterSelectTimeout`的那個區塊（約第681-699行，`advanceCharacterSelection`內部），把傳入的引數清單同步移除`phaseTimeoutMs, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs`這三個（改成跟新簽名一致，只留`phaseTimeouts`）。

還有 `registerSocketHandlers` 主體裡直接呼叫 `advanceCharacterSelection` 的兩處（約第131、158行），從：

```javascript
        advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts, phaseTimeoutMs, phaseTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
```

改成：

```javascript
        advanceCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, characterSelectTimeoutMs, characterSelectTimeouts, phaseTimeouts);
```

- [ ] **Step 4: 機械式移除其餘函式的 `rollChoiceTimeoutMs`／`inventoryChoiceTimeoutMs` 參數與呼叫引數**

以下每個函式簽名，移除參數列表裡的 `rollChoiceTimeoutMs` 與 `inventoryChoiceTimeoutMs`（兩者一律相鄰出現，直接整組拿掉；有預設值`=20000`的一併拿掉）：

- `scheduleOrRefreshPhaseTimeout`（約711行）
- `handlePhaseTimeout`（約726行）——內部呼叫`resolveRollChoiceByTimeout`／`resolveEffectChoiceByTimeout`／`scheduleOrRefreshPhaseTimeout`的引數同步移除
- `openInventoryChoiceIfNeeded`（約778行）——見Step 5，同時要改內部的`timeoutMs`來源
- `finishMoveResult`（約907行）——內部呼叫`resolveCardDraw`的引數同步移除
- `handleLeaveCheckRollPending`（約970行）——見Step 5
- `handleCollapseCheckRollPending`（約998行）——見Step 5
- `applyRoomEndTurnBonus`（約1026行）——內部呼叫`handleEffectResolveResult`的引數同步移除
- `resolveCardDraw`（約1097行）——內部呼叫`openInventoryChoiceIfNeeded`／`handleEffectResolveResult`的引數同步移除
- `handleEffectResolveResult`（約1160行）——內部呼叫`handleRollChoicePending`的引數同步移除
- `handleRollChoicePending`（約1237行）——見Step 5
- `resumeRollChoice`（約1281行）——內部呼叫`resumeLeaveCheckRollChoice`／`resumeCollapseCheckRollChoice`／`handleEffectResolveResult`的引數同步移除
- `resumeLeaveCheckRollChoice`（約1298行）——內部呼叫`finishMoveResult`的引數同步移除
- `resumeCollapseCheckRollChoice`（約1319行）——內部呼叫`finishMoveResult`的引數同步移除
- `resolveRollChoiceByTimeout`（約1351行）——內部呼叫`resumeRollChoice`的引數同步移除
- `resolveEffectChoiceByTimeout`（約1372行）——內部呼叫`handleEffectResolveResult`的引數同步移除

同時要修正 `registerSocketHandlers` 主體內所有直接呼叫上述函式的地方（約第191、202、208、214、215、252、341、363、367、377、379、387、424、498、508、515、548、552、588、592、622行）——每一處都是把呼叫引數列表最後的`rollChoiceTimeoutMs, inventoryChoiceTimeoutMs`（或單獨的`inventoryChoiceTimeoutMs`，視函式而定）拿掉。

> 這一步全部是「刪除同一組已經確認死掉的參數」，沒有分支邏輯改動。建議用編輯器對`, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs`／`, inventoryChoiceTimeoutMs)`／`rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, `這幾種精確字串做全檔案搜尋，確認每一處出現都屬於上面列出的函式後再刪，刪除後用Step 6的測試驗證沒有漏改或改錯。

- [ ] **Step 5: 把4個直接建立`timeoutMs`的地方改成讀`gameState.phaseTimeoutMs`**

`openInventoryChoiceIfNeeded`（約794行），從：
```javascript
    timeoutMs: inventoryChoiceTimeoutMs,
```
改成：
```javascript
    timeoutMs: gameState.phaseTimeoutMs,
```

`handleLeaveCheckRollPending`（約978行），從：
```javascript
    timeoutMs: rollChoiceTimeoutMs,
```
改成：
```javascript
    timeoutMs: gameState.phaseTimeoutMs,
```

`handleCollapseCheckRollPending`（約1006行），同樣從`timeoutMs: rollChoiceTimeoutMs,`改成`timeoutMs: gameState.phaseTimeoutMs,`

`handleRollChoicePending`（約1260行），同樣從`timeoutMs: rollChoiceTimeoutMs,`改成`timeoutMs: gameState.phaseTimeoutMs,`

同時，烹飪選擇的寫死值（約312行，`game:selectAction`裡`room_action`分支的`craft`情境），從：
```javascript
              timeoutMs: 20000,
```
改成：
```javascript
              timeoutMs: gameState.phaseTimeoutMs,
```

- [ ] **Step 6: 修正因為移除`registerSocketHandlers`的`phaseTimeoutMs`選項而壞掉的3個既有測試**

修改 `server/test/socketHandlers.test.js` 的 `setUpStartedGameWithContent` 函式（約2514行），把 `lobbyManager` 加進解構，並在房間建立後、`game:startCharacterSelect`之前，直接寫入短逾時值：

```javascript
async function setUpStartedGameWithContent(content, options) {
  const { httpServer, port, lobbyManager, gameManager, effectResolverManager, io } = await startTestServer(content, options);
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) => clientA.emit('lobby:create', { playerName: 'Alice' }, resolve));
  const roomCode = created.roomCode;
  const aliceId = created.playerId;

  if (options && options.phaseTimeoutMs) {
    lobbyManager.rooms.get(roomCode).phaseTimeoutMs = options.phaseTimeoutMs;
  }

  const clientB = ioClient(url);
```

（只新增`lobbyManager`解構跟中間那個`if`區塊，其餘程式碼不變；這個寫法跟同檔案裡既有的`getPlayer(gameState, currentPlayerId).actionPoints = 1`直接讀寫內部狀態做測試設置是同一種慣例）

- [ ] **Step 7: 新增一個驗證秒數確實流通到`gameState`的整合測試**

在 `server/test/socketHandlers.test.js` 裡新增：

```javascript
test('a game started from a room with a custom phaseTimeoutSeconds uses it as gameState.phaseTimeoutMs', async () => {
  const { httpServer, port, gameManager } = await startTestServer();
  const url = `http://localhost:${port}`;

  const clientA = ioClient(url);
  const created = await new Promise((resolve) =>
    clientA.emit('lobby:create', { playerName: 'Alice', phaseTimeoutSeconds: 60 }, resolve)
  );
  const roomCode = created.roomCode;
  const aliceId = created.playerId;

  const clientB = ioClient(url);
  await new Promise((resolve) => clientB.emit('lobby:join', { roomCode, playerName: 'Bob' }, resolve));

  const started = new Promise((resolve) => clientA.once('game:started', resolve));
  const firstPromptA = new Promise((resolve) => clientA.once('game:prompt', resolve));
  const firstPromptB = new Promise((resolve) => clientB.once('game:prompt', resolve));
  await new Promise((resolve) => clientA.emit('game:startCharacterSelect', {}, resolve));
  const [prompt1] = await Promise.all([firstPromptA, firstPromptB]);
  const firstPickerClient = prompt1.targetPlayerId === aliceId ? clientA : clientB;
  const secondPickerClient = prompt1.targetPlayerId === aliceId ? clientB : clientA;

  const secondPrompt = new Promise((resolve) => secondPickerClient.once('game:prompt', resolve));
  const firstRespondedA = new Promise((resolve) => clientA.once('game:promptResolved', resolve));
  const firstRespondedB = new Promise((resolve) => clientB.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    firstPickerClient.emit('game:promptRespond', { promptId: prompt1.promptId, optionId: prompt1.options[0] }, resolve)
  );
  await Promise.all([firstRespondedA, firstRespondedB]);
  const prompt2 = await secondPrompt;
  const secondRespondedA = new Promise((resolve) => clientA.once('game:promptResolved', resolve));
  const secondRespondedB = new Promise((resolve) => clientB.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    secondPickerClient.emit('game:promptRespond', { promptId: prompt2.promptId, optionId: prompt2.options[0] }, resolve)
  );
  await Promise.all([secondRespondedA, secondRespondedB]);
  await started;

  const gameState = getGameState(gameManager, roomCode);
  expect(gameState.phaseTimeoutMs).toBe(60000);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 8: 執行完整測試套件，確認回到Step 1的基準線（含新增測試）**

Run: `cd server && npx jest`
Expected: 全部PASS，總數等於Step 1基準線加上這個任務新增的測試數量

- [ ] **Step 9: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "refactor: route phaseTimeoutMs from room config, remove dead roll/inventory choice timeout params"
```

---

## Task 4: `effectResolver.js` 改用 `gameState.phaseTimeoutMs`

**Files:**
- Modify: `server/src/game/effectResolver.js:508-540`
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: `gameState.phaseTimeoutMs`（已存在的既有欄位）
- Produces: `handleChoice`／`handlePreviewAndChoose`不再讀`effect.timeoutMs`

- [ ] **Step 1: 更新既有測試的期望值**

`effect.timeoutMs`被忽略後，`server/test/game/effectResolver.test.js`裡唯一直接斷言`deadline`數值的測試（約1304-1314行）需要更新期望值，因為來源從測試自訂的`effect.timeoutMs:20000`改成`gameState`預設的`phaseTimeoutMs`（`createGameState`未帶`options`時預設30000）。修改：

```javascript
test('resolveEffects choice result includes description, deadline, and defaultOptionId for the caller to schedule a real timeout', () => {
  const gameState = makeGameStateWithPlayer();
  const promptState = createPromptState();
  const options = [{ optionId: 'opt_might', effects: [] }];
  const result = resolveEffects(gameState, promptState, 'p1', [
    { type: 'choice', description: '選擇要下降哪項', options, defaultOptionId: 'opt_might' },
  ], { now: 1000 });
  expect(result.description).toBe('選擇要下降哪項');
  expect(result.deadline).toBe(31000); // now(1000) + gameState.phaseTimeoutMs(30000)
  expect(result.defaultOptionId).toBe('opt_might');
});
```

（拿掉輸入裡的`timeoutMs: 20000`，因為它已經不會被讀取，留著只會誤導——並把期望值從`21000`改成`31000`）

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest effectResolver.test.js -t "includes description, deadline"`
Expected: FAIL（目前`result.deadline`仍然是`21000`，因為程式碼還在讀`effect.timeoutMs`）

- [ ] **Step 3: 修改 `effectResolver.js`**

修改 `handlePreviewAndChoose`（約508-530行）：

```javascript
function handlePreviewAndChoose(gameState, promptState, playerId, effect, context) {
  const deckField = DECK_FIELD_BY_TYPE[effect.deck];
  if (!deckField) {
    throw new Error('UNKNOWN_DECK_TYPE');
  }
  const deck = gameState[deckField];
  const previewCards = deck.cards.slice(0, effect.count);
  if (previewCards.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const options = previewCards.map((card) => ({
    optionId: card.id,
    label: card.name,
    effects: [{ type: 'take_previewed_card', deck: effect.deck, cardId: card.id }],
  }));
  options.push({ optionId: '__skip__', label: '放棄', effects: [] });
  return handleChoice(gameState, promptState, playerId, {
    description: effect.description,
    timeoutMs: gameState.phaseTimeoutMs,
    defaultOptionId: '__skip__',
    options,
  }, context);
}

function handleChoice(gameState, promptState, playerId, effect, context) {
  const prompt = createPrompt(promptState, {
    type: 'effect_choice',
    targetPlayerId: playerId,
    description: effect.description,
    options: effect.options.map((o) => o.optionId),
    timeoutMs: gameState.phaseTimeoutMs,
    now: context.now,
  });
```

（只把兩處`effect.timeoutMs`改成`gameState.phaseTimeoutMs`，函式其餘部分不變）

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest effectResolver.test.js`
Expected: 全部PASS（其餘使用`timeoutMs:20000`當輸入、但沒有斷言`deadline`數值的測試——如`preview_and_choose`相關測試——不受影響，因為那個欄位現在只是被忽略的多餘屬性）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "refactor: effectResolver choice prompts use gameState.phaseTimeoutMs instead of dead effect.timeoutMs"
```

---

## Task 5: 清除卡片JSON裡已經死掉的 `timeoutMs` 欄位

**Files:**
- Modify: `data/cards/event-cards.json:137,407`
- Modify: `data/cards/omen-cards.json:23`
- Test: `server/test/game/effectResolver.test.js:1892-1914`

**Interfaces:**
- 無（純資料清理，不影響任何程式介面）

- [ ] **Step 1: 更新讀取真實JSON內容的既有測試**

`server/test/game/effectResolver.test.js`裡`'event_031 in data/cards/event-cards.json has the expected choice+random_effect data...'`這個測試（約1892-1914行）直接讀取`event-cards.json`並用`toEqual`做精確比對，`timeoutMs`欄位刪除後這個測試會失敗，需要同步修改期望值。修改約1903-1914行：

```javascript
  expect(event031.effects).toEqual([{
    type: 'choice',
    description: '紅色藥丸還是藍色藥丸？',
    defaultOptionId: 'give_up',
    onTimeout: 'random',
    options: [
      { optionId: 'red', label: '紅色', effects: [fiftyFifty] },
      { optionId: 'blue', label: '藍色', effects: [fiftyFifty] },
      { optionId: 'give_up', label: '放棄', effects: [fiftyFifty] },
    ],
  }]);
```

（拿掉`timeoutMs: 20000,`這一行，其餘不變）

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest effectResolver.test.js -t "event_031"`
Expected: FAIL（目前真實JSON檔案裡還有`timeoutMs:20000`，跟Step 1改過的期望值對不上）

- [ ] **Step 3: 移除JSON資料裡的死欄位**

`data/cards/event-cards.json`第137行，從：
```json
          "timeoutMs": 20000,
```
整行刪除（event_010「電話鈴聲」卡片的`choice`效果裡）。

`data/cards/event-cards.json`第407行，從：
```json
      "timeoutMs": 20000,
```
整行刪除（event_031「紅藍藥丸」卡片的`choice`效果裡）。

`data/cards/omen-cards.json`第23行，從：
```json
      { "min": 4, "max": 16, "pass": true, "effects": [{ "type": "preview_and_choose", "deck": "event", "count": 3, "description": "選擇一張事件卡", "timeoutMs": 20000 }] },
```
改成：
```json
      { "min": 4, "max": 16, "pass": true, "effects": [{ "type": "preview_and_choose", "deck": "event", "count": 3, "description": "選擇一張事件卡" }] },
```

（每處刪除後用`node -e "JSON.parse(require('fs').readFileSync('data/cards/event-cards.json'))"`跟對`omen-cards.json`同樣的指令，確認JSON格式仍然合法——逗號位置容易在刪除單行時出錯）

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest effectResolver.test.js`
Expected: 全部PASS

- [ ] **Step 5: 執行完整後端測試套件，確認沒有其他回歸**

Run: `cd server && npx jest`
Expected: 全部PASS

- [ ] **Step 6: Commit**

```bash
git add data/cards/event-cards.json data/cards/omen-cards.json server/test/game/effectResolver.test.js
git commit -m "chore: remove dead timeoutMs fields from event/omen card data"
```

---

## Task 6: 前端 —— 建立房間時輸入階段秒數

**Files:**
- Modify: `client/src/lobby/NicknameModal.jsx`
- Modify: `client/src/LobbyScreen.jsx:62-90`

**Interfaces:**
- Consumes: `lobby:create`payload新增`phaseTimeoutSeconds`（Task 2）
- Produces: `NicknameModal`的`onConfirm`callback簽名從`onConfirm(trimmedName)`改成`onConfirm(trimmedName, phaseTimeoutSeconds)`（`phaseTimeoutSeconds`在`nicknameFlow==='join'`時為`undefined`）

前端沒有自動化測試框架（`client/package.json`沒有test script），這個任務用手動瀏覽器驗證取代自動測試。

- [ ] **Step 1: 修改 `NicknameModal.jsx` 加入秒數輸入欄位**

完整改寫 `client/src/lobby/NicknameModal.jsx`：

```javascript
import { useState } from 'react';

const DEFAULT_PHASE_TIMEOUT_SECONDS = 30;
const MIN_PHASE_TIMEOUT_SECONDS = 20;
const MAX_PHASE_TIMEOUT_SECONDS = 90;

export default function NicknameModal({ onConfirm, onCancel, error, mode }) {
  const [name, setName] = useState('');
  const [phaseTimeoutSeconds, setPhaseTimeoutSeconds] = useState(DEFAULT_PHASE_TIMEOUT_SECONDS);

  function handleConfirm() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed, mode === 'create' ? phaseTimeoutSeconds : undefined);
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
        {mode === 'create' && (
          <div className="lobby-modal-field">
            <label htmlFor="phase-timeout-input">每階段秒數（{MIN_PHASE_TIMEOUT_SECONDS}~{MAX_PHASE_TIMEOUT_SECONDS}）</label>
            <input
              id="phase-timeout-input"
              className="lobby-modal-input"
              type="number"
              min={MIN_PHASE_TIMEOUT_SECONDS}
              max={MAX_PHASE_TIMEOUT_SECONDS}
              value={phaseTimeoutSeconds}
              onChange={(e) => setPhaseTimeoutSeconds(Number(e.target.value))}
            />
          </div>
        )}
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

（新增`mode` prop決定要不要顯示秒數欄位；`onConfirm`第二參數只有`mode==='create'`才帶值）

- [ ] **Step 2: 修改 `LobbyScreen.jsx` 傳遞 `mode` 並在payload帶上秒數**

修改 `client/src/LobbyScreen.jsx` 第74-90行的 `handleNicknameConfirm`：

```javascript
  function handleNicknameConfirm(enteredName, phaseTimeoutSeconds) {
    setName(enteredName);
    if (nicknameFlow === 'create') {
      socketRef.current.emit('lobby:create', { playerName: enteredName, phaseTimeoutSeconds }, (res) => {
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
```

（只在函式簽名多接一個參數、payload多帶一個欄位，其餘不變）

找到 `LobbyScreen.jsx` 裡render `NicknameModal`的地方（`screen === 'nickname'`分支），加上 `mode={nicknameFlow}` prop：

```javascript
<NicknameModal
  onConfirm={handleNicknameConfirm}
  onCancel={() => setScreen('start')}
  error={nicknameError}
  mode={nicknameFlow}
/>
```

- [ ] **Step 3: 手動瀏覽器驗證**

啟動前後端開發伺服器（`server`目錄`npm start`、`client`目錄`npm run dev`），在瀏覽器：
1. 點「建立房間」→ 輸入暱稱畫面應該同時看到暱稱欄位跟「每階段秒數（20~90）」欄位，預設顯示30
2. 把秒數改成15（低於下限）送出 → 應該顯示錯誤訊息「每階段秒數必須是 20~90 之間的整數」
3. 把秒數改成45送出 → 應該成功進入等待室
4. 用另一個瀏覽器分頁「加入房間」流程 → 輸入暱稱畫面應該**沒有**秒數欄位
5. 兩人都選好角色開始遊戲後，在瀏覽器開發者工具的Network/Socket.IO面板確認`game:started`payload的`phaseDeadline`落在「目前時間+45秒」附近（而不是原本寫死的30秒）

- [ ] **Step 4: Commit**

```bash
git add client/src/lobby/NicknameModal.jsx client/src/LobbyScreen.jsx
git commit -m "feat: let the host set per-phase countdown seconds when creating a room"
```

---

## 自我檢查

- **設計文件涵蓋度**：資料流（Task 1-3）、驗證規則（Task 1-2）、角色選擇逾時不動（Task 3 Step 3 明確保留其獨立性）、死參數清除（Task 3-5）、前端UI（Task 6）、測試影響段落列出的3個既有測試修正（Task 3 Step 6）與新增測試（Task 1/2/3）全部對應到具體任務
- **無占位符**：所有程式碼片段均為完整可執行內容，Task 3的機械式移除步驟雖然用「約N行」加清單列出而非逐一貼出完整函式，但變換規則（刪除這兩個具名參數/引數）100%明確且清單完整，不是模糊描述
- **型別/介面一致性**：`phaseTimeoutSeconds`（房主輸入，秒）／`phaseTimeoutMs`（內部儲存與`gameState`欄位，毫秒）的欄位名稱在Task 1-3-6三處保持一致；`getPhaseTimeoutMs`的呼叫簽名在Task 1定義、Task 3消費，一致
- **任務順序**：Task 1→2→3有嚴格依賴（`createRoom`/`getPhaseTimeoutMs`→socket handler→character-select流程），Task 4→5有依賴（先讓程式碼不讀`effect.timeoutMs`，再刪JSON資料，避免中間態測試失敗），Task 6依賴Task 2的payload欄位名稱；6個任務都能獨立跑完自己的測試後再進到下一個
