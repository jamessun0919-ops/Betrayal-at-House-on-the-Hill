# 道具手持/配戴機制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `weapon` 類道具可以「手持」、`gear` 類道具可以「配戴」，成為跨回合持續生效的裝備狀態，並讓道具選單依 `category` 動態決定顯示哪些選項，取代現在寫死的邏輯。

**Architecture:** 在 `player` 物件新增 `wieldedWeaponId`（單一武器）與 `wornGearIds`（多件裝備陣列）兩個欄位；`turnFlow.js` 的 `selectAction` 新增 `wield`/`unwield`/`wear`/`unwear` 四種道具動作模式，比照既有 `give`/`leave`/`pickup` 模式的寫法；既有的「道具離開背包」三個入口（給予／遺留／物品攜帶上限強制遺留）統一呼叫一個新的 `clearEquipStateIfNeeded` 清理裝備狀態；`diceInterjection.js` 的持有判斷對 `gear` 類道具改成要求配戴中；前端 `CharacterPanel.jsx` 的道具選單改成依 `category` 查表決定顯示選項。

**Tech Stack:** Node.js / Express / Socket.IO 後端（`server/src/game/*.js`、`server/src/socketHandlers.js`），React 前端（`client/src/gameplay/CharacterPanel.jsx`），Jest 測試。

**Design doc:** `docs/superpowers/specs/2026-08-23-item-equip-mechanism-design.md`（已核准）。

## Global Constraints

- `wieldedWeaponId: string | null`——最多手持一件 `weapon` 類道具，初始 `null`。已手持另一件時再手持，自動換持（不需要玩家先手動取下）。
- `wornGearIds: string[]`——可配戴任意數量 `gear` 類道具，無上限，初始 `[]`。
- `wield`/`unwield`/`wear`/`unwear` 皆各扣 1 行動力，跟現有的 `give`/`leave`(自願)/`pickup` 一致。
- `wield`/`wear` 只能對背包裡對應 `category` 的道具操作（`wield` 只認 `weapon`，`wear` 只認 `gear`），類別不符要拋 `INVALID_ITEM_CATEGORY`。
- `unwield`/`unwear` 只能對「目前真的處於手持/配戴中」的那一件操作，否則拋 `ITEM_NOT_WIELDED`/`ITEM_NOT_WORN`。
- 道具離開玩家背包（給予／遺留／物品攜帶上限強制遺留）時，若該道具正手持/配戴中，要同步清除裝備狀態。
- `item_010`（油燈）現有的擲骰介入效果（`diceInterjection`），`category:"gear"` 的道具改成必須配戴中才觸發；其他類別維持「持有即可用」不變。
- 角色開場的初始道具（`characters.json` 的 `itemID`）若是 `weapon`/`gear`，遊戲開始時自動手持/配戴。
- 攻擊機制本身（`actionType:'attack'` 的實際邏輯、傷害計算）不在這個計畫範圍內；`item_008`/`item_024`/`item_031`/`item_037` 這幾張 gear 卡自己的被動效果也不在範圍內。

---

### Task 1: 裝備狀態資料模型 + 道具離開背包時的清理邏輯

**Files:**
- Modify: `server/src/game/playerEntity.js`
- Modify: `server/src/game/turnFlow.js:424-453`（`giveItemAction`／`leaveItemAction`）
- Modify: `server/src/socketHandlers.js:688-693`（`applyInventoryLeave`）
- Test: `server/test/game/playerEntity.test.js`
- Test: `server/test/game/turnFlow.test.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Produces: `player.wieldedWeaponId`（`string | null`）、`player.wornGearIds`（`string[]`）——`createPlayer` 回傳的 player 物件新欄位，之後所有 task 都會讀寫。`clearEquipStateIfNeeded(player, itemId)`，從 `server/src/game/playerEntity.js` 匯出，Task 2 的 socketHandlers.js 不需要用到它（`applyInventoryLeave` 已在本 task 內處理），但保留匯出供未來其他「道具離開背包」路徑使用。
- Consumes: 無新依賴。

- [ ] **Step 1: 寫 `createPlayer` 新欄位的失敗測試**

在 `server/test/game/playerEntity.test.js` 檔案的 `createPlayer builds a player with the given stat tracks, position, and action points` 測試之後加入：

```js
test('createPlayer initializes empty equip state (wieldedWeaponId null, wornGearIds empty)', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(player.wieldedWeaponId).toBeNull();
  expect(player.wornGearIds).toEqual([]);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx jest server/test/game/playerEntity.test.js -t "initializes empty equip state"`
Expected: FAIL（`player.wieldedWeaponId` 是 `undefined`，不是 `null`）

- [ ] **Step 3: 在 `createPlayer` 加入新欄位**

`server/src/game/playerEntity.js` 第 42-54 行的 `return` 物件字面量，在 `enteredFromSide: null,` 之後加入：

```js
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
    visitedRooms: [{ floor, x, y }],
    enteredFromSide: null, // null = arrived by spawn/stairs (badge centered), else the door side entered through
    wieldedWeaponId: null, // id of the currently wielded weapon-category item, at most one
    wornGearIds: [], // ids of currently worn gear-category items, no cap
  };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx jest server/test/game/playerEntity.test.js`
Expected: PASS（全部測試，包含新增的 1 個）

- [ ] **Step 5: 寫 `clearEquipStateIfNeeded` 的失敗測試**

在 `server/test/game/playerEntity.test.js` 檔案最後加入（`removeItem` 相關測試之後），並把檔案最上方的 import 改成加入 `clearEquipStateIfNeeded`：

```js
const { STATS, createPlayer, changeStat, resetActionPoints, movePlayerTo, getStatValue, isBelowBase, addItem, removeItem, clearEquipStateIfNeeded } = require('../../src/game/playerEntity');
```

```js
test('clearEquipStateIfNeeded clears wieldedWeaponId when it matches the given itemId', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  player.wieldedWeaponId = 'item_001';
  clearEquipStateIfNeeded(player, 'item_001');
  expect(player.wieldedWeaponId).toBeNull();
});

