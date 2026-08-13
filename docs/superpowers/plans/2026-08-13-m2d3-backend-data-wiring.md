# M2D3 後端資料串接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補齊 M2D3（遊戲進行畫面）前端骨架需要、但目前完全沒有的三項後端資料：房間靜態內容（名稱等）、可推導「目前房間四個方向門狀態」用的房間牌庫分樓層剩餘資料、玩家個人探索房間紀錄。

**Architecture:** 三項改動彼此獨立、互不依賴，都是既有序列化/廣播邏輯的小幅擴充，不新增 socket 事件、不新增資料表。房間內容比照角色選擇畫面已經在用的模式（伺服器把完整內容陣列送給前端一次）；門狀態改用「小幅擴充廣播資料＋前端自己算」而非伺服器逐位玩家推播（見設計文件的技術決策）；探索紀錄比照 `inventory` 現有慣例，整包 player 物件既有的方式廣播，不做每人隱私過濾。

**Tech Stack:** Node.js + Jest（既有測試框架），CommonJS，無 TypeScript。

## Global Constraints

- 沿用專案既有輸入驗證慣例：不合法輸入一律拋自訂 `Error`（`UPPER_SNAKE_CASE` 訊息），本計畫三項改動皆無新增輸入驗證需求（都是唯讀衍生資料）
- 不新增任何 npm 依賴
- 每個任務完成後執行對應測試檔，確保全數通過才進下一個任務
- 本計畫只做後端資料串接，不涉及任何前端程式碼（前端骨架是下一份獨立計畫）

---

### Task 1：`game:started` 廣播房間靜態內容

**Files:**
- Modify: `server/src/socketHandlers.js`（`finishCharacterSelection` 函式內，`game:started` 的 `emit` 呼叫）
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Produces：`game:started` 廣播 payload 新增 `roomContent: {rooms, startingRooms}` 欄位（`rooms`/`startingRooms` 就是伺服器啟動時載入的 `content.rooms`/`content.startingRooms`，未經篩選的完整陣列）

- [ ] **Step 1：找到現有的 `game:started` 廣播程式碼**

`server/src/socketHandlers.js` 裡的 `finishCharacterSelection` 函式，目前結尾是：

```js
  const gameState = startGame(gameManager, roomCode, {
    startingRooms: content.startingRooms,
    rooms: content.rooms,
    cards: content.cards,
    characters: content.characters,
    players,
  });
  startResolver(effectResolverManager, roomCode);
  endSelection(characterSelectionManager, roomCode);
  io.to(roomCode).emit('game:started', serializeGameState(gameState));
```

- [ ] **Step 2：先寫失敗的測試**

在 `server/test/socketHandlers.test.js` 找到這個既有測試（測試名稱為 `'game:startCharacterSelect full flow: host triggers, both players get prompted in turn, game starts'`，大約在檔案第 383 行開始），在這幾行之後：

```js
  const startedPayload = await gameStarted;
  expect(startedPayload.players).toHaveLength(2);
  expect(startedPayload.turnOrder.slice().sort()).toEqual([aliceId, bobId].sort());
```

新增以下斷言（用的是這個測試檔頂端 `makeContent()` 回傳的預設內容，`rooms`/`startingRooms` 陣列內容固定）：

```js
  expect(startedPayload.roomContent).toEqual({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground' }],
    startingRooms: [
      { id: 'room_entrance_hall', name: '大門廳', floor: 'ground' },
      { id: 'room_foyer', name: '廊廳', floor: 'ground' },
      { id: 'room_grand_staircase', name: '梯廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
    ],
  });
```

- [ ] **Step 3：執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -t "game:startCharacterSelect full flow" --forceExit`
Expected: FAIL，`startedPayload.roomContent` 是 `undefined`

（這個測試檔案跑完 Jest 進程不會自然結束是已知環境問題，跟這次改動無關，務必加 `--forceExit`，見 Handover 除錯注意事項）

- [ ] **Step 4：實作**

把 `finishCharacterSelection` 結尾的 `emit` 那一行改成：

```js
  io.to(roomCode).emit('game:started', {
    ...serializeGameState(gameState),
    roomContent: { rooms: content.rooms, startingRooms: content.startingRooms },
  });
