# 角色死亡判定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 真人玩家角色在邪祟降臨後，能力刻度降到骷髏頭刻度即死亡；死亡後不擋任何階段推進；死亡當回合結束時，系統主動把他移出遊戲，重用既有的斷線／房間回收機制。

**Architecture:** 死亡判定集中在`playerEntity.js`的`changeStat`（唯一的屬性mutate函式）；死亡不擋階段推進靠修改`phaseFlow.js`的`allParticipantsLocked`讓死亡角色直接視為滿足鎖定條件；回合結束移出遊戲靠在`handleLockPhase`／`handlePhaseTimeout`（唯二能讓階段真正推進到`player_move`的地方）尾端掛一個檢查，重用既有的`handlePlayerDisconnectedFromGame`＋`closeLobbyRoom`完成房間回收。

**Tech Stack:** Node.js, Socket.IO, Jest。

## Global Constraints

- 死亡機制只套用在真人玩家身上，不含NPC（NPC沒有client/socket，明確排除）
- 這次不寫邪祟降臨本身（叛徒/生還者分陣營、劇本查表）跟勝利條件的實際判斷邏輯，只在兩個指定位置留註解標明未來掛鉤點
- 對應設計文件：[docs/superpowers/specs/2026-09-10-character-death-design.md](../specs/2026-09-10-character-death-design.md)

---

## Task 1: `changeStat`死亡判定 + `isDead`欄位

**Files:**
- Modify: `server/src/game/playerEntity.js:44-64`（`createPlayer`）、`:112-140`（`changeStat`）
- Test: `server/test/game/playerEntity.test.js`

**Interfaces:**
- Produces: `player.isDead`（boolean，`createPlayer`預設`false`，NPC沒有這個欄位）；`changeStat(player, stat, delta, hauntStarted)`在`hauntStarted && !player.isNPC && track.currentIndex === track.skullIndex`時把`player.isDead`設成`true`（副作用，不改變回傳值——`changeStat`本來就沒有回傳值）

- [ ] **Step 1: 寫失敗測試**

在`server/test/game/playerEntity.test.js`裡，`changeStat throws INVALID_HAUNT_FLAG...`這個測試（第156-161行）後面加入：

```javascript
test('changeStat marks isDead when the haunt has started and a stat drops to skullIndex', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'knowledge', -10, true);
  expect(player.stats.knowledge.currentIndex).toBe(0); // skullIndex itself
  expect(player.isDead).toBe(true);
});

test('changeStat does not mark isDead when a stat drops but stays above skullIndex, even after the haunt starts', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'might', -1, true); // baseIndex 2 -> currentIndex 1, still above skullIndex 0
  expect(player.stats.might.currentIndex).toBe(1);
  expect(player.isDead).toBe(false);
});

test('changeStat does not mark isDead before the haunt starts, since the floor prevents reaching skullIndex', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  changeStat(player, 'knowledge', -10, false);
  expect(player.stats.knowledge.currentIndex).toBe(1); // floored at skullIndex(0)+1, never reaches skullIndex
  expect(player.isDead).toBe(false);
});

test('changeStat does not mark isDead for an NPC, even if the haunt has started and its stat reaches skullIndex', () => {
  const npc = createNpc({ npcID: 'npc_001', controlledBy: 'p1', floor: 'ground', x: 0, y: 0, stats: makeNpcStats() });
  changeStat(npc, 'knowledge', -10, true);
  expect(npc.stats.knowledge.currentIndex).toBe(0); // skullIndex itself
  expect(npc.isDead).toBeUndefined(); // death mechanic doesn't apply to NPCs at all
});

test('createPlayer defaults isDead to false', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(player.isDead).toBe(false);
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `cd server && npx jest test/game/playerEntity.test.js -t "isDead" --forceExit`
Expected: 5個新測試全部FAIL（`isDead`是`undefined`，不是`true`/`false`）

- [ ] **Step 3: 實作**

`playerEntity.js`的`createPlayer`（[playerEntity.js:44](../../../server/src/game/playerEntity.js)），在`connected,`那一行後面加一行：

```javascript
function createPlayer({ playerId, name, characterId, floor, x, y, stats, actionPoints, connected = true }) {
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
    connected,
    isDead: false,
    visitedRooms: [{ floor, x, y }],
```

`changeStat`（[playerEntity.js:112](../../../server/src/game/playerEntity.js)）的負向分支，最後加上死亡判定：

```javascript
  } else if (delta < 0) {
    let amount = -delta;
    const fromOverflow = Math.min(track.overflow, amount);
    track.overflow -= fromOverflow;
    amount -= fromOverflow;
    const minIndex = hauntStarted ? track.skullIndex : track.skullIndex + 1;
    track.currentIndex = Math.max(track.currentIndex - amount, minIndex);
    if (!player.isNPC && hauntStarted && track.currentIndex === track.skullIndex) {
      player.isDead = true;
    }
  }
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `cd server && npx jest test/game/playerEntity.test.js --forceExit`
Expected: 全部PASS

- [ ] **Step 5: 跑全套件確認無回歸**

Run: `cd server && npx jest --forceExit`
Expected: 全部PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/game/playerEntity.js server/test/game/playerEntity.test.js
git commit -m "feat: mark a real player isDead when the haunt has started and a stat reaches skullIndex

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: 邪祟降臨當下的特例——`settlement`階段一次性補判

**Files:**
- Modify: `server/src/game/gameState.js:6-18`（`createGameState`）
- Modify: `server/src/socketHandlers.js:1167-1175`（`hauntStarted`翻`true`那段）
- Modify: `server/src/game/phaseFlow.js:1-2, 56-96`（`enterPhase`）
- Test: `server/test/game/gameState.test.js`、`server/test/game/phaseFlow.test.js`

**Interfaces:**
- Consumes: Task 1的`player.isDead`欄位
- Produces: `gameState.pendingHauntGraceCheck`（boolean，`createGameState`預設`false`）；`enterPhase`在進入`settlement`且該旗標為`true`時，掃描真人玩家標記`isDead`後把旗標清成`false`

- [ ] **Step 1: 寫失敗測試（`gameState.js`預設值）**

`server/test/game/gameState.test.js`，`createGameState builds a board...`測試（第29-36行）後面加入：

