# 遊戲進行中斷線視同一般玩家 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `game:started`之後，房主斷線/離開不再有特殊待遇；已知斷線的玩家從下一個新階段開始不擋其他人推進；操控中的NPC比照操控者；最後一個真人玩家斷線時沿用既有的`closeLobbyRoom`完整回收房間。

**Architecture:** 玩家實體新增`connected`欄位；`phaseFlow.js`的`resetPhaseLocks`在每次進入新階段時，把已知斷線的參與者（含NPC，查其操控者）直接視為已鎖定；`socketHandlers.js`的`disconnect`／`lobby:leave`改成先判斷遊戲是否已經開始，是的話走新的統一邏輯（標記斷線＋檢查是否所有真人都斷線了），不是的話完全維持現有的房主/非房主判斷。

**Tech Stack:** Node.js + Socket.IO（後端），Jest（測試）。這次改動不涉及前端。

## Global Constraints

- 不改`allParticipantsLocked`／`lockPlayerPhase`／既有的階段逾時機制——玩家斷線當下所在的那個階段仍然照舊靠逾時強制鎖定，只有下一個新階段開始時才會自動視為已鎖定
- NPC沒有自己的`connected`欄位，查其`controlledBy`指向的玩家
- 這次不做：斷線通知/UI廣播（已記錄為獨立待辦「全局廣播訊息清單及UI」）、重連機制、AI代管
- 設計文件：[docs/superpowers/specs/2026-09-05-disconnect-as-regular-player-design.md](../specs/2026-09-05-disconnect-as-regular-player-design.md)

---

## Task 1: `connected`欄位＋`resetPhaseLocks`自動鎖定已知斷線的參與者

**Files:**
- Modify: `server/src/game/playerEntity.js`
- Modify: `server/src/game/phaseFlow.js`
- Test: `server/test/game/phaseFlow.test.js`

**Interfaces:**
- Produces: `createPlayer(...)`回傳的玩家實體新增`connected: true`欄位
- Produces: `resetPhaseLocks(gameState, phase)`（既有函式，內部邏輯改變，簽名不變）——已連線的參與者行為不變（`phaseLocked = false`），已知斷線的參與者（真人查自己、NPC查`controlledBy`）改成直接`phaseLocked = true`

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/phaseFlow.test.js` 裡，找到既有的`makeGameStateWithPlayers`輔助函式（檔案開頭），在檔案裡任一個既有測試附近（例如緊接在第45行`'enterPhase resets phaseLocked to false for that phase\'s participants'`測試之後）新增：

```javascript
test('enterPhase (via resetPhaseLocks) auto-locks a real player who is already disconnected when the new phase begins', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  gameState.players.get('p1').connected = false;
  enterPhase(gameState, 'player_interact');
  expect(gameState.players.get('p1').phaseLocked).toBe(true);
  expect(gameState.players.get('p2').phaseLocked).toBe(false);
});

test('enterPhase (via resetPhaseLocks) does NOT auto-lock a connected player', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_interact');
  expect(gameState.players.get('p1').phaseLocked).toBe(false);
});

test('enterPhase (via resetPhaseLocks) auto-locks an NPC whose controller is already disconnected, and the round correctly cascades past npc_move to player_interact (where a still-connected real player blocks further auto-advance)', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']); // p2 stays connected so the cascade has somewhere to stop -- with only p1 (disconnected) present, every phase in the round would be entirely disconnected participants and enterPhase would recurse forever advancing phase after phase
  gameState.players.get('p1').connected = false;
  // stats is required: npc_move is a move phase, so enterPhase's move-phase
  // branch calls resetActionPoints on every participant (including NPCs)
  // regardless of lock status, and that reads player.stats.speed -- an NPC
  // fixture without stats throws before the assertions below ever run.
  gameState.players.set('npc_1', { playerId: 'npc_1', isNPC: true, controlledBy: 'p1', phaseLocked: false, stats: makeStats() });
  enterPhase(gameState, 'npc_move');
  expect(gameState.players.get('npc_1').phaseLocked).toBe(true);
  // PHASE_ORDER is ['player_move','npc_move','player_interact','npc_interact','settlement'] --
  // npc_move's next phase is player_interact, NOT npc_interact. The cascade
  // is: npc_move (npc_1 auto-locked, sole participant -> advance) ->
  // player_interact (p1 auto-locked since disconnected, but p2 is connected
  // and NOT auto-locked -> allParticipantsLocked is false -> cascade stops here).
  expect(gameState.currentPhase).toBe('player_interact');
});

