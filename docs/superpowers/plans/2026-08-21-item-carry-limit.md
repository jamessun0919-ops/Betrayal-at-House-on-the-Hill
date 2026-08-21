# 物品攜帶數量上限機制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 玩家能攜帶的道具卡數量上限＝目前力量值；取得道具（不論透過哪一種路徑）後若超過上限，開啟一個「選擇遺留哪件道具」的暫停狀態，直到回到上限內為止。

**Architecture:** 統一所有「道具進背包」路徑經過 `playerEntity.js` 的 `addItem()`；新增一個共用檢查函式 `openInventoryChoiceIfNeeded`，在每個取得道具的入口點之後呼叫；沿用既有的 `promptState.js` 通用暫停/回應/逾時機制（`createPrompt`/`respondToPrompt`/`resolvePromptTimeout`），新增一個平行的 `resolverEntry.pendingInventoryChoice` 欄位（不重用 `pendingChoice` 的資料結構），比照 `pendingChoice`/`pendingRollChoice` 現有的「room 進行中動作要被擋下」約定。

**Tech Stack:** Node.js / Express / Socket.IO 後端（`server/src/game/*.js`、`server/src/socketHandlers.js`），React 前端（`client/src/DebugGameScreen.jsx`），Jest 測試。

**Design doc:** `docs/superpowers/specs/2026-08-21-item-carry-limit-design.md`（已核准）。本計畫在其基礎上加入兩項實作細節上的釐清（皆與開發者確認過，不牴觸已核准的設計）：

1. **逾時預設目標的精確定義**：設計文件的 `triggeredByItemId` 在「一次取得多件道具、超過上限需連續詢問多輪」時，`triggeredByItemId` 每一輪都**重新計算**——固定從「這次操作新取得的道具 id 清單」（`newlyAcquiredItemIds`，依取得順序）由後往前找「目前仍持有」的第一件；如果這批新道具全部都已在前面幾輪被玩家手動選走，才 fallback 成「目前持有清單的第一件」。範例：一次抽到 item_A、item_B 兩張且都超過上限 → 第 1 輪逾時預設遺留 item_B（最後抽到的）→ 若還超過上限開第 2 輪 → 逾時預設遺留 item_A。
2. **`pendingInventoryChoice` 資料結構補一個欄位** `newlyAcquiredItemIds`（設計文件原始草稿沒有寫出這個欄位，但要支援上一點的邏輯就需要它）：

```js
// resolverEntry.pendingInventoryChoice
{
  playerId,
  itemIds: [...],              // 玩家目前持有的道具卡 id 清單（動態產生，不含預兆卡）
  newlyAcquiredItemIds: [...], // 這次操作新取得的道具 id 清單（依取得順序），逾時預設從這裡挑選，跨輪次不變
  triggeredByItemId,           // 本輪逾時預設遺留的道具 id（每輪重新計算，見上）
  deadline
}
```

**前端檔案更正**：設計文件寫「`CharacterPanel.jsx` 新增彈窗」，但實際查證後，`game:effectPendingChoice`／`game:diceChoicePending` 的既有彈窗渲染邏輯位於 `client/src/DebugGameScreen.jsx`（不是 `CharacterPanel.jsx`）。Task 4 的新彈窗會加在 `DebugGameScreen.jsx`，比照該檔案既有的 `pendingEffectChoice`/`pendingRollChoice` 彈窗寫法，UI 風格不變，僅檔案位置與設計文件原文不同。

## Global Constraints

- 上限計算：`getStatValue(player, 'might')`（`server/src/game/playerEntity.js` 既有函式，含 overflow）。
- 只計算道具卡：`countHeldItems`／`openInventoryChoiceIfNeeded` 判斷「是否為道具卡」一律用 `cardContent.items.some((i) => i.id === held.id)`（`cardContent` 即伺服器端的 `content.cards`，形狀為 `{ items, events, omens }`），預兆卡（`cardContent.omens`）不計入。
- 遺留道具**不扣行動力**：直接把道具從 `player.inventory` 移到當前房間的 `room.droppedItems`，不呼叫任何會扣 `actionPoints` 的既有函式。
- 力量值下降**不**回溯觸發遺留選擇：`openInventoryChoiceIfNeeded` 只在明確呼叫時才檢查一次，沒有任何監聽力量值變動的程式碼。
- 召喚物攜帶的道具（`player.summons.carryingItemId`）不受影響：`selectSummonAction` 完全不改動，本來就不經過 `player.inventory`／`addItem`。
- 逾時預設時間沿用既有慣例：新增 `options.inventoryChoiceTimeoutMs`，預設 `20000`（比照 `rollChoiceTimeoutMs` 在 `registerSocketHandlers` 開頭的寫法）。
- 未解決的 `pendingInventoryChoice` 要擋下 `game:move`／`game:selectAction`／`game:useStairs`／`game:endTurn` 這 4 個既有守衛點，回傳 `INVENTORY_CHOICE_IN_PROGRESS`，插入順序在既有的 `EFFECT_CHOICE_IN_PROGRESS`／`ROLL_CHOICE_IN_PROGRESS` 檢查之後。
- `pendingInventoryChoice` 的逾時計時器 handle 存在 `resolverEntry.inventoryChoiceTimeoutHandle`（不是額外的頂層 `Map`）——因為每個需要用到它的函式都已經透過 `getResolver(effectResolverManager, roomCode)` 拿到 `resolverEntry`，不需要像 `effectChoiceTimeouts`/`rollChoiceTimeouts` 那樣額外多傳一個 `Map` 參數穿過一堆函式。`resolverEntry` 本身不會被序列化送給任何 client（`serializeGameState` 只序列化 `gameState`），所以存一個 `Timeout` handle 在它身上是安全的。