```javascript
test('createGameState defaults pendingHauntGraceCheck to false', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms(3));
  expect(gameState.pendingHauntGraceCheck).toBe(false);
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `cd server && npx jest test/game/gameState.test.js -t "pendingHauntGraceCheck" --forceExit`
Expected: FAIL（`undefined`不是`false`）

- [ ] **Step 3: 實作`gameState.js`**

`createGameState`（[gameState.js:6](../../../server/src/game/gameState.js)），`hauntStarted: false,`後面加一行：

```javascript
function createGameState(startingRooms, rooms, cards = {}, options = {}) {
  return {
    board: createBoard(startingRooms),
    players: new Map(),
    hauntStarted: false,
    pendingHauntGraceCheck: false,
    omenCount: 0,
    roomDeck: createRoomDeck(rooms),
    eventDeck: createCardDeck(cards.events || []),
    itemDeck: createCardDeck(cards.items || []),
    omenDeck: createCardDeck(cards.omens || []),
    phaseTimeoutMs: options.phaseTimeoutMs || 30000,
  };
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `cd server && npx jest test/game/gameState.test.js --forceExit`
Expected: 全部PASS

- [ ] **Step 5: 實作`socketHandlers.js`的`hauntStarted`翻轉點**

[socketHandlers.js:1167-1175](../../../server/src/socketHandlers.js)：

```javascript
  if (deckType === 'omen' && !gameState.hauntStarted) {
    gameState.omenCount += 1;
    const rollSum = rollDice(gameState.omenCount);
    io.to(roomCode).emit('game:hauntCheck', { omenCount: gameState.omenCount, rollSum });
    if (rollSum > 5) {
      gameState.hauntStarted = true;
      gameState.pendingHauntGraceCheck = true;
      io.to(roomCode).emit('game:hauntStarted', { omenCount: gameState.omenCount, rollSum });
    }
  }
```

（這一步沒有獨立測試——`pendingHauntGraceCheck`真正被消費的行為，留到Step 6-10在`phaseFlow.js`層級驗證；這裡先跑一次全套件確認沒有語法錯誤/既有測試沒壞。）

Run: `cd server && npx jest test/socketHandlers.test.js --forceExit`
Expected: 全部PASS（既有涉及`hauntStarted`翻轉的測試不受影響，這次只是多設一個當下沒人讀取的欄位）

- [ ] **Step 6: 寫失敗測試（`phaseFlow.js`的`enterPhase`）**

`server/test/game/phaseFlow.test.js`頂端的`require`加入`STATS`（跟現有的其他匯入放一起，這個測試檔案需要直接操作`currentIndex`）：

```javascript
const { createGameState, addPlayer } = require('../../src/game/gameState');
const { getStatValue, changeStat } = require('../../src/game/playerEntity');
const { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase, requirePhase, resolveActingEntity, isParticipantDisconnected } = require('../../src/game/phaseFlow');
```

（`STATS`這個測試不需要額外匯入，四項能力名稱直接寫死在斷言裡即可，不需要迴圈。）

在`isParticipantDisconnected: an NPC is judged by its controller's connected state, not its own`測試（第99-105行）後面加入：

```javascript
test('enterPhase, entering settlement with pendingHauntGraceCheck true, marks isDead for a real player still stuck at skullIndex+1', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.hauntStarted = true;
  gameState.pendingHauntGraceCheck = true;
  gameState.players.get('p1').stats.might.currentIndex = 1; // skullIndex(0) + 1, the pre-haunt floor
  enterPhase(gameState, 'settlement');
  expect(gameState.players.get('p1').isDead).toBe(true);
  expect(gameState.pendingHauntGraceCheck).toBe(false); // consumed, one-time only
});

test('enterPhase, entering settlement with pendingHauntGraceCheck true, does NOT mark isDead for a player whose stats are all above skullIndex+1', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.hauntStarted = true;
  gameState.pendingHauntGraceCheck = true;
  enterPhase(gameState, 'settlement'); // p1's stats are all at baseIndex, well above the floor
  expect(gameState.players.get('p1').isDead).toBe(false);
  expect(gameState.pendingHauntGraceCheck).toBe(false); // still consumed even when nobody matched
});

test('enterPhase entering settlement does nothing extra when pendingHauntGraceCheck is false', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.hauntStarted = true;
  gameState.players.get('p1').stats.might.currentIndex = 1; // would match the floor check, but the flag is off
  enterPhase(gameState, 'settlement');
  expect(gameState.players.get('p1').isDead).toBe(false);
});

test('enterPhase\'s settlement grace check skips a player already marked isDead', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  gameState.hauntStarted = true;
  gameState.pendingHauntGraceCheck = true;
  const p1 = gameState.players.get('p1');
  p1.isDead = true;
  p1.stats.might.currentIndex = 1; // would also match -- confirms no crash/double-processing on an already-dead player
  enterPhase(gameState, 'settlement');
  expect(p1.isDead).toBe(true); // unchanged
  expect(gameState.pendingHauntGraceCheck).toBe(false);
});
```

- [ ] **Step 7: 執行測試，確認失敗**

Run: `cd server && npx jest test/game/phaseFlow.test.js -t "pendingHauntGraceCheck" --forceExit`
Expected: 前3個測試FAIL（`isDead`/`pendingHauntGraceCheck`沒有被改變），第4個測試PASS（因為它只驗證已死亡的人保持不變，剛好符合什麼都沒實作前的狀態——沒關係，Step 9實作後這個測試依然要通過）

- [ ] **Step 8: 實作`phaseFlow.js`**

`phaseFlow.js`頂端的`require`（[phaseFlow.js:2](../../../server/src/game/phaseFlow.js)）加入`STATS`：

```javascript
const { getPlayer } = require('./gameState');
const { resetActionPoints, changeStat, STATS } = require('./playerEntity');
```

`enterPhase`（[phaseFlow.js:56](../../../server/src/game/phaseFlow.js)），在結尾的級聯檢查`if (allParticipantsLocked(gameState, phase)) { advancePhase(gameState); }`**之前**、`resetPhaseLocks(gameState, phase);`**之後**插入：

```javascript
function enterPhase(gameState, phase) {
  gameState.currentPhase = phase;
  gameState.phaseDeadline = Date.now() + gameState.phaseTimeoutMs;
  resetPhaseLocks(gameState, phase);
  if (isMovePhase(phase)) {
    // ...既有的行動力重置區塊，不動...
  }
  if (phase === 'player_move') {
    // ...既有的每回合重置區塊，不動...
  }
  // The haunt-transition grace period (physical-game rule): the instant the
  // haunt begins isn't itself a stat-reduction event, so a player already
  // sitting at the pre-haunt floor (skullIndex+1) doesn't die immediately --
  // they get one round (this flag only fires once, right after
  // gameState.hauntStarted flips true) to be healed back up before this
  // settlement phase decides they're still stuck there.
  if (phase === 'settlement' && gameState.pendingHauntGraceCheck) {
    for (const p of gameState.players.values()) {
      if (p.isNPC || p.isDead) continue;
      for (const stat of STATS) {
        const track = p.stats[stat];
        if (track.currentIndex === track.skullIndex + 1) {
          p.isDead = true;
          break;
        }
      }
    }
    gameState.pendingHauntGraceCheck = false;
  }
  // A phase with zero eligible participants can never receive a lock, so it
  // must auto-advance immediately -- this cascades through consecutive empty
  // phases (e.g. npc_move directly into npc_interact) via the recursive call.
  if (allParticipantsLocked(gameState, phase)) {
    advancePhase(gameState);
  }
}
```

（上面省略號部分是既有程式碼，原封不動——只是標示插入點在哪兩段既有邏輯之間。）

- [ ] **Step 9: 執行測試，確認通過**

Run: `cd server && npx jest test/game/phaseFlow.test.js --forceExit`
Expected: 全部PASS

- [ ] **Step 10: 跑全套件確認無回歸**

Run: `cd server && npx jest --forceExit`
Expected: 全部PASS

- [ ] **Step 11: Commit**

```bash
git add server/src/game/gameState.js server/src/socketHandlers.js server/src/game/phaseFlow.js server/test/game/gameState.test.js server/test/game/phaseFlow.test.js
git commit -m "feat: one-time settlement-phase grace check for stats already at the pre-haunt floor when the haunt begins

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: 死亡不擋任何階段推進

**Files:**
- Modify: `server/src/game/phaseFlow.js:34-36`（`allParticipantsLocked`）、`:50-54`（`resetPhaseLocks`）
- Modify: `server/src/socketHandlers.js:768`（`handlePhaseTimeout`的`unresolved`filter）
- Test: `server/test/game/phaseFlow.test.js`、`server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 1的`player.isDead`
- Produces: `allParticipantsLocked(gameState, phase)`對`isDead:true`的參與者視為已滿足（不管`phaseLocked`實際值）；`resetPhaseLocks`／`handlePhaseTimeout`的sweep一併涵蓋死亡角色

- [ ] **Step 1: 寫失敗測試（`allParticipantsLocked`／`resetPhaseLocks`）**

`server/test/game/phaseFlow.test.js`，在Task 2新增的4個測試後面加入：

```javascript
test('allParticipantsLocked treats a dead participant as satisfying the lock requirement, even if phaseLocked is still false', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  gameState.players.get('p1').isDead = true;
  gameState.players.get('p2').phaseLocked = true;
  expect(allParticipantsLocked(gameState, 'player_move')).toBe(true);
});

test('allParticipantsLocked still requires a lock from a participant who is neither locked nor dead', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  gameState.players.get('p2').phaseLocked = true;
  expect(allParticipantsLocked(gameState, 'player_move')).toBe(false); // p1 neither locked nor dead
});

test('resetPhaseLocks auto-locks a dead real player entering a new phase (display consistency, matching the disconnected case)', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.players.get('p1').isDead = true;
  enterPhase(gameState, 'player_interact');
  expect(gameState.players.get('p1').phaseLocked).toBe(true);
});
```

`allParticipantsLocked`目前沒有被export——確認`phaseFlow.test.js`頂端的`require`已經有它（第3行），如果沒有就加進去。（目前已經有，見Task 2 Step 6列出的`require`那一行。）

- [ ] **Step 2: 執行測試，確認失敗**

Run: `cd server && npx jest test/game/phaseFlow.test.js -t "dead participant" --forceExit`
Run: `cd server && npx jest test/game/phaseFlow.test.js -t "auto-locks a dead real player" --forceExit`
Expected: 3個都FAIL（`allParticipantsLocked`第一個測試回傳`false`不是`true`；第三個測試`phaseLocked`是`false`不是`true`；第二個測試本來就該回傳`false`，這個會PASS，只是先確認沒被誤改壞）

- [ ] **Step 3: 實作`phaseFlow.js`**

`allParticipantsLocked`（[phaseFlow.js:34](../../../server/src/game/phaseFlow.js)）：

```javascript
function allParticipantsLocked(gameState, phase) {
  return getParticipants(gameState, phase).every((p) => p.phaseLocked || p.isDead);
}
```

`resetPhaseLocks`（[phaseFlow.js:50](../../../server/src/game/phaseFlow.js)）：

```javascript
function resetPhaseLocks(gameState, phase) {
  for (const p of getParticipants(gameState, phase)) {
    p.phaseLocked = isParticipantDisconnected(gameState, p) || p.isDead;
  }
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `cd server && npx jest test/game/phaseFlow.test.js --forceExit`
Expected: 全部PASS

- [ ] **Step 5: 寫失敗測試（`handlePhaseTimeout`的sweep）**

`server/test/socketHandlers.test.js`，在Task 1（2026-09-07那次）新增的`phase timeout resolves a DISCONNECTED (already auto-locked) player's pending inventory choice...`測試（搜尋`DISCONNECTED`）後面加入一個幾乎一樣、但改成死亡的版本：

```javascript
test('phase timeout resolves a DEAD (auto-locked) player\'s pending inventory choice too, same as a disconnected one', async () => {
  const content = makeContent({
    cards: {
      events: [],
      omens: [],
      items: [
        { id: 'item_001', name: 'A', effects: [] }, { id: 'item_002', name: 'B', effects: [] },
        { id: 'item_003', name: 'C', effects: [] }, { id: 'item_004', name: 'D', effects: [] },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content, { phaseTimeoutMs: 150 });
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);

  gameState.currentPhase = 'player_interact';
  gameState.phaseDeadline = Date.now() + 150;
  const otherPlayer = getPlayer(gameState, otherPlayerId);
  otherPlayer.isDead = true;
  otherPlayer.phaseLocked = true;
  otherPlayer.inventory.push({ id: 'item_001' }, { id: 'item_002' }, { id: 'item_003' }); // at cap (might: 3)
  const currentPlayer = getPlayer(gameState, currentPlayerId);
  currentPlayer.inventory.push({ id: 'item_004' });
  currentPlayer.actionPoints = 1;

  const giveResult = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_004', mode: 'give', targetPlayerId: otherPlayerId }, resolve)
  );
  expect(giveResult.error).toBeUndefined();
  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice.has(otherPlayerId)).toBe(true);

  await new Promise((resolve) => setTimeout(resolve, 250)); // past the 150ms phase deadline

  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice.has(otherPlayerId)).toBe(false);
  expect(otherPlayer.inventory.map((i) => i.id).sort()).toEqual(['item_001', 'item_002', 'item_003']);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 6: 執行測試，確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -t "DEAD (auto-locked)" --forceExit`
Expected: FAIL（`pendingInventoryChoice.has`在等待後仍是`true`）

- [ ] **Step 7: 實作`socketHandlers.js`**

`handlePhaseTimeout`（[socketHandlers.js:755](../../../server/src/socketHandlers.js)）的`unresolved`那一行：

```javascript
    const unresolved = getParticipants(gameState, phase).filter(
      (p) => !p.phaseLocked || isParticipantDisconnected(gameState, p) || p.isDead
    );
```

- [ ] **Step 8: 執行測試，確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "DEAD (auto-locked)" --forceExit`
Expected: PASS

- [ ] **Step 9: 跑全套件確認無回歸**

Run: `cd server && npx jest --forceExit`
Expected: 全部PASS

- [ ] **Step 10: Commit**

```bash
git add server/src/game/phaseFlow.js server/src/socketHandlers.js server/test/game/phaseFlow.test.js server/test/socketHandlers.test.js
git commit -m "feat: a dead participant no longer blocks any phase from advancing, in any round

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: 回合結束移出遊戲

**Files:**
- Modify: `server/src/socketHandlers.js`（`scheduleOrRefreshPhaseTimeout`/`handlePhaseTimeout`簽名、10個既有呼叫點、`handleLockPhase`兩個分支、新函式`removePlayerFromGame`/`removeDeadPlayersAtRoundStart`、`handlePlayerDisconnectedFromGame`補一句註解）
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 1的`player.isDead`、Task 3的`allParticipantsLocked`死亡bypass（讓一輪真的能推進到`player_move`而不用整輪都靠逾時硬撐）、既有的`handlePlayerDisconnectedFromGame`（[socketHandlers.js:1513](../../../server/src/socketHandlers.js)）
- Produces: 新client端事件`game:removedFromGame`（payload：`{ reason: 'died' }`）

### 這個任務為什麼範圍比較大

真正能讓`gameState.currentPhase`變成`'player_move'`（回合真正結束、新一輪開始）的地方只有兩處：`handleLockPhase`（玩家主動鎖定階段觸發）跟`handlePhaseTimeout`（逾時強制鎖定觸發，非同步`setTimeout`回呼）。`handleLockPhase`是`registerSocketHandlers`裡的closure，直接拿得到所有manager；但`scheduleOrRefreshPhaseTimeout`／`handlePhaseTimeout`是模組層級函式，簽名裡沒有`lobbyManager`/`gameManager`/`characterSelectionManager`/`characterSelectTimeouts`——這幾個是回合結束移出遊戲（可能觸發`closeLobbyRoom`）必須要有的。因為逾時是非同步觸發、跟哪個socket handler呼叫`scheduleOrRefreshPhaseTimeout`來啟動計時器無關，兩個函式的簽名都要擴充，連帶現有10個呼叫點都要多傳4個參數。這幾步都是機械性的參數傳遞，先完成、跑一次全套件確認沒有壞任何東西，再往下寫真正的新行為。

- [ ] **Step 1: 擴充`scheduleOrRefreshPhaseTimeout`／`handlePhaseTimeout`簽名**

[socketHandlers.js:740-791](../../../server/src/socketHandlers.js)：

```javascript
function scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, lobbyManager, gameManager, characterSelectionManager, characterSelectTimeouts) {
  const existing = phaseTimeouts.get(roomCode);
  if (existing && existing.deadline === gameState.phaseDeadline) {
    return; // already scheduled for this exact phase entry, nothing changed
  }
  if (existing) {
    clearTimeout(existing.handle);
  }
  const delayMs = Math.max(gameState.phaseDeadline - Date.now(), 0);
  const handle = setTimeout(() => {
    handlePhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, lobbyManager, gameManager, characterSelectionManager, characterSelectTimeouts);
  }, delayMs);
  phaseTimeouts.set(roomCode, { handle, deadline: gameState.phaseDeadline });
}

function handlePhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, lobbyManager, gameManager, characterSelectionManager, characterSelectTimeouts) {
  try {
    const phase = gameState.currentPhase;
    const unresolved = getParticipants(gameState, phase).filter(
      (p) => !p.phaseLocked || isParticipantDisconnected(gameState, p) || p.isDead
    );
    for (const participant of unresolved) {
      const playerId = participant.playerId;
      resolveRollChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, content);
      resolveInventoryChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, content.cards);
      resolveEffectChoiceByTimeout(io, effectResolverManager, gameState, roomCode, playerId, content);
      if (gameState.currentPhase === phase && !participant.phaseLocked) {
        lockPlayerPhase(gameState, playerId);
      }
    }
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('phase timeout error', err);
  } finally {
    scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, lobbyManager, gameManager, characterSelectionManager, characterSelectTimeouts);
  }
  removeDeadPlayersAtRoundStart(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode).catch((err) => {
    console.error('removeDeadPlayersAtRoundStart error', err);
  });
}
```

（`removeDeadPlayersAtRoundStart`還沒定義，下面Step 4會補上——這步先讓簽名跟呼叫關係就位。`removeDeadPlayersAtRoundStart`是`async`的但`handlePhaseTimeout`本身不是`async`函式，所以用`.catch(...)`處理，不用`await`，避免把整個函式簽名跟呼叫鏈都改成`async`——這是唯一一個非同步呼叫、且失敗時只需要log，不影響上面`finally`區塊已經完成的重新排程。）

- [ ] **Step 2: 更新10個既有呼叫點的參數**

以下這個呼叫（在檔案裡出現10次，行號約在188、212、249、337、363、420、494、511、548、588，全部逐字相同）：

```javascript
        scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content);
```

全部取代成：

```javascript
        scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, lobbyManager, gameManager, characterSelectionManager, characterSelectTimeouts);
```

（每一處前導空白數量不同，取代時只需要比對`scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content);`這段本體，不用管前面的縮排；用支援「取代全部符合的地方」的編輯方式一次處理完，處理完後用`grep -n "scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content)" server/src/socketHandlers.js`確認沒有殘留舊版簽名的呼叫。）

**修正（原計畫漏掉的第11處呼叫點）**：上面列的10處都在`registerSocketHandlers`的closure裡，直接就拿得到`lobbyManager`/`gameManager`/`characterSelectionManager`/`characterSelectTimeouts`。但`finishCharacterSelection`（[socketHandlers.js:1450](../../../server/src/socketHandlers.js)，角色選擇完成、遊戲正式開始時呼叫，會排定這個房間的第一個階段逾時）裡也有一處同樣的呼叫（約在1488行），這個函式簽名已經有`lobbyManager`/`gameManager`/`characterSelectionManager`，但**沒有**`characterSelectTimeouts`。它唯一的呼叫端`advanceCharacterSelection`（[socketHandlers.js:671](../../../server/src/socketHandlers.js)）本身的參數列裡就有`characterSelectTimeouts`，只是目前沒有往下傳給`finishCharacterSelection`。所以這一處除了跟其他10處一樣補4個參數給`scheduleOrRefreshPhaseTimeout`之外，還要多做兩件事：

1. `finishCharacterSelection`的參數列尾端加上`characterSelectTimeouts`：

```javascript
function finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, phaseTimeouts, characterSelectTimeouts) {
```

2. `advanceCharacterSelection`裡呼叫`finishCharacterSelection`的那一行，補上這個參數：

```javascript
    finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, phaseTimeouts, characterSelectTimeouts);
```

3. `finishCharacterSelection`內部呼叫`scheduleOrRefreshPhaseTimeout`那一行，比照其他10處補上4個參數（`characterSelectTimeouts`這次是從第9步驟新增的參數直接拿，不是從closure外層拿）：

```javascript
  scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, lobbyManager, gameManager, characterSelectionManager, characterSelectTimeouts);
```

這樣加起來共11處呼叫點被更新，全域`grep`舊簽名字串應該回傳0筆——這是驗證是否處理完整的正確標準，不是10筆。

- [ ] **Step 3: 執行全套件，確認純參數擴充沒有壞任何東西**

Run: `cd server && npx jest --forceExit`
Expected: 全部PASS（這步還沒有新增任何行為，`lobbyManager`等4個新參數目前在`handlePhaseTimeout`裡完全沒被用到，純粹是簽名擴充）

- [ ] **Step 4: 寫失敗測試（`removeDeadPlayersAtRoundStart`／`removePlayerFromGame`／新事件）**

`server/test/socketHandlers.test.js`，找到`test('lobby:leave sent mid-game clears the caller\'s own socket.data...')`這個測試（2026-09-07那次新增的，搜尋`so that same socket can no longer act`），在它後面加入：

```javascript
test('a player marked isDead does not block the rest of the round it dies in from advancing -- the remaining connected player alone is enough', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } =
    await setUpStartedGameWithContent(makeContent());
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);

  getPlayer(gameState, otherPlayerId).isDead = true; // died mid player_move, e.g. from a room effect -- never locks anything itself

  const lockResult = await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  expect(lockResult.error).toBeUndefined();
  expect(lockResult.currentPhase).toBe('player_interact'); // otherPlayerId's death alone satisfied the lock, npc_move cascades through (0 NPCs)

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a dead player gets removed from the game exactly when the next round\'s player_move begins, via game:lockPhase', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, aliceId, bobId, roomCode, gameManager, io } =
    await setUpStartedGameWithContent(makeContent());
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);

  getPlayer(gameState, otherPlayerId).isDead = true; // died mid player_move

  const removedPromise = new Promise((resolve) => otherClient.once('game:removedFromGame', resolve));

  // Drive a full round: currentClient alone is enough to satisfy every
  // phase (otherPlayerId is dead-bypassed throughout) -- 3 locks reaches
  // settlement, the 3rd lock's cascade (empty npc_interact) wraps back to
  // a fresh player_move, which is where removal happens.
  await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve)); // -> player_interact
  await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve)); // -> settlement
  await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve)); // -> wraps to a fresh player_move

  const removedPayload = await removedPromise;
  expect(removedPayload.reason).toBe('died');
  expect(getPlayer(gameState, otherPlayerId).connected).toBe(false);

  const socketsInRoom = await io.in(roomCode).fetchSockets();
  expect(socketsInRoom.some((s) => s.data.playerId === otherPlayerId)).toBe(false);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('both real players dying in the same round tears the room down once the second is removed at the next round start', async () => {
  const { httpServer, clientA, clientB, aliceId, bobId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(makeContent(), { phaseTimeoutMs: 150 });
  const gameState = getGameState(gameManager, roomCode);

  getPlayer(gameState, aliceId).isDead = true;
  getPlayer(gameState, bobId).isDead = true;
  // Neither client ever locks anything -- with both dead-bypassed, nothing
  // triggers allParticipantsLocked until the phase timeout itself force-locks
  // them (see handlePhaseTimeout's unresolved sweep from Task 3), cascading
  // the whole way around back to a fresh player_move synchronously.
  await new Promise((resolve) => setTimeout(resolve, 250)); // past the 150ms deadline

  expect(getGameState(gameManager, roomCode)).toBeUndefined();
  expect(getResolver(effectResolverManager, roomCode)).toBeUndefined();

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 5: 執行測試，確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -t "isDead does not block" --forceExit`
Run: `cd server && npx jest test/socketHandlers.test.js -t "gets removed from the game exactly when" --forceExit`
Run: `cd server && npx jest test/socketHandlers.test.js -t "tears the room down once the second" --forceExit`
Expected: 第一個測試已經會PASS（Task 3已經做完`allParticipantsLocked`的bypass）；第二、三個測試FAIL（`game:removedFromGame`永遠不會發生、房間永遠不會被回收，因為`removeDeadPlayersAtRoundStart`還沒實作）

- [ ] **Step 6: 實作`removePlayerFromGame`／`removeDeadPlayersAtRoundStart`**

放在`handlePlayerDisconnectedFromGame`（[socketHandlers.js:1513](../../../server/src/socketHandlers.js)）前面：

```javascript
async function removePlayerFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, playerId, reason) {
  const sockets = await io.in(roomCode).fetchSockets();
  const targetSocket = sockets.find((s) => s.data.playerId === playerId);
  if (targetSocket) {
    targetSocket.emit('game:removedFromGame', { reason });
    targetSocket.leave(roomCode);
    targetSocket.data.roomCode = null;
    targetSocket.data.playerId = null;
  }
  await handlePlayerDisconnectedFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, playerId);
}

async function removeDeadPlayersAtRoundStart(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode) {
  if (gameState.currentPhase !== 'player_move') {
    return;
  }
  const toRemove = Array.from(gameState.players.values()).filter((p) => !p.isNPC && p.isDead && p.connected);
  // Sequential on purpose, not Promise.all: removePlayerFromGame ->
  // handlePlayerDisconnectedFromGame re-checks "is anyone still connected"
  // against the CURRENT state each time. Running these concurrently would
  // let every iteration see the others' not-yet-applied connected:false,
  // so closeLobbyRoom either fires multiple times or never fires at all.
  // One at a time, it correctly fires exactly once, on the last removal.
  for (const player of toRemove) {
    // 未來勝利條件系統要掛在這裡：許多劇本的勝利條件是「另一陣營全滅」，
    // 這個移出動作發生的當下就是檢查這類條件的正確時機點。
    await removePlayerFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, player.playerId, 'died');
  }
}

async function handlePlayerDisconnectedFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, playerId) {
  const player = getPlayer(gameState, playerId);
  if (player) {
    player.connected = false;
  }
  // 未來勝利條件系統也要掛在這裡：偵測到玩家斷線是開發者指定的另一個檢查觸發點。
  const anyoneStillConnected = Array.from(gameState.players.values())
    .filter((p) => !p.isNPC)
    .some((p) => p.connected);
  if (!anyoneStillConnected) {
    await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts);
  }
}
```

（`handlePlayerDisconnectedFromGame`本體邏輯不變，只多一句註解。）

- [ ] **Step 7: 在`handleLockPhase`的兩個分支呼叫`removeDeadPlayersAtRoundStart`**

[socketHandlers.js:470-518](../../../server/src/socketHandlers.js)，兩個分支各自在`scheduleOrRefreshPhaseTimeout`那一行後面加一行：

```javascript
    function handleLockPhase(eventName, payload, callback) {
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
        if (hasPendingEffectChoice(effectResolverManager, roomCode, playerId)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        if (hasPendingRollChoice(effectResolverManager, roomCode, playerId)) {
          return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
        }
        if (hasPendingInventoryChoice(effectResolverManager, roomCode, playerId)) {
          return ack({ error: 'INVENTORY_CHOICE_IN_PROGRESS' });
        }
        const { actingAsNpcId } = payload || {};
        if (actingAsNpcId) {
          const npcId = resolveActingEntity(gameState, playerId, actingAsNpcId);
          lockPlayerPhase(gameState, npcId);
          scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, lobbyManager, gameManager, characterSelectionManager, characterSelectTimeouts);
          await removeDeadPlayersAtRoundStart(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode);
          ack({ currentPhase: gameState.currentPhase });
          io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
          return;
        }
        const player = getPlayer(gameState, playerId);
        const placedRoom = gameState.board[player.floor].get(coordKey(player.x, player.y));
        const roomDefinition = findRoomDefinition(content, placedRoom.roomId);
        lockPlayerPhase(gameState, playerId);
        try {
          applyRoomEndTurnBonus(io, effectResolverManager, gameState, roomCode, playerId, roomDefinition, content);
        } catch (bonusErr) {
          console.error('applyRoomEndTurnBonus error', bonusErr);
        }
        scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, lobbyManager, gameManager, characterSelectionManager, characterSelectTimeouts);
        await removeDeadPlayersAtRoundStart(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode);
        ack({ currentPhase: gameState.currentPhase });
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error(`${eventName} error`, err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    }
```

`handleLockPhase`本身要改成`async function`（因為現在裡面有`await`）：

```javascript
    async function handleLockPhase(eventName, payload, callback) {
```

呼叫端`socket.on('game:endTurn', ...)`／`socket.on('game:lockPhase', ...)`（[socketHandlers.js:520-521](../../../server/src/socketHandlers.js)）不用改——Socket.IO的事件handler本來就可以是`async`函式，回呼機制不受影響。

- [ ] **Step 8: 執行測試，確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "gets removed from the game exactly when" --forceExit`
Run: `cd server && npx jest test/socketHandlers.test.js -t "tears the room down once the second" --forceExit`
Expected: 全部PASS

- [ ] **Step 9: 跑全套件確認無回歸**

Run: `cd server && npx jest --forceExit`
Expected: 全部PASS

- [ ] **Step 10: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: remove dead players from the game when the next round's player_move begins

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 4修正：全員陣亡時的無限遞迴（實作期間發現，開發者已核准納入Task 4範圍）

執行Step 8時，「兩位真人玩家同一輪雙雙死亡」這個測試觸發了一個`phaseFlow.js`既有的、Task 3引入但這次才第一次被測試踩到的bug：當房間裡所有真人玩家都死亡（且沒有NPC）時，每個階段的參與者都因為死亡被`resetPhaseLocks`自動視為已鎖定，`allParticipantsLocked`在每個階段都立即為true，`enterPhase`／`advancePhase`會不斷級聯下去，五個階段繞圈子，永遠不會停——因為根本沒有一個「真的還活著、還沒鎖定」的參與者能停下這個級聯。最終`RangeError: Maximum call stack size exceeded`，被`handlePhaseTimeout`既有的try/catch吞掉、只印log，房間永久卡死、不會被回收。

這不是Task 4的檔案範圍（`phaseFlow.js`完全不在Task 4的檔案清單裡），但開發者已確認這個修法要納入Task 4一起做，不要另開任務或跳過測試。修法分兩部分：

**Part A：`phaseFlow.js`加一個級聯遞迴的安全閥（防止當機，不管觸發原因是什麼）**

`enterPhase`／`advancePhase`（[phaseFlow.js:56](../../../server/src/game/phaseFlow.js)、[phaseFlow.js:99](../../../server/src/game/phaseFlow.js)）新增第三個參數`visitedPhases`，追蹤「這一輪同步級聯鏈裡已經進入過哪些階段名稱」——如果級聯要再次進入一個已經進入過的階段，代表已經繞完一整圈、完全沒有真正的進展，就停止繼續級聯（不再呼叫`advancePhase`），把`gameState.currentPhase`留在目前這個階段：

```javascript
function enterPhase(gameState, phase, visitedPhases = new Set()) {
  gameState.currentPhase = phase;
  gameState.phaseDeadline = Date.now() + gameState.phaseTimeoutMs;
  resetPhaseLocks(gameState, phase);
  if (isMovePhase(phase)) {
    // ...既有的行動力重置區塊，不動...
  }
  if (phase === 'player_move') {
    // ...既有的每回合重置區塊，不動...
  }
  // ...Task 2新增的settlement grace-check區塊，不動...
  // A phase with zero eligible participants can never receive a lock, so it
  // must auto-advance immediately -- this cascades through consecutive empty
  // phases (e.g. npc_move directly into npc_interact) via the recursive call.
  if (allParticipantsLocked(gameState, phase)) {
    if (visitedPhases.has(phase)) {
      // Already cascaded through this exact phase once in this same
      // synchronous chain, with zero real progress -- every remaining
      // participant is dead/disconnected-bypassed, so nobody can ever
      // genuinely lock anything and this would recurse forever. Stop here;
      // socketHandlers.js's closeRoomIfNoViablePlayersRemain (see Part B) is
      // what actually tears the room down when this happens.
      return;
    }
    visitedPhases.add(phase);
    advancePhase(gameState, visitedPhases);
  }
}

function advancePhase(gameState, visitedPhases = new Set()) {
  const currentIndex = PHASE_ORDER.indexOf(gameState.currentPhase);
  const nextPhase = PHASE_ORDER[(currentIndex + 1) % PHASE_ORDER.length];
  enterPhase(gameState, nextPhase, visitedPhases);
}
```

（上面省略號部分是既有程式碼，原封不動——只是標示新參數穿過去的地方。`visitedPhases`預設`new Set()`，所有既有呼叫端（`lockPlayerPhase`呼叫`advancePhase(gameState)`、`handlePhaseTimeout`呼叫`lockPlayerPhase`等）完全不用改，因為每次從外部呼叫都會拿到一個全新的追蹤集合，只有遞迴呼叫自己時才會把同一個集合傳下去。）

**Part B：`socketHandlers.js`加一個「這個房間還有沒有活人」的即時檢查，取代「等到回合結束才移出」在全員陣亡時的失效**

斷線的情況已經有即時檢查（`handlePlayerDisconnectedFromGame`的`anyoneStillConnected`，斷線當下就查、不等回合結束）——死亡原本刻意設計成「回合結束才移出」（開發者的原始需求，正常情況下這樣沒問題，因為房間裡還有其他活人可以讓回合正常走完）。但「全員陣亡」是特殊情況：沒有任何人能再讓回合往下走，這時候不能再等「回合結束」，因為回合根本走不完（Part A的安全閥只是防止當機，並不會讓房間被回收）。

新增一個檢查「這個房間是否還有任何一個真人是connected且沒死亡」，只要沒有，就不等`player_move`了，直接比照斷線的方式回收房間：

```javascript
function hasAnyViableRealPlayer(gameState) {
  return Array.from(gameState.players.values()).some((p) => !p.isNPC && p.connected && !p.isDead);
}
```

這個函式放在`phaseFlow.js`（純函式、不需要io，跟`isParticipantDisconnected`放在一起），並加進`module.exports`。`socketHandlers.js`頂端`require('./game/phaseFlow')`那一行加入`hasAnyViableRealPlayer`。

`removeDeadPlayersAtRoundStart`（原本Step 6寫的那個函式）開頭插入這個檢查，比原本「只在`player_move`才處理」的邏輯優先：

```javascript
async function removeDeadPlayersAtRoundStart(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode) {
  if (!hasAnyViableRealPlayer(gameState)) {
    // Nobody left who could ever lock another phase again (everyone's dead
    // and/or disconnected) -- don't wait for player_move, which may never
    // be reached (see Part A's recursion guard). Tear down now, the same
    // way the last real disconnect already does.
    await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts);
    return;
  }
  if (gameState.currentPhase !== 'player_move') {
    return;
  }
  const toRemove = Array.from(gameState.players.values()).filter((p) => !p.isNPC && p.isDead && p.connected);
  // ...既有的sequential迴圈，不動...
}
```

（`toRemove`的迴圈只會在「至少還有一個活人」的情況下才執行到——這時候`hasAnyViableRealPlayer`一定是true，所以不會跟上面新加的分支衝突。）

**這個修正需要的測試（TDD，先RED再GREEN）**：

`server/test/game/phaseFlow.test.js`：

```javascript
test('enterPhase does not recurse forever when every real participant is dead and there are 0 NPCs -- it stops after one full lap with the phase left wherever it landed', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  gameState.players.get('p1').isDead = true;
  gameState.players.get('p2').isDead = true;
  expect(() => enterPhase(gameState, 'player_move')).not.toThrow();
  expect(PHASE_ORDER).toContain(gameState.currentPhase); // landed somewhere valid, didn't crash
});

