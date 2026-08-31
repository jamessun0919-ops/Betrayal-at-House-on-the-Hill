# 5張卡片新機制＋roomEntered廣播缺口修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補完 `event_013`／`event_026`／`event_031`／`event_033`／`item_040` 五張卡片的 `effects`，並修正 `game:roomEntered` 廣播只涵蓋「使用道具」路徑、不涵蓋事件卡/選項/逾時/擲骰介入路徑的既有架構缺口。

**Architecture:** 三個新效果類型（`restore_or_advance`／`lose_random_item`／`move_to_random_other_player_room`）新增進 `server/src/game/effectResolver.js` 的既有 handler 模式；`event_031`／`item_040` 完全重用既有的 `choice`／`random_effect` 機制，只需資料串接。`game:roomEntered` 廣播從 `game:selectAction` handler 裡的一段局部程式碼，搬進所有效果解析路徑共用的 `handleEffectResolveResult`（`server/src/socketHandlers.js`），一次修好全部路徑。

**Tech Stack:** Node.js + Express + Socket.IO 後端；Jest 測試；純 JavaScript。這次範圍完全在伺服器端＋資料檔案，不涉及前端。

## Global Constraints

- `lose_random_item` 的隨機物品池**只限一般道具卡**（`context.itemCatalog` 裡查得到的），不含預兆/銘印——即使玩家背包裡同時有預兆/銘印，也絕對不會被選中；沒有任何一般道具時無效果（`appliedCount:0`），不拋錯
- `event_031` 的「放棄」選項效果跟「紅色」「藍色」完全相同（都掛同一份 50/50 隨機效果）——開發者已明確確認「放棄也一樣觸發」，三個選項只是文字不同
- 選擇類效果的逾時慣例固定 `timeoutMs: 20000`（20秒），比照既有 `data/cards/event-cards.json`／`omen-cards.json` 裡所有 `choice`／`preview_and_choose` 的既有用法
- `game:roomEntered` 廣播集中到 `handleEffectResolveResult` 本體之後，`game:selectAction` handler 裡原本重複的一段局部廣播必須整段刪除——不可以兩處都留著（會重複廣播），也不可以只留舊的那段不動（事件卡路徑仍然收不到廣播）
- 三個新效果類型（`restore_or_advance`／`lose_random_item`／`move_to_random_other_player_room`）的 handler 簽名、回傳值形狀（`{pending:false, appliedCount?}` 或 `{pending:false, enteredNewRoom?}`）都要跟 `effectResolver.js` 現有的同類 handler（`handleStatChange`／`handleLoseItem`／`handleMoveToPreviousRoom`）保持一致，讓 `resolveEffects` 既有的聚合迴圈不需要任何修改就能正確處理

---

## File Structure

- **`server/src/game/effectResolver.js`**（修改）：新增 `handleRestoreOrAdvance`／`handleLoseRandomItem`／`handleMoveToRandomOtherPlayerRoom` 三個 handler；把 `handleLoseItem` 內的「回牌堆／留房間」路由邏輯抽成共用的 `routeLostItemToDestination`（`handleLoseRandomItem` 也會用到）；`HANDLERS` 註冊表新增三個對應項目；`require('./playerEntity')` 的解構新增 `isBelowBase`
- **`server/src/socketHandlers.js`**（修改）：`handleEffectResolveResult` 新增集中式 `game:roomEntered` 廣播；`game:selectAction` handler 刪除原本重複的局部廣播；`buildRandomEffectText` 新增陣列型 `feedbacktextOccur` 的查找分支
- **`data/cards/event-cards.json`**（修改）：`event_013`／`event_026`／`event_031`／`event_033` 補上 `effects`，`needsCustomLogic` 改 `false`
- **`data/cards/item-cards.json`**（修改）：`item_040` 補上 `effects`
- **`server/test/game/effectResolver.test.js`**（修改）：三個新效果類型的單元測試＋四張卡片的資料層完整性測試
- **`server/test/socketHandlers.test.js`**（修改）：roomEntered 缺口修正的端對端測試（含既有回歸驗證）、`event_031`／`event_033`／`item_040` 的端對端測試

---

### Task 1: 集中 `game:roomEntered` 廣播到 `handleEffectResolveResult`

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes：`handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied, content, rollChoiceTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, actingPlayerId)`（既有函式簽名不變，內部行為擴充）；`effectResult.enteredNewRoom`（既有 `resolveEffects` 輸出欄位，`move_to_room`／`move_to_previous_room`／`move_to_random_neighbor_room` 等移動類效果都已經在設）
- Produces：`handleEffectResolveResult` 現在會在自己內部廣播 `game:roomEntered`（只要 `effectResult.enteredNewRoom !== undefined`），所有呼叫它的路徑（`game:selectAction`、`game:effectPromptRespond`、`applyRoomEndTurnBonus`、`resolveCardDraw`、`handleEffectChoiceTimeout`、`resumeRollChoice`）都自動獲得這個廣播，不需要各自處理

- [ ] **Step 1: 讀取目前的 `game:selectAction` 局部廣播區塊，確認要刪除的確切範圍**

打開 `server/src/socketHandlers.js`，找到 `game:selectAction` handler 裡 `sourceEffects` 處理區塊內的這一段（目前大約在第349-394行附近，`resolveEffects` 呼叫之後）：

