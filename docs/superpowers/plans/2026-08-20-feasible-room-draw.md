# 先判斷合理房型再抽房間卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 開門進入新房間時，優先抽一張門型（門數/`doorPattern`）在目前位置不需要退化就能放置的房間卡，減少「房間強制退化成單門房」的情況。

**Architecture:** `boardGenerator.js` 新增 `isDoorLayoutFeasible`，直接重用既有的 `computeDoorLayout` 引擎當作可行性檢查器；`roomDeck.js` 新增 `drawFeasibleRoom`，比照既有 `drawRoom` 的「依序檢查、對不到就搬到牌堆尾端」寫法，多加一個可行性判斷條件，找不到就退回原本的 `drawRoom`；`turnFlow.js` 的 `moveToRoom` 把兩處既有的 `drawRoom` 呼叫換成 `drawFeasibleRoom`。

**Tech Stack:** Node.js（伺服器，Jest 測試），純 JavaScript，本次改動完全在伺服器端，不涉及前端。

## Global Constraints

- 只改主要開門路徑（`turnFlow.js` 的 `moveToRoom`）。崩塌房間掉落地下室的生成（`applyCollapseCheck`）維持原樣不動。
- 可行性判斷**直接重用** `computeDoorLayout`，不另外實作一套判斷邏輯：呼叫 `computeDoorLayout(doors, entrySide, getNeighborRequirement, doorPattern)`，如果回傳的門位集合大小等於 `doors`，代表可行；小於 `doors` 代表會被 `computeDoorLayout` 既有的退化 fallback 影響，代表不可行。
- 抽卡方式維持依片庫（洗牌後）順序依序檢查，對不到（樓層不合或門型不可行）就搬到牌堆尾端、換下一張——不改成「先篩選全部符合的卡、再隨機抽」。
- 整副牌都找不到「樓層對、門型又可行」的卡時，退回既有的 `drawRoom(deck, floor)` 行為（只看樓層，不管門型），讓 `computeDoorLayout` 依原本的退化 fallback 處理，不拋錯、不視為異常。
- 舞廳/包廂配對的既有重抽迴圈（配對座標衝突時的重抽）邏輯不變，只是重抽時呼叫新的 `drawFeasibleRoom` 取代原本的 `drawRoom`；`hasRoomForFloor`（判斷牌庫是否還有這個樓層的卡）維持只看卡片數量，不牽扯門型可行性。
- `getAvailableDirections`（決定要不要顯示「開門」選項）不需要修改。
- 前端完全不需要改動。

---

## Task 1: 可行性檢查（`boardGenerator.js`）

**Files:**
- Modify: `server/src/game/boardGenerator.js`
- Test: `server/test/game/boardGenerator.test.js`

**Interfaces:**
- Produces: `isDoorLayoutFeasible(board, floor, fromCoord, direction, doors, doorPattern)` — 回傳布林值。參數形狀比照既有的 `placeNewRoom(board, floor, fromCoord, direction, roomDefinition)`，但最後兩個參數直接是 `doors`/`doorPattern`（不是整個 `roomDefinition`），讓呼叫端可以在還沒決定要用哪張房間卡之前，先針對「候選的門數/門型」單獨測試可行性。Task 3 會呼叫這個函式。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/boardGenerator.test.js` 檔案最後面新增：

```js
test('isDoorLayoutFeasible returns true when the room type can be placed without degrading', () => {
  const board = createBoard(STARTING_ROOMS);
  // (5,5) -> east -> target (6,5), entrySide 'west'. No neighbors placed
  // anywhere near (6,5) on a fresh board, so doorPattern:'opposite' can
  // freely put its extra door on 'east' (the only candidate) with no conflict.
  const feasible = isDoorLayoutFeasible(board, 'ground', { x: 5, y: 5 }, 'east', 2, 'opposite');
  expect(feasible).toBe(true);
});