test('hasAnyViableRealPlayer is true when at least one real player is connected and not dead', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  gameState.players.get('p1').isDead = true;
  expect(hasAnyViableRealPlayer(gameState)).toBe(true); // p2 still viable
});

test('hasAnyViableRealPlayer is false when every real player is dead or disconnected', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  gameState.players.get('p1').isDead = true;
  gameState.players.get('p2').connected = false;
  expect(hasAnyViableRealPlayer(gameState)).toBe(false);
});
```

`phaseFlow.test.js`頂端的`require`加入`hasAnyViableRealPlayer`（跟現有的`isParticipantDisconnected`同一行）。

`server/test/socketHandlers.test.js`裡Step 4寫的「兩位真人玩家同一輪雙雙死亡」測試不用改內容——它本來就是在驗證這個修正後的最終行為（`getGameState`變成`undefined`），只是在這個修正之前會因為上述bug而失敗，修正後應該直接變成GREEN，不需要調整斷言。

**Commit（獨立一個commit，接在原本Task 4 commit的規劃之後）**：

```bash
git add server/src/game/phaseFlow.js server/src/socketHandlers.js server/test/game/phaseFlow.test.js server/test/socketHandlers.test.js
git commit -m "fix: stop the phase cascade from recursing forever when every real player is dead, and tear the room down immediately when nobody viable remains

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5：最終全支線審查修正輪（開發者裁示）