test('enterPhase (via resetPhaseLocks) does NOT auto-lock an NPC whose controller is still connected', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.players.set('npc_1', { playerId: 'npc_1', isNPC: true, controlledBy: 'p1', phaseLocked: false, stats: makeStats() });
  enterPhase(gameState, 'npc_move');
  expect(gameState.players.get('npc_1').phaseLocked).toBe(false);
});
```

（`makeGameStateWithPlayers`建立的玩家目前不會有`connected`欄位，因為`createPlayer`還沒被Step 3修改，所以`gameState.players.get('p1').connected = false`這行手動賦值在RED階段其實無意義——測試會失敗是因為`resetPhaseLocks`還沒讀取這個欄位，不是因為欄位不存在，這點在Step 2確認）

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest phaseFlow.test.js -t "auto-locks"`
Expected: 前3個測試FAIL（`resetPhaseLocks`目前無條件把每個參與者設成`phaseLocked = false`，不會因為`connected`是`false`就設成`true`）；第4個測試（「does NOT auto-lock」）目前應該已經PASS（因為現有行為本來就是`false`），這是預期中的——只是還沒被這個原因驗證過，實作後會用同一組邏輯正確通過

- [ ] **Step 3: 實作**

修改 `server/src/game/playerEntity.js` 的 `createPlayer`（約44-63行），在回傳物件裡新增一個欄位（建議放在`inventory: [],`附近，跟其他玩家生命週期欄位放一起）：

```javascript
function createPlayer({ playerId, name, characterId, floor, x, y, stats, actionPoints }) {
  const statTracks = buildStatTracks(stats);
  return {
    playerId,
    name,
    characterId: characterId || null,
    floor,
    x,
    y,
    stats: statTracks,
    actionPoints,
    inventory: [],
    connected: true,
    visitedRooms: [{ floor, x, y }],
    enteredFromSide: null, // null = arrived by spawn/stairs (badge centered), else the door side entered through
    previousPosition: null, // {floor,x,y} snapshot of where the player was immediately before their current position, set by movePlayerTo; null until they've moved at least once
    wieldedWeaponId: null, // id of the currently wielded weapon-category item, at most one
    wornGearIds: [], // ids of currently worn gear-category items, no cap
    pendingStatReverts: [], // {stat, delta} entries applied and cleared by phaseFlow.js's enterPhase when this player's next round's player_move phase starts
  };
}
```

修改 `server/src/game/phaseFlow.js` 的 `resetPhaseLocks`（約39-43行），從：

```javascript
function resetPhaseLocks(gameState, phase) {
  for (const p of getParticipants(gameState, phase)) {
    p.phaseLocked = false;
  }
}
```

改成：

```javascript
function resetPhaseLocks(gameState, phase) {
  for (const p of getParticipants(gameState, phase)) {
    p.phaseLocked = p.isNPC
      ? !(getPlayer(gameState, p.controlledBy)?.connected ?? true)
      : !p.connected;
  }
}
```