```

- [ ] **Step 5：執行測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "game:startCharacterSelect full flow" --forceExit`
Expected: PASS

- [ ] **Step 6：跑整個 socketHandlers 測試檔確認沒有連帶壞掉**

Run: `cd server && npx jest test/socketHandlers.test.js --forceExit`
Expected: 全數 PASS

- [ ] **Step 7：Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(m2d3): broadcast room content on game:started"
```

---

### Task 2：`serializeGameState` 新增分樓層房間牌庫剩餘資料

**Files:**
- Modify: `server/src/game/gameState.js`
- Test: `server/test/game/gameState.test.js`

**Interfaces:**
- Consumes：`hasRoomForFloor(deck, floor)`（`server/src/game/roomDeck.js` 既有 export，簽章 `(deck, 'ground'|'upper') => boolean`）
- Produces：`serializeGameState(gameState).roomDeck` 新增 `hasRoomForGround`/`hasRoomForUpper` 兩個布林欄位（前端會用這兩個欄位＋房間 `doorSides`＋鄰居房間是否已存在，自行推算「目前房間四個方向的門狀態」，邏輯對應 `server/src/game/turnFlow.js` 的 `getAvailableDirections`，這是本計畫刻意的架構決策：不新增逐玩家推播事件，改由前端用這份公開資料自己算，見設計文件）

- [ ] **Step 1：先寫失敗的測試**

在 `server/test/game/gameState.test.js`，把既有這個測試（第 86-91 行）：

```js
test('serializeGameState exposes only remainingCount/isEmpty for the room deck, not its contents', () => {
  const gameState = createGameState(STARTING_ROOMS, makeDrawableRooms(3));
  const serialized = serializeGameState(gameState);
  expect(serialized.roomDeck).toEqual({ remainingCount: 3, isEmpty: false });
  expect(serialized.roomDeck.cards).toBeUndefined();
});
```

改成：

```js
test('serializeGameState exposes remainingCount/isEmpty/hasRoomForGround/hasRoomForUpper for the room deck, not its contents', () => {
  const gameState = createGameState(STARTING_ROOMS, [
    { id: 'room_a', doors: 2, floor: 'ground' },
    { id: 'room_b', doors: 2, floor: 'upper' },
  ]);
  const serialized = serializeGameState(gameState);
  expect(serialized.roomDeck).toEqual({
    remainingCount: 2,
    isEmpty: false,
    hasRoomForGround: true,
    hasRoomForUpper: true,
  });
  expect(serialized.roomDeck.cards).toBeUndefined();
});