---

### Task 1: `countHeldItems` + 讓 `giveItemAction`／`pickupItemAction` 也經過 `addItem()`

**Files:**
- Modify: `server/src/game/playerEntity.js`
- Modify: `server/src/game/turnFlow.js:1-6`（import）、`server/src/game/turnFlow.js:424-441`（`giveItemAction`）、`server/src/game/turnFlow.js:455-465`（`pickupItemAction`）
- Test: `server/test/game/playerEntity.test.js`

**Interfaces:**
- Produces: `countHeldItems(player, cardContent) -> number`，從 `server/src/game/playerEntity.js` 匯出。之後 Task 2 會在 `socketHandlers.js` 匯入使用。
- Consumes: 無新依賴，沿用 `playerEntity.js` 既有的 `addItem(player, item)`（會拋 `INVALID_ITEM`）。

- [ ] **Step 1: 寫 `countHeldItems` 的失敗測試**

在 `server/test/game/playerEntity.test.js` 檔案最後加入（`removeItem` 相關測試之後）：

```js
test('countHeldItems counts only ids that appear in cardContent.items, not omens', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  addItem(player, { id: 'item_001' });
  addItem(player, { id: 'omen_003' });
  addItem(player, { id: 'item_007' });
  const cardContent = {
    items: [{ id: 'item_001' }, { id: 'item_007' }, { id: 'item_099' }],
    omens: [{ id: 'omen_003' }],
  };
  expect(countHeldItems(player, cardContent)).toBe(2);
});

test('countHeldItems returns 0 for an empty inventory', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  const cardContent = { items: [{ id: 'item_001' }], omens: [] };
  expect(countHeldItems(player, cardContent)).toBe(0);
});
```

同時把檔案最上方的 import 改成加入 `countHeldItems`：

```js
const { STATS, createPlayer, changeStat, resetActionPoints, movePlayerTo, getStatValue, isBelowBase, addItem, removeItem, countHeldItems } = require('../../src/game/playerEntity');
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx jest server/test/game/playerEntity.test.js -t "countHeldItems"`
Expected: FAIL（`countHeldItems is not a function`）

- [ ] **Step 3: 實作 `countHeldItems`**

在 `server/src/game/playerEntity.js` 的 `removeItem` 函式之後（第 141 行之後）加入：

```js
function countHeldItems(player, cardContent) {
  return player.inventory.filter((held) => cardContent.items.some((i) => i.id === held.id)).length;
}
```

並把檔案結尾的 `module.exports` 改成：

