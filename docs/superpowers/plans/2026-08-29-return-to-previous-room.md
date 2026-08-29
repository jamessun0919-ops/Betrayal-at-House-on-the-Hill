# 回到前一個房間機制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `event_004`／`event_029`／`event_035` 能把玩家送回移動前的上一個位置，`event_029` 另外能在原房間與門連接的已生成鄰房留下永久減骰標記。

**Architecture:** `movePlayerTo`（所有移動的唯一入口）在覆寫玩家位置前先記錄舊位置到新欄位 `player.previousPosition`；新增效果類型 `move_to_previous_room` 讀取這個欄位執行移動；`persistent_modifier` 效果新增第三種 `appliesTo:"roomAndNeighbors"`，重用既有的 `canMoveBetween`（`boardGenerator.js`）判斷門連接。

**Tech Stack:** Node.js（`server/src/game/`），Jest 測試（`server/test/game/`、`server/test/socketHandlers.test.js`）。

## Global Constraints

- `previousPosition` 是「緊接著的上一個位置」，不是完整移動歷史——每次 `movePlayerTo` 都會用當下位置覆寫它
- 角色開場出生位置不經過 `movePlayerTo`（`createPlayer` 直接指定座標），所以從未移動過時 `previousPosition` 為 `null`
- `previousPosition` 為 `null` 時，`move_to_previous_room` 無效果（`appliedCount:0`），不拋錯、不移動
- `move_to_previous_room` 移動時 `enteredFromSide` 給 `null`，且不重新觸發新房間的抽卡（比照既有 `move_to_room` 效果類型的行為）
- `appliesTo:"roomAndNeighbors"` 的「已生成的相鄰房間」要求門連接（用 `canMoveBetween` 判斷），單純格子相鄰但沒有門連接、或格子相鄰但還沒生成房間的位置都要排除
- `roomAndNeighbors` 套用的每個房間（目前房間＋各鄰房）各自獨立呼叫 `attachModifier`，取得各自獨立的 modifier id

---

### Task 1: `player.previousPosition` 追蹤

**Files:**
- Modify: `server/src/game/playerEntity.js`（`createPlayer` 回傳物件、`movePlayerTo`）
- Test: `server/test/game/playerEntity.test.js`

**Interfaces:**
- Produces: `player.previousPosition`（`{floor, x, y}` 或 `null`），供 Task 2 的 `move_to_previous_room` 效果消費

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/playerEntity.test.js` 第 167 行（`movePlayerTo updates floor and coordinates` 測試結束）後面加：

```javascript
test('createPlayer initializes previousPosition as null', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  expect(player.previousPosition).toBeNull();
});

test('movePlayerTo records the position the player was at just before moving', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  movePlayerTo(player, 'ground', 1, 0);
  expect(player.previousPosition).toEqual({ floor: 'ground', x: 0, y: 0 });
});