```javascript
            if (!effectResult.pending && effectResult.enteredNewRoom !== undefined) {
              const movedPlayer = getPlayer(gameState, targetForEffects);
              const enteredRoom = gameState.board[movedPlayer.floor].get(coordKey(movedPlayer.x, movedPlayer.y));
              io.to(roomCode).emit('game:roomEntered', { playerId: targetForEffects, roomId: enteredRoom.roomId, enteredNewRoom: effectResult.enteredNewRoom });
            }
```

這段就是待刪除／搬移的目標。確認上下文（前面是 `revealText`／`randomEffectText`／`itemUseResolved` 的組裝與廣播，後面是 `outcome.drawnCards` 的處理）跟這裡描述的一致，避免刪錯位置。

- [ ] **Step 2: 寫失敗測試——事件卡觸發的移動也要廣播 `game:roomEntered`**

在 `server/test/socketHandlers.test.js` 裡，靠近既有的 `event_004`／`event_035` 測試（搜尋 `game:move into event_035`），新增：

```javascript
test('game:move into an event card whose effects move the player again broadcasts a second game:roomEntered for that move (event-card path previously had no such broadcast)', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_test_teleport',
        name: '測試傳送',
        effects: [{ type: 'move_to_room', targetRoomId: 'room_teleport_target' }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  // move_to_room only scans the board for an already-placed room with this id -- it
  // does not create one, so this must be placed manually before the event fires.
  gameState.board.ground.set('5,5', { roomId: 'room_teleport_target', x: 5, y: 5, doorSides: [], droppedItems: [], item: null });

  // Entering room_new itself (the event-card-drawing room, freshly placed east of
  // spawn) already broadcasts its OWN game:roomEntered before the event card is even
  // drawn -- a plain .once() listener would catch that first broadcast, not the one
  // this test is actually checking for. Collect every broadcast instead and wait for
  // game:effectResolved (always emitted once the card's effects finish resolving)
  // before asserting, so both broadcasts are captured deterministically.
  const roomEnteredEvents = [];
  currentClient.on('game:roomEntered', (payload) => roomEnteredEvents.push(payload));
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;
  currentClient.off('game:roomEntered');

  expect(roomEnteredEvents).toHaveLength(2); // [0]: entering room_new, [1]: the event card's own move_to_room
  expect(roomEnteredEvents[1].roomId).toBe('room_teleport_target');
  expect(roomEnteredEvents[1].enteredNewRoom).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -t "event-card path previously had no such broadcast"`
Expected: FAIL（`roomEnteredEvents` 只收到1個——進 `room_new` 本身那個，事件卡的 `move_to_room` 完全沒有廣播，因為 `resolveCardDraw`→`handleEffectResolveResult` 目前完全沒有這段廣播）

- [ ] **Step 4: 把廣播邏輯搬進 `handleEffectResolveResult`**

在 `handleEffectResolveResult` 函式本體裡找到這兩行（緊接在 pending 分支的 `if (effectResult.pending) { ... return { pending: true }; }` 之後）：

```javascript
  resolverEntry.pendingChoice = null;
  const player = getPlayer(gameState, playerId);
```

在這兩行**之後**插入：

```javascript
  if (effectResult.enteredNewRoom !== undefined) {
    const enteredRoom = gameState.board[player.floor].get(coordKey(player.x, player.y));
    io.to(roomCode).emit('game:roomEntered', { playerId, roomId: enteredRoom.roomId, enteredNewRoom: effectResult.enteredNewRoom });
  }
```

（這裡不需要再檢查 `!effectResult.pending`——能執行到這一行代表 pending 分支已經提前 `return` 過了，一定是 non-pending。）

- [ ] **Step 5: 刪除 `game:selectAction` 裡重複的局部廣播**

刪除 Step 1 找到的那整段（4行 `if (!effectResult.pending && effectResult.enteredNewRoom !== undefined) { ... }`）。`targetForEffects` 這個變數在同一個 try 區塊的其他地方（`resolveEffects` 呼叫、`revealText`/`randomEffectText` 的目標判斷）仍然有用到，不會變成孤兒變數，不要連著一起刪。

- [ ] **Step 6: 執行 Step 2 的測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "event-card path previously had no such broadcast"`
Expected: PASS

- [ ] **Step 7: 執行既有相關回歸測試，確認廣播內容一致（但注意：發射順序已改變）**

Run: `cd server && npx jest test/socketHandlers.test.js -t "roomEntered"`
Expected: 全數 PASS。注意：搬移改變了 `game:roomEntered` 相對於 `game:itemUseResolved` 的發射順序（現在在前，之前在後），接收者/payload 本身未變。這是刻意的設計（開發者已於 2026-08-31 審核並接受）。特別確認以下三個既有測試沒有被搬移動作的其他面向影響：
- `game:selectAction room_action with actionIndex selecting teleport: jumping down an already-collapsed room broadcasts game:roomEntered for the basement room`
- `game:selectAction room_action resolving a move_to_room effect (e.g. stairs) broadcasts game:roomEntered for the target room`
- `game:selectAction item_044 with rng landing on option 1: broadcasts game:roomEntered when the random neighbor is a room the player has never visited`

- [ ] **Step 8: 執行完整後端測試套件確認零回歸**

Run: `cd server && npx jest`
Expected: 全數 PASS（這次修改前的基準是主分支目前的 665/665，這裡應該變成 666/666，多了 Step 2 新增的 1 個測試）

- [ ] **Step 9: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "fix: broadcast game:roomEntered from all effect-resolution paths, not just item use"
```