```js
module.exports = {
  STATS,
  createPlayer,
  changeStat,
  resetActionPoints,
  movePlayerTo,
  getStatValue,
  isBelowBase,
  addItem,
  removeItem,
  countHeldItems,
};
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx jest server/test/game/playerEntity.test.js`
Expected: PASS（全部測試，包含新增的 2 個）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/playerEntity.js server/test/game/playerEntity.test.js
git commit -m "feat: add countHeldItems to playerEntity"
```

- [ ] **Step 6: 讓 `giveItemAction`／`pickupItemAction` 改成呼叫 `addItem()`**

`server/src/game/turnFlow.js` 第 5 行的 import 改成：

```js
const { movePlayerTo, resetActionPoints, getStatValue, changeStat, addItem } = require('./playerEntity');
```

`giveItemAction`（第 424-441 行）把 `targetPlayer.inventory.push(item);` 改成 `addItem(targetPlayer, item);`：

```js
function giveItemAction(gameState, player, itemId, targetPlayerId) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_HELD');
  }
  const targetPlayer = requirePlayer(gameState, targetPlayerId);
  if (
    targetPlayer.floor !== player.floor ||
    targetPlayer.x !== player.x ||
    targetPlayer.y !== player.y
  ) {
    throw new Error('TARGET_NOT_IN_ROOM');
  }
  const [item] = player.inventory.splice(index, 1);
  addItem(targetPlayer, item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'give', itemId, targetPlayerId };
}
```

`pickupItemAction`（第 455-465 行）把 `player.inventory.push(item);` 改成 `addItem(player, item);`：

```js
function pickupItemAction(gameState, player, itemId) {
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  const index = room.droppedItems.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_IN_ROOM');
  }
  const [item] = room.droppedItems.splice(index, 1);
  addItem(player, item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'pickup', itemId };
}
```

（`leaveItemAction` 不需要改，它是移除道具，不是加入。）

- [ ] **Step 7: 執行既有測試確認沒有回歸**

Run: `npx jest server/test/game/turnFlow.test.js`
Expected: PASS（全部測試，包含既有的 `selectAction item mode:give`／`mode:pickup` 系列測試——這一步是純粹的行為保留重構，`addItem` 對合法道具物件的行為與原本的 `.push()` 完全相同）

- [ ] **Step 8: Commit**

```bash
git add server/src/game/turnFlow.js
git commit -m "refactor: route giveItemAction/pickupItemAction through addItem"
```

---

### Task 2: `pendingInventoryChoice` 核心機制（狀態欄位、共用檢查函式、逾時、四個守衛點、串進 handleEffectResolveResult）

**Files:**
- Modify: `server/src/game/effectResolverManager.js`
- Modify: `server/src/game/effectResolver.js:39-43`（`handleGrantItem`）
- Modify: `server/src/socketHandlers.js`（多處，見下）
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 1 的 `countHeldItems(player, cardContent)`；既有的 `createPrompt`/`respondToPrompt`/`resolvePromptTimeout`（`server/src/game/promptState.js`）；既有的 `getResolver(effectResolverManager, roomCode)`（`server/src/game/effectResolverManager.js`）；既有的 `getPlayer(gameState, playerId)`（`server/src/game/gameState.js`）；既有的 `getStatValue(player, stat)`（`server/src/game/playerEntity.js`）。
- Produces（供 Task 3、Task 4 使用）：
  - `openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, playerId, cardContent, newlyAcquiredItemIds, inventoryChoiceTimeoutMs)` — 無回傳值，純副作用函式。若玩家目前持有道具卡數量 <= 上限則不做任何事；超過上限則設定 `resolverEntry.pendingInventoryChoice`、廣播 `game:inventoryChoicePending`、設定逾時計時器。
  - `hasPendingInventoryChoice(effectResolverManager, roomCode) -> boolean`
  - 新 socket 事件 `game:inventoryChoicePending`（payload: `{ playerId, promptId, itemIds }`）與 `game:inventoryChoiceRespond`（Task 3 實作 handler，這裡先只確保 `respondToPrompt` 相容的 `promptState` 已就緒）。
  - 新 error code：`INVENTORY_CHOICE_IN_PROGRESS`。

- [ ] **Step 1: `effectResolverManager.js` 的 entry 加上新欄位**

`server/src/game/effectResolverManager.js` 的 `startResolver` 內：

```js
function startResolver(manager, roomCode) {
  if (manager.resolvers.has(roomCode)) {
    throw new Error('RESOLVER_ALREADY_STARTED');
  }
  const entry = {
    promptState: createPromptState(),
    pendingChoice: null,
    pendingRollChoice: null,
    pendingInventoryChoice: null,
    inventoryChoiceTimeoutHandle: null,
  };
  manager.resolvers.set(roomCode, entry);
  return entry;
}
```

（這一步沒有獨立的單元測試檔案——`effectResolverManager.js` 目前沒有專屬測試檔，既有慣例是透過 `socketHandlers.test.js` 的整合測試間接驗證 entry 形狀。Step 6 的整合測試會驗證這個新欄位確實存在且行為正確。）

- [ ] **Step 2: `handleGrantItem` 補上 `drawnCards`，讓 `grant_item` 效果也能被通用地追蹤「剛取得哪個道具」**

`server/src/game/effectResolver.js` 第 39-43 行：

```js
function handleGrantItem(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  addItem(player, { id: effect.itemId });
  return { pending: false, drawnCards: [{ id: effect.itemId }] };
}
```

理由：`resolveEffects`（同檔案第 282-315 行）會把每個 handler 回傳的 `drawnCards` 陣列 concat 起來，`handleDrawCard`／`handleTakePreviewedCard` 已經這樣做；`handleGrantItem` 原本沒有，導致「透過 `grant_item` 拿到道具」這條路徑沒有任何通用訊號能知道剛剛拿到了哪張卡。這個欄位目前只有 `socketHandlers.js` 在 `outcome.drawnCards` 存在時透過 `socket.emit('game:cardsDrawn', ...)` 轉發給該名玩家自己的 socket（`server/src/socketHandlers.js` 第 335-337 行），而 client 端目前完全沒有監聽 `game:cardsDrawn`（已用 `Grep` 確認 `client/src/DebugGameScreen.jsx` 沒有任何 `game:cardsDrawn` 相關程式碼），所以這個改動對現有玩家可見行為零影響，只是補齊一個既有但不完整的資料聚合管道。

- [ ] **Step 3: 寫 `effectResolver.test.js` 的失敗測試（確認 `handleGrantItem` 回傳 `drawnCards`）**

先確認測試檔存在：

Run: `ls server/test/game/effectResolver.test.js`

在該檔案裡找到 `grant_item` 相關的既有測試（用 `grep -n "grant_item" server/test/game/effectResolver.test.js` 找到確切位置），在附近加入：

```js
test('grant_item effect reports the granted item id in drawnCards', () => {
  const { gameState } = makeGameStateWithPlayer(); // 沿用該測試檔既有的 setup helper，若名稱不同請以檔案內既有 helper 為準
  const promptState = createPromptState();
  const result = resolveEffects(gameState, promptState, 'p1', [{ type: 'grant_item', itemId: 'item_042' }], {});
  expect(result.drawnCards).toEqual([{ id: 'item_042' }]);
});
```

**注意**：此檔案既有的 setup helper 名稱與 import 清單需要先讀取 `server/test/game/effectResolver.test.js` 檔案開頭確認（不同測試檔案的 helper 命名可能不同於 `turnFlow.test.js`），照既有慣例調整上面範例中的 `makeGameStateWithPlayer()` 呼叫方式。

- [ ] **Step 4: 執行測試確認失敗，然後確認通過**

Run: `npx jest server/test/game/effectResolver.test.js -t "grant_item effect reports"`
Expected: 先 FAIL（`drawnCards` 是 `undefined`），套用 Step 2 的改動後 PASS。

- [ ] **Step 5: Commit Steps 1-4**

```bash
git add server/src/game/effectResolverManager.js server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat: add pendingInventoryChoice slot and grant_item drawnCards tracking"
```

- [ ] **Step 6: 寫 `openInventoryChoiceIfNeeded` 觸發情境的失敗測試**

在 `server/test/socketHandlers.test.js` 檔案適當位置（`pendingChoice`／`pendingRollChoice` 相關測試群組附近）加入。先看檔案開頭第 13-30 行的 `makeContent` 預設 `might` track 是 `[1, 2, 3, 4, 5]`、`baseIndex: 2`，所以預設上限 `getStatValue(player,'might')` = `track[2]` = `3`。

```js
test('a grant_item effect that pushes the player over the item cap opens a pendingInventoryChoice and blocks game:endTurn', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        {
          id: 'item_104',
          name: '會送人道具的卡',
          effects: [{ type: 'grant_item', itemId: 'item_999' }],
        },
        { id: 'item_999', name: '第四件道具' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' }, { id: 'item_104' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  const ack = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104' }, resolve)
  );
  expect(ack.error).toBeUndefined();
  const pending = await pendingPromise;
  expect(pending.playerId).toBe(currentPlayerId);
  expect(pending.itemIds.sort()).toEqual(['item_101', 'item_102', 'item_103', 'item_999'].sort());

  const entry = getResolver(effectResolverManager, roomCode);
  expect(entry.pendingInventoryChoice).not.toBeNull();
  expect(entry.pendingInventoryChoice.triggeredByItemId).toBe('item_999');

  const blocked = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(blocked.error).toBe('INVENTORY_CHOICE_IN_PROGRESS');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('holding exactly the cap does not open a pendingInventoryChoice', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        {
          id: 'item_104',
          name: '會送人道具的卡',
          effects: [{ type: 'grant_item', itemId: 'item_999' }],
        },
        { id: 'item_999', name: '第三件道具' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_104' });

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const ack = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104' }, resolve)
  );
  expect(ack.error).toBeUndefined();
  await resolvedPromise;

  const entry = getResolver(effectResolverManager, roomCode);
  expect(entry.pendingInventoryChoice).toBeNull(); // 剛好等於上限（might=3），不觸發

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 7: 執行測試確認失敗**

Run: `npx jest server/test/socketHandlers.test.js -t "pushes the player over the item cap"`
Expected: FAIL（目前沒有 `game:inventoryChoicePending` 事件，`pending` 這個 Promise 會一直不 resolve 而逾時；或 `entry.pendingInventoryChoice` 是 `undefined`）

- [ ] **Step 8: 實作 `openInventoryChoiceIfNeeded`／`handleInventoryChoiceTimeout`／`hasPendingInventoryChoice`**

`server/src/socketHandlers.js` 第 23 行的 import 改成：

```js
const { addItem, removeItem, getStatValue, countHeldItems } = require('./game/playerEntity');
```

在 `hasPendingRollChoice` 函式之後（現在的第 582-585 行之後）加入：

```js
function hasPendingInventoryChoice(effectResolverManager, roomCode) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  return Boolean(resolverEntry && resolverEntry.pendingInventoryChoice);
}

function pickInventoryChoiceDefault(heldItemIds, newlyAcquiredItemIds) {
  for (let i = newlyAcquiredItemIds.length - 1; i >= 0; i -= 1) {
    if (heldItemIds.includes(newlyAcquiredItemIds[i])) {
      return newlyAcquiredItemIds[i];
    }
  }
  return heldItemIds[0];
}

function openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, playerId, cardContent, newlyAcquiredItemIds, inventoryChoiceTimeoutMs) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const player = getPlayer(gameState, playerId);
  const cap = getStatValue(player, 'might');
  const heldItemIds = player.inventory
    .filter((item) => cardContent.items.some((i) => i.id === item.id))
    .map((item) => item.id);
  if (heldItemIds.length <= cap) {
    return;
  }
  const triggeredByItemId = pickInventoryChoiceDefault(heldItemIds, newlyAcquiredItemIds);
  const prompt = createPrompt(resolverEntry.promptState, {
    type: 'inventory_choice',
    targetPlayerId: playerId,
    description: '選擇要遺留哪一件道具',
    options: heldItemIds,
    timeoutMs: inventoryChoiceTimeoutMs,
    now: Date.now(),
  });
  resolverEntry.pendingInventoryChoice = {
    playerId,
    itemIds: heldItemIds,
    newlyAcquiredItemIds,
    triggeredByItemId,
    deadline: prompt.deadline,
  };
  io.to(roomCode).emit('game:inventoryChoicePending', { playerId, promptId: prompt.promptId, itemIds: heldItemIds });
  const handle = setTimeout(() => {
    handleInventoryChoiceTimeout(io, effectResolverManager, gameState, roomCode, prompt.promptId, cardContent, inventoryChoiceTimeoutMs);
  }, Math.max(prompt.deadline - Date.now(), 0));
  resolverEntry.inventoryChoiceTimeoutHandle = handle;
}

function applyInventoryLeave(gameState, playerId, itemId) {
  const player = getPlayer(gameState, playerId);
  const item = removeItem(player, itemId);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push(item);
}

function handleInventoryChoiceTimeout(io, effectResolverManager, gameState, roomCode, promptId, cardContent, inventoryChoiceTimeoutMs) {
  try {
    const resolverEntry = getResolver(effectResolverManager, roomCode);
    if (!resolverEntry || !resolverEntry.pendingInventoryChoice) return;
    resolverEntry.inventoryChoiceTimeoutHandle = null;
    const { playerId, triggeredByItemId, newlyAcquiredItemIds } = resolverEntry.pendingInventoryChoice;
    const result = resolvePromptTimeout(resolverEntry.promptState, { promptId, defaultOptionId: triggeredByItemId });
    if (!result) return;
    resolverEntry.pendingInventoryChoice = null;
    applyInventoryLeave(gameState, playerId, result.chosenOptionId);
    io.to(roomCode).emit('game:promptResolved', result);
    openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, playerId, cardContent, newlyAcquiredItemIds, inventoryChoiceTimeoutMs);
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('inventory choice timeout error', err);
  }
}
```

- [ ] **Step 9: 在 `registerSocketHandlers` 開頭加上 `inventoryChoiceTimeoutMs` 選項**

`server/src/socketHandlers.js` 第 35 行 `const rollChoiceTimeoutMs = options.rollChoiceTimeoutMs || 20000;` 之後加一行：

```js
const inventoryChoiceTimeoutMs = options.inventoryChoiceTimeoutMs || 20000;
```

- [ ] **Step 10: 在 `handleEffectResolveResult` 尾端串接檢查**

`server/src/socketHandlers.js` 現在第 907 行 `io.to(roomCode).emit('game:effectResolved', { playerId, sourceId });` 之後、第 908 行 `const outcome = { pending: false };` 之前加入：

```js
  io.to(roomCode).emit('game:effectResolved', { playerId, sourceId });
  if (content) {
    const newlyAcquiredItemIds = Array.isArray(effectResult.drawnCards) ? effectResult.drawnCards.map((c) => c.id) : [];
    openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, playerId, content.cards, newlyAcquiredItemIds, inventoryChoiceTimeoutMs);
  }
  const outcome = { pending: false };
```

`handleEffectResolveResult` 的函式簽名（第 848 行）不需要改變參數——`content`／`playerId` 已經是既有參數；`inventoryChoiceTimeoutMs` 是這個檔案頂層的變數，`handleEffectResolveResult` 是同一個 `registerSocketHandlers` 閉包內的函式，可以直接存取，不需要額外傳參數（比照 `rollChoiceTimeoutMs` 目前的用法——它其實是明確當參數傳遞的；為了不改動 `handleEffectResolveResult` 既有的 6 個呼叫點簽名，這裡選擇讓 `inventoryChoiceTimeoutMs` 保持閉包變數，不新增成第 7 個顯式參數）。

- [ ] **Step 11: 在 4 個既有守衛點加上第三個檢查**

在 `server/src/socketHandlers.js` 裡，以下 4 個位置，緊接在既有的
```js
if (hasPendingRollChoice(effectResolverManager, roomCode)) {
  return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
}
```
之後，各自加入：
```js
if (hasPendingInventoryChoice(effectResolverManager, roomCode)) {
  return ack({ error: 'INVENTORY_CHOICE_IN_PROGRESS' });
}
```

四個位置：
1. `game:move` handler（目前第 164-166 行之後）
2. `game:selectAction` handler（目前第 215-217 行之後）
3. `game:useStairs` handler（目前第 366-368 行之後）
4. `game:endTurn` handler（目前第 392-394 行之後）

- [ ] **Step 12: 執行測試確認通過**

Run: `npx jest server/test/socketHandlers.test.js -t "item cap"`
Expected: PASS（Step 6 的兩個測試都通過）

Run: `npx jest server/test/socketHandlers.test.js`
Expected: PASS（全部既有測試沒有回歸——尤其確認既有的 `pendingChoice`／`pendingRollChoice` 系列測試不受影響，因為新檢查只在 `content` 存在且道具數超過上限時才會建立 prompt）

- [ ] **Step 13: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: open pendingInventoryChoice when an effect-resolution path exceeds the item cap"
```

---

### Task 3: 串接「撿取／給予／搜索」三條非 `resolveEffects` 路徑，新增 `game:inventoryChoiceRespond`

**Files:**
- Modify: `server/src/socketHandlers.js`（`game:selectAction` handler 內的 search 分支與泛用 fallthrough 分支；新增 `game:inventoryChoiceRespond` handler）
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 2 的 `openInventoryChoiceIfNeeded`／`applyInventoryLeave`／`hasPendingInventoryChoice`。
- Produces: 完整可用的 `game:inventoryChoiceRespond` socket 事件（payload: `{ promptId, optionId }`，回應「要遺留哪一件道具」，`optionId` 是道具 id）。

- [ ] **Step 1: 寫「撿取道具超過上限」的失敗測試**

在 `server/test/socketHandlers.test.js` 加入（沿用 Task 2 Step 6 的 `makeContent` 寫法）：

```js
test('picking up a dropped item that pushes the player over the cap opens a pendingInventoryChoice', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        { id: 'item_104', name: '道具四' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' });
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push({ id: 'item_104' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  const ack = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104', mode: 'pickup' }, resolve)
  );
  expect(ack.error).toBeUndefined();
  const pending = await pendingPromise;
  expect(pending.playerId).toBe(currentPlayerId);

  const entry = getResolver(effectResolverManager, roomCode);
  expect(entry.pendingInventoryChoice.triggeredByItemId).toBe('item_104');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx jest server/test/socketHandlers.test.js -t "picking up a dropped item that pushes"`
Expected: FAIL（`pending` Promise 逾時，因為目前 `pickup` 分支沒有呼叫 `openInventoryChoiceIfNeeded`）

- [ ] **Step 3: 在 `game:selectAction` 的泛用 fallthrough 加上 give/pickup 的檢查**

`server/src/socketHandlers.js` 目前第 322-323 行：

```js
        const result = selectAction(gameState, playerId, actionType, selectOptions);
        ack(result);
```

改成：

```js
        const result = selectAction(gameState, playerId, actionType, selectOptions);
        ack(result);

        if (result.kind === 'item' && result.mode === 'give') {
          openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, result.targetPlayerId, content.cards, [result.itemId], inventoryChoiceTimeoutMs);
          io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
        } else if (result.kind === 'item' && result.mode === 'pickup') {
          openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, playerId, content.cards, [result.itemId], inventoryChoiceTimeoutMs);
          io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
        }
```

（這裡額外補一次 `game:stateUpdate` 廣播，是因為 `openInventoryChoiceIfNeeded` 可能會修改 `resolverEntry`，但不會修改 `gameState` 本身——真正需要廣播的是 `game:inventoryChoicePending` 事件本身已經帶有必要資訊；補這行是為了讓所有 client 的畫面也同步看到「道具已進背包」這件事，比照這個函式往下第 341-343 行既有的 `else if (result.pending)` 分支旁邊也會有一次 `io.to(roomCode).emit('game:stateUpdate', ...)` 的既有寫法一致。若 give/pickup 沒有觸發 `pendingInventoryChoice`，這次 `game:stateUpdate` 廣播仍然正確且必要——因為 give/pickup 修改了 `player.inventory`／`room.droppedItems`，這兩個動作原本就沒有專屬的 `game:stateUpdate` 廣播，是這次改動附帶補上的。)

- [ ] **Step 4: 在搜索分支加上檢查**

`server/src/socketHandlers.js` 目前第 310-317 行：

```js
            const result = selectAction(gameState, playerId, actionType, selectOptions);
            ack(result);
            currentPlayer.searchedThisTurn = true;
            const searchOutcome = performSearch(gameState, placedRoom);
            if (searchOutcome.found) {
              addItem(currentPlayer, { id: searchOutcome.card.id });
              io.to(roomCode).emit('game:cardDrawn', { playerId, deckType: 'item', cardId: searchOutcome.card.id, cardName: searchOutcome.card.name, hasCheck: false });
            } else {
              io.to(roomCode).emit('game:searchEmpty', { playerId, roomId: placedRoom.roomId });
            }
            io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
            return;
```

改成：

```js
            const result = selectAction(gameState, playerId, actionType, selectOptions);
            ack(result);
            currentPlayer.searchedThisTurn = true;
            const searchOutcome = performSearch(gameState, placedRoom);
            if (searchOutcome.found) {
              addItem(currentPlayer, { id: searchOutcome.card.id });
              io.to(roomCode).emit('game:cardDrawn', { playerId, deckType: 'item', cardId: searchOutcome.card.id, cardName: searchOutcome.card.name, hasCheck: false });
              openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, playerId, content.cards, [searchOutcome.card.id], inventoryChoiceTimeoutMs);
            } else {
              io.to(roomCode).emit('game:searchEmpty', { playerId, roomId: placedRoom.roomId });
            }
            io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
            return;
```

- [ ] **Step 5: 執行測試確認通過**

Run: `npx jest server/test/socketHandlers.test.js -t "picking up a dropped item that pushes"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: check the item cap after pickup/give/search"
```

- [ ] **Step 7: 寫 `game:inventoryChoiceRespond` 的失敗測試（含連續兩輪的情境）**

```js
test('game:inventoryChoiceRespond leaves the chosen item in the room and clears the pending state', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        { id: 'item_104', name: '道具四' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' });
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push({ id: 'item_104' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104', mode: 'pickup' }, resolve)
  );
  const pending = await pendingPromise;

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  const respondAck = await new Promise((resolve) =>
    currentClient.emit('game:inventoryChoiceRespond', { promptId: pending.promptId, optionId: 'item_101' }, resolve)
  );
  expect(respondAck.error).toBeUndefined();
  await resolvedPromise;

  expect(player.inventory.map((i) => i.id).sort()).toEqual(['item_102', 'item_103', 'item_104'].sort());
  expect(room.droppedItems).toEqual([{ id: 'item_101' }]);
  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice).toBeNull();

  // 已經解決，接下來的動作不應該再被擋
  const endTurnAck = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endTurnAck.error).toBeUndefined();

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:inventoryChoiceRespond opens a second round when still over the cap after leaving one item', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        {
          id: 'item_201',
          name: '一次抽兩張的卡',
          effects: [{ type: 'draw_card', deck: 'item', count: 2 }],
        },
        { id: 'item_301', name: '被抽到的道具A' },
        { id: 'item_302', name: '被抽到的道具B' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' }, { id: 'item_201' });
  gameState.itemDeck.cards = [{ id: 'item_301', name: '被抽到的道具A' }, { id: 'item_302', name: '被抽到的道具B' }];

  const firstPendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_201' }, resolve)
  );
  const firstPending = await firstPendingPromise;
  // might 上限 3、目前持有 5 件（101/102/103/301/302）-> 觸發，逾時預設會是 item_302（最後抽到的）
  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice.triggeredByItemId).toBe('item_302');

  const secondPendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:inventoryChoiceRespond', { promptId: firstPending.promptId, optionId: 'item_101' }, resolve)
  );
  const secondPending = await secondPendingPromise;
  // 還是超過上限(4件) -> 開第二輪，這次逾時預設沿用 newlyAcquiredItemIds 找仍持有的最後一件 -> 還是 item_302（還沒被選走）
  expect(secondPending.itemIds.sort()).toEqual(['item_102', 'item_103', 'item_301', 'item_302'].sort());
  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice.triggeredByItemId).toBe('item_302');

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:inventoryChoiceRespond', { promptId: secondPending.promptId, optionId: 'item_302' }, resolve)
  );
  await resolvedPromise;

  expect(player.inventory.map((i) => i.id).sort()).toEqual(['item_102', 'item_103', 'item_301'].sort());
  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice).toBeNull();

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 8: 執行測試確認失敗**