全支線最終審查（opus）發現4個Important，開發者已就每一點裁示方向，這次全部要修：

### 修正①：`effectResolver.js`的imprint卡NPC移除級聯，也可能讓階段推進到`player_move`，但沒有觸發移出檢查

審查抓到`effectResolver.js:158-160`（`handleRemoveImprint`，玩家消除銘印時連帶刪除操控中的NPC）也會呼叫`advancePhase`，這是除了`handleLockPhase`／`handlePhaseTimeout`之外第三個能讓階段真正推進的地方，但`removeDeadPlayersAtRoundStart`只掛在前兩處。`effectResolver.js`本身刻意保持不碰io（跟`phaseFlow.js`一樣的既有原則），所以修法不是在`effectResolver.js`裡加東西，而是在**所有**會呼叫到`resolveEffects`／`handleEffectResolveResult`的socket handler尾端，比照`handleLockPhase`已經做的，也接上`removeDeadPlayersAtRoundStart`——不逐一追蹤「哪些路徑理論上摸得到這個NPC移除級聯」（容易漏，這次的第11個呼叫點跟這個Important本身都是這樣漏掉的），而是統一在**所有**目前已經有`scheduleOrRefreshPhaseTimeout`呼叫的地方都補上，這樣不管未來效果解析鏈長成什麼樣子，都不會再漏。