test('isDoorLayoutFeasible returns false when computeDoorLayout would have to degrade to entry-only', () => {
  const board = createBoard(STARTING_ROOMS);
  // Target coord (6,5) via 'east' from (5,5): entrySide is 'west'. A neighbor
  // placed south of the target, with a door facing back north, forces a
  // 'door' requirement on the target's south side. doorPattern:'opposite'
  // only ever offers 'east' as the extra door (opposite of the west entry) --
  // an irreconcilable conflict, so computeDoorLayout falls back to
  // entry-only (real doorSides = {west}, size 1, not 2).
  board.ground.set(coordKey(6, 6), { roomId: 'room_neighbor', x: 6, y: 6, doorSides: ['north'] });
  const feasible = isDoorLayoutFeasible(board, 'ground', { x: 5, y: 5 }, 'east', 2, 'opposite');
  expect(feasible).toBe(false);
});
```

Also add `isDoorLayoutFeasible` to the destructured import at the top of the test file:

```js
const { createBoard, placeNewRoom, placeRoomAt, placeAtRandomOpenDoor, coordKey, canMoveBetween, isDoorLayoutFeasible } = require('../../src/game/boardGenerator');
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/boardGenerator.test.js -t "isDoorLayoutFeasible"`
Expected: FAIL（`isDoorLayoutFeasible is not a function`）

- [ ] **Step 3: 實作 `isDoorLayoutFeasible`**

在 `server/src/game/boardGenerator.js`，找到 `placeRoomAt` 函式結尾（目前約在第 168 行）跟 `function shuffle` 之間：

```js
  grid.set(key, placedRoom);
  return placedRoom;
}

function shuffle(array) {
```

在兩者之間插入：

```js
  grid.set(key, placedRoom);
  return placedRoom;
}

// 檢查「如果把一個 doors/doorPattern 這樣的房型放在 fromCoord+direction 這個位置，
// computeDoorLayout 會不會需要退化成只剩入口一扇門」。直接重用 computeDoorLayout
// 本身當可行性檢查器（跟 placeNewRoom/placeRoomAt 用的是同一套引擎），不是另外實作
// 一套判斷邏輯，這樣可行性判斷永遠跟實際放置時的引擎結果一致。
function isDoorLayoutFeasible(board, floor, fromCoord, direction, doors, doorPattern) {
  const grid = board[floor];
  const delta = DIRECTION_DELTA[direction];
  const targetCoord = { x: fromCoord.x + delta.dx, y: fromCoord.y + delta.dy };
  const entrySide = OPPOSITE_SIDE[direction];
  const getNeighborRequirement = makeNeighborRequirementReader(grid, targetCoord);
  const doorSides = computeDoorLayout(doors, entrySide, getNeighborRequirement, doorPattern || null);
  return doorSides.size === doors;
}