Run: `npx jest server/test/socketHandlers.test.js -t "game:inventoryChoiceRespond"`
Expected: FAIL（`game:inventoryChoiceRespond` 事件目前沒有 handler，`callback` 永遠不會被呼叫，測試逾時）

- [ ] **Step 9: 實作 `game:inventoryChoiceRespond` handler**

在 `server/src/socketHandlers.js` 的 `game:diceChoiceRespond` handler 結尾（目前第 499 行 `});` 之後）加入：

```js
    socket.on('game:inventoryChoiceRespond', (payload, callback) => {
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
        const resolverEntry = getResolver(effectResolverManager, roomCode);
        if (!resolverEntry || !resolverEntry.pendingInventoryChoice) {
          return ack({ error: 'NO_ACTIVE_INVENTORY_CHOICE' });
        }
        const { promptId, optionId } = payload || {};
        const { playerId: choicePlayerId, newlyAcquiredItemIds } = resolverEntry.pendingInventoryChoice;
        const result = respondToPrompt(resolverEntry.promptState, { promptId, playerId, optionId });
        if (resolverEntry.inventoryChoiceTimeoutHandle) {
          clearTimeout(resolverEntry.inventoryChoiceTimeoutHandle);
          resolverEntry.inventoryChoiceTimeoutHandle = null;
        }
        resolverEntry.pendingInventoryChoice = null;
        applyInventoryLeave(gameState, choicePlayerId, result.chosenOptionId);
        io.to(roomCode).emit('game:promptResolved', result);
        openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, choicePlayerId, content.cards, newlyAcquiredItemIds, inventoryChoiceTimeoutMs);
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
        ack({});
      } catch (err) {
        console.error('game:inventoryChoiceRespond error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });
```

