# 房間多重行動機制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「一個房間只能有一種 room_action」改成「一個房間可以同時提供多種行動，有多個選項時跳出選單」，並新增 LobbyC 下樓、包廂房跳下舞廳、崩塌房間跳下三個具體行動。

**Architecture:** `rooms.json`/`starting-rooms.json` 的 `actions` 欄位從純文字標籤改成結構化清單（`{label, kind, ...}`，`kind` 為 `search`/`craft`/`effects`/`teleport` 四選一）；伺服器新增 `getRoomActions` 依房間目前狀態算出有效清單，`game:selectAction room_action` 依清單長度決定要不要要求 `actionIndex`；前端算出同一份清單，長度 ≥2 時跳選單。

**Tech Stack:** Node.js + Socket.IO 後端（CommonJS，Jest 測試）、React 前端。

## Global Constraints

- `actions` 陣列每一項：`{ "label": string, "kind": "search"|"craft"|"effects"|"teleport", ... }`；`effects` 類需要自己的 `effects` 陣列＋可選的 `freeAction:true`（省略即為 `false`，扣 1 點行動力）
- 房間頂層的 `effects` 欄位語意收斂成**只給 `applyRoomEndTurnBonus`（結束回合被動加成）使用**，room_action 完全不再讀它——所有 room_action 觸發的效果都要搬進 `actions` 裡對應項目自己的 `effects`
- 沒有 `actions` 欄位的房間，程式碼層級預設 `[{ "label": "搜索", "kind": "search" }]`（沿用既有慣例，不用改資料）
- 清單長度 1：不需要 `actionIndex`，直接執行（沿用現有單一行動房間的既有互動方式）
- 清單長度 ≥2：`payload.actionIndex` 沒帶或超出範圍 → `INVALID_ACTION_INDEX`
- 崩塌的房間、包廂房的「跳下」都消耗 1 點行動力（開發者已確認統一規則，不是免費）；崩塌房間**第一次**開門進入觸發的摔落是移動本身的必然效果，不算這裡的「跳下」，不受這次改動影響
- 崩塌房間的「跳下」只有 `placedRoom.collapseLink` 已存在時才會出現在清單裡
- 對應設計文件：[docs/superpowers/specs/2026-08-19-multi-room-action-design.md](../specs/2026-08-19-multi-room-action-design.md)

---

## Task 1: `performTeleport`（`turnFlow.js`，取代 `jumpIntoCollapsedRoom`）

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes：既有的 `movePlayerTo`（`./playerEntity`）、`isBallroomOrGallery`/`pairedFloorFor`（同檔案既有函式）、`COLLAPSED_ROOM_ID`（同檔案既有常數）、`coordKey`（`./boardGenerator`，已 import）
- Produces：`performTeleport(gameState, playerId)`，回傳 `{ floor, x, y }`（移動後的目的地）；不檢查 `NOT_YOUR_TURN`（呼叫方——Task 2 的 `socketHandlers.js`——會先透過 `selectAction` 檢查過），純粹「知道要去哪裡就移過去」。取代舊的 `jumpIntoCollapsedRoom`（連同它自己的 `NOT_YOUR_TURN`/`NO_ROOM_ACTION_AVAILABLE` 檢查一起移除——這兩個檢查現在由 Task 2 的呼叫端負責）。

**目前 `server/src/game/turnFlow.js` 第 288-307 行**（含前導註解）：

```javascript
// 之後進來的玩家，可自由選擇是否跳入地板大洞 -- once a Collapsed Room has a
// recorded collapseLink (someone already fell through), any later player
// standing in it can jump down for free (no action point cost, matching the
// official rule's "無需耗移動點數"). Triggered via the same room_action /
// "行動" button as any other room action, but this is a pure teleport, not
// an effects-array resolution -- socketHandlers.js special-cases it before
// falling through to the normal room_action/effects path.
function jumpIntoCollapsedRoom(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  if (!room || room.roomId !== COLLAPSED_ROOM_ID || !room.collapseLink) {
    throw new Error('NO_ROOM_ACTION_AVAILABLE');
  }
  const { x, y } = room.collapseLink;
  movePlayerTo(player, 'basement', x, y, null);
  return { kind: 'room_action', collapseJump: true, x, y };
}
```

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/turnFlow.test.js` 裡，找到現有的 4 個 `jumpIntoCollapsedRoom` 測試（`'jumpIntoCollapsedRoom teleports a later player down a known collapseLink for free (no action point cost)'`、`'...throws NO_ROOM_ACTION_AVAILABLE when the room has no collapseLink yet'`、`'...throws NO_ROOM_ACTION_AVAILABLE when the player is not standing in a Collapsed Room'`、`'...throws NOT_YOUR_TURN when called by a player who is not the current turn player'`，第 503-555 行），**整段刪除**，替換成：

```javascript
test('performTeleport moves a player through a known collapseLink on a Collapsed Room', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set(coordKey(0, 1), {
    roomId: 'room_collapsed_room',
    x: 0,
    y: 1,
    doorSides: ['north'],
    droppedItems: [],
    collapseLink: { x: 7, y: 7 },
  });
  gameState.board.basement.set(coordKey(7, 7), { roomId: 'room_basement_a', x: 7, y: 7, doorSides: ['north'], droppedItems: [] });

  const result = performTeleport(gameState, 'p1');

  expect(result).toEqual({ floor: 'basement', x: 7, y: 7 });
  expect(player.floor).toBe('basement');
  expect(player.x).toBe(7);
  expect(player.y).toBe(7);
});