test('clearEquipStateIfNeeded leaves wieldedWeaponId untouched when it does not match', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  player.wieldedWeaponId = 'item_001';
  clearEquipStateIfNeeded(player, 'item_002');
  expect(player.wieldedWeaponId).toBe('item_001');
});

test('clearEquipStateIfNeeded removes the itemId from wornGearIds if present', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  player.wornGearIds = ['item_008', 'item_010'];
  clearEquipStateIfNeeded(player, 'item_008');
  expect(player.wornGearIds).toEqual(['item_010']);
});

test('clearEquipStateIfNeeded is a no-op when the itemId is neither wielded nor worn', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  player.wieldedWeaponId = 'item_001';
  player.wornGearIds = ['item_008'];
  clearEquipStateIfNeeded(player, 'item_099');
  expect(player.wieldedWeaponId).toBe('item_001');
  expect(player.wornGearIds).toEqual(['item_008']);
});
```

- [ ] **Step 6: 執行測試確認失敗**

Run: `npx jest server/test/game/playerEntity.test.js -t "clearEquipStateIfNeeded"`
Expected: FAIL（`clearEquipStateIfNeeded is not a function`）

- [ ] **Step 7: 實作 `clearEquipStateIfNeeded`**

在 `server/src/game/playerEntity.js` 的 `removeItem` 函式之後加入：

```js
function clearEquipStateIfNeeded(player, itemId) {
  if (player.wieldedWeaponId === itemId) {
    player.wieldedWeaponId = null;
  }
  const index = player.wornGearIds.indexOf(itemId);
  if (index !== -1) {
    player.wornGearIds.splice(index, 1);
  }
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
  clearEquipStateIfNeeded,
};
```

- [ ] **Step 8: 執行測試確認通過**

Run: `npx jest server/test/game/playerEntity.test.js`
Expected: PASS（全部測試）

- [ ] **Step 9: Commit**

```bash
git add server/src/game/playerEntity.js server/test/game/playerEntity.test.js
git commit -m "feat: add equip state fields and clearEquipStateIfNeeded to playerEntity"
```

- [ ] **Step 10: 寫 `giveItemAction`／`leaveItemAction` 清除裝備狀態的失敗測試**

在 `server/test/game/turnFlow.test.js` 檔案裡，找到 `selectAction item mode:give transfers the item to a same-room target player` 這個既有測試（用 `grep -n "mode:give transfers"` 找到確切位置），在它之後加入：

```js
test('selectAction item mode:give clears the giver\'s wieldedWeaponId when giving away the wielded weapon', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_001' });
  player.wieldedWeaponId = 'item_001';
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  other.floor = player.floor;
  other.x = player.x;
  other.y = player.y;
  selectAction(gameState, 'p1', 'item', { itemId: 'item_001', mode: 'give', targetPlayerId: 'p2' });
  expect(player.wieldedWeaponId).toBeNull();
});

test('selectAction item mode:give clears the giver\'s wornGearIds when giving away a worn gear item', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_008' });
  player.wornGearIds = ['item_008'];
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  other.floor = player.floor;
  other.x = player.x;
  other.y = player.y;
  selectAction(gameState, 'p1', 'item', { itemId: 'item_008', mode: 'give', targetPlayerId: 'p2' });
  expect(player.wornGearIds).toEqual([]);
});
```

在 `selectAction item mode:leave removes the item from inventory and adds it to the current room's droppedItems` 這個既有測試之後加入：

```js
test('selectAction item mode:leave clears the player\'s wieldedWeaponId when leaving the wielded weapon', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_001' });
  player.wieldedWeaponId = 'item_001';
  selectAction(gameState, 'p1', 'item', { itemId: 'item_001', mode: 'leave' });
  expect(player.wieldedWeaponId).toBeNull();
});

test('selectAction item mode:leave clears the player\'s wornGearIds when leaving a worn gear item', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_008' });
  player.wornGearIds = ['item_008'];
  selectAction(gameState, 'p1', 'item', { itemId: 'item_008', mode: 'leave' });
  expect(player.wornGearIds).toEqual([]);
});
```

- [ ] **Step 11: 執行測試確認失敗**

Run: `npx jest server/test/game/turnFlow.test.js -t "clears the giver's wieldedWeaponId"`
Expected: FAIL（`player.wieldedWeaponId` 仍是 `'item_001'`，因為 `giveItemAction`／`leaveItemAction` 還沒呼叫 `clearEquipStateIfNeeded`）

- [ ] **Step 12: 在 `giveItemAction`／`leaveItemAction` 呼叫 `clearEquipStateIfNeeded`**

`server/src/game/turnFlow.js` 第 5 行的 import 改成：

```js
const { movePlayerTo, resetActionPoints, getStatValue, changeStat, addItem, clearEquipStateIfNeeded } = require('./playerEntity');
```