test('serializeGameState roomDeck hasRoomForGround/hasRoomForUpper reflect per-floor availability, not just overall emptiness', () => {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_a', doors: 2, floor: 'ground' }]);
  const serialized = serializeGameState(gameState);
  expect(serialized.roomDeck.hasRoomForGround).toBe(true);
  expect(serialized.roomDeck.hasRoomForUpper).toBe(false);
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `cd server && npx jest test/game/gameState.test.js --forceExit`
Expected: FAIL（`hasRoomForGround`/`hasRoomForUpper` 是 `undefined`）

- [ ] **Step 3：實作**

在 `server/src/game/gameState.js` 頂端的 require 改成：

```js
const { createRoomDeck, isRoomDeckEmpty, getRemainingCount, hasRoomForFloor } = require('./roomDeck');
```

把 `serializeGameState` 裡的 `roomDeck` 欄位改成：

```js
    roomDeck: {
      remainingCount: getRemainingCount(gameState.roomDeck),
      isEmpty: isRoomDeckEmpty(gameState.roomDeck),
      hasRoomForGround: hasRoomForFloor(gameState.roomDeck, 'ground'),
      hasRoomForUpper: hasRoomForFloor(gameState.roomDeck, 'upper'),
    },
```

- [ ] **Step 4：執行測試確認通過**

Run: `cd server && npx jest test/game/gameState.test.js --forceExit`
Expected: 全數 PASS

- [ ] **Step 5：跑整個 server 測試套件確認沒有連帶壞掉**

Run: `cd server && npx jest --forceExit`
Expected: 全數 PASS（`roomDeck` 序列化形狀在其他測試檔也可能被引用，例如 `socketHandlers.test.js` 若有相關斷言）

- [ ] **Step 6：Commit**

```bash
git add server/src/game/gameState.js server/test/game/gameState.test.js
git commit -m "feat(m2d3): expose per-floor room deck availability in serialized game state"
```

---

### Task 3：玩家個人探索房間紀錄（`visitedRooms`）

**Files:**
- Modify: `server/src/game/playerEntity.js`
- Test: `server/test/game/playerEntity.test.js`

**Interfaces:**
- Produces：`player.visitedRooms`（陣列，元素為 `{floor, x, y}`），`createPlayer` 建立時以起始位置初始化為單一元素陣列；`movePlayerTo` 每次呼叫時，若新位置尚未存在於陣列中才附加一筆（避免重複造訪同一房間時無限增長）。這個欄位會跟著既有 `player` 物件整包被 `serializeGameState` 廣播出去（比照 `inventory` 現有慣例，不做逐玩家隱私過濾，前端只是不會把別人的 `visitedRooms` 畫出來）

- [ ] **Step 1：先寫失敗的測試**

在 `server/test/game/playerEntity.test.js`，在既有的 `'movePlayerTo updates floor and coordinates'` 測試（第 135-141 行）之後新增：

```js
test('createPlayer initializes visitedRooms with the starting position', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(player.visitedRooms).toEqual([{ floor: 'ground', x: 0, y: 0 }]);
});

test('movePlayerTo appends the new position to visitedRooms', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  movePlayerTo(player, 'ground', 1, 0);
  expect(player.visitedRooms).toEqual([
    { floor: 'ground', x: 0, y: 0 },
    { floor: 'ground', x: 1, y: 0 },
  ]);
});

test('movePlayerTo does not add a duplicate entry when returning to an already-visited room', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  movePlayerTo(player, 'ground', 1, 0);
  movePlayerTo(player, 'ground', 0, 0);
  expect(player.visitedRooms).toEqual([
    { floor: 'ground', x: 0, y: 0 },
    { floor: 'ground', x: 1, y: 0 },
  ]);
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `cd server && npx jest test/game/playerEntity.test.js --forceExit`
Expected: FAIL（`player.visitedRooms` 是 `undefined`）

- [ ] **Step 3：實作**

在 `server/src/game/playerEntity.js`，`createPlayer` 的 `return` 陳述式加入 `visitedRooms`：

```js
  return {
    playerId,
    name,
    floor,
    x,
    y,
    stats: statTracks,
    actionPoints,
    inventory: [],
    visitedRooms: [{ floor, x, y }],
  };
```

把 `movePlayerTo` 改成：

```js
function movePlayerTo(player, floor, x, y) {
  player.floor = floor;
  player.x = x;
  player.y = y;
  const alreadyVisited = player.visitedRooms.some(
    (r) => r.floor === floor && r.x === x && r.y === y
  );
  if (!alreadyVisited) {
    player.visitedRooms.push({ floor, x, y });
  }
}
```

- [ ] **Step 4：執行測試確認通過**

Run: `cd server && npx jest test/game/playerEntity.test.js --forceExit`
Expected: 全數 PASS

- [ ] **Step 5：跑整個 server 測試套件確認沒有連帶壞掉**

Run: `cd server && npx jest --forceExit`
Expected: 全數 PASS

- [ ] **Step 6：Commit**

```bash
git add server/src/game/playerEntity.js server/test/game/playerEntity.test.js
git commit -m "feat(m2d3): track each player's visited rooms for the personal overview map"
```

---

## 完成後驗證

三個任務都完成後，跑一次完整 server 測試套件確認全綠：

Run: `cd server && npx jest --forceExit`
Expected: 全數 PASS，414 → 421（Task 1: +1、Task 2: 淨增 1（原本 1 個測試被取代＋新增 1 個）、Task 3: +3；基準 414 為本計畫開始前 `npx jest --forceExit` 的實測結果）