以下這8處呼叫（`game:move`、`game:selectAction`的4處、`game:effectPromptRespond`、`game:diceChoiceRespond`、`finishCharacterSelection`）目前只有`scheduleOrRefreshPhaseTimeout`、沒有`removeDeadPlayersAtRoundStart`，全部要補上（呼叫端所在的handler目前都不是`async`，要先改成`async`才能`await`）：

**`game:move`**（[socketHandlers.js:163](../../../server/src/socketHandlers.js)）：

```javascript
    socket.on('game:move', async (payload, callback) => {
```

兩處`scheduleOrRefreshPhaseTimeout`呼叫（約188、212行）後面各自加一行：

```javascript
          scheduleOrRefreshPhaseTimeout(io, gameState, roomCode, phaseTimeouts, effectResolverManager, content, lobbyManager, gameManager, characterSelectionManager, characterSelectTimeouts);
          await removeDeadPlayersAtRoundStart(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode);
```

**`game:selectAction`**（[socketHandlers.js:220](../../../server/src/socketHandlers.js)）：

```javascript
    socket.on('game:selectAction', async (payload, callback) => {
```

這個handler裡有4處`scheduleOrRefreshPhaseTimeout`呼叫（約249、337、363、420行，分別是`actingAsNpcId`分支、teleport分支、搜索分支、跟最後共用的收尾），每一處後面都加一行`await removeDeadPlayersAtRoundStart(...)`，參數順序跟上面`game:move`那行一模一樣。