test('performTeleport moves a player from the Gallery to the paired Ballroom at the same coordinate', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.floor = 'upper';
  player.x = 3;
  player.y = 3;
  gameState.board.upper.set(coordKey(3, 3), { roomId: 'room_gallery', x: 3, y: 3, doorSides: ['north'], droppedItems: [] });
  gameState.board.ground.set(coordKey(3, 3), { roomId: 'room_ballroom', x: 3, y: 3, doorSides: ['north'], droppedItems: [] });

  const result = performTeleport(gameState, 'p1');

  expect(result).toEqual({ floor: 'ground', x: 3, y: 3 });
  expect(player.floor).toBe('ground');
  expect(player.x).toBe(3);
  expect(player.y).toBe(3);
});

test('performTeleport throws NO_TELEPORT_TARGET when the player is not standing in a teleport-capable room', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => performTeleport(gameState, 'p1')).toThrow('NO_TELEPORT_TARGET');
});
```

同一個檔案開頭的 import 區塊（找 `jumpIntoCollapsedRoom` 出現的那一行 import），把 `jumpIntoCollapsedRoom` 改成 `performTeleport`。

- [ ] **Step 2: 執行測試確認 RED**

Run: `cd server && npx jest test/game/turnFlow.test.js -t "performTeleport" --forceExit`
Expected: 3 個新測試 FAIL（`performTeleport is not defined`）

- [ ] **Step 3: 實作**

把上面引用的 `jumpIntoCollapsedRoom` 函式（含前導註解）整段替換成：

```javascript
// 「跳下」的兩個具體案例：崩塌的房間（已有 collapseLink 才能跳）、包廂房/舞廳配對
// （放置時就決定好座標，永遠可跳）。純粹是「知道目的地在哪就移過去」，不檢查
// NOT_YOUR_TURN/行動力——呼叫方（socketHandlers.js）已經透過 selectAction 檢查過
// 回合與行動力，這裡只負責移動本身。
function performTeleport(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  if (room.roomId === COLLAPSED_ROOM_ID && room.collapseLink) {
    const { x, y } = room.collapseLink;
    movePlayerTo(player, 'basement', x, y, null);
    return { floor: 'basement', x, y };
  }
  if (isBallroomOrGallery(room.roomId)) {
    const targetFloor = pairedFloorFor(room.roomId);
    movePlayerTo(player, targetFloor, room.x, room.y, null);
    return { floor: targetFloor, x: room.x, y: room.y };
  }
  throw new Error('NO_TELEPORT_TARGET');
}
```

在檔案結尾的 `module.exports` 裡，把 `jumpIntoCollapsedRoom` 換成 `performTeleport`。

- [ ] **Step 4: 執行測試確認 GREEN**

Run: `cd server && npx jest test/game/turnFlow.test.js -t "performTeleport" --forceExit`
Expected: 全數 PASS

- [ ] **Step 5: 跑全套後端測試（預期會有既有測試因為 `jumpIntoCollapsedRoom` 被移除而失敗，這是預期中的，Task 2 會處理）**

Run: `cd server && npx jest --forceExit`
Expected: `server/test/socketHandlers.test.js` 裡引用舊 collapse-jump 行為的測試會 FAIL（`jumpIntoCollapsedRoom is not a function` 之類）——這是 Task 2 的範圍，這裡先確認**只有**這兩個測試壞掉，其餘全綠

- [ ] **Step 6: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat: add performTeleport, replacing jumpIntoCollapsedRoom"
```

---

## Task 2: `getRoomActions` ＋ room_action 多重行動分派（`socketHandlers.js`）

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes：Task 1 的 `performTeleport(gameState, playerId)`；既有的 `performSearch(gameState, placedRoom)`、`findRoomDefinition(content, roomId)`（同檔案既有函式）
- Produces：新函式 `getRoomActions(roomDefinition, placedRoom)`，回傳目前有效的 `actions` 陣列（套用崩塌房間的 `collapseLink` 過濾）；新錯誤代碼 `INVALID_ACTION_INDEX`

這個任務會整段替換 `server/src/socketHandlers.js` 裡 `actionType === 'room_action'` 的處理區塊，並更新它的 import（把 `jumpIntoCollapsedRoom` 改成 `performTeleport`）。

**這個任務也會動到 6 個既有測試**（4 個要更新 fixture、2 個要整段替換），詳見下方各步驟。

- [ ] **Step 1: 更新 import**

`server/src/socketHandlers.js` 第 17 行：

```javascript
const { moveToRoom, moveSummon, selectAction, selectSummonAction, useStairs, endTurn, resumeCollapseCheck, jumpIntoCollapsedRoom } = require('./game/turnFlow');
```