- [ ] **Step 10: 執行測試確認通過**

Run: `npx jest server/test/socketHandlers.test.js -t "game:inventoryChoiceRespond"`
Expected: PASS（兩個測試都通過）

Run: `npx jest server/test/socketHandlers.test.js`
Expected: PASS（全部既有測試沒有回歸）

- [ ] **Step 11: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: add game:inventoryChoiceRespond handler with multi-round overflow support"
```

- [ ] **Step 12: 補一個逾時測試**

```js
test('a timed-out inventory choice auto-leaves the triggering item and does not affect the player\'s other items', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_101', name: '道具一' },
        { id: 'item_102', name: '道具二' },
        { id: 'item_103', name: '道具三' },
        { id: 'item_104', name: '道具四' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content, { inventoryChoiceTimeoutMs: 50 });
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' });
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push({ id: 'item_104' });

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104', mode: 'pickup' }, resolve)
  );
  const resolved = await resolvedPromise;
  expect(resolved.wasTimeout).toBe(true);
  expect(resolved.chosenOptionId).toBe('item_104');

  expect(player.inventory.map((i) => i.id).sort()).toEqual(['item_101', 'item_102', 'item_103'].sort());
  expect(room.droppedItems).toEqual([{ id: 'item_104' }]);
  expect(getResolver(effectResolverManager, roomCode).pendingInventoryChoice).toBeNull();

  clientA.close();
  clientB.close();
  httpServer.close();
}, 5000);
```

**注意**：`setUpStartedGameWithContent(content, options)` 的第二個參數需要確認該 helper 是否已支援轉發 `options` 給 `startTestServer`（檔案第 1756-1757 行已經是 `async function setUpStartedGameWithContent(content, options)` 並轉呼叫 `startTestServer(content, options)`，所以直接可用，不需要額外修改 helper）。比照本檔案既有的 `game:diceChoiceRespond` 逾時測試風格，加上 `5000` 毫秒的 test-level timeout（第二個參數），避免這類真的會等待計時器的測試拖慢整體 suite 或意外掛住。

- [ ] **Step 13: 執行測試確認通過**

Run: `npx jest server/test/socketHandlers.test.js -t "auto-leaves the triggering item"`
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add server/test/socketHandlers.test.js
git commit -m "test: cover inventory choice timeout auto-leave"
```