`giveItemAction`（第 424-441 行）在 `player.inventory.splice` 之後、`addItem(targetPlayer, item)` 之前加入清理呼叫：

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
  clearEquipStateIfNeeded(player, itemId);
  addItem(targetPlayer, item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'give', itemId, targetPlayerId };
}
```

`leaveItemAction`（第 443-453 行）同樣在 splice 之後加入：

```js
function leaveItemAction(gameState, player, itemId) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_HELD');
  }
  const [item] = player.inventory.splice(index, 1);
  clearEquipStateIfNeeded(player, itemId);
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  room.droppedItems.push(item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'leave', itemId };
}
```

- [ ] **Step 13: 執行測試確認通過**

Run: `npx jest server/test/game/turnFlow.test.js`
Expected: PASS（全部測試）

- [ ] **Step 14: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat: clear equip state when giving away or leaving an equipped item"
```

- [ ] **Step 15: 寫 `applyInventoryLeave` 清除裝備狀態的失敗測試**

`applyInventoryLeave` 是物品攜帶上限機制的一部分，透過 socket 事件 `game:inventoryChoiceRespond` 觸發。在 `server/test/socketHandlers.test.js` 檔案裡找到 `game:inventoryChoiceRespond leaves the chosen item in the room and clears the pending state` 這個既有測試（用 `grep -n "leaves the chosen item in the room"` 找到確切位置），在它之後加入：

```js
test('game:inventoryChoiceRespond clears wieldedWeaponId when the forced-left item was wielded', async () => {
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
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }, { id: 'item_103' });
  player.wieldedWeaponId = 'item_101';
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push({ id: 'item_104' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_104', mode: 'pickup' }, resolve)
  );
  const pending = await pendingPromise;

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  await new Promise((resolve) =>
    currentClient.emit('game:inventoryChoiceRespond', { promptId: pending.promptId, optionId: 'item_101' }, resolve)
  );
  await resolvedPromise;

  expect(player.wieldedWeaponId).toBeNull();

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 16: 執行測試確認失敗**

Run: `npx jest server/test/socketHandlers.test.js -t "clears wieldedWeaponId when the forced-left item was wielded"`
Expected: FAIL（`player.wieldedWeaponId` 仍是 `'item_101'`）

- [ ] **Step 17: 在 `applyInventoryLeave` 呼叫 `clearEquipStateIfNeeded`**

`server/src/socketHandlers.js` 第 23 行的 import 改成加入 `clearEquipStateIfNeeded`：

```js
const { addItem, removeItem, getStatValue, clearEquipStateIfNeeded } = require('./game/playerEntity');
```

`applyInventoryLeave`（第 688-693 行）改成：

```js
function applyInventoryLeave(gameState, playerId, itemId) {
  const player = getPlayer(gameState, playerId);
  const item = removeItem(player, itemId);
  clearEquipStateIfNeeded(player, itemId);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push(item);
}
```

- [ ] **Step 18: 執行測試確認通過**

Run: `npx jest server/test/socketHandlers.test.js`
Expected: PASS（全部測試）

- [ ] **Step 19: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: clear equip state when an item is force-left via the inventory cap"
```

---

### Task 2: `wield`/`unwield`/`wear`/`unwear` 道具動作

**Files:**
- Modify: `server/src/game/turnFlow.js`（新增 4 個動作函式＋ `selectAction` 的 `mode` 分支）
- Modify: `server/src/socketHandlers.js`（`game:selectAction` handler 內解析 `itemCategory`）
- Test: `server/test/game/turnFlow.test.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 1 的 `player.wieldedWeaponId`／`player.wornGearIds` 欄位。
- Produces: `selectAction(gameState, playerId, 'item', { itemId, mode: 'wield'|'unwield'|'wear'|'unwear', itemCategory })` 支援 4 種新 `mode`；`itemCategory` 只有 `mode==='wield'` 或 `mode==='wear'` 時才需要提供（由呼叫端／socketHandlers.js 從卡片內容查出，`selectAction` 本身不做內容查表）。回傳值：`{ kind: 'item', mode, itemId }`。

- [ ] **Step 1: 寫 `wield` 的失敗測試**

在 `server/test/game/turnFlow.test.js` 檔案裡，找到 `selectAction item mode:pickup throws ITEM_NOT_IN_ROOM when the room has no such dropped item` 這個既有測試（`wield`/`unwield`/`wear`/`unwear` 是全新的 mode，加在這幾個既有 item mode 測試群組之後、`selectAction room_action` 測試群組之前），在它之後加入：

```js
test('selectAction item mode:wield sets wieldedWeaponId and spends 1 action point', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_001' });
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_001', mode: 'wield', itemCategory: 'weapon' });
  expect(result).toEqual({ kind: 'item', mode: 'wield', itemId: 'item_001' });
  expect(player.wieldedWeaponId).toBe('item_001');
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('selectAction item mode:wield swaps out the previously wielded weapon automatically', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_001' }, { id: 'item_011' });
  player.wieldedWeaponId = 'item_001';
  selectAction(gameState, 'p1', 'item', { itemId: 'item_011', mode: 'wield', itemCategory: 'weapon' });
  expect(player.wieldedWeaponId).toBe('item_011');
});

test('selectAction item mode:wield throws ITEM_NOT_HELD when the player does not hold the item', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_001', mode: 'wield', itemCategory: 'weapon' })
  ).toThrow('ITEM_NOT_HELD');
});

test('selectAction item mode:wield throws INVALID_ITEM_CATEGORY when the item is not a weapon', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_003' });
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'wield', itemCategory: 'consumable' })
  ).toThrow('INVALID_ITEM_CATEGORY');
});