---

### Task 2: 新增 `restore_or_advance` 效果類型，串接 `event_026`

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Modify: `data/cards/event-cards.json`
- Test: `server/test/game/effectResolver.test.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes：`isBelowBase(player, stat)`（`server/src/game/playerEntity.js` 既有 export，回傳 `player.stats[stat].currentIndex < player.stats[stat].baseIndex`）；`changeStat(player, stat, delta, hauntStarted)`（既有 export）
- Produces：`HANDLERS.restore_or_advance`，效果格式 `{ type: "restore_or_advance", stat: "sanity" | "knowledge" | "might" | "speed" }`，回傳 `{ pending: false }`

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/effectResolver.test.js`，靠近既有的 `restoreToBase` 測試群組（搜尋 `restores a stat to its baseIndex`），新增：

```javascript
test('resolveEffects restore_or_advance restores the stat to baseIndex when it is currently below base', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.stats.sanity.currentIndex = 0; // dropped below base (baseIndex 2)
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'restore_or_advance', stat: 'sanity' },
  ]);
  expect(player.stats.sanity.currentIndex).toBe(2); // restored to baseIndex, not advanced further
});

test('resolveEffects restore_or_advance advances the stat by one level when it is already at baseIndex', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  // sanity.currentIndex starts at baseIndex 2 by default (see makeStats/createPlayer)
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'restore_or_advance', stat: 'sanity' },
  ]);
  expect(player.stats.sanity.currentIndex).toBe(3); // baseIndex 2 + 1
});

test('resolveEffects restore_or_advance throws UNKNOWN_STAT for an unrecognized stat', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [{ type: 'restore_or_advance', stat: 'luck' }])
  ).toThrow('UNKNOWN_STAT');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "restore_or_advance"`
Expected: FAIL with "UNSUPPORTED_EFFECT_TYPE"（`restore_or_advance` 還沒註冊）

- [ ] **Step 3: 實作 `handleRestoreOrAdvance`**

在 `server/src/game/effectResolver.js` 頂部的 import（第2行）加上 `isBelowBase`：

```javascript
const { changeStat, addItem, removeItem, getStatValue, movePlayerTo, STATS, isBelowBase } = require('./playerEntity');
```

在 `handleRandomStatChange` 函式（第60-65行）之後新增：

```javascript
function handleRestoreOrAdvance(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  const statTrack = player.stats[effect.stat];
  if (!statTrack) {
    throw new Error('UNKNOWN_STAT');
  }
  if (isBelowBase(player, effect.stat)) {
    changeStat(player, effect.stat, statTrack.baseIndex - statTrack.currentIndex, gameState.hauntStarted);
  } else {
    changeStat(player, effect.stat, 1, gameState.hauntStarted);
  }
  return { pending: false };
}
```

在 `HANDLERS` 註冊表（`stat_change` 那一行附近）新增一行：

```javascript
  restore_or_advance: (gameState, promptState, playerId, effect) => handleRestoreOrAdvance(gameState, playerId, effect),
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "restore_or_advance"`
Expected: PASS

- [ ] **Step 5: 串接 `event_026` 資料**

在 `data/cards/event-cards.json` 找到 `event_026`（`"id": "event_026"`），把：

```json
    "effects": [],
    "needsCustomLogic": false
```

改成：

```json
    "effects": [
      { "type": "action_points", "setTo": 0 },
      { "type": "restore_or_advance", "stat": "sanity" },
      { "type": "restore_or_advance", "stat": "knowledge" }
    ],
    "needsCustomLogic": false
```

（`needsCustomLogic` 原本已經是 `false`，維持不變。）

- [ ] **Step 6: 寫資料層完整性測試**

在 `server/test/game/effectResolver.test.js`，靠近既有的 `event_004/event_029/event_035 in data/cards/event-cards.json have the expected...` 測試，新增：

```javascript
test('event_026 in data/cards/event-cards.json has the expected restore_or_advance effects', () => {
  const eventCards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data/cards/event-cards.json'), 'utf8'));
  const event026 = eventCards.find((c) => c.id === 'event_026');
  expect(event026).toBeDefined();
  expect(event026.effects).toEqual([
    { type: 'action_points', setTo: 0 },
    { type: 'restore_or_advance', stat: 'sanity' },
    { type: 'restore_or_advance', stat: 'knowledge' },
  ]);
  expect(event026.needsCustomLogic).toBe(false);
});
```

- [ ] **Step 7: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "event_026"`
Expected: PASS

- [ ] **Step 8: 寫端對端測試（socket 層真實資料驗證，比照 `item_038` 既有先例）**

在 `server/test/socketHandlers.test.js`，靠近既有的 `game:move into event_035` 測試，新增：

```javascript
test('game:move into event_026 (透入的陽光) zeros action points and restores/advances sanity and knowledge independently', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_026',
        name: '透入的陽光',
        effects: [
          { type: 'action_points', setTo: 0 },
          { type: 'restore_or_advance', stat: 'sanity' },
          { type: 'restore_or_advance', stat: 'knowledge' },
        ],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const before = getPlayer(gameState, currentPlayerId);
  before.stats.sanity.currentIndex = before.stats.sanity.baseIndex - 1; // below base
  // knowledge left untouched, i.e. already at baseIndex

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.actionPoints).toBe(0);
  expect(after.stats.sanity.currentIndex).toBe(after.stats.sanity.baseIndex); // restored, not advanced past base
  expect(after.stats.knowledge.currentIndex).toBe(after.stats.knowledge.baseIndex + 1); // was at base, advanced

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 9: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "event_026"`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js server/test/socketHandlers.test.js data/cards/event-cards.json
git commit -m "feat: add restore_or_advance effect type, wire event_026"
```