（`getPlayer`已經在檔案第1行匯入，不用新增import；找不到操控者時`?? true`預設視為連線中，避免誤鎖——這種情況理論上不會發生，因為玩家永遠不會從`gameState.players`被移除，只會被標記斷線）

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest phaseFlow.test.js`
Expected: 全部PASS

- [ ] **Step 5: 執行完整後端測試套件，確認沒有回歸**

Run: `cd server && npx jest`
Expected: 全部PASS——`createPlayer`新增的`connected: true`欄位是純新增（不影響既有欄位），`resetPhaseLocks`的改動對所有既有測試裡「玩家永遠是連線狀態」（`connected`預設`true`）的情境行為完全不變（`!true`＝`false`，等同原本無條件的`false`）

- [ ] **Step 6: Commit**

```bash
git add server/src/game/playerEntity.js server/src/game/phaseFlow.js server/test/game/phaseFlow.test.js
git commit -m "feat: auto-lock already-disconnected participants (and their NPCs) at the start of each new phase"
```

---

## Task 2: `disconnect`／`lobby:leave` 遊戲開始後統一處理

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `player.connected`（Task 1）、既有的`closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts)`、既有的`getGameState(gameManager, roomCode)`、既有的`getPlayer(gameState, playerId)`
- Produces: 新函式`handlePlayerDisconnectedFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, playerId)`

- [ ] **Step 1: 寫失敗測試**

在 `server/test/socketHandlers.test.js` 裡，找到既有的4個大廳階段host-leave/disconnect測試（[socketHandlers.test.js:373](../../../server/test/socketHandlers.test.js)起）附近，新增：

```javascript
test('the host disconnecting after the game has started does NOT close the room -- handled the same as any other player', async () => {
  const { httpServer, clientA, clientB, roomCode, aliceId, gameManager } = await setUpStartedGameWithContent(makeContent());

  let closedFired = false;
  clientB.on('lobby:closed', () => { closedFired = true; });

  clientA.close(); // host disconnects mid-game
  await new Promise((resolve) => setTimeout(resolve, 100)); // give the server's disconnect handler time to run

  expect(closedFired).toBe(false);
  const gameState = getGameState(gameManager, roomCode);
  expect(gameState).toBeDefined();
  expect(getPlayer(gameState, aliceId).connected).toBe(false);

  clientB.close();
  httpServer.close();
});

test('the last connected real player disconnecting from a started game tears everything down, same as closeLobbyRoom', async () => {
  const { httpServer, clientA, clientB, roomCode, gameManager, effectResolverManager } = await setUpStartedGameWithContent(makeContent());

  clientA.close(); // first disconnect -- game continues (Bob is still connected)
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(getGameState(gameManager, roomCode)).toBeDefined();

  clientB.close(); // second (last) disconnect -- should trigger full teardown
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(getGameState(gameManager, roomCode)).toBeUndefined();
  expect(getResolver(effectResolverManager, roomCode)).toBeUndefined();

  httpServer.close();
});

test('lobby:leave sent by the host after the game has started is handled the same as disconnect -- no room close, just marks them disconnected', async () => {
  const { httpServer, clientA, clientB, roomCode, aliceId, gameManager } = await setUpStartedGameWithContent(makeContent());

  let closedFired = false;
  clientB.on('lobby:closed', () => { closedFired = true; });

  const leaveResult = await new Promise((resolve) => clientA.emit('lobby:leave', {}, resolve));
  expect(leaveResult.error).toBeUndefined();

  expect(closedFired).toBe(false);
  const gameState = getGameState(gameManager, roomCode);
  expect(gameState).toBeDefined();
  expect(getPlayer(gameState, aliceId).connected).toBe(false);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest socketHandlers.test.js -t "after the game has started"`
Expected: 前兩個測試FAIL（目前`disconnect`的房主分支不管遊戲開不開始都無條件呼叫`closeLobbyRoom`，`closedFired`會是`true`，`getGameState`在第一個測試裡會是`undefined`）

Run: `cd server && npx jest socketHandlers.test.js -t "lobby:leave sent by the host"`
Expected: FAIL（同樣原因）

- [ ] **Step 3: 實作**

在 `server/src/socketHandlers.js` 裡，找到`closeLobbyRoom`函式（約1482行）前面，新增：

```javascript
async function handlePlayerDisconnectedFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, playerId) {
  const player = getPlayer(gameState, playerId);
  if (player) {
    player.connected = false;
  }
  const anyoneStillConnected = Array.from(gameState.players.values())
    .filter((p) => !p.isNPC)
    .some((p) => p.connected);
  if (!anyoneStillConnected) {
    // Every real player of this already-started game has now disconnected --
    // closeLobbyRoom doesn't care who triggered it or how many sockets are
    // actually still in the room (it kicks whoever's left, which is
    // correctly zero here), so reusing it is exactly the same teardown path
    // the host-leaves-the-lobby case already uses.
    await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts);
  }
}
```

修改 `lobby:leave` handler（約627-646行），從：

```javascript
    socket.on('lobby:leave', async (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) {
        return ack({ error: 'NOT_IN_ROOM' });
      }
      if (lobbyManager.isHost(roomCode, playerId)) {
        await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts);
      } else {
        // No teardownRoom call here: the host is never removed via this path,
        // so the room's io membership can never reach zero this way -- see
        // closeLobbyRoom, which is the only place that can happen.
        lobbyManager.leaveRoom(roomCode, playerId);
        socket.leave(roomCode);
        socket.data.roomCode = null;
        socket.data.playerId = null;
        broadcastPlayers(io, lobbyManager, roomCode);
      }
      ack({});
    });