test('selectAction item mode:unwield clears wieldedWeaponId and spends 1 action point', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_001' });
  player.wieldedWeaponId = 'item_001';
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_001', mode: 'unwield' });
  expect(result).toEqual({ kind: 'item', mode: 'unwield', itemId: 'item_001' });
  expect(player.wieldedWeaponId).toBeNull();
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('selectAction item mode:unwield throws ITEM_NOT_WIELDED when that item is not the wielded one', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_001' });
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_001', mode: 'unwield' })
  ).toThrow('ITEM_NOT_WIELDED');
});

test('selectAction item mode:wear adds to wornGearIds and spends 1 action point', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_008' });
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_008', mode: 'wear', itemCategory: 'gear' });
  expect(result).toEqual({ kind: 'item', mode: 'wear', itemId: 'item_008' });
  expect(player.wornGearIds).toEqual(['item_008']);
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('selectAction item mode:wear allows multiple gear items to be worn at once', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_008' }, { id: 'item_010' });
  selectAction(gameState, 'p1', 'item', { itemId: 'item_008', mode: 'wear', itemCategory: 'gear' });
  selectAction(gameState, 'p1', 'item', { itemId: 'item_010', mode: 'wear', itemCategory: 'gear' });
  expect(player.wornGearIds).toEqual(['item_008', 'item_010']);
});

test('selectAction item mode:wear throws INVALID_ITEM_CATEGORY when the item is not gear', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_001' });
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_001', mode: 'wear', itemCategory: 'weapon' })
  ).toThrow('INVALID_ITEM_CATEGORY');
});

test('selectAction item mode:unwear removes from wornGearIds and spends 1 action point', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_008' });
  player.wornGearIds = ['item_008'];
  const startingAP = player.actionPoints;
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_008', mode: 'unwear' });
  expect(result).toEqual({ kind: 'item', mode: 'unwear', itemId: 'item_008' });
  expect(player.wornGearIds).toEqual([]);
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('selectAction item mode:unwear throws ITEM_NOT_WORN when that item is not currently worn', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_008' });
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_008', mode: 'unwear' })
  ).toThrow('ITEM_NOT_WORN');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx jest server/test/game/turnFlow.test.js -t "mode:wield"`
Expected: FAIL（`selectAction` 目前不認得 `mode:'wield'`，會落到既有的「使用」分支，因為 `item_001` 沒被加進背包判斷會拋 `ITEM_NOT_HELD` 或其他不符預期的錯誤）

- [ ] **Step 3: 實作 4 個新動作函式，串進 `selectAction`**

`server/src/game/turnFlow.js` 在 `pickupItemAction`（第 455-465 行）之後加入：

```js
function wieldItemAction(gameState, player, itemId, itemCategory) {
  if (!player.inventory.some((item) => item.id === itemId)) {
    throw new Error('ITEM_NOT_HELD');
  }
  if (itemCategory !== 'weapon') {
    throw new Error('INVALID_ITEM_CATEGORY');
  }
  player.wieldedWeaponId = itemId;
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'wield', itemId };
}

function unwieldItemAction(gameState, player, itemId) {
  if (player.wieldedWeaponId !== itemId) {
    throw new Error('ITEM_NOT_WIELDED');
  }
  player.wieldedWeaponId = null;
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'unwield', itemId };
}

function wearItemAction(gameState, player, itemId, itemCategory) {
  if (!player.inventory.some((item) => item.id === itemId)) {
    throw new Error('ITEM_NOT_HELD');
  }
  if (itemCategory !== 'gear') {
    throw new Error('INVALID_ITEM_CATEGORY');
  }
  if (!player.wornGearIds.includes(itemId)) {
    player.wornGearIds.push(itemId);
  }
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'wear', itemId };
}