---

### Task 3: 新增 `lose_random_item` 效果類型，串接 `event_013`

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Modify: `data/cards/event-cards.json`
- Test: `server/test/game/effectResolver.test.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes：`removeItem(player, itemId)`（既有 `playerEntity.js` export）；`context.itemCatalog`（既有慣例，`resolveEffects` 呼叫端都會傳，格式是卡片定義陣列 `[{id, name, ...}, ...]`）
- Produces：`HANDLERS.lose_random_item`，效果格式 `{ type: "lose_random_item", destination?: "deck" | "room" }`，回傳 `{ pending: false, appliedCount: 0 }`（沒有候選物品時）或 `{ pending: false }`（成功移除時）；新增共用函式 `routeLostItemToDestination(gameState, player, itemId, destination, itemCatalog)`（`handleLoseItem` 也會改用它，行為不變）

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/effectResolver.test.js`，靠近既有的 `lose_item` 測試群組（第178-228行附近），新增：

```javascript
test('resolveEffects lose_random_item removes a random item that belongs to the item catalog, ignoring anything else held', () => {
  const gameState = makeGameStateWithPlayer('p1', { items: [] });
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_a' }, { id: 'omen_x' }); // omen_x is NOT in itemCatalog below
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'lose_random_item' },
  ], { itemCatalog: [{ id: 'item_a', name: 'A' }] });
  expect(player.inventory).toEqual([{ id: 'omen_x' }]); // only the catalog item was eligible/removed
});

test('resolveEffects lose_random_item does nothing when the player holds no items from the item catalog', () => {
  const gameState = makeGameStateWithPlayer('p1');
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'omen_x' });
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'lose_random_item' },
  ], { itemCatalog: [] });
  expect(result).toEqual({ pending: false, appliedCount: 0 });
  expect(player.inventory).toEqual([{ id: 'omen_x' }]);
});

test('resolveEffects lose_random_item with destination "deck" pushes the removed card definition onto the item deck', () => {
  const gameState = makeGameStateWithPlayer('p1', { items: [] });
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_013_test' });
  const cardDef = { id: 'item_013_test', name: '測試道具', effects: [] };
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'lose_random_item', destination: 'deck' },
  ], { itemCatalog: [cardDef] });
  expect(player.inventory).toEqual([]);
  expect(gameState.itemDeck.cards).toEqual([cardDef]);
});

test('resolveEffects lose_random_item picks a different candidate depending on rng', () => {
  function setup() {
    const gameState = makeGameStateWithPlayer('p1', { items: [] });
    const player = gameState.players.get('p1');
    player.inventory.push({ id: 'item_a' }, { id: 'item_b' });
    return gameState;
  }
  const itemCatalog = [{ id: 'item_a' }, { id: 'item_b' }];

  const gsLow = setup();
  const rngLow = jest.spyOn(Math, 'random').mockReturnValue(0);
  resolveEffects(gsLow, createPromptState(), 'p1', [{ type: 'lose_random_item' }], { itemCatalog });
  rngLow.mockRestore();

  const gsHigh = setup();
  const rngHigh = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  resolveEffects(gsHigh, createPromptState(), 'p1', [{ type: 'lose_random_item' }], { itemCatalog });
  rngHigh.mockRestore();

  expect(gsLow.players.get('p1').inventory).toEqual([{ id: 'item_b' }]); // item_a removed
  expect(gsHigh.players.get('p1').inventory).toEqual([{ id: 'item_a' }]); // item_b removed
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "lose_random_item"`
Expected: FAIL with "UNSUPPORTED_EFFECT_TYPE"

- [ ] **Step 3: 抽出共用的 `routeLostItemToDestination`，實作 `handleLoseRandomItem`**

把現有的 `handleLoseItem`（第83-97行）：

```javascript
function handleLoseItem(gameState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  removeItem(player, effect.itemId);
  if (effect.destination === 'deck') {
    const cardDef = ((context && context.itemCatalog) || []).find((c) => c.id === effect.itemId);
    if (!cardDef) {
      throw new Error('UNKNOWN_ITEM_CARD');
    }
    gameState.itemDeck.cards.push(cardDef);
  } else if (effect.destination === 'room') {
    const room = getRoomForPlayer(gameState, player);
    room.droppedItems.push({ id: effect.itemId });
  }
  return { pending: false };
}
```

改成：