---

### Task 4: 前端「選擇遺留道具」彈窗（`DebugGameScreen.jsx`）

**Files:**
- Modify: `client/src/DebugGameScreen.jsx`

**Interfaces:**
- Consumes: 新 socket 事件 `game:inventoryChoicePending`（payload: `{ playerId, promptId, itemIds }`）、`game:promptResolved`（既有事件，遺留動作完成或逾時都會收到）；既有的 `findCardName(id, cardContent)` 函式（檔案第 72 行）。
- Produces: 新 socket 事件送出 `game:inventoryChoiceRespond`（payload: `{ promptId, optionId }`）。

- [ ] **Step 1: 加入 state 與事件監聽**

`client/src/DebugGameScreen.jsx` 第 84 行 `const [pendingRollChoice, setPendingRollChoice] = useState(null);` 之後加入：

```js
  const [pendingInventoryChoice, setPendingInventoryChoice] = useState(null);
```

第 98-103 行的 `onPromptResolved` 函式：

```js
    function onPromptResolved(data) {
      setLastPromptResolved(data);
      setMessages((prev) => [...prev, `提問結果：${JSON.stringify(data)}`]);
      setPrompt(null);
      setPendingRollChoice(null);
    }
```

改成（讓遺留選擇解決後，彈窗也會關閉——收到 `game:inventoryChoicePending` 才會重新開下一輪）：