改成：

```javascript
const { moveToRoom, moveSummon, selectAction, selectSummonAction, useStairs, endTurn, resumeCollapseCheck, performTeleport } = require('./game/turnFlow');
```

- [ ] **Step 2: 寫失敗測試（更新 4 個既有 fixture，讓它們符合新資料格式）**

**2a.** 找到 `makeCraftRoomContent` 函式（第 2563-2572 行）：

```javascript
function makeCraftRoomContent() {
  return makeContent({
    rooms: [{
      id: 'room_new',
      doors: 4,
      floor: 'ground',
      craftRecipes: [{ id: 'recipe_cooked_food', ingredients: ['item_016', 'item_017'], result: 'item_021' }],
    }],
  });
}
```

改成（只加一行 `actions`）：

```javascript
function makeCraftRoomContent() {
  return makeContent({
    rooms: [{
      id: 'room_new',
      doors: 4,
      floor: 'ground',
      actions: [{ label: '烹飪', kind: 'craft' }],
      craftRecipes: [{ id: 'recipe_cooked_food', ingredients: ['item_016', 'item_017'], result: 'item_021' }],
    }],
  });
}
```

（這個函式下面依附的 4 個 craftRecipes 測試不用改，它們都是單一行動房間，`actionIndex` 預設為 0。）

**2b.** 找到 `'game:selectAction room_action: resolves the current room\'s effects'` 測試（第 2275 行），把它的 `content`：

```javascript
  const content = makeContent({
    rooms: [{
      id: 'room_new',
      doors: 4,
      floor: 'ground',
      effects: [{ type: 'stat_change', stat: 'might', delta: 1 }],
    }],
  });
```

改成：

```javascript
  const content = makeContent({
    rooms: [{
      id: 'room_new',
      doors: 4,
      floor: 'ground',
      actions: [{ label: '考驗', kind: 'effects', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
    }],
  });
```

**2c.** 找到 `'game:selectAction room_action: existing craftRecipes/effects rooms are unaffected by the search branch (regression)'` 測試，把它的 `content`：

```javascript
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
  });
```

改成：

```javascript
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', actions: [{ label: '考驗', kind: 'effects', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }] }],
  });
```

**2d.** 刪除以下兩個測試整段（這次改動後房間頂層 `effects` 欄位完全不再被 room_action 讀取，只給 `applyRoomEndTurnBonus` 用，這兩個測試驗證的「room_action 怎麼篩選頂層 effects」的問題已經不存在，不是遺漏，是設計改變讓它們的前提不再成立）：
- `'game:selectAction room_action: a room whose effects are ONLY a onceOnlyPerPlayer stat_change falls through to search instead of applying the stat_change'`
- `'game:selectAction room_action: a room mixing a onceOnlyPerPlayer stat_change with a real effect still takes the effects branch (regression)'`

**2e.** 找到 `'game:selectAction room_action resolving a move_to_room effect (e.g. stairs) broadcasts game:roomEntered for the target room'` 測試，把 `startingRooms` 裡的 `room_lobby_c`：

```javascript
      {
        id: 'room_lobby_c',
        name: '大門廳',
        floor: 'ground',
        effects: [{ type: 'move_to_room', targetRoomId: 'room_upper_landing' }],
        freeAction: true,
      },
```

改成：

```javascript
      {
        id: 'room_lobby_c',
        name: '大門廳',
        floor: 'ground',
        actions: [{ label: '上樓', kind: 'effects', effects: [{ type: 'move_to_room', targetRoomId: 'room_upper_landing' }], freeAction: true }],
      },
```

**2f.** 找到並整段刪除以下兩個測試（下一步會用新版本替換）：
- `'game:selectAction room_action jumps a later player down an already-collapsed room for free'`
- `'game:selectAction room_action jumping down an already-collapsed room broadcasts game:roomEntered for the basement room'`

替換成：