```javascript
function routeLostItemToDestination(gameState, player, itemId, destination, itemCatalog) {
  if (destination === 'deck') {
    const cardDef = itemCatalog.find((c) => c.id === itemId);
    if (!cardDef) {
      throw new Error('UNKNOWN_ITEM_CARD');
    }
    gameState.itemDeck.cards.push(cardDef);
  } else if (destination === 'room') {
    const room = getRoomForPlayer(gameState, player);
    room.droppedItems.push({ id: itemId });
  }
}

function handleLoseItem(gameState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  removeItem(player, effect.itemId);
  routeLostItemToDestination(gameState, player, effect.itemId, effect.destination, (context && context.itemCatalog) || []);
  return { pending: false };
}

function handleLoseRandomItem(gameState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const itemCatalog = (context && context.itemCatalog) || [];
  const candidateIds = player.inventory
    .map((item) => item.id)
    .filter((id) => itemCatalog.some((c) => c.id === id));
  if (candidateIds.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const chosenId = candidateIds[Math.floor(Math.random() * candidateIds.length)];
  removeItem(player, chosenId);
  routeLostItemToDestination(gameState, player, chosenId, effect.destination, itemCatalog);
  return { pending: false };
}
```

在 `HANDLERS` 註冊表的 `lose_item` 那一行之後新增：

```javascript
  lose_random_item: (gameState, promptState, playerId, effect, context) => handleLoseRandomItem(gameState, playerId, effect, context),
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "lose_random_item|lose_item"`
Expected: 全數 PASS（含既有 `lose_item` 測試——確認重構沒有改變既有行為）

- [ ] **Step 5: 串接 `event_013` 資料**

在 `data/cards/event-cards.json` 找到 `event_013`，把：

```json
    "effects": [],
    "needsCustomLogic": true
```

改成：

```json
    "effects": [{ "type": "lose_random_item", "destination": "deck" }],
    "needsCustomLogic": false
```

- [ ] **Step 6: 寫資料層完整性測試**

在 `server/test/game/effectResolver.test.js` 新增：

```javascript
test('event_013 in data/cards/event-cards.json has the expected lose_random_item effect', () => {
  const eventCards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data/cards/event-cards.json'), 'utf8'));
  const event013 = eventCards.find((c) => c.id === 'event_013');
  expect(event013).toBeDefined();
  expect(event013.effects).toEqual([{ type: 'lose_random_item', destination: 'deck' }]);
  expect(event013.needsCustomLogic).toBe(false);
});
```

- [ ] **Step 7: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "event_013"`
Expected: PASS

- [ ] **Step 8: 寫端對端測試（socket 層真實資料驗證，比照 `item_038` 既有先例）**

在 `server/test/socketHandlers.test.js`，靠近既有的 `game:move into event_035` 測試，新增：

```javascript
test('game:move into event_013 (割破背包) removes a random held item and returns it to the item deck', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_013',
        name: '割破背包',
        effects: [{ type: 'lose_random_item', destination: 'deck' }],
      }],
      items: [{ id: 'item_test_a', name: '測試道具A', effects: [] }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_test_a' });
  const deckCountBefore = gameState.itemDeck.cards.length;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.inventory).toEqual([]);
  expect(gameState.itemDeck.cards.length).toBe(deckCountBefore + 1); // the removed item was pushed back
  expect(gameState.itemDeck.cards[gameState.itemDeck.cards.length - 1]).toEqual({ id: 'item_test_a', name: '測試道具A', effects: [] });

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 9: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "event_013"`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js server/test/socketHandlers.test.js data/cards/event-cards.json
git commit -m "feat: add lose_random_item effect type, wire event_013"
```

---

### Task 4: 新增 `move_to_random_other_player_room` 效果類型，串接 `event_033`

**依賴：Task 1 必須先完成**——`event_033` 移動到的房間可能是全新房間，這個任務的端對端測試要驗證 `game:roomEntered` 正確廣播，若 Task 1 的集中式廣播還沒做，這個測試會失敗（事件卡路徑當時還沒有廣播）。

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Modify: `data/cards/event-cards.json`
- Test: `server/test/game/effectResolver.test.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes：`movePlayerTo(player, floor, x, y, enteredFromSide=null)`（既有 `playerEntity.js` export，回傳 `enteredNewRoom` 布林值）；`gameState.players`（`Map<playerId, player>`，既有結構）
- Produces：`HANDLERS.move_to_random_other_player_room`，效果格式 `{ type: "move_to_random_other_player_room" }`，回傳 `{ pending: false, appliedCount: 0 }`（沒有其他玩家時）或 `{ pending: false, enteredNewRoom }`

- [ ] **Step 1: 寫失敗測試（單元）**

在 `server/test/game/effectResolver.test.js`，靠近既有的 `move_to_random_neighbor_room` 測試群組（第605-659行附近），新增：

```javascript
test('resolveEffects move_to_random_other_player_room moves the player to another player\'s current position', () => {
  const gameState = makeGameStateWithPlayer('p1');
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  const p2 = gameState.players.get('p2');
  p2.floor = 'ground';
  p2.x = 5;
  p2.y = 5;
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'move_to_random_other_player_room' },
  ]);
  const p1 = gameState.players.get('p1');
  expect(p1.floor).toBe('ground');
  expect(p1.x).toBe(5);
  expect(p1.y).toBe(5);
});

test('resolveEffects move_to_random_other_player_room does nothing when there are no other players', () => {
  const gameState = makeGameStateWithPlayer('p1');
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'move_to_random_other_player_room' },
  ]);
  expect(result).toEqual({ pending: false, appliedCount: 0 });
});