```js
    function onPromptResolved(data) {
      setLastPromptResolved(data);
      setMessages((prev) => [...prev, `提問結果：${JSON.stringify(data)}`]);
      setPrompt(null);
      setPendingRollChoice(null);
      setPendingInventoryChoice(null);
    }
```

第 160-162 行 `onDiceChoicePending` 之後加入：

```js
    function onInventoryChoicePending(data) {
      setPendingInventoryChoice(data);
    }
```

第 173 行 `socket.on('game:diceChoicePending', onDiceChoicePending);` 之後加入：

```js
    socket.on('game:inventoryChoicePending', onInventoryChoicePending);
```

第 188 行 `socket.off('game:diceChoicePending', onDiceChoicePending);` 之後加入：

```js
    socket.off('game:inventoryChoicePending', onInventoryChoicePending);
```

- [ ] **Step 2: 加入送出回應的 handler**

第 250-258 行 `handleRollChoiceRespond` 函式之後加入：

```js
  function handleInventoryChoiceRespond(itemId) {
    if (!pendingInventoryChoice) return;
    socket.emit('game:inventoryChoiceRespond', { promptId: pendingInventoryChoice.promptId, optionId: itemId }, (res) => {
      if (res && res.error) {
        console.error('[game:inventoryChoiceRespond]', res.error);
        setActionError(res.error);
      }
    });
  }
```