**`game:effectPromptRespond`**（[socketHandlers.js:525](../../../server/src/socketHandlers.js)）：

```javascript
    socket.on('game:effectPromptRespond', async (payload, callback) => {
```

約550行的`scheduleOrRefreshPhaseTimeout`後面加一行`await removeDeadPlayersAtRoundStart(...)`。

**`game:diceChoiceRespond`**（[socketHandlers.js:559](../../../server/src/socketHandlers.js)）：

```javascript
    socket.on('game:diceChoiceRespond', async (payload, callback) => {
```

約590行的`scheduleOrRefreshPhaseTimeout`後面加一行`await removeDeadPlayersAtRoundStart(...)`。

**`finishCharacterSelection`**（[socketHandlers.js:1466](../../../server/src/socketHandlers.js)，本來就是遊戲剛開始的地方，理論上不可能有人已經死亡，這裡補上純粹是為了跟其他10處一致、不留特例）：

```javascript
async function finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, phaseTimeouts, characterSelectTimeouts) {
```

（原本不是`async`，要加）約1493行的`scheduleOrRefreshPhaseTimeout`後面加一行`await removeDeadPlayersAtRoundStart(...)`。`finishCharacterSelection`本身是`async`後，它唯一的呼叫端`advanceCharacterSelection`（[socketHandlers.js:671](../../../server/src/socketHandlers.js)）呼叫它那一行要補`await`：