test('resolveEffects move_to_random_other_player_room picks different target players depending on rng', () => {
  function setup() {
    const gameState = makeGameStateWithPlayer('p1');
    addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
    addPlayer(gameState, { playerId: 'p3', name: 'Carol', stats: makeStats() });
    const p2 = gameState.players.get('p2');
    p2.x = 5; p2.y = 5;
    const p3 = gameState.players.get('p3');
    p3.x = 9; p3.y = 9;
    return gameState;
  }

  const gameStateLow = setup();
  const rngLow = jest.spyOn(Math, 'random').mockReturnValue(0);
  resolveEffects(gameStateLow, createPromptState(), 'p1', [{ type: 'move_to_random_other_player_room' }]);
  rngLow.mockRestore();
  const p1Low = gameStateLow.players.get('p1');

  const gameStateHigh = setup();
  const rngHigh = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  resolveEffects(gameStateHigh, createPromptState(), 'p1', [{ type: 'move_to_random_other_player_room' }]);
  rngHigh.mockRestore();
  const p1High = gameStateHigh.players.get('p1');

  const lowDestination = [p1Low.x, p1Low.y];
  const highDestination = [p1High.x, p1High.y];
  expect(lowDestination).not.toEqual(highDestination);
  expect([lowDestination, highDestination]).toEqual(expect.arrayContaining([[5, 5], [9, 9]]));
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "move_to_random_other_player_room"`
Expected: FAIL with "UNSUPPORTED_EFFECT_TYPE"

- [ ] **Step 3: 實作 `handleMoveToRandomOtherPlayerRoom`**

在 `handleMoveToRandomNeighborRoom` 函式（第234-249行）之後新增：

```javascript
function handleMoveToRandomOtherPlayerRoom(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const others = [...gameState.players.values()].filter((p) => p.playerId !== playerId);
  if (others.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const target = others[Math.floor(Math.random() * others.length)];
  const enteredNewRoom = movePlayerTo(player, target.floor, target.x, target.y);
  return { pending: false, enteredNewRoom };
}
```

在 `HANDLERS` 註冊表的 `move_to_random_neighbor_room` 那一行之後新增：

```javascript
  move_to_random_other_player_room: (gameState, promptState, playerId) => handleMoveToRandomOtherPlayerRoom(gameState, playerId),
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "move_to_random_other_player_room"`
Expected: PASS

- [ ] **Step 5: 串接 `event_033` 資料**

在 `data/cards/event-cards.json` 找到 `event_033`，把：

```json
    "effects": [],
    "needsCustomLogic": true
```

改成：

```json
    "effects": [{ "type": "move_to_random_other_player_room" }],
    "needsCustomLogic": false
```

- [ ] **Step 6: 寫資料層完整性測試**

在 `server/test/game/effectResolver.test.js` 新增：

```javascript
test('event_033 in data/cards/event-cards.json has the expected move_to_random_other_player_room effect', () => {
  const eventCards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data/cards/event-cards.json'), 'utf8'));
  const event033 = eventCards.find((c) => c.id === 'event_033');
  expect(event033).toBeDefined();
  expect(event033.effects).toEqual([{ type: 'move_to_random_other_player_room' }]);
  expect(event033.needsCustomLogic).toBe(false);
});
```

- [ ] **Step 7: 寫端對端測試（驗證 Task 1 的 roomEntered 修法真的涵蓋這條路徑）**

在 `server/test/socketHandlers.test.js`，靠近既有的 `event_004`/`event_035` 測試，新增：

```javascript
test('game:move into event_033 (傳送門) moves the player to a random other player\'s room and broadcasts game:roomEntered for it', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_033',
        name: '傳送門',
        effects: [{ type: 'move_to_random_other_player_room' }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  // Move the OTHER player to a distinct, already-placed room so the teleport target
  // is somewhere genuinely different from where the acting player currently stands.
  const otherPlayer = [...gameState.players.values()].find((p) => p.playerId !== currentPlayerId);
  otherPlayer.floor = 'ground';
  otherPlayer.x = 5;
  otherPlayer.y = 5;
  gameState.board.ground.set('5,5', { roomId: 'room_teleport_target', x: 5, y: 5, doorSides: [], droppedItems: [], item: null });

  // Entering room_new itself (the event-card-drawing room) already broadcasts its OWN
  // game:roomEntered before event_033 is even drawn -- collect every broadcast and wait
  // for game:effectResolved so both are captured deterministically (same reasoning as
  // Task 1's regression test).
  const roomEnteredEvents = [];
  currentClient.on('game:roomEntered', (payload) => roomEnteredEvents.push(payload));
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;
  currentClient.off('game:roomEntered');

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.floor).toBe('ground');
  expect(after.x).toBe(5);
  expect(after.y).toBe(5);
  expect(roomEnteredEvents).toHaveLength(2); // [0]: entering room_new, [1]: event_033's teleport
  expect(roomEnteredEvents[1].roomId).toBe('room_teleport_target');
  expect(roomEnteredEvents[1].enteredNewRoom).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 8: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "event_033"`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js server/test/socketHandlers.test.js data/cards/event-cards.json
git commit -m "feat: add move_to_random_other_player_room effect type, wire event_033"
```

---

### Task 5: 擴充 `buildRandomEffectText` 支援陣列型 `feedbacktextOccur`，串接 `item_040`

**Files:**
- Modify: `server/src/socketHandlers.js`
- Modify: `data/cards/item-cards.json`
- Test: `server/test/game/effectResolver.test.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes：`content.cards.items`／`content.cards.events`／`content.cards.omens`（既有靜態卡片內容，`buildRandomEffectText` 既有簽名 `(content, sourceId, randomEffectIndex)` 不變）
- Produces：`buildRandomEffectText` 現在對陣列型 `feedbacktextOccur` 也能正確查到文字，`game:itemUseResolved` 的 `randomEffectText` 欄位因此對 `item_040` 也能正確填值（前端 `overrideText: data.revealText || data.randomEffectText` 完全不用改，既有機制自動生效）

- [ ] **Step 1: 寫失敗測試（端對端）**

在 `server/test/socketHandlers.test.js`，靠近既有的 `item_044 with rng landing on option 6: sends the matching feedbacktextDice string` 測試，新增：

```javascript
test('game:selectAction item_040 with rng landing on index 3: sends the matching feedbacktextOccur array entry as randomEffectText', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_040',
        name: '一疊紙牌',
        feedbacktextOccur: ['抽到了紅心七', '抽到了黑桃二', '抽到了梅花三', '抽到了鬼牌', '抽到了黑桃Ａ', '抽到了黑桃Ｊ'],
        effects: [{
          type: 'random_effect',
          options: [
            { effects: [] }, { effects: [] }, { effects: [] },
            { effects: [] }, { effects: [] }, { effects: [] },
          ],
        }],
        category: 'reusable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_040' });

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5); // 0.5 * 6 options -> index 3
  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_040' }, resolve));
  const itemUseResolved = await itemUseResolvedPromise;
  rngSpy.mockRestore();

  expect(itemUseResolved.randomEffectText).toBe('抽到了鬼牌');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -t "item_040"`
Expected: FAIL（`randomEffectText` 是 `undefined`，因為 `buildRandomEffectText` 目前只認 `feedbacktextDice`）

- [ ] **Step 3: 擴充 `buildRandomEffectText`**

在 `server/src/socketHandlers.js` 找到（第798-809行）：

```javascript
function buildRandomEffectText(content, sourceId, randomEffectIndex) {
  if (typeof randomEffectIndex !== 'number') {
    return null;
  }
  const card = content.cards.items.find((c) => c.id === sourceId)
    || content.cards.events.find((c) => c.id === sourceId)
    || content.cards.omens.find((c) => c.id === sourceId);
  if (!card || !card.feedbacktextDice) {
    return null;
  }
  return card.feedbacktextDice[String(randomEffectIndex + 1)] || null;
}
```

改成：

```javascript
function buildRandomEffectText(content, sourceId, randomEffectIndex) {
  if (typeof randomEffectIndex !== 'number') {
    return null;
  }
  const card = content.cards.items.find((c) => c.id === sourceId)
    || content.cards.events.find((c) => c.id === sourceId)
    || content.cards.omens.find((c) => c.id === sourceId);
  if (!card) {
    return null;
  }
  if (Array.isArray(card.feedbacktextOccur)) {
    return card.feedbacktextOccur[randomEffectIndex] || null;
  }
  if (!card.feedbacktextDice) {
    return null;
  }
  return card.feedbacktextDice[String(randomEffectIndex + 1)] || null;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "item_040|item_044"`
Expected: 全數 PASS（含既有 `item_044` 的 `feedbacktextDice` 測試——確認 dict 型路徑不受影響）

- [ ] **Step 5: 串接 `item_040` 資料**

在 `data/cards/item-cards.json` 找到 `item_040`，把：

```json
    "effects": [],
```

改成：

```json
    "effects": [{
      "type": "random_effect",
      "options": [
        { "effects": [] }, { "effects": [] }, { "effects": [] },
        { "effects": [] }, { "effects": [] }, { "effects": [] }
      ]
    }],
```

（`feedbacktextOccur` 已經是既有的6句陣列，不需要改；`needsCustomLogic` 已經是 `false`，不需要改。）

- [ ] **Step 6: 寫資料層完整性測試**

在 `server/test/game/effectResolver.test.js` 新增：

```javascript
test('item_040 in data/cards/item-cards.json has the expected random_effect options (6 empty-effect choices)', () => {
  const itemCards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data/cards/item-cards.json'), 'utf8'));
  const item040 = itemCards.find((c) => c.id === 'item_040');
  expect(item040).toBeDefined();
  expect(item040.effects).toEqual([{
    type: 'random_effect',
    options: [
      { effects: [] }, { effects: [] }, { effects: [] },
      { effects: [] }, { effects: [] }, { effects: [] },
    ],
  }]);
  expect(item040.feedbacktextOccur).toHaveLength(6);
});
```

- [ ] **Step 7: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "item_040"`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/src/socketHandlers.js server/test/game/effectResolver.test.js server/test/socketHandlers.test.js data/cards/item-cards.json
git commit -m "feat: support array-shaped feedbacktextOccur in buildRandomEffectText, wire item_040"
```

---

### Task 6: 串接 `event_031`（紅藍藥丸，純資料，重用既有 `choice`＋`random_effect`）

**Files:**
- Modify: `data/cards/event-cards.json`
- Test: `server/test/game/effectResolver.test.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes：既有 `choice` 效果（`HANDLERS.choice`）與既有 `random_effect` 效果（`HANDLERS.random_effect`）——這個任務不新增任何生產程式碼，純資料串接＋測試

- [ ] **Step 1: 串接 `event_031` 資料**

在 `data/cards/event-cards.json` 找到 `event_031`，把：

```json
    "effects": [],
    "needsCustomLogic": true
```

改成：

```json
    "effects": [{
      "type": "choice",
      "description": "紅色藥丸還是藍色藥丸？",
      "timeoutMs": 20000,
      "defaultOptionId": "give_up",
      "options": [
        { "optionId": "red", "label": "紅色", "effects": [{ "type": "random_effect", "options": [{ "effects": [{ "type": "stat_change", "stat": "sanity", "delta": 1 }] }, { "effects": [{ "type": "stat_change", "stat": "sanity", "delta": -1 }] }] }] },
        { "optionId": "blue", "label": "藍色", "effects": [{ "type": "random_effect", "options": [{ "effects": [{ "type": "stat_change", "stat": "sanity", "delta": 1 }] }, { "effects": [{ "type": "stat_change", "stat": "sanity", "delta": -1 }] }] }] },
        { "optionId": "give_up", "label": "放棄", "effects": [{ "type": "random_effect", "options": [{ "effects": [{ "type": "stat_change", "stat": "sanity", "delta": 1 }] }, { "effects": [{ "type": "stat_change", "stat": "sanity", "delta": -1 }] }] }] }
      ]
    }],
    "needsCustomLogic": false
```

三個選項的 `effects` 完全相同（各自獨立掛一份 50/50 隨機效果）——這是刻意的，開發者已確認「放棄」也要觸發同一個隨機事件。

- [ ] **Step 2: 寫資料層完整性測試**

在 `server/test/game/effectResolver.test.js` 新增：

```javascript
test('event_031 in data/cards/event-cards.json has the expected choice+random_effect data (give_up also triggers the 50/50)', () => {
  const eventCards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data/cards/event-cards.json'), 'utf8'));
  const event031 = eventCards.find((c) => c.id === 'event_031');
  expect(event031).toBeDefined();
  const fiftyFifty = {
    type: 'random_effect',
    options: [
      { effects: [{ type: 'stat_change', stat: 'sanity', delta: 1 }] },
      { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] },
    ],
  };
  expect(event031.effects).toEqual([{
    type: 'choice',
    description: '紅色藥丸還是藍色藥丸？',
    timeoutMs: 20000,
    defaultOptionId: 'give_up',
    options: [
      { optionId: 'red', label: '紅色', effects: [fiftyFifty] },
      { optionId: 'blue', label: '藍色', effects: [fiftyFifty] },
      { optionId: 'give_up', label: '放棄', effects: [fiftyFifty] },
    ],
  }]);
  expect(event031.needsCustomLogic).toBe(false);
});
```

- [ ] **Step 3: 執行測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "event_031"`
Expected: PASS

- [ ] **Step 4: 寫端對端測試——確認「放棄」也觸發隨機效果**

在 `server/test/socketHandlers.test.js`，靠近既有的 `game:effectPromptRespond resolves the pending choice` 測試，新增：

```javascript
test('game:move into event_031 (紅藍藥丸) opens a red/blue/give-up choice, and give_up still triggers the 50/50 sanity swing', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_031',
        name: '紅藍藥丸',
        effects: [{
          type: 'choice',
          description: '紅色藥丸還是藍色藥丸？',
          timeoutMs: 20000,
          defaultOptionId: 'give_up',
          options: [
            { optionId: 'red', label: '紅色', effects: [{ type: 'random_effect', options: [{ effects: [{ type: 'stat_change', stat: 'sanity', delta: 1 }] }, { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] }] }] },
            { optionId: 'blue', label: '藍色', effects: [{ type: 'random_effect', options: [{ effects: [{ type: 'stat_change', stat: 'sanity', delta: 1 }] }, { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] }] }] },
            { optionId: 'give_up', label: '放棄', effects: [{ type: 'random_effect', options: [{ effects: [{ type: 'stat_change', stat: 'sanity', delta: 1 }] }, { effects: [{ type: 'stat_change', stat: 'sanity', delta: -1 }] }] }] },
          ],
        }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;
  expect(pendingChoice.options.map((o) => o.optionId)).toEqual(['red', 'blue', 'give_up']);

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // random_effect index 0 -> sanity +1
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'give_up' }, resolve);
  });
  await effectResolvedPromise;
  const update = await updatePromise;
  rngSpy.mockRestore();

  const me = update.players.find((p) => p.playerId === currentPlayerId);
  expect(me.stats.sanity.currentIndex).toBe(me.stats.sanity.baseIndex + 1); // give_up still triggered the 50/50, landed on +1

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 5: 執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "event_031"`
Expected: PASS

- [ ] **Step 6: 執行完整後端測試套件確認全部通過（本次計畫的最終驗收）**

Run: `cd server && npx jest`
Expected: 全數 PASS（Task 1 完成後基準是 666，Task 2-6 各自新增測試後，最終應該是 666 + 5(Task2：3單元+1資料層+1端對端) + 6(Task3：4單元+1資料層+1端對端) + 5(Task4：3單元+1資料層+1端對端) + 2(Task5：1端對端+1資料層) + 2(Task6：1資料層+1端對端) = 686 附近，實際數字以執行結果為準，重點是「全部 PASS，沒有任何 FAIL」）

- [ ] **Step 7: Commit**

```bash
git add server/test/game/effectResolver.test.js server/test/socketHandlers.test.js data/cards/event-cards.json
git commit -m "feat: wire event_031 to existing choice+random_effect (give_up also triggers the 50/50)"
```