- [ ] **Step 3: 加入彈窗 JSX**

第 427 行的 `{(pendingEffectChoice || pendingRollChoice) && (` 改成：

```jsx
          {(pendingEffectChoice || pendingRollChoice || pendingInventoryChoice) && (
```

在同一個彈窗容器內，`pendingRollChoice` 那個區塊（第 456-484 行）結束的 `)}` 之後、外層容器結束的 `</div>` （第 485 行）之前，加入：

```jsx
              {pendingInventoryChoice && (
                <div>
                  <p>攜帶的道具已經超過上限（力量值），請選擇要遺留哪一件：</p>
                  <ul>
                    {pendingInventoryChoice.itemIds.map((itemId) => (
                      <li key={itemId}>
                        {findCardName(itemId, cardContent)}
                        <button onClick={() => handleInventoryChoiceRespond(itemId)}>遺留這件</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
```

- [ ] **Step 4: 手動驗證（前端無自動化測試框架，比照本專案既有慣例用瀏覽器手動操作驗證）**

啟動開發伺服器（先確認沒有殘留的舊 server 在跑，若有請先關閉再啟動，比照 CLAUDE.md 的 debug 流程規則）：

```bash
npm --prefix server start
```

另開一個 terminal：

```bash
npm --prefix client run dev
```

用瀏覽器開兩個分頁模擬兩名玩家，走一次「玩家力量值上限為 3、目前持有 3 件道具、再撿一件超過上限」的流程，確認：
1. 彈窗正確列出目前持有的道具名稱（不是 id）
2. 點選任一件送出後彈窗關閉，該道具消失於清單、出現在房間的掉落物
3. 在彈窗開啟期間嘗試「移動」／「結束回合」會被擋下（`actionError` 顯示 `INVENTORY_CHOICE_IN_PROGRESS`）
4. 完成後測試結束，關閉本次啟動的 server／dev server

- [ ] **Step 5: Commit**

```bash
git add client/src/DebugGameScreen.jsx
git commit -m "feat: add inventory-choice modal to DebugGameScreen"
```

---

## Self-Review 檢查結果

**Spec coverage：**
- 上限計算、只計道具卡不計預兆卡 → Task 1（`countHeldItems`）、Global Constraints。
- 3 條路徑統一經過 `addItem()` → Task 1（give/pickup）+ 既有的 `addItem` 呼叫點本來就有 6 個（grant_item／draw_card／take_previewed_card／search／起始道具）不需要改，因為它們已經呼叫 `addItem()`。
- `pendingInventoryChoice` 新暫停狀態、逾時、四個守衛點 → Task 2。
- 串接每個取得道具的入口點（`resolveEffects` 路徑 + 撿取/給予/搜索） → Task 2 Step 10、Task 3。
- 一次取得多件依序詢問直到回到上限內 → Task 3（`openInventoryChoiceIfNeeded` 在 respond/timeout handler 內遞迴呼叫自己，Step 7 的第二個測試驗證）。
- 逾時自動遺留剛取得的那一件（含多輪的精確定義，已與開發者確認） → Task 2 Step 8（`pickInventoryChoiceDefault`）、Task 3 Step 12。
- 遺留不扣行動力 → Task 2/3 的 `applyInventoryLeave` 直接操作 inventory/droppedItems，不碰 `actionPoints`。
- 力量值下降不回溯檢查 → 沒有新增任何監聽力量值變動的程式碼，Global Constraints 已明列。
- 召喚物排除 → `selectSummonAction` 完全未改動。
- 前端彈窗 → Task 4。

**Placeholder scan：** 全文搜尋過，沒有 TBD／TODO／「之後補」等字樣；每個 code block 都是可直接套用的完整程式碼。

**Type/signature 一致性檢查：**
- `openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, playerId, cardContent, newlyAcquiredItemIds, inventoryChoiceTimeoutMs)` 在 Task 2 定義，Task 2 Step 10、Task 3 Step 3/4/9 的所有呼叫點參數順序與數量一致。
- `applyInventoryLeave(gameState, playerId, itemId)` 在 Task 2 定義，Task 3 Step 9 的呼叫一致。
- `hasPendingInventoryChoice(effectResolverManager, roomCode)` 在 Task 2 定義，Task 2 Step 11 的四個守衛點呼叫一致。
- `resolverEntry.pendingInventoryChoice` 的欄位名稱（`playerId`／`itemIds`／`newlyAcquiredItemIds`／`triggeredByItemId`／`deadline`）在 Task 2 Step 1（初始化為 `null`）、Step 8（設定）、Task 3 Step 9（讀取 `newlyAcquiredItemIds`）全部一致。
- `resolverEntry.inventoryChoiceTimeoutHandle` 命名在 Task 2 Step 1（初始化）、Step 8（設定/讀取）、Task 3 Step 9（清除）全部一致。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-21-item-carry-limit.md`. Two execution options:

1. **Subagent-Driven (recommended)** - 每個 Task 交給獨立 subagent 執行，Task 之間互相 review，快速迭代
2. **Inline Execution** - 在目前這個 session 用 executing-plans 批次執行，checkpoint 時我會跟你確認

要用哪一種方式？