```javascript
test('game:selectAction room_action with actionIndex selecting teleport: jumps a later player down an already-collapsed room, costing 1 action point', async () => {
  const content = makeContent({
    rooms: [
      { id: 'room_collapsed_room', doors: 2, floor: 'ground', actions: [{ label: '搜索', kind: 'search' }, { label: '跳下', kind: 'teleport' }] },
      { id: 'room_basement_a', doors: 2, floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guaranteed fail -> falls immediately
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();
  expect(player.floor).toBe('basement'); // fell already -- simulate a later turn to try the jump action too
  player.actionPoints = 4;
  player.floor = 'ground';
  player.x = 1;
  player.y = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 1 }, resolve));

  expect(result.error).toBeUndefined();
  expect(player.floor).toBe('basement');
  expect(player.x).toBe(1);
  expect(player.y).toBe(1);
  expect(player.actionPoints).toBe(3); // costs 1 AP now (unified with the gallery jump rule)

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with actionIndex selecting teleport: jumping down an already-collapsed room broadcasts game:roomEntered for the basement room', async () => {
  const content = makeContent({
    rooms: [
      { id: 'room_collapsed_room', doors: 2, floor: 'ground', actions: [{ label: '搜索', kind: 'search' }, { label: '跳下', kind: 'teleport' }] },
      { id: 'room_basement_a', doors: 2, floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  // The fall-through move itself already broadcasts its own game:roomEntered
  // (finishMoveResult reads the mover's actual final position, which by then
  // is the basement room) -- drain that first so the listener below can only
  // catch what the room_action jump itself broadcasts, not a race with this
  // earlier one.
  const firstRoomEnteredPromise = new Promise((resolve) => otherClient.once('game:roomEntered', resolve));
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guaranteed fail -> falls immediately
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();
  await firstRoomEnteredPromise;

  player.actionPoints = 4;
  player.floor = 'ground';
  player.x = 1;
  player.y = 1;

  const roomEnteredPromise = new Promise((resolve) => otherClient.once('game:roomEntered', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 1 }, resolve));
  const roomEntered = await roomEnteredPromise;

  expect(roomEntered.playerId).toBe(currentPlayerId);
  expect(roomEntered.roomId).toBe('room_basement_a');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: a Collapsed Room without a collapseLink yet does not offer teleport (only search)', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_collapsed_room', doors: 4, floor: 'ground', actions: [{ label: '搜索', kind: 'search' }, { label: '跳下', kind: 'teleport' }] }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  // Entering room_collapsed_room always triggers the automatic speed check
  // (moveToRoom, unconditional on this specific room id) -- mock a guaranteed
  // PASS (rolled >= 5) so the player does NOT fall through and collapseLink
  // stays unset, matching this test's premise.
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  rngSpy.mockRestore();
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  expect(player.floor).toBe('ground'); // confirms the check passed -- did not fall
  player.actionPoints = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 1 }, resolve));
  expect(result.error).toBe('INVALID_ACTION_INDEX'); // teleport filtered out -- list length is 1, index 1 is out of range

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with actionIndex selecting teleport: jumps from the Gallery to the paired Ballroom, costing 1 action point, no damage applied', async () => {
  const content = makeContent({
    rooms: [
      { id: 'room_gallery', doors: 4, floor: 'upper', actions: [{ label: '搜索', kind: 'search' }, { label: '跳下', kind: 'teleport' }] },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_gallery on the upper floor
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  expect(player.floor).toBe('upper');
  const galleryX = player.x;
  const galleryY = player.y;
  // room_gallery/room_ballroom pairing places the ballroom at the same (x, y) on the ground floor.
  gameState.board.ground.set(coordKey(galleryX, galleryY), { roomId: 'room_ballroom', x: galleryX, y: galleryY, doorSides: ['north'], droppedItems: [], item: null });
  player.actionPoints = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 1 }, resolve));

  expect(result.error).toBeUndefined();
  expect(player.floor).toBe('ground');
  expect(player.x).toBe(galleryX);
  expect(player.y).toBe(galleryY);
  expect(player.actionPoints).toBe(0); // costs 1 AP, same rule as the collapsed room's jump

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: no actionIndex and a multi-action room throws INVALID_ACTION_INDEX without spending an action point', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', actions: [{ label: '搜索', kind: 'search' }, { label: '烹飪', kind: 'craft' }], craftRecipes: [{ id: 'recipe_cooked_food', ingredients: ['item_016', 'item_017'], result: 'item_021' }] }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve)); // no actionIndex
  expect(result.error).toBe('INVALID_ACTION_INDEX');
  expect(getPlayer(gameState, currentPlayerId).actionPoints).toBe(1); // unchanged

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: an out-of-range actionIndex throws INVALID_ACTION_INDEX', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', actions: [{ label: '搜索', kind: 'search' }, { label: '烹飪', kind: 'craft' }], craftRecipes: [{ id: 'recipe_cooked_food', ingredients: ['item_016', 'item_017'], result: 'item_021' }] }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 2 }, resolve));
  expect(result.error).toBe('INVALID_ACTION_INDEX');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: a two-action room (search + craft) can select search via actionIndex 0', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', item: 'random_one', actions: [{ label: '搜索', kind: 'search' }, { label: '烹飪', kind: 'craft' }], craftRecipes: [{ id: 'recipe_cooked_food', ingredients: ['item_016', 'item_017'], result: 'item_021' }] }],
  });
  content.cards.items = [{ id: 'item_001', name: '測試道具', effects: [] }];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action', actionIndex: 0 }, resolve));
  expect(result.error).toBeUndefined();
  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.cardId).toBe('item_001');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 3: 執行測試確認 RED**

Run: `cd server && npx jest test/socketHandlers.test.js -t "room_action" --forceExit`
Expected: 新增的測試 FAIL（`getRoomActions is not defined`／`INVALID_ACTION_INDEX` 相關斷言不符）；2f 的兩個新版跳下測試也 FAIL（此時 `performTeleport` 還沒被接上，`jumpIntoCollapsedRoom` 也已經在 Task 1 被移除，這裡呼叫會直接噴 `TypeError`，是預期中的失敗）

- [ ] **Step 4: 實作**

在 `server/src/socketHandlers.js` 的 `findRoomDefinition` 函式（第 558 行附近）之前新增：

```javascript
// 房間目前有效的行動清單。單一行動的房間（絕大多數）就是 roomDefinition.actions
// 本身（或程式碼層級預設的搜索）；崩塌的房間是唯一的例外，「跳下」這個 teleport
// 項目只有在已經有人摔下去過（collapseLink 存在）時才會出現。
function getRoomActions(roomDefinition, placedRoom) {
  const actions = (roomDefinition && Array.isArray(roomDefinition.actions) && roomDefinition.actions.length > 0)
    ? roomDefinition.actions
    : [{ label: '搜索', kind: 'search' }];
  return actions.filter((action) => {
    if (action.kind === 'teleport' && placedRoom.roomId === 'room_collapsed_room') {
      return Boolean(placedRoom.collapseLink);
    }
    return true;
  });
}
```

把 `if (actionType === 'room_action') { ... }` 整段（從 `const currentPlayer = getPlayer(gameState, playerId);` 到配對的結尾 `}`，也就是原本第 240-308 行左右）替換成：

```javascript
        if (actionType === 'room_action') {
          const currentPlayer = getPlayer(gameState, playerId);
          const placedRoom = gameState.board[currentPlayer.floor].get(coordKey(currentPlayer.x, currentPlayer.y));
          const roomDefinition = findRoomDefinition(content, placedRoom.roomId);
          const roomActions = getRoomActions(roomDefinition, placedRoom);

          if (roomActions.length === 0) {
            throw new Error('NO_ROOM_ACTION_AVAILABLE');
          }
          let actionIndex = 0;
          if (roomActions.length > 1) {
            actionIndex = payload && payload.actionIndex;
            if (!Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= roomActions.length) {
              throw new Error('INVALID_ACTION_INDEX');
            }
          }
          const chosenAction = roomActions[actionIndex];
          sourceId = placedRoom.roomId;

          if (chosenAction.kind === 'craft') {
            const heldIds = currentPlayer.inventory.map((item) => item.id);
            const recipe = (roomDefinition.craftRecipes || []).find((r) => r.ingredients.every((id) => heldIds.includes(id)));
            if (!recipe) {
              throw new Error('MISSING_CRAFT_MATERIALS');
            }
            sourceEffects = [{
              type: 'choice',
              description: '要不要進行烹飪？',
              timeoutMs: 20000,
              defaultOptionId: 'no',
              options: [
                {
                  optionId: 'yes',
                  label: '是',
                  effects: [
                    ...recipe.ingredients.map((itemId) => ({ type: 'lose_item', itemId })),
                    { type: 'grant_item', itemId: recipe.result },
                  ],
                },
                { optionId: 'no', label: '否', effects: [] },
              ],
            }];
            selectOptions.hasRoomAction = true;
            selectOptions.freeRoomAction = Boolean(chosenAction.freeAction);
          } else if (chosenAction.kind === 'effects') {
            sourceEffects = chosenAction.effects;
            selectOptions.hasRoomAction = true;
            selectOptions.freeRoomAction = Boolean(chosenAction.freeAction);
          } else if (chosenAction.kind === 'teleport') {
            selectOptions.hasRoomAction = true;
            selectOptions.freeRoomAction = Boolean(chosenAction.freeAction);
            const result = selectAction(gameState, playerId, actionType, selectOptions);
            ack(result);
            const destination = performTeleport(gameState, playerId);
            const enteredRoom = gameState.board[destination.floor].get(coordKey(destination.x, destination.y));
            io.to(roomCode).emit('game:roomEntered', { playerId, roomId: enteredRoom.roomId });
            io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
            return;
          } else {
            selectOptions.hasRoomAction = true;
            if (currentPlayer.searchedThisTurn) {
              throw new Error('ALREADY_SEARCHED_THIS_TURN');
            }
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
          }
        }