```

改成：

```javascript
    socket.on('lobby:leave', async (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) {
        return ack({ error: 'NOT_IN_ROOM' });
      }
      const gameState = getGameState(gameManager, roomCode);
      if (gameState) {
        await handlePlayerDisconnectedFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, playerId);
      } else if (lobbyManager.isHost(roomCode, playerId)) {
        await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts);
      } else {
        // No teardownRoom call here: the host is never removed via this path,
        // so the room's io membership can never reach zero this way -- see
        // closeLobbyRoom, which is the only place that can happen.
        lobbyManager.leaveRoom(roomCode, playerId);
        socket.leave(roomCode);
        socket.data.roomCode = null;
        socket.data.playerId = null;
        broadcastPlayers(io, lobbyManager, roomCode);
      }
      ack({});
    });
```

修改 `disconnect` handler（約648-661行），從：

```javascript
    socket.on('disconnect', async () => {
      const { roomCode, playerId } = socket.data;
      if (roomCode && playerId) {
        if (lobbyManager.isHost(roomCode, playerId)) {
          await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts);
        } else {
          // No teardownRoom call here: the host is never removed via this path,
          // so the room's io membership can never reach zero this way -- see
          // closeLobbyRoom, which is the only place that can happen.
          lobbyManager.leaveRoom(roomCode, playerId);
          broadcastPlayers(io, lobbyManager, roomCode);
        }
      }
    });
```

改成：

```javascript
    socket.on('disconnect', async () => {
      const { roomCode, playerId } = socket.data;
      if (roomCode && playerId) {
        const gameState = getGameState(gameManager, roomCode);
        if (gameState) {
          await handlePlayerDisconnectedFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, playerId);
        } else if (lobbyManager.isHost(roomCode, playerId)) {
          await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts);
        } else {
          // No teardownRoom call here: the host is never removed via this path,
          // so the room's io membership can never reach zero this way -- see
          // closeLobbyRoom, which is the only place that can happen.
          lobbyManager.leaveRoom(roomCode, playerId);
          broadcastPlayers(io, lobbyManager, roomCode);
        }
      }
    });
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest socketHandlers.test.js -t "after the game has started"`
Run: `cd server && npx jest socketHandlers.test.js -t "lobby:leave sent by the host"`
Expected: 全部PASS

- [ ] **Step 5: 執行完整後端測試套件，確認既有的4個大廳階段測試沒有回歸**

Run: `cd server && npx jest`
Expected: 全部PASS，包含既有的`'lobby:leave by the host closes the room...'`／`'the host disconnecting (not an explicit lobby:leave)...'`等4個大廳階段測試（[socketHandlers.test.js:373](../../../server/test/socketHandlers.test.js)、[socketHandlers.test.js:399](../../../server/test/socketHandlers.test.js)）——這些測試的房間都還沒開始遊戲（`getGameState`回傳`undefined`），會正確落入`else if (lobbyManager.isHost(...))`分支，行為跟修改前完全一樣

- [ ] **Step 6: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: treat mid-game host disconnect the same as any other player's"
```

---

## 自我檢查

- **設計文件涵蓋度**：`connected`欄位、`resetPhaseLocks`只在新階段開始時生效（不影響斷線當下的階段）、NPC比照操控者、`disconnect`/`lobby:leave`統一邏輯、沿用`closeLobbyRoom`當最後真人斷線的清理，全部對應到Task 1／Task 2的具體步驟
- **無占位符**：所有程式碼片段均為完整可執行內容
- **型別/介面一致性**：`handlePlayerDisconnectedFromGame`的參數順序、呼叫點的引數順序一致；`player.connected`欄位名稱在Task 1（定義）與Task 2（讀寫）保持一致
- **任務順序**：Task 1（資料模型＋階段鎖定邏輯）必須先於Task 2（handler邏輯依賴`connected`欄位才有意義）；兩個任務都能各自獨立跑完測試