```javascript
    await finishCharacterSelection(io, lobbyManager, gameManager, characterSelectionManager, effectResolverManager, content, roomCode, phaseTimeouts, characterSelectTimeouts);
```

（`advanceCharacterSelection`本身也要確認呼叫端`game:startCharacterSelect`／`game:promptRespond`／`handleCharacterSelectTimeout`三處呼叫`advanceCharacterSelection`的地方，如果因此需要跟著補`async`/`await`，一併處理——`advanceCharacterSelection`本身不需要變成`async`，只要它內部呼叫`finishCharacterSelection`那一行加`await`，`advanceCharacterSelection`函式本體其餘部分不變；但因為`advanceCharacterSelection`現在內部有一個`await`，它自己也必須宣告成`async function`，呼叫端則不強制要求跟著`await`它，除非該呼叫端本來就需要等它做完才能繼續——目前3個呼叫端都是fire-and-forget呼叫`advanceCharacterSelection`後就結束，不需要额外處理。）

**這8處全部補齊後**，`removeDeadPlayersAtRoundStart`實際掛在全部11個`scheduleOrRefreshPhaseTimeout`呼叫點（原本3個＋新增8個），任何未來新的效果解析巢狀路徑都不會再漏接。

### 修正②：全員陣亡時，每個死亡玩家仍要分別收到自己的`game:removedFromGame`

開發者裁示：「全員陣亡」時，每個玩家的死亡通知是各自獨立的事情（各自的client要知道『我死了』），跟房間被回收的`lobby:closed`廣播是兩件不同的事、不同的訊息內容，不能只送`lobby:closed`打發。`removeDeadPlayersAtRoundStart`（[socketHandlers.js:1534](../../../server/src/socketHandlers.js)）的`!hasAnyViableRealPlayer`分支改成：

```javascript
async function removeDeadPlayersAtRoundStart(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode) {
  if (!hasAnyViableRealPlayer(gameState)) {
    // Nobody left who could ever lock another phase again. Each dead real
    // player still gets their own individual death notification -- from
    // that player's own perspective they died, this is a different event
    // with different meaning than the room-wide lobby:closed broadcast
    // closeLobbyRoom sends next, not a substitute for it. Emitted directly
    // (not via removePlayerFromGame/handlePlayerDisconnectedFromGame) since
    // closeLobbyRoom immediately below already does the socket.leave/
    // socket.data cleanup and connected:false marking for everyone in the
    // room -- no need to duplicate that per player here.
    const deadPlayerIds = Array.from(gameState.players.values())
      .filter((p) => !p.isNPC && p.isDead && p.connected)
      .map((p) => p.playerId);
    if (deadPlayerIds.length > 0) {
      const sockets = await io.in(roomCode).fetchSockets();
      for (const playerId of deadPlayerIds) {
        const targetSocket = sockets.find((s) => s.data.playerId === playerId);
        if (targetSocket) {
          targetSocket.emit('game:removedFromGame', { reason: 'died' });
        }
      }
    }
    await closeLobbyRoom(io, lobbyManager, roomCode, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts);
    return;
  }
  if (gameState.currentPhase !== 'player_move') {
    return;
  }
  const toRemove = Array.from(gameState.players.values()).filter((p) => !p.isNPC && p.isDead && p.connected);
  for (const player of toRemove) {
    await removePlayerFromGame(io, lobbyManager, gameManager, effectResolverManager, characterSelectionManager, phaseTimeouts, characterSelectTimeouts, gameState, roomCode, player.playerId, 'died');
  }
}
```

（比照`closeLobbyRoom`自己的既有原則——廣播要在任何人離開io房間之前送出，這裡的`game:removedFromGame`也是在`closeLobbyRoom`真正把大家踢出房間之前先送。）

### 修正③：補上`pendingHauntGraceCheck`的端到端整合測試

審查發現`socketHandlers.js`裡設定`gameState.pendingHauntGraceCheck = true`那一行完全沒有被任何測試斷言到——刪掉那一行，808個測試依然全綠，代表Task 2的核心機制沒有真正的端到端證據。補一個`server/test/socketHandlers.test.js`整合測試：