function unwearItemAction(gameState, player, itemId) {
  const index = player.wornGearIds.indexOf(itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_WORN');
  }
  player.wornGearIds.splice(index, 1);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'unwear', itemId };
}
```

`selectAction`（第 467 行起）的 `actionType === 'item'` 分支（第 479-489 行）目前是：

```js
  if (actionType === 'item') {
    const { itemId, targetPlayerId, mode } = options;
    if (mode === 'give') {
      return giveItemAction(gameState, player, itemId, targetPlayerId);
    }
    if (mode === 'leave') {
      return leaveItemAction(gameState, player, itemId);
    }
    if (mode === 'pickup') {
      return pickupItemAction(gameState, player, itemId);
    }
```

改成：

```js
  if (actionType === 'item') {
    const { itemId, targetPlayerId, mode, itemCategory } = options;
    if (mode === 'give') {
      return giveItemAction(gameState, player, itemId, targetPlayerId);
    }
    if (mode === 'leave') {
      return leaveItemAction(gameState, player, itemId);
    }
    if (mode === 'pickup') {
      return pickupItemAction(gameState, player, itemId);
    }
    if (mode === 'wield') {
      return wieldItemAction(gameState, player, itemId, itemCategory);
    }
    if (mode === 'unwield') {
      return unwieldItemAction(gameState, player, itemId);
    }
    if (mode === 'wear') {
      return wearItemAction(gameState, player, itemId, itemCategory);
    }
    if (mode === 'unwear') {
      return unwearItemAction(gameState, player, itemId);
    }
```

（`selectAction` 函式其餘部分，包含後面「使用」分支的邏輯，維持不動。）

- [ ] **Step 4: 執行測試確認通過**

Run: `npx jest server/test/game/turnFlow.test.js`
Expected: PASS（全部測試）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat: add wield/unwield/wear/unwear item actions"
```

- [ ] **Step 6: 寫 socketHandlers.js 解析 `itemCategory` 的失敗測試**

在 `server/test/socketHandlers.test.js` 檔案裡，找到 `picking up a dropped item that pushes the player over the cap opens a pendingInventoryChoice` 這個既有測試（用 `grep -n "picking up a dropped item that pushes"` 找到確切位置），在它之後加入：

```js
test('game:selectAction item mode:wield resolves itemCategory from content and sets wieldedWeaponId', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [{ id: 'item_101', name: '短劍', category: 'weapon' }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' });

  const ack = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_101', mode: 'wield' }, resolve)
  );
  expect(ack.error).toBeUndefined();
  expect(player.wieldedWeaponId).toBe('item_101');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item mode:wear on a non-gear item is rejected with INVALID_ITEM_CATEGORY', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [{ id: 'item_101', name: '短劍', category: 'weapon' }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_101' });

  const ack = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_101', mode: 'wear' }, resolve)
  );
  expect(ack.error).toBe('INVALID_ITEM_CATEGORY');
  expect(player.wornGearIds).toEqual([]);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 7: 執行測試確認失敗**

Run: `npx jest server/test/socketHandlers.test.js -t "mode:wield resolves itemCategory"`
Expected: FAIL（`selectOptions` 沒有帶 `itemCategory`，`wieldItemAction` 會用 `undefined !== 'weapon'` 拋 `INVALID_ITEM_CATEGORY`，跟第二個測試期待的錯誤搞混，兩個測試都不會如預期通過）

- [ ] **Step 8: 在 `game:selectAction` handler 解析 `itemCategory`**

`server/src/socketHandlers.js` 第 233-245 行目前是：

```js
        const { actionType, itemId, targetPlayerId, mode } = payload || {};
        const selectOptions = { itemId, targetPlayerId, mode };
        let sourceEffects = null;
        let sourceId = null;
        let consumeItemIfApplied = false;

        if (actionType === 'item' && (!mode || mode === 'use')) {
          const itemContent = content.cards.items.find((i) => i.id === itemId) || content.cards.omens.find((o) => o.id === itemId);
          selectOptions.itemCanTargetOthers = Boolean(itemContent && itemContent.canTargetOthers);
          sourceEffects = itemContent ? itemContent.effects : [];
          sourceId = itemId;
          consumeItemIfApplied = Boolean(itemContent && itemContent.category === 'consumable');
        }
```

改成（在既有的 `!mode || mode === 'use'` 分支之後，新增一個 `wield`/`wear` 專用分支）：

```js
        const { actionType, itemId, targetPlayerId, mode } = payload || {};
        const selectOptions = { itemId, targetPlayerId, mode };
        let sourceEffects = null;
        let sourceId = null;
        let consumeItemIfApplied = false;

        if (actionType === 'item' && (!mode || mode === 'use')) {
          const itemContent = content.cards.items.find((i) => i.id === itemId) || content.cards.omens.find((o) => o.id === itemId);
          selectOptions.itemCanTargetOthers = Boolean(itemContent && itemContent.canTargetOthers);
          sourceEffects = itemContent ? itemContent.effects : [];
          sourceId = itemId;
          consumeItemIfApplied = Boolean(itemContent && itemContent.category === 'consumable');
        }

        if (actionType === 'item' && (mode === 'wield' || mode === 'wear')) {
          const itemContent = content.cards.items.find((i) => i.id === itemId);
          selectOptions.itemCategory = itemContent ? itemContent.category : null;
        }
```

- [ ] **Step 9: 執行測試確認通過**

Run: `npx jest server/test/socketHandlers.test.js`
Expected: PASS（全部測試）

- [ ] **Step 10: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: resolve itemCategory for wield/wear from card content"
```

---

### Task 3: `item_010` 擲骰介入改成配戴中才觸發 + 開場自動裝備

**Files:**
- Modify: `server/src/game/diceInterjection.js`
- Modify: `server/src/game/gameManager.js`
- Test: `server/test/game/diceInterjection.test.js`
- Test: `server/test/game/gameManager.test.js`

**Interfaces:**
- Consumes: Task 1 的 `player.wornGearIds`。
- Produces: 無新的匯出介面，行為改變已涵蓋在既有函式內。

- [ ] **Step 1: 寫 gear 擲骰介入需要配戴中的失敗測試**

先確認測試檔案存在與既有測試風格：

Run: `ls server/test/game/diceInterjection.test.js`

在該檔案裡找到 `findInterjectionOptions` 相關的既有測試群組（用 `grep -n "findInterjectionOptions" server/test/game/diceInterjection.test.js` 找到確切位置與既有的 `itemCatalog`/`player` 建構方式），在附近加入（`player` 建構請照該檔案既有寫法調整，以下範例假設既有測試已經有一個建立最小 `player` 物件的 helper 或直接字面量寫法）：

```js
test('findInterjectionOptions excludes a gear-category diceInterjection item when it is not worn', () => {
  const player = { inventory: [{ id: 'item_010' }], wornGearIds: [], diceInterjectionUsedThisTurn: [] };
  const itemCatalog = [
    { id: 'item_010', name: '油燈', category: 'gear', diceInterjection: { scope: 'eventTriggered', bonusDice: 1, consumesItem: false } },
  ];
  const options = findInterjectionOptions(player, itemCatalog, 'event');
  expect(options).toEqual([]);
});

test('findInterjectionOptions includes a gear-category diceInterjection item when it is worn', () => {
  const player = { inventory: [{ id: 'item_010' }], wornGearIds: ['item_010'], diceInterjectionUsedThisTurn: [] };
  const itemCatalog = [
    { id: 'item_010', name: '油燈', category: 'gear', diceInterjection: { scope: 'eventTriggered', bonusDice: 1, consumesItem: false } },
  ];
  const options = findInterjectionOptions(player, itemCatalog, 'event');
  expect(options).toEqual([{ itemId: 'item_010', name: '油燈', diceInterjection: { scope: 'eventTriggered', bonusDice: 1, consumesItem: false } }]);
});

test('findInterjectionOptions includes a non-gear diceInterjection item regardless of wornGearIds', () => {
  const player = { inventory: [{ id: 'item_006' }], wornGearIds: [], diceInterjectionUsedThisTurn: [] };
  const itemCatalog = [
    { id: 'item_006', name: '詭異人偶', category: 'reusable', diceInterjection: { scope: 'any', bonusDice: 2, consumesItem: false } },
  ];
  const options = findInterjectionOptions(player, itemCatalog, 'event');
  expect(options).toEqual([{ itemId: 'item_006', name: '詭異人偶', diceInterjection: { scope: 'any', bonusDice: 2, consumesItem: false } }]);
});
```

**注意**：檔案既有測試裡 `player` 物件的確切建構方式（可能是直接字面量、也可能有共用 helper）請先讀該檔案開頭確認，調整以上範例讓它符合既有慣例，不要引入第二套不一致的寫法。

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx jest server/test/game/diceInterjection.test.js -t "gear-category diceInterjection item"`
Expected: 第一個（`excludes...when it is not worn`）FAIL——目前 `item_010` 只要持有就會被列入，不會被排除。

- [ ] **Step 3: 在 `findInterjectionOptions` 加入 gear 配戴檢查**

`server/src/game/diceInterjection.js` 第 9-16 行目前是：

```js
  for (const invItem of player.inventory || []) {
    const content = itemCatalog.find((c) => c.id === invItem.id);
    if (!content || !content.diceInterjection) continue;
    const di = content.diceInterjection;
    if (di.scope === 'eventTriggered' && sourceDeckType !== 'event') continue;
    if (!di.consumesItem && used.includes(invItem.id)) continue;
    options.push({ itemId: invItem.id, name: content.name, diceInterjection: di });
  }
```

改成：

```js
  for (const invItem of player.inventory || []) {
    const content = itemCatalog.find((c) => c.id === invItem.id);
    if (!content || !content.diceInterjection) continue;
    if (content.category === 'gear' && !player.wornGearIds.includes(invItem.id)) continue;
    const di = content.diceInterjection;
    if (di.scope === 'eventTriggered' && sourceDeckType !== 'event') continue;
    if (!di.consumesItem && used.includes(invItem.id)) continue;
    options.push({ itemId: invItem.id, name: content.name, diceInterjection: di });
  }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx jest server/test/game/diceInterjection.test.js`
Expected: PASS（全部測試）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/diceInterjection.js server/test/game/diceInterjection.test.js
git commit -m "feat: require gear items to be worn for their dice interjection to apply"
```

- [ ] **Step 6: 寫開場自動裝備的失敗測試**

先確認測試檔案存在與既有測試風格：

Run: `ls server/test/game/gameManager.test.js`

在該檔案裡找到 `startGame` 給角色初始道具的既有測試（用 `grep -n "itemID" server/test/game/gameManager.test.js` 找到確切位置與既有的 `characters`/`cards`/`players` 參數建構方式），在附近加入（請照該檔案既有的 `characters`/`cards` 陣列寫法調整，以下範例假設有一個角色 `itemID` 指到一張 weapon 卡）：

```js
test('startGame auto-wields a weapon-category starting item', () => {
  const characters = [
    { id: 'char_001', codename: 'Alice', itemID: 'item_101', stats: makeStats() },
  ];
  const cards = { items: [{ id: 'item_101', name: '短劍', category: 'weapon' }], events: [], omens: [] };
  const manager = createGameManager();
  const gameState = startGame(manager, 'ROOM1', {
    startingRooms: STARTING_ROOMS,
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    cards,
    characters,
    players: [{ playerId: 'p1', name: 'Alice', characterId: 'char_001' }],
  });
  const player = gameState.players.find((p) => p.playerId === 'p1');
  expect(player.wieldedWeaponId).toBe('item_101');
});

test('startGame auto-wears a gear-category starting item', () => {
  const characters = [
    { id: 'char_001', codename: 'Alice', itemID: 'item_102', stats: makeStats() },
  ];
  const cards = { items: [{ id: 'item_102', name: '護目鏡', category: 'gear' }], events: [], omens: [] };
  const manager = createGameManager();
  const gameState = startGame(manager, 'ROOM1', {
    startingRooms: STARTING_ROOMS,
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    cards,
    characters,
    players: [{ playerId: 'p1', name: 'Alice', characterId: 'char_001' }],
  });
  const player = gameState.players.find((p) => p.playerId === 'p1');
  expect(player.wornGearIds).toEqual(['item_102']);
});
```

**注意**：`STARTING_ROOMS`／`makeStats`／`createGameManager` 等既有的 import/helper 名稱請先讀 `server/test/game/gameManager.test.js` 檔案開頭確認，調整以上範例符合既有慣例（例如 `gameState.players` 的實際存取方式，可能是陣列也可能要透過 `getPlayer` 之類的既有匯出函式）。

- [ ] **Step 7: 執行測試確認失敗**

Run: `npx jest server/test/game/gameManager.test.js -t "auto-wields"`
Expected: FAIL（`player.wieldedWeaponId` 是 `null`）

- [ ] **Step 8: 在 `startGame` 加入開場自動裝備邏輯**

`server/src/game/gameManager.js` 第 35-37 行目前是：

```js
    if (character.itemID) {
      addItem(newPlayer, { id: character.itemID });
    }
```

改成：

```js
    if (character.itemID) {
      addItem(newPlayer, { id: character.itemID });
      const itemContent = cards.items.find((i) => i.id === character.itemID);
      if (itemContent && itemContent.category === 'weapon') {
        newPlayer.wieldedWeaponId = character.itemID;
      } else if (itemContent && itemContent.category === 'gear') {
        newPlayer.wornGearIds.push(character.itemID);
      }
    }
```

- [ ] **Step 9: 執行測試確認通過**

Run: `npx jest server/test/game/gameManager.test.js`
Expected: PASS（全部測試）

- [ ] **Step 10: Commit**

```bash
git add server/src/game/gameManager.js server/test/game/gameManager.test.js
git commit -m "feat: auto-equip weapon/gear starting items on game start"
```

---

### Task 4: 前端道具選單依 category 動態決定選項

**Files:**
- Modify: `client/src/gameplay/CharacterPanel.jsx`

**Interfaces:**
- Consumes: `player.wieldedWeaponId`、`player.wornGearIds`（Task 1 新增，隨 `game:stateUpdate` 自動送到前端，不需要新的 socket 事件）；`findCardInfo(id, cardContent)`（`client/src/gameplay/mapUtils.js` 既有匯出，可以拿到卡片的 `category` 欄位）。
- Produces: 無新匯出，純 UI 行為改變。

- [ ] **Step 1: 手動驗證前準備——讀懂現有選單程式碼**

`client/src/gameplay/CharacterPanel.jsx` 目前第 92-115 行（元件開頭到 `handleGiveItem`）與第 210-246 行（選單 JSX）是這次要改的範圍。第 93 行 `selectedItem` 的形狀目前是 `{ itemId, name, isMaterial }`，第 180 行點擊道具格子時組出這個物件。

- [ ] **Step 2: 加入 category 查表與裝備狀態判斷**

第 72-75 行的 `findCardName` 之後加入：

```js
function findCardCategory(id, cardContent) {
  const card = findCardInfo(id, cardContent);
  return card ? card.category : null;
}
```

第 93 行 `const [selectedItem, setSelectedItem] = useState(null); // { itemId, name, isMaterial } | null` 改成：

```js
  const [selectedItem, setSelectedItem] = useState(null); // { itemId, name, isMaterial, category } | null
```

第 180 行（點擊道具格子組出 `selectedItem` 的地方）目前是：

```jsx
                  onClick={() => setSelectedItem({ itemId: item.id, name: findCardName(item.id, cardContent), isMaterial: Boolean(findCardInfo(item.id, cardContent)?.isMaterial) })}
```

改成：

```jsx
                  onClick={() => setSelectedItem({ itemId: item.id, name: findCardName(item.id, cardContent), isMaterial: Boolean(findCardInfo(item.id, cardContent)?.isMaterial), category: findCardCategory(item.id, cardContent) })}
```

- [ ] **Step 3: 加入 wield/unwield/wear/unwear 的送出 handler**

第 108-115 行（`handleLeaveItem`／`handleGiveItem` 之間或之後）加入：

```js
  function handleWieldItem() {
    onSelectAction('item', { itemId: selectedItem.itemId, mode: 'wield', itemCategory: selectedItem.category });
    closeItemMenu();
  }
  function handleUnwieldItem() {
    onSelectAction('item', { itemId: selectedItem.itemId, mode: 'unwield' });
    closeItemMenu();
  }
  function handleWearItem() {
    onSelectAction('item', { itemId: selectedItem.itemId, mode: 'wear', itemCategory: selectedItem.category });
    closeItemMenu();
  }
  function handleUnwearItem() {
    onSelectAction('item', { itemId: selectedItem.itemId, mode: 'unwear' });
    closeItemMenu();
  }
```

（伺服器端的 `mode:'wield'`／`mode:'wear'` 本身也會從卡片內容重新查一次 `itemCategory` 覆蓋掉前端傳的值——見 Task 2 Step 8——這裡直接帶上 `selectedItem.category` 只是avoid 額外查表，不是安全性依賴。）

- [ ] **Step 4: 選單 JSX 改成依 category 動態決定選項**

第 234-243 行目前是：

```jsx
              <div style={{ display: 'flex', gap: 8 }}>
                {!selectedItem.isMaterial && <button onClick={handleUseItem}>使用</button>}
                {roommates && roommates.length > 0 && (
                  <button onClick={() => setShowGiveTargets(true)}>給予</button>
                )}
                <button onClick={handleLeaveItem}>遺留</button>
                <button onClick={closeItemMenu}>取消</button>
              </div>
```

改成：

```jsx
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedItem.category === 'weapon' && (
                  player.wieldedWeaponId === selectedItem.itemId ? (
                    <button onClick={handleUnwieldItem}>取下</button>
                  ) : (
                    <button onClick={handleWieldItem}>手持</button>
                  )
                )}
                {selectedItem.category === 'gear' && (
                  player.wornGearIds.includes(selectedItem.itemId) ? (
                    <button onClick={handleUnwearItem}>取下</button>
                  ) : (
                    <button onClick={handleWearItem}>配戴</button>
                  )
                )}
                {(selectedItem.category === 'consumable' || selectedItem.category === 'reusable') && !selectedItem.isMaterial && (
                  <button onClick={handleUseItem}>使用</button>
                )}
                {roommates && roommates.length > 0 && (
                  <button onClick={() => setShowGiveTargets(true)}>給予</button>
                )}
                <button onClick={handleLeaveItem}>遺留</button>
                <button onClick={closeItemMenu}>取消</button>
              </div>
```

（`decoration` 類與 `category` 為 `null`/未知值的道具，這幾個條件都不成立，自然只剩「給予」／「遺留」／「取消」，符合設計文件的 `decoration` 選項組合；預兆卡不會落到這個分支，因為第 176 行外層的 `slots` 已經用 `isOmenCard` 把預兆卡跟道具卡分開渲染，但兩者共用同一個道具格 `onClick`／選單邏輯——這裡刻意不特別排除 omen，因為 omen 卡的 `findCardCategory` 查不到 `cardContent.items` 裡的資料會回傳 `null`，效果跟 `decoration` 一樣只顯示給予/遺留，不需要額外分支。）

- [ ] **Step 5: 啟動開發伺服器，手動驗證**

先確認沒有殘留的舊 server 在跑，若有請先關閉再啟動：

```bash
npm --prefix server start
```

另開一個 terminal：

```bash
npm --prefix client run dev
```

用瀏覽器開兩個分頁模擬兩名玩家，走一次角色選擇（挑一個初始道具是 weapon 或 gear 的角色，確認開場就顯示「手持中」/「配戴中」狀態——若道具選單裡看到的是「取下」而非「手持」/「配戴」即代表開場自動裝備生效），然後手動測試：
1. 點一件 weapon 類道具，確認選單顯示「手持」而非「使用」
2. 按下「手持」，重新點開同一件道具，確認選單變成「取下」
3. 手持另一件 weapon 道具，確認前一件自動變回「手持」（不再是「取下」）
4. 點一件 gear 類道具，確認可以「配戴」，配戴後可以再配戴另一件 gear（兩件同時顯示「取下」）
5. 點一件 decoration 類道具，確認選單只有「給予」／「遺留」／「取消」，沒有「使用」
6. 把手持中的武器「遺留」在房間，重新查看角色狀態，確認不再手持任何武器
7. 全程觀察 console 沒有錯誤

完成後關閉本次啟動的 server／dev server。

- [ ] **Step 6: Commit**

```bash
git add client/src/gameplay/CharacterPanel.jsx
git commit -m "feat: item menu options driven by category (wield/wear/use/give/leave)"
```

## Self-Review 檢查結果

**Spec coverage：**
- 資料模型（`wieldedWeaponId`／`wornGearIds`） → Task 1
- 給予/遺留/物品攜帶上限強制遺留時清除裝備狀態 → Task 1
- `wield`/`unwield`/`wear`/`unwear` 四種動作、換持、無上限配戴、行動力扣點、category 合法性檢查 → Task 2
- `item_010` 改成配戴中才觸發 → Task 3
- 開場自動裝備 → Task 3
- 前端選單依 category 動態決定選項 → Task 4

**Placeholder scan：** 全文搜尋過，沒有 TBD／TODO／「之後補」字樣；每個 code block 都是可直接套用的完整程式碼。少數地方（Task 3 的 `diceInterjection.test.js`／`gameManager.test.js` 既有測試建構方式、Task 4 的 omen 分支說明）明確標註「請先讀既有慣例調整」而不是含糊帶過，是刻意留給 implementer 核對既有檔案的具體指示，不是缺漏。

**Type/signature 一致性檢查：**
- `clearEquipStateIfNeeded(player, itemId)` 在 Task 1 定義並匯出，同一 Task 內 `giveItemAction`／`leaveItemAction`／`applyInventoryLeave` 三個呼叫點的參數順序與數量一致。
- `wieldItemAction(gameState, player, itemId, itemCategory)`／`wearItemAction(gameState, player, itemId, itemCategory)`／`unwieldItemAction(gameState, player, itemId)`／`unwearItemAction(gameState, player, itemId)` 在 Task 2 定義，`selectAction` 內的呼叫與回傳值 `{ kind: 'item', mode, itemId }` 格式跟既有 `give`/`leave`/`pickup` 一致。
- `selectOptions.itemCategory` 在 Task 2 的 socketHandlers.js 端設定、`selectAction` 端讀取，命名跟型別（字串或 `null`）在兩處一致。
- Task 4 前端 `selectedItem.category` 命名與 Task 2 的 `itemCategory` 概念一致（前端叫 `category` 是因為 `findCardCategory` 直接回傳卡片的 `category` 欄位本身，跟後端 `selectOptions.itemCategory` 指的是同一件事，只是變數名稱依各自檔案既有慣例命名，不是不一致）。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-23-item-equip-mechanism.md`. Two execution options:

1. **Subagent-Driven (recommended)** - 每個 Task 交給獨立 subagent 執行，Task 之間互相 review，快速迭代
2. **Inline Execution** - 在目前這個 session 用 executing-plans 批次執行，checkpoint 時我會跟你確認

要用哪一種方式？