```

（這個替換拿掉了舊的「崩塌房間特例 bypass」——`if (placedRoom.roomId === 'room_collapsed_room' && placedRoom.collapseLink) { ... }`——那段邏輯現在收編進 `getRoomActions` 的過濾＋上面的 `teleport` 分支，不再需要獨立的特例判斷。）

同一個 socket handler 裡，`payload` 解構的那一行（`const { actionType, itemId, targetPlayerId, mode } = payload || {};`）維持不變——`actionIndex` 直接從 `payload` 讀（上面程式碼裡的 `payload && payload.actionIndex`），不需要加進解構。

- [ ] **Step 5: 執行測試確認 GREEN**

Run: `cd server && npx jest test/socketHandlers.test.js -t "room_action" --forceExit`
Expected: 全數 PASS

- [ ] **Step 6: 跑全套後端測試確認無回歸**

Run: `cd server && npx jest --forceExit`
Expected: 全數 PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: dispatch room_action through a per-room actions list (multi-action support)"
```

---

## Task 3: `rooms.json`／`starting-rooms.json` 資料遷移

**Files:**
- Modify: `data/rooms/rooms.json`
- Modify: `data/rooms/starting-rooms.json`

**Interfaces:**
- Consumes：無
- Produces：11 間房間改成新的 `actions` 結構化格式；`room_vault`／`room_collapsed_room`／`room_gallery`／`room_lobby_c`／`room_upper_landing` 的頂層 `effects`／`freeAction` 欄位移除（內容搬進 `actions` 對應項目）