test('movePlayerTo overwrites previousPosition on each subsequent move (only the immediately-prior position is kept)', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  movePlayerTo(player, 'ground', 1, 0);
  movePlayerTo(player, 'ground', 2, 0);
  expect(player.previousPosition).toEqual({ floor: 'ground', x: 1, y: 0 });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd server && npx jest test/game/playerEntity.test.js -t "previousPosition"`
Expected: FAIL（`player.previousPosition` 是 `undefined`）

- [ ] **Step 3: 修改 `playerEntity.js`**

在 `createPlayer` 的回傳物件裡（`enteredFromSide: null,` 這行後面）加一行：

```javascript
    previousPosition: null, // {floor,x,y} snapshot of where the player was immediately before their current position, set by movePlayerTo; null until they've moved at least once
```

把 `movePlayerTo` 函式（目前開頭是 `player.floor = floor;`）改成：

```javascript
function movePlayerTo(player, floor, x, y, enteredFromSide = null) {
  player.previousPosition = { floor: player.floor, x: player.x, y: player.y };
  player.floor = floor;
  player.x = x;
  player.y = y;
  player.enteredFromSide = enteredFromSide;
  const alreadyVisited = player.visitedRooms.some(
    (r) => r.floor === floor && r.x === x && r.y === y
  );
  if (!alreadyVisited) {
    player.visitedRooms.push({ floor, x, y });
  }
  return !alreadyVisited;
}
```

（只在函式最前面新增一行 `player.previousPosition = {...}`，其他都不變。）

- [ ] **Step 4: 跑測試確認通過**

Run: `cd server && npx jest test/game/playerEntity.test.js -t "previousPosition"`
Expected: PASS（3 個新測試全過）

- [ ] **Step 5: 跑整個 `server` 測試套件確認沒有破壞既有測試**

Run: `cd server && npm test`
Expected: 全數 PASS（641 既有 + 3 新增 = 644）

- [ ] **Step 6: Commit**

```bash
git add server/src/game/playerEntity.js server/test/game/playerEntity.test.js
git commit -m "feat: track player.previousPosition in movePlayerTo"
```

---

### Task 2: 新效果類型 `move_to_previous_room`

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: `player.previousPosition`（Task 1 產出）、`movePlayerTo(player, floor, x, y, enteredFromSide)`（`playerEntity.js` 既有函式，`effectResolver.js` 已經 `require` 進來）
- Produces: 效果類型 `move_to_previous_room`（無額外欄位），供 Task 4 的 `event_004`／`event_029`／`event_035` 資料使用

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/effectResolver.test.js` 找到這個測試（搜尋 `'resolveEffects draw_card throws UNKNOWN_DECK_TYPE for an unrecognized deck'`，這個測試目前結束於 `});` 後緊接著 `test('resolveEffects persistent_modifier attaches to the player by default'...` 這個測試），在這兩個測試中間插入：

```javascript
test('resolveEffects move_to_previous_room moves the player back to their previous position', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.previousPosition = { floor: 'ground', x: 0, y: 0 };
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'move_to_previous_room' },
  ]);
  expect(player.floor).toBe('ground');
  expect(player.x).toBe(0);
  expect(player.y).toBe(0);
});

test('resolveEffects move_to_previous_room does nothing when there is no previous position', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  const startFloor = player.floor;
  const startX = player.x;
  const startY = player.y;
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'move_to_previous_room' },
  ]);
  expect(result).toEqual({ pending: false, appliedCount: 0 });
  expect(player.floor).toBe(startFloor);
  expect(player.x).toBe(startX);
  expect(player.y).toBe(startY);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "move_to_previous_room"`
Expected: FAIL（`UNSUPPORTED_EFFECT_TYPE`，`move_to_previous_room` 還沒註冊）

- [ ] **Step 3: 修改 `effectResolver.js`**

在 `handleMoveToRoom` 函式（搜尋 `function handleMoveToRoom`）後面加一個新函式：

```javascript
function handleMoveToPreviousRoom(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  if (!player.previousPosition) {
    return { pending: false, appliedCount: 0 };
  }
  const { floor, x, y } = player.previousPosition;
  const enteredNewRoom = movePlayerTo(player, floor, x, y);
  return { pending: false, enteredNewRoom };
}
```

在 `HANDLERS` 物件裡，`move_to_room:` 那一行後面加一行：

```javascript
  move_to_previous_room: (gameState, promptState, playerId) => handleMoveToPreviousRoom(gameState, playerId),
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "move_to_previous_room"`
Expected: PASS（2 個新測試全過）

- [ ] **Step 5: 跑整個 `server` 測試套件確認沒有破壞既有測試**

Run: `cd server && npm test`
Expected: 全數 PASS（644 既有 + 2 新增 = 646）

- [ ] **Step 6: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat: add move_to_previous_room effect type"
```

---

### Task 3: `persistent_modifier` 新增 `appliesTo:"roomAndNeighbors"`

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: `canMoveBetween(board, floor, fromCoord, direction)`（`server/src/game/boardGenerator.js` 既有並已匯出的函式，簽名為 `canMoveBetween(board, floor, {x,y}, 'north'|'south'|'east'|'west')`，回傳 boolean）、`SIDES`（`doorLayout.js` 已匯出的陣列 `['north','south','east','west']`，`effectResolver.js` 已經 `require` 進來）、`DIRECTION_DELTA`（`boardGenerator.js` 已匯出，`{north:{dx,dy}, ...}`）、`coordKey(x,y)`（`boardGenerator.js` 已匯出）
- Produces: `persistent_modifier` 效果的 `appliesTo:"roomAndNeighbors"` 值，供 Task 4 的 `event_029` 資料使用

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/effectResolver.test.js` 找到這個測試（搜尋 `'resolveEffects persistent_modifier attaches to the room the player currently stands in'`），在它結束的 `});` 後面加（注意：這個測試前面經過 Task 2 已經新增了 2 個 `move_to_previous_room` 測試，實際行號跟目前這份計畫文件寫的不同，用搜尋字串定位，不要依賴行號）：

```javascript
test('resolveEffects persistent_modifier appliesTo:"roomAndNeighbors" attaches to the current room and its door-connected neighbors, excluding non-door-connected or unplaced ones', () => {
  const gameState = makeGameStateWithPlayer();
  // Player starts at room_lobby_a (0,1), doors north/east/west (see boardGenerator.js
  // createBoard). North (0,0) is room_lobby_b, already door-connected (it has a south
  // door facing back). Manually place a decoy room to the east (1,1) WITHOUT a matching
  // west door, to prove a grid-adjacent-but-not-door-connected room is excluded even
  // though the current room has a door facing that direction. West (-1,1) is left
  // unplaced entirely, to prove an unplaced neighbor doesn't cause an error.
  gameState.board.ground.set('1,1', { roomId: 'room_x', x: 1, y: 1, doorSides: ['north'], droppedItems: [], item: null });

  resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'persistent_modifier',
      appliesTo: 'roomAndNeighbors',
      effects: [{ hookType: 'onBeforeRoll', delta: -1 }],
    },
  ]);

  const currentRoom = gameState.board.ground.get('0,1');
  const doorConnectedNeighbor = gameState.board.ground.get('0,0'); // room_lobby_b
  const nonDoorConnectedDecoy = gameState.board.ground.get('1,1');
  expect(currentRoom.modifiers).toHaveLength(1);
  expect(doorConnectedNeighbor.modifiers).toHaveLength(1);
  expect(nonDoorConnectedDecoy.modifiers).toBeUndefined(); // never attached to -- attachModifier only initializes .modifiers on first use
});

test('resolveEffects persistent_modifier throws INVALID_MODIFIER_APPLIES_TO for an unrecognized appliesTo value', () => {
  const gameState = makeGameStateWithPlayer();
  expect(() =>
    resolveEffects(gameState, createPromptState(), 'p1', [
      { type: 'persistent_modifier', appliesTo: 'bogus', effects: [{ hookType: 'onBeforeRoll', delta: -1 }] },
    ])
  ).toThrow('INVALID_MODIFIER_APPLIES_TO');
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "roomAndNeighbors"`
Expected: FAIL（第一個測試：`INVALID_MODIFIER_APPLIES_TO` 被拋出，因為 `roomAndNeighbors` 還不是合法值；第二個測試現在應該已經通過，先確認第一個測試確實失敗即可）

- [ ] **Step 3: 修改 `effectResolver.js`**

在檔案最上方的 import 區塊，把：

```javascript
const { coordKey, DIRECTION_DELTA } = require('./boardGenerator');
```

改成：

```javascript
const { coordKey, DIRECTION_DELTA, canMoveBetween } = require('./boardGenerator');
```

把 `handlePersistentModifier` 函式（目前內容）：

```javascript
function handlePersistentModifier(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  if (effect.appliesTo !== 'player' && effect.appliesTo !== 'room') {
    throw new Error('INVALID_MODIFIER_APPLIES_TO');
  }
  const entity = effect.appliesTo === 'room' ? getRoomForPlayer(gameState, player) : player;
  attachModifier(entity, { effects: effect.effects, removeWhen: effect.removeWhen });
  return { pending: false };
}
```

換成：

```javascript
function handlePersistentModifier(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  if (effect.appliesTo !== 'player' && effect.appliesTo !== 'room' && effect.appliesTo !== 'roomAndNeighbors') {
    throw new Error('INVALID_MODIFIER_APPLIES_TO');
  }
  if (effect.appliesTo === 'player') {
    attachModifier(player, { effects: effect.effects, removeWhen: effect.removeWhen });
    return { pending: false };
  }
  const room = getRoomForPlayer(gameState, player);
  attachModifier(room, { effects: effect.effects, removeWhen: effect.removeWhen });
  if (effect.appliesTo === 'roomAndNeighbors') {
    for (const side of SIDES) {
      if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, side)) {
        const delta = DIRECTION_DELTA[side];
        const neighbor = gameState.board[player.floor].get(coordKey(player.x + delta.dx, player.y + delta.dy));
        attachModifier(neighbor, { effects: effect.effects, removeWhen: effect.removeWhen });
      }
    }
  }
  return { pending: false };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd server && npx jest test/game/effectResolver.test.js -t "roomAndNeighbors"`
Expected: PASS（2 個新測試全過）

- [ ] **Step 5: 跑整個 `server` 測試套件確認沒有破壞既有測試**

Run: `cd server && npm test`
Expected: 全數 PASS（646 既有 + 2 新增 = 648）

- [ ] **Step 6: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat: add persistent_modifier appliesTo roomAndNeighbors"
```

---

### Task 4: `event_004`／`event_029`／`event_035` 資料串接與端對端測試

**Files:**
- Modify: `data/cards/event-cards.json`（`event_004`／`event_029`／`event_035`）
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 1-3 的 `previousPosition`／`move_to_previous_room`／`persistent_modifier appliesTo:"roomAndNeighbors"`（純資料串接與整合測試，不寫新的伺服器邏輯）

- [ ] **Step 1: 寫失敗端對端測試**

在 `server/test/socketHandlers.test.js` 找到 `game:cardDrawn reports hasCheck:true...` 測試（搜尋 `'game:cardDrawn reports hasCheck:true'`）前面加入以下三個測試：

```javascript
test('game:move into event_004 (突發故障) zeros action points and moves the player back to their previous room', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_004',
        name: '突發故障',
        effects: [
          { type: 'action_points', setTo: 0 },
          { type: 'move_to_previous_room' },
        ],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const before = getPlayer(gameState, currentPlayerId);
  const startFloor = before.floor;
  const startX = before.x;
  const startY = before.y;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.actionPoints).toBe(0);
  expect(after.floor).toBe(startFloor);
  expect(after.x).toBe(startX);
  expect(after.y).toBe(startY);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into event_035 (狂風襲來) moves the player back to their previous room', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_035',
        name: '狂風襲來',
        effects: [{ type: 'move_to_previous_room' }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const before = getPlayer(gameState, currentPlayerId);
  const startFloor = before.floor;
  const startX = before.x;
  const startY = before.y;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.floor).toBe(startFloor);
  expect(after.x).toBe(startX);
  expect(after.y).toBe(startY);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:move into event_029 (濃煙密布) moves the player back and leaves a dice-penalty modifier on the room they left', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_029',
        name: '濃煙密布',
        effects: [
          {
            type: 'persistent_modifier',
            appliesTo: 'roomAndNeighbors',
            effects: [{ hookType: 'onBeforeRoll', delta: -1 }],
          },
          { type: 'move_to_previous_room' },
        ],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const before = getPlayer(gameState, currentPlayerId);
  const startFloor = before.floor;
  const startX = before.x;
  const startY = before.y;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await effectResolvedPromise;

  const after = getPlayer(gameState, currentPlayerId);
  expect(after.floor).toBe(startFloor);
  expect(after.x).toBe(startX);
  expect(after.y).toBe(startY);

  // The room the player just left (room_new, where event_029 was drawn) should carry
  // the smoke marker -- found by scanning the board for the placed room_new instance.
  const leftRoom = Array.from(gameState.board[startFloor].values()).find((r) => r.roomId === 'room_new');
  expect(leftRoom.modifiers).toHaveLength(1);
  expect(leftRoom.modifiers[0].effects).toEqual([{ hookType: 'onBeforeRoll', delta: -1 }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js -t "event_004|event_029|event_035"`
Expected: FAIL（此時真實卡片資料 `event_029`／`event_035` 的 `effects` 還是空陣列，`event_004` 缺少 `move_to_previous_room`，玩家不會被移回前一個房間）

- [ ] **Step 3: 更新 `data/cards/event-cards.json`**

`event_004` 目前的 `"effects"` 欄位：

```json
    "effects": [
      {
        "type": "action_points",
        "setTo": 0
      }
    ],
```

改成：

```json
    "effects": [
      {
        "type": "action_points",
        "setTo": 0
      },
      {
        "type": "move_to_previous_room"
      }
    ],
```

`event_029` 目前的 `"effects": [],` 改成：

```json
    "effects": [
      {
        "type": "persistent_modifier",
        "appliesTo": "roomAndNeighbors",
        "effects": [
          {
            "hookType": "onBeforeRoll",
            "delta": -1
          }
        ]
      },
      {
        "type": "move_to_previous_room"
      }
    ],
```

`event_035` 目前的 `"effects": [],` 改成：

```json
    "effects": [
      {
        "type": "move_to_previous_room"
      }
    ],
```

另外把這三張卡的 `"needsCustomLogic"` 都改成 `false`（`event_035` 目前已經是 `false`，不用動；`event_004`／`event_029` 目前是 `true`，改成 `false`）。其他欄位（`text`／`feedbacktextOccur`／`description`）完全不動。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd server && npx jest test/socketHandlers.test.js -t "event_004|event_029|event_035"`
Expected: PASS（3 個新測試全過）

- [ ] **Step 5: 跑整個 `server` 測試套件確認沒有破壞既有測試**

Run: `cd server && npm test`
Expected: 全數 PASS（648 既有 + 3 新增 = 651）

- [ ] **Step 6: Commit**

```bash
git add data/cards/event-cards.json server/test/socketHandlers.test.js
git commit -m "feat: wire event_004/event_029/event_035 to the return-to-previous-room mechanism"
```