```javascript
test('haunt-transition grace period end-to-end: a player already at the pre-haunt floor when the haunt starts is NOT healed -> dies at settlement -> gets removed next round with game:removedFromGame', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [],
      items: [],
      omens: [{ id: 'omen_haunt_test', name: '測試預兆', effects: [] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } =
    await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  const otherPlayer = getPlayer(gameState, otherPlayerId);
  otherPlayer.stats.might.currentIndex = otherPlayer.stats.might.skullIndex + 1; // sitting at the pre-haunt floor

  // Force the haunt to start: enough omen draws that rollDice(omenCount) > 5
  // is effectively guaranteed. Simpler and more direct: drive it through the
  // same production path the game already uses, by mocking Math.random so
  // rollDice's sum lands above 5.
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  const hauntStartedPromise = new Promise((resolve) => currentClient.once('game:hauntStarted', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // draws omen_haunt_test
  await hauntStartedPromise;
  rngSpy.mockRestore();

  expect(gameState.hauntStarted).toBe(true);
  expect(gameState.pendingHauntGraceCheck).toBe(true); // the flag this test exists to cover
  expect(otherPlayer.isDead).toBe(false); // not dead yet -- haunt just started, no grace check run yet this round

  // No healing happens -- drive the round to settlement without touching
  // otherPlayer's stats. currentClient alone is enough (otherPlayerId isn't
  // locked yet at this point, but is real/connected/not-dead, so the normal
  // per-phase lock requirement still applies to them like anyone else until
  // the grace check actually marks them dead).
  await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  const otherLockResult = await new Promise((resolve) => otherClient.emit('game:lockPhase', {}, resolve)); // player_move -> player_interact
  await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  await new Promise((resolve) => otherClient.emit('game:lockPhase', {}, resolve)); // player_interact -> settlement, grace check runs here

  expect(gameState.pendingHauntGraceCheck).toBe(false); // consumed
  expect(otherPlayer.isDead).toBe(true); // still at the floor, no healing -> died

  const removedPromise = new Promise((resolve) => otherClient.once('game:removedFromGame', resolve));
  await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve)); // settlement -> wraps to a fresh player_move, removal happens here
  const removedPayload = await removedPromise;
  expect(removedPayload.reason).toBe('died');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

（如果`rollDice`的實際擲骰邏輯讓上面的`Math.random`mock沒辦法穩定讓`rollSum > 5`，改用這個測試檔案裡其他既有測試已經驗證過的、能穩定觸發`game:hauntStarted`的手法——可以先搜尋`game:hauntStarted`確認既有測試怎麼做，沿用同一招，不用自己重新設計觸發邪祟的方式。）

### 修正④：死亡玩家在被移出前不能再行動

開發者裁示：玩家死亡「當下」就不該再能行動（移動/搜索/用道具/操控NPC），前端要彈黑幕訊息窗＋按確認回開頭選單——**這部分UI是前端工作，不在這個backend-only的計畫範圍內，這次只做伺服器端擋下死亡玩家的行動**，讓前端未來接上時有明確的錯誤代碼可以判斷。

`game:move`、`game:selectAction`、`game:useStairs`、`handleLockPhase`（[socketHandlers.js:470](../../../server/src/socketHandlers.js)附近，`game:endTurn`/`game:lockPhase`共用的那個函式）這4個handler，在確認`gameState`存在之後、既有3個pending-choice檢查之前，各自加入：

```javascript
        const actingPlayer = getPlayer(gameState, playerId);
        if (actingPlayer.isDead) {
          return ack({ error: 'PLAYER_IS_DEAD' });
        }
```

（變數命名成`actingPlayer`避免跟這幾個handler後面原本就有的`const player = getPlayer(gameState, playerId);`重複宣告衝突——如果該handler後面本來就有一模一樣的`getPlayer`呼叫，改成重用`actingPlayer`這個名字、刪掉後面重複的宣告即可，不要留兩個變數指向同一個查詢。）

**範圍刻意只到這4個handler**：`game:effectPromptRespond`／`game:diceChoiceRespond`／`game:inventoryChoiceRespond`（回應一個已經開啟的懸置提示，不是主動發起新行動）不在這次範圍內——這幾個懸置提示如果掛在一個已死亡的玩家身上，本來就會被`handlePhaseTimeout`的sweep（Task 3已經涵蓋`isDead`）強制逾時決議掉，不需要額外擋。

**測試**：`server/test/socketHandlers.test.js`新增（或利用上面修正③已經寫的整合測試場景延伸）至少1個測試，直接把某玩家標記`isDead:true`後呼叫`game:move`／`game:selectAction`／`game:useStairs`／`game:lockPhase`四者之一，驗證回傳`{error:'PLAYER_IS_DEAD'}`、且沒有任何副作用（行動力沒扣、位置沒變）。

### Task 5測試計畫總覽

- `server/test/socketHandlers.test.js`：修正③的邪祟寬限期端到端測試（1個）、修正④的死亡玩家行動被擋測試（至少1個，可以拆成4個各自對應4個handler，或用參數化的方式合併）、既有涉及`removeDeadPlayersAtRoundStart`／全員陣亡的測試（Task 4已經寫的那個）確認在修正②之後還是綠的（`game:removedFromGame`現在會在全員陣亡時也收到，如果原測試沒有斷言收不到這個事件則不用改，只是行為變得更完整）
- 跑一次全套件確認無回歸

### Commit

```bash
git add server/src/socketHandlers.js server/src/game/effectResolver.js server/test/socketHandlers.test.js
git commit -m "fix: close the remaining gaps from the final whole-branch review

- removeDeadPlayersAtRoundStart now also runs after every other
  effect-resolution path that could advance the phase (not just
  handleLockPhase/handlePhaseTimeout), closing the imprint-NPC-removal
  cascade gap found in effectResolver.js
- each dead real player gets their own game:removedFromGame even when
  the whole room is wiped out at once, distinct from the room-wide
  lobby:closed broadcast
- added end-to-end test coverage for the haunt-transition grace period
  (pendingHauntGraceCheck had zero prior assertions)
- a dead player can no longer move/act/lock a phase before being removed

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## 自我檢查（Plan Self-Review）

**Spec coverage**：設計文件的①②③④⑤⑥六個小節逐一對應——①→Task 1；②→Task 2；③→Task 3；④→Task 4（含`removePlayerFromGame`/`removeDeadPlayersAtRoundStart`）；⑤→Task 4的`removePlayerFromGame`直接重用`handlePlayerDisconnectedFromGame`，沒有另外寫程式碼；⑥→Task 4 Step 6在兩個指定位置補上註解，沒有寫任何邏輯。

**Placeholder掃描**：4個任務、41個步驟全部是可直接執行的具體程式碼／指令，沒有「TBD」、「add appropriate handling」這類字眼。

**型別/命名一致性**：`isDead`／`pendingHauntGraceCheck`／`removePlayerFromGame`／`removeDeadPlayersAtRoundStart`／`game:removedFromGame`在四個任務之間的用字完全一致，沒有出現同一個東西在不同任務被叫不同名字的情況。

**任務邊界**：Task 1-3各自獨立可測（單元測試層級），Task 4是整合任務、依賴前三個任務都完成後才能正確跑通端到端情境（尤其是Task 3的`allParticipantsLocked`死亡bypass，沒有它Task 4的測試會需要真的等滿整個`phaseTimeoutMs`才能推進每一階段，拖慢測試也偏離設計文件的本意）。