- [ ] **Step 1: `data/rooms/rooms.json` 依序做以下編輯**

**9 間現有搜索房間**（`room_master_bedroom`／`room_game_room`／`room_larder`／`room_guest_1`／`room_gymnasium`／`room_weapon_room`／`room_baby`／`room_bathroom_ground`／`room_bathroom_upper`）：每一間都把
```
    "actions": ["搜索"],
```
改成：
```
    "actions": [{ "label": "搜索", "kind": "search" }],
```
（每間房間的 `"id"` 都是檔案內唯一字串，用來定位對應的區塊。）

**廚房**（`room_kitchen`）：把
```
    "actions": ["烹飪"],
    "craftRecipes": [
      { "id": "recipe_cooked_food", "ingredients": ["item_016", "item_017"], "result": "item_021" }
    ]
```
改成（新增搜索）：
```
    "actions": [
      { "label": "搜索", "kind": "search" },
      { "label": "烹飪", "kind": "craft" }
    ],
    "item": "random_one",
    "craftRecipes": [
      { "id": "recipe_cooked_food", "ingredients": ["item_016", "item_017"], "result": "item_021" }
    ]
```

**保險庫**（`room_vault`）：把
```
    "drawType": null,
    "text": "以知識能力進行考驗，若骰子點數大於等於六，視為成功開啟保險箱，可以抽取兩張物品牌，之後放置空蕩蕩標記",
    "effects": [
      {
        "type": "dice_check",
        "stat": "knowledge",
        "tiers": [
          {
            "min": 6,
            "max": 8,
            "effects": [
              {
                "type": "draw_card",
                "deck": "item",
                "count": 2
              }
            ]
          },
          {
            "min": 0,
            "max": 5,
            "effects": []
          }
        ]
      }
    ],
    "needsCustomLogic": true
```
改成（`effects` 陣列整個搬進新的 `actions` 裡的考驗項目）：
```
    "drawType": null,
    "text": "以知識能力進行考驗，若骰子點數大於等於六，視為成功開啟保險箱，可以抽取兩張物品牌，之後放置空蕩蕩標記",
    "item": "random_one",
    "actions": [
      { "label": "搜索", "kind": "search" },
      {
        "label": "考驗",
        "kind": "effects",
        "effects": [
          {
            "type": "dice_check",
            "stat": "knowledge",
            "tiers": [
              {
                "min": 6,
                "max": 8,
                "effects": [
                  {
                    "type": "draw_card",
                    "deck": "item",
                    "count": 2
                  }
                ]
              },
              {
                "min": 0,
                "max": 5,
                "effects": []
              }
            ]
          }
        ]
      }
    ],
    "needsCustomLogic": true
```

**崩塌的房間**（`room_collapsed_room`）：找到這個房間目前的區塊（目前完全沒有 `actions`/`item` 欄位），在 `needsCustomLogic` 那一行之後新增：
```
    "actions": [
      { "label": "搜索", "kind": "search" },
      { "label": "跳下", "kind": "teleport" }
    ],
    "item": "random_one",
```
（確切插入位置：跟其他房間一樣接在 `needsCustomLogic` 欄位之後、區塊結尾 `}` 之前；用 `"id": "room_collapsed_room"` 定位這個區塊。）

**包廂房**（`room_gallery`）：同樣找到這個房間目前的區塊（目前也完全沒有 `actions`/`item` 欄位），新增：
```
    "actions": [
      { "label": "搜索", "kind": "search" },
      { "label": "跳下", "kind": "teleport" }
    ],
    "item": "random_one",
```

- [ ] **Step 2: `data/rooms/starting-rooms.json` 依序做以下編輯**

**LobbyC**（`room_lobby_c`）：把目前的
```
    "effects": [{ "type": "move_to_room", "targetRoomId": "room_upper_landing" }],
    "freeAction": true
```
改成：
```
    "actions": [
      { "label": "上樓", "kind": "effects", "effects": [{ "type": "move_to_room", "targetRoomId": "room_upper_landing" }], "freeAction": true },
      { "label": "下樓", "kind": "effects", "effects": [{ "type": "move_to_room", "targetRoomId": "room_basement_landing" }], "freeAction": true }
    ]
```

**二樓平台**（`room_upper_landing`）：把目前的
```
    "effects": [{ "type": "move_to_room", "targetRoomId": "room_lobby_c" }],
    "freeAction": true
```
改成：
```
    "actions": [
      { "label": "下樓", "kind": "effects", "effects": [{ "type": "move_to_room", "targetRoomId": "room_lobby_c" }], "freeAction": true }
    ]
```

（這兩個房間的確切格式已於計畫撰寫時用 `Read` 工具驗證過，跟上面描述一致，是多行縮排的 JSON——`room_lobby_c` 另外還有 `"stairsTo": "room_upper_landing"` 欄位，這是另一個獨立、目前計畫不會動到的既有欄位，編輯時保留不動。）