function shuffle(array) {
```

找到檔案最後的 `module.exports`（目前約在第 235-244 行）：

```js
module.exports = {
  createBoard,
  placeNewRoom,
  placeRoomAt,
  placeAtRandomOpenDoor,
  coordKey,
  canMoveBetween,
  DIRECTION_DELTA,
  FLOORS,
};
```

改成：

```js
module.exports = {
  createBoard,
  placeNewRoom,
  placeRoomAt,
  placeAtRandomOpenDoor,
  coordKey,
  canMoveBetween,
  isDoorLayoutFeasible,
  DIRECTION_DELTA,
  FLOORS,
};
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/boardGenerator.test.js`
Expected: PASS，全部測試（含新增的 2 個）都綠燈

- [ ] **Step 5: Commit**

```bash
cd server
git add src/game/boardGenerator.js test/game/boardGenerator.test.js
git commit -m "feat: add isDoorLayoutFeasible to check a room type against existing neighbors before drawing"
```

---

## Task 2: 篩選抽卡（`roomDeck.js`）

**Files:**
- Modify: `server/src/game/roomDeck.js`
- Test: `server/test/game/roomDeck.test.js`

**Interfaces:**
- Consumes: 無（`isFeasible` 是呼叫端傳入的純函式參數，這個檔案不依賴 Task 1 的具體實作）
- Produces: `drawFeasibleRoom(deck, floor, isFeasible)` — `isFeasible` 是 `(room) => boolean` 的函式。回傳值跟既有 `drawRoom(deck, floor)` 一樣是一個房間定義物件，同樣會把抽到的卡從牌堆移除。Task 3 會呼叫這個函式。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/roomDeck.test.js` 檔案最後面新增：

```js
test('drawFeasibleRoom returns the first room matching both floor and the isFeasible predicate, cycling non-matches to the back', () => {
  const rooms = [
    { id: 'g_bad', doors: 4, floor: 'ground' },
    { id: 'u_ok', doors: 4, floor: 'upper' },
    { id: 'g_ok', doors: 2, floor: 'ground' },
  ];
  const deck = createRoomDeck(rooms);
  const isFeasible = (room) => room.id === 'g_ok';
  const drawn = drawFeasibleRoom(deck, 'ground', isFeasible);
  expect(drawn.id).toBe('g_ok');
  expect(getRemainingCount(deck)).toBe(2);
  expect(deck.cards.some((r) => r.id === 'g_bad')).toBe(true);
  expect(deck.cards.some((r) => r.id === 'u_ok')).toBe(true);
});

test('drawFeasibleRoom falls back to a plain floor-matching draw when no remaining card satisfies isFeasible', () => {
  const rooms = [
    { id: 'g1', doors: 2, floor: 'ground' },
    { id: 'g2', doors: 3, floor: 'ground' },
  ];
  const deck = createRoomDeck(rooms);
  const isFeasible = () => false; // nothing is ever feasible
  const drawn = drawFeasibleRoom(deck, 'ground', isFeasible);
  expect(['g1', 'g2']).toContain(drawn.id);
  expect(getRemainingCount(deck)).toBe(1);
});

test('drawFeasibleRoom throws ROOM_DECK_EMPTY when no card matches the floor at all, delegating to drawRoom', () => {
  const deck = createRoomDeck(makeRooms(2, 'upper'));
  expect(() => drawFeasibleRoom(deck, 'ground', () => true)).toThrow('ROOM_DECK_EMPTY');
});
```

Also add `drawFeasibleRoom` to the destructured import at the top of the test file:

```js
const { createRoomDeck, drawRoom, drawFeasibleRoom, isRoomDeckEmpty, getRemainingCount, hasRoomForFloor, removeRoomById } = require('../../src/game/roomDeck');
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/roomDeck.test.js -t "drawFeasibleRoom"`
Expected: FAIL（`drawFeasibleRoom is not a function`）

- [ ] **Step 3: 實作 `drawFeasibleRoom`**

在 `server/src/game/roomDeck.js`，找到 `drawRoom` 函式結尾（目前約在第 36-53 行）：

```js
function drawRoom(deck, floor) {
  if (!FLOORS.includes(floor)) {
    throw new Error('INVALID_FLOOR');
  }
  if (isRoomDeckEmpty(deck)) {
    throw new Error('ROOM_DECK_EMPTY');
  }
  const attempts = deck.cards.length;
  for (let i = 0; i < attempts; i++) {
    const room = deck.cards.shift();
    if (room.floor === floor || room.floor === 'any') {
      return room;
    }
    deck.cards.push(room); // put back at bottom, try the next card
  }
  // Cycled through every remaining card and none matched this floor.
  throw new Error('ROOM_DECK_EMPTY');
}
```

在它後面（`removeRoomById` 之前）新增：

```js
// 跟 drawRoom 一樣依片庫（洗牌後）順序依序檢查，只是多一個 isFeasible(room) 判斷
// 條件（樓層跟可行性都要符合才會被抽出）。整副牌試過一輪都找不到符合的卡時，直接
// 呼叫既有的 drawRoom(deck, floor) 退回原本行為（只看樓層），讓後續的門位配置演算法
// 依原本的退化 fallback 處理。這一輪失敗的搜尋不會弄亂牌堆順序：每張牌被 shift()
// 之後如果不符合就 push() 回尾端，一輪跑完（attempts 次）陣列會剛好繞回原本的順序。
function drawFeasibleRoom(deck, floor, isFeasible) {
  const attempts = deck.cards.length;
  for (let i = 0; i < attempts; i++) {
    const room = deck.cards.shift();
    if ((room.floor === floor || room.floor === 'any') && isFeasible(room)) {
      return room;
    }
    deck.cards.push(room);
  }
  return drawRoom(deck, floor);
}
```

找到檔案最後的 `module.exports`：

```js
module.exports = { createRoomDeck, drawRoom, isRoomDeckEmpty, getRemainingCount, hasRoomForFloor, removeRoomById };
```

改成：

```js
module.exports = { createRoomDeck, drawRoom, drawFeasibleRoom, isRoomDeckEmpty, getRemainingCount, hasRoomForFloor, removeRoomById };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/roomDeck.test.js`
Expected: PASS，全部測試（含新增的 3 個）都綠燈

- [ ] **Step 5: Commit**

```bash
cd server
git add src/game/roomDeck.js test/game/roomDeck.test.js
git commit -m "feat: add drawFeasibleRoom to prefer a room type that satisfies the target coordinate's neighbor constraints"
```

---

## Task 3: 串接進 `moveToRoom`（`turnFlow.js`）

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: Task 1 的 `isDoorLayoutFeasible(board, floor, fromCoord, direction, doors, doorPattern)`、Task 2 的 `drawFeasibleRoom(deck, floor, isFeasible)`。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/turnFlow.test.js` 檔案最後面新增：

```js
test('moveToRoom opens a door: prefers a room type that avoids computeDoorLayout degrading to entry-only, when a feasible alternative exists in the deck', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0); // deterministic shuffle throughout this test
  const { gameState, player } = makeGameStateWithPlayer([
    { id: 'room_good', doors: 3, floor: 'ground' },
    { id: 'room_bad', doors: 2, doorPattern: 'opposite', floor: 'ground' },
  ]);
  // A pre-placed neighbor south of the target coordinate (1,1) requires a
  // door on that side (its own north side has a door facing back). room_bad's
  // doorPattern:'opposite' can only ever put its extra door on the east side
  // (opposite of the west entry from moving 'east'), so it can never satisfy
  // this and would degrade to entry-only if it were drawn and placed.
  // room_good (doors:3, no doorPattern restriction) can satisfy it. With
  // Math.random mocked to 0, the deck's shuffle deterministically puts
  // room_bad first -- proving drawFeasibleRoom actually skips it rather than
  // just happening to draw room_good anyway.
  gameState.board.ground.set(coordKey(1, 2), { roomId: 'room_neighbor', x: 1, y: 2, doorSides: ['north'] });
  const result = moveToRoom(gameState, 'p1', 'east');
  expect(result.roomId).toBe('room_good');
  expect(player.actionPoints).toBe(2); // startingAP 4 - OPEN_DOOR_AP_COST 2
  const placedRoom = gameState.board.ground.get(coordKey(1, 1));
  expect(placedRoom.doorSides).toHaveLength(3); // did not degrade to entry-only
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/turnFlow.test.js -t "prefers a room type"`
Expected: FAIL（`result.roomId` 會是 `'room_bad'`，不是 `'room_good'` —— 目前的 `drawRoom` 不會跳過門型不可行的卡）

- [ ] **Step 3: 串接 `drawFeasibleRoom`**

在 `server/src/game/turnFlow.js`，找到檔案最上面的 import（目前第 2-3 行）：

```js
const { canMoveBetween, placeNewRoom, placeRoomAt, placeAtRandomOpenDoor, coordKey, DIRECTION_DELTA } = require('./boardGenerator');
const { drawRoom, hasRoomForFloor, removeRoomById } = require('./roomDeck');
```

改成：

```js
const { canMoveBetween, placeNewRoom, placeRoomAt, placeAtRandomOpenDoor, coordKey, DIRECTION_DELTA, isDoorLayoutFeasible } = require('./boardGenerator');
const { drawRoom, drawFeasibleRoom, hasRoomForFloor, removeRoomById } = require('./roomDeck');
```

（`drawRoom` 保留匯入不動——`applyCollapseCheck` 那邊的地下室生成仍然使用它，這次不改。）

找到 `moveToRoom` 函式裡的這段（目前約在第 137-152 行）：

```js
  // 舞廳 & 包廂房 -- drawing either one must also place its pair at the same
  // (x, y) on the paired floor. If that coordinate is already occupied, the
  // whole draw is rejected (card goes back to the bottom of the deck) and a
  // different card is drawn instead -- unless this was the last card
  // available for this floor, in which case the draw is allowed through and
  // the pair falls back to a random open door on its own floor instead of
  // insisting on the same coordinate (handled in placeBallroomGalleryPair).
  let roomDefinition = drawRoom(gameState.roomDeck, player.floor);
  while (isBallroomOrGallery(roomDefinition.id)) {
    const pairedFloor = pairedFloorFor(roomDefinition.id);
    const pairedOccupied = gameState.board[pairedFloor].has(coordKey(targetCoord.x, targetCoord.y));
    if (!pairedOccupied) break;
    if (!hasRoomForFloor(gameState.roomDeck, player.floor)) break; // last card for this floor -- let it through anyway
    gameState.roomDeck.cards.push(roomDefinition); // rejected -- back to the bottom, draw again
    roomDefinition = drawRoom(gameState.roomDeck, player.floor);
  }
```

改成：

```js
  // 舞廳 & 包廂房 -- drawing either one must also place its pair at the same
  // (x, y) on the paired floor. If that coordinate is already occupied, the
  // whole draw is rejected (card goes back to the bottom of the deck) and a
  // different card is drawn instead -- unless this was the last card
  // available for this floor, in which case the draw is allowed through and
  // the pair falls back to a random open door on its own floor instead of
  // insisting on the same coordinate (handled in placeBallroomGalleryPair).
  const isFeasible = (room) =>
    isDoorLayoutFeasible(gameState.board, player.floor, { x: player.x, y: player.y }, direction, room.doors, room.doorPattern);
  let roomDefinition = drawFeasibleRoom(gameState.roomDeck, player.floor, isFeasible);
  while (isBallroomOrGallery(roomDefinition.id)) {
    const pairedFloor = pairedFloorFor(roomDefinition.id);
    const pairedOccupied = gameState.board[pairedFloor].has(coordKey(targetCoord.x, targetCoord.y));
    if (!pairedOccupied) break;
    if (!hasRoomForFloor(gameState.roomDeck, player.floor)) break; // last card for this floor -- let it through anyway
    gameState.roomDeck.cards.push(roomDefinition); // rejected -- back to the bottom, draw again
    roomDefinition = drawFeasibleRoom(gameState.roomDeck, player.floor, isFeasible);
  }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: PASS，全部測試都綠燈（既有的舞廳/包廂配對測試不需要修改——那些測試用的房間定義多半沒有宣告 `doorPattern`、放在乾淨的盤面上，`isFeasible` 對它們自然回傳 `true`，`drawFeasibleRoom` 的行為等同原本的 `drawRoom`）

- [ ] **Step 5: 執行完整後端測試套件確認沒有回歸**

Run: `cd server && npx jest`
Expected: PASS，全部測試套件都綠燈

- [ ] **Step 6: Commit**

```bash
cd server
git add src/game/turnFlow.js test/game/turnFlow.test.js
git commit -m "feat: prefer a door-feasible room type when opening a new door"
```