- [ ] **Step 3: 驗證 JSON 合法且欄位正確**

Run:
```bash
cd "C:\Users\User\Desktop\Betrayal at House on the Hill"
node -e "
const rooms = require('./data/rooms/rooms.json');
const starting = require('./data/rooms/starting-rooms.json');
const searchOnly = ['room_master_bedroom','room_game_room','room_larder','room_guest_1','room_gymnasium','room_weapon_room','room_baby','room_bathroom_ground','room_bathroom_upper'];
for (const id of searchOnly) {
  const r = rooms.find(x => x.id === id);
  const ok = Array.isArray(r.actions) && r.actions.length === 1 && r.actions[0].kind === 'search';
  console.log(id, ok ? 'OK' : 'MISMATCH: ' + JSON.stringify(r.actions));
}
const kitchen = rooms.find(x => x.id === 'room_kitchen');
console.log('room_kitchen', (kitchen.actions.length === 2 && kitchen.actions[0].kind === 'search' && kitchen.actions[1].kind === 'craft' && kitchen.item === 'random_one') ? 'OK' : 'MISMATCH: ' + JSON.stringify(kitchen.actions));
const vault = rooms.find(x => x.id === 'room_vault');
console.log('room_vault', (vault.actions.length === 2 && vault.actions[1].kind === 'effects' && vault.actions[1].effects[0].type === 'dice_check' && vault.effects === undefined) ? 'OK' : 'MISMATCH: ' + JSON.stringify(vault.actions) + ' effects:' + JSON.stringify(vault.effects));
const collapsed = rooms.find(x => x.id === 'room_collapsed_room');
console.log('room_collapsed_room', (collapsed.actions.length === 2 && collapsed.actions[1].kind === 'teleport' && collapsed.item === 'random_one') ? 'OK' : 'MISMATCH: ' + JSON.stringify(collapsed.actions));
const gallery = rooms.find(x => x.id === 'room_gallery');
console.log('room_gallery', (gallery.actions.length === 2 && gallery.actions[1].kind === 'teleport' && gallery.item === 'random_one') ? 'OK' : 'MISMATCH: ' + JSON.stringify(gallery.actions));
const lobbyC = starting.find(x => x.id === 'room_lobby_c') || (starting.rooms || []).find(x => x.id === 'room_lobby_c');
console.log('room_lobby_c', (lobbyC.actions.length === 2 && lobbyC.actions[0].freeAction === true && lobbyC.actions[1].freeAction === true && lobbyC.effects === undefined) ? 'OK' : 'MISMATCH: ' + JSON.stringify(lobbyC.actions));
const upperLanding = starting.find(x => x.id === 'room_upper_landing') || (starting.rooms || []).find(x => x.id === 'room_upper_landing');
console.log('room_upper_landing', (upperLanding.actions.length === 1 && upperLanding.actions[0].freeAction === true && upperLanding.effects === undefined) ? 'OK' : 'MISMATCH: ' + JSON.stringify(upperLanding.actions));
"
```
Expected: 全部印出 `OK`

- [ ] **Step 4: 跑全套後端測試確認無回歸**

Run: `cd server && npx jest --forceExit`
Expected: 全數 PASS（真實內容資料異動，Task 1/2 已經確保程式邏輯正確，這裡純粹確認資料格式沒有打錯字/漏欄位）

- [ ] **Step 5: Commit**

```bash
git add data/rooms/rooms.json data/rooms/starting-rooms.json
git commit -m "data(rooms): migrate actions to structured format, add vault/collapsed-room/gallery search+teleport, LobbyC down-stairs"
```

---

## Task 4: 前端多重行動選單

**Files:**
- Modify: `client/src/gameplay/mapUtils.js`
- Modify: `client/src/DebugGameScreen.jsx`

**Interfaces:**
- Consumes：伺服器透過 `roomContent`（既有的一次性靜態房間資料廣播）送出的 `actions` 欄位；`gameState.board[floor]` 裡目前房間實體的 `collapseLink`（既有欄位，未被序列化剔除，前端本來就看得到）
- Produces：`mapUtils.js` 新增 `getRoomActions(roomDefinition, placedRoom)`（跟伺服器 `socketHandlers.js` 的同名函式邏輯一致，前端自己重算一份，不新增 socket 事件）

- [ ] **Step 1: 寫失敗測試——這個專案的前端沒有自動化測試套件**（`client/package.json` 只有 `build`），驗證方式是 `npm run build` 成功＋後續手動瀏覽器驗證，這個任務跳過 TDD 的 RED/GREEN 步驟，直接進行實作。

- [ ] **Step 2: 在 `mapUtils.js` 新增 `getRoomActions`**

在 `client/src/gameplay/mapUtils.js` 裡，找到 `findCardInfo` 函式定義之後，新增：

```javascript
// 跟伺服器 socketHandlers.js 的 getRoomActions 同一套邏輯，前端自己重算一份
// （不新增 socket 事件）。roomDefinition 來自 roomContent（一次性靜態資料），
// placedRoom 是 gameState.board[floor] 裡目前房間的實體（含 collapseLink）。
function getRoomActions(roomDefinition, placedRoom) {
  const actions = (roomDefinition && Array.isArray(roomDefinition.actions) && roomDefinition.actions.length > 0)
    ? roomDefinition.actions
    : [{ label: '搜索', kind: 'search' }];
  return actions.filter((action) => {
    if (action.kind === 'teleport' && placedRoom.roomId === 'room_collapsed_room') {
      return Boolean(placedRoom.collapseLink);
    }
    return true;
  });
}
```

在檔案結尾的 `export { ... }` 裡加入 `getRoomActions`。

- [ ] **Step 3: `DebugGameScreen.jsx` 接上選單**

在 `client/src/DebugGameScreen.jsx` 的 import 那一行：
```javascript
import { getAvailableDirections, findRoomInfo, findCardInfo, STAT_LABELS } from './gameplay/mapUtils';
```
改成：
```javascript
import { getAvailableDirections, findRoomInfo, findCardInfo, getRoomActions, STAT_LABELS } from './gameplay/mapUtils';
```

新增一個 state（放在既有的 `useState` 群組裡，例如 `pendingRollChoice` 那一行附近）：
```javascript
  const [showRoomActionMenu, setShowRoomActionMenu] = useState(false);
```

找到「Precomputed once for the playing-phase render」那個區塊（`let me, currentRoom, hasRoomForFloor, directions, roommates;`），在 `roommates = ...` 那一行之後新增：
```javascript
    roomActions = roomContent ? getRoomActions(findRoomInfo(currentRoom.roomId, roomContent), currentRoom) : [];
```
並把該區塊開頭的 `let` 宣告加上 `roomActions`：
```javascript
  let me, currentRoom, hasRoomForFloor, directions, roommates, roomActions;
```

找到「行動」按鈕（`<button style={cornerButtonStyle('top-left')} onClick={() => handleSelectAction('room_action')}>行動</button>`），改成：
```javascript
              <button
                style={cornerButtonStyle('top-left')}
                onClick={() => (roomActions.length > 1 ? setShowRoomActionMenu(true) : handleSelectAction('room_action'))}
              >
                行動
              </button>
```

在 `handleSelectAction` 函式定義之後（或任何合理位置），新增一個處理選單點選的函式：
```javascript
  function handleChooseRoomAction(actionIndex) {
    setShowRoomActionMenu(false);
    handleSelectAction('room_action', { actionIndex });
  }
```

在既有的 `{(pendingEffectChoice || pendingRollChoice) && ( ... )}` 彈窗區塊**之前**（同樣是 `phase === 'playing'` 那個大區塊內，`FocusedRoomView`/角落按鈕群那個 `div` 結束之後、`CharacterPanel` 之前都可以，只要跟其他彈窗同一層級），新增：
```javascript
          {showRoomActionMenu && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 60,
              }}
              onClick={() => setShowRoomActionMenu(false)}
            >
              <div style={{ backgroundColor: '#fff', padding: 16, borderRadius: 8, minWidth: 200 }} onClick={(e) => e.stopPropagation()}>
                <p style={{ fontWeight: 'bold', marginBottom: 8 }}>選擇行動</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {roomActions.map((action, i) => (
                    <button key={i} onClick={() => handleChooseRoomAction(i)}>
                      {action.label}
                    </button>
                  ))}
                  <button onClick={() => setShowRoomActionMenu(false)}>取消</button>
                </div>
              </div>
            </div>
          )}
```

- [ ] **Step 4: 驗證 build 通過**

Run: `cd client && npm run build`
Expected: 成功（無語法錯誤）

- [ ] **Step 5: Commit**

```bash
git add client/src/gameplay/mapUtils.js client/src/DebugGameScreen.jsx
git commit -m "feat: show a room-action picker menu when a room offers 2+ actions"
```

---

## 全部任務完成後：手動驗證

1. 關閉並重啟本機測試伺服器（後端 `server/src/index.js`、前端 `client`）
2. 雙人建房→選角→進遊戲：
   - 廚房：按「行動」跳出「搜索」／「烹飪」選單，兩個都能分別正確觸發
   - 保險庫：按「行動」跳出「搜索」／「考驗」選單
   - LobbyC：按「行動」跳出「上樓」／「下樓」選單，都不扣行動力
   - 一般單一搜索房間（例如武器室）：按「行動」直接搜索，不跳選單（維持既有手感）
3. 崩塌的房間：故意觸發摔落考驗失敗（或用除錯手段調整骰值），確認摔落當下不跳「跳下」選單（那是移動本身的必然效果）；摔落之後，另一位玩家（或同一位玩家下回合）走到同一個崩塌房間，按「行動」應該跳出「搜索」／「跳下」選單，選「跳下」扣 1 點行動力、正確傳送到地下室
4. 包廂房：走到包廂房，按「行動」跳出「搜索」／「跳下」選單，選「跳下」扣 1 點行動力、正確傳送到配對的舞廳（不套用任何傷害，這是已知留給 M3 的缺口）
5. 檢查 console 無錯誤
