# 召喚物操控切換＋道具給予/遺留/撿取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓玩家可以召喚犬靈（暫時切換操控權到一個受限行動的召喚實體）、並讓道具除了「使用」之外，能夠給予同房間玩家、遺留在房間裡、從房間撿取。

**Architecture:** `player.summons`（單一物件，`null` 代表沒有召喚物）承載召喚物的座標/行動力/攜帶物；房間動態狀態（`gameState.board` 裡的房間物件，不是靜態 `rooms.json`）新增 `droppedItems` 陣列。犬靈道具卡透過新的 `switch_control` 效果類型建立 `summons`。伺服器收到 `game:move`/`game:selectAction` 時，先檢查呼叫者的 `player.summons` 是否存在，存在就走召喚物專用的限定邏輯（`turnFlow.js` 的 `moveSummon`/`selectSummonAction`），不存在則走既有邏輯（新增 give/leave/pickup 三種 `mode` 到既有的 `item` 動作）。

**Tech Stack:** Node.js + CommonJS，沿用 `server/src/game/` 現有模組結構；Jest 測試。

## Global Constraints

- 純 JavaScript，不使用 TypeScript
- 所有函式對不合法輸入一律拋出自訂 `Error`，訊息用 UPPER_SNAKE_CASE 字串
- `turnFlow.js` 可以直接讀寫 `gameState`（含 `gameState.board` 這類動態狀態），但不可以觸碰 `content.cards`/`content.rooms` 這類靜態內容目錄——那是 `socketHandlers.js` 的職責（既有的「action boundary」慣例，`droppedItems` 屬於 `gameState.board` 動態狀態，所以 `turnFlow.js` 可以直接操作它）
- 任何會讓效果解析「暫停等待玩家選擇」的流程，在選擇解決前不可以推進遊戲狀態（本次新增的 `switch_control` 不會產生 pending 選擇，這條不直接適用，但心裡要有數）
- `server` 目錄執行 Jest 時如果要看到指令正常在數秒內返回，記得加 `--forceExit`（既有的非同步 handle 未關閉問題，見 Handover 除錯注意事項，跟這次改動無關）
- 每個任務結束都要跑 `cd server && npx jest --forceExit` 確認全套測試綠燈，再 commit

---

## Task 1: `boardGenerator.js` — 房間新增 `droppedItems` 欄位

**Files:**
- Modify: `server/src/game/boardGenerator.js`
- Test: `server/test/game/boardGenerator.test.js`

**Interfaces:**
- Consumes: 無新依賴
- Produces: `placeFixedRoom`（起始房間）與 `placeNewRoom`（開新房間）建立的房間物件，現在都帶有 `droppedItems: []`

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/boardGenerator.test.js` 找一個既有測試附近（例如驗證 `createBoard`/`placeNewRoom` 回傳形狀的測試旁邊）新增：

```js
test('createBoard places starting rooms with an empty droppedItems array', () => {
  const board = createBoard(STARTING_ROOMS);
  const entranceHall = board.ground.get('0,0');
  expect(entranceHall.droppedItems).toEqual([]);
});

test('placeNewRoom creates a room with an empty droppedItems array', () => {
  const board = createBoard(STARTING_ROOMS);
  const placedRoom = placeNewRoom(board, 'ground', { x: 0, y: 0 }, 'east', { id: 'room_new', doors: 4 });
  expect(placedRoom.droppedItems).toEqual([]);
});
```

（`STARTING_ROOMS`、`createBoard`、`placeNewRoom` 這個測試檔案應該已經有既有的 import/固定資料可以沿用；如果變數名稱不同，依實際檔案內容調整，不要另外重新定義一份）

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/boardGenerator.test.js --forceExit`
Expected: FAIL——`droppedItems` 是 `undefined`，不是 `[]`

- [ ] **Step 3: 實作**

修改 `server/src/game/boardGenerator.js` 的 `placeFixedRoom`：

```js
function placeFixedRoom(grid, roomId, x, y) {
  grid.set(coordKey(x, y), { roomId, x, y, doorSides: ALL_SIDES.slice(), droppedItems: [] });
}
```

修改 `placeNewRoom` 建立 `placedRoom` 的地方：

```js
  const placedRoom = {
    roomId: roomDefinition.id,
    x: newCoord.x,
    y: newCoord.y,
    doorSides: Array.from(doorSides),
    droppedItems: [],
  };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS，全部既有測試也要綠燈（沒有任何地方對房間物件的欄位數量做過嚴格比對而爆掉，例如 `toEqual` 比對整個房間物件——如果有，把新欄位加進期望值裡）

- [ ] **Step 5: Commit**

```bash
git add server/src/game/boardGenerator.js server/test/game/boardGenerator.test.js
git commit -m "feat(summon): add droppedItems array to placed room objects"
```

---

## Task 2: `effectResolver.js` — 新增 `switch_control` 效果類型

**Files:**
- Modify: `server/src/game/effectResolver.js`
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: 無新依賴
- Produces: 新增效果類型 `switch_control`，`{type:"switch_control", summonType, actionPoints}` → 在玩家物件上建立 `player.summons`

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/effectResolver.test.js` 找一個現有 handler 測試附近（例如 `grant_item`/`toggle_active` 測試旁邊）新增：

```js
test('resolveEffects switch_control creates player.summons at the player\'s current position', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.floor = 'ground';
  player.x = 3;
  player.y = -2;
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'switch_control', summonType: 'spiritDog', actionPoints: 6 },
  ]);
  expect(player.summons).toEqual({
    type: 'spiritDog',
    floor: 'ground',
    x: 3,
    y: -2,
    actionPoints: 6,
    carryingItemId: null,
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/effectResolver.test.js --forceExit`
Expected: FAIL——`UNSUPPORTED_EFFECT_TYPE`

- [ ] **Step 3: 實作**

在 `server/src/game/effectResolver.js` 新增（放在 `handleToggleActive` 之後、`handlePersistentModifier` 之前即可，順序不影響）：

```js
function handleSwitchControl(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  player.summons = {
    type: effect.summonType,
    floor: player.floor,
    x: player.x,
    y: player.y,
    actionPoints: effect.actionPoints,
    carryingItemId: null,
  };
  return { pending: false };
}
```

在 `HANDLERS` 物件裡加一行（放在 `toggle_active` 那行附近即可）：

```js
  switch_control: (gameState, promptState, playerId, effect) => handleSwitchControl(gameState, playerId, effect),
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat(summon): add switch_control effect type"
```

---

## Task 3: `turnFlow.js` — 道具給予/遺留/撿取（一般玩家）

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: `gameState.board[floor].get(coordKey(x,y)).droppedItems`（Task 1 新增的欄位）
- Produces: `selectAction(gameState, playerId, 'item', {itemId, mode: 'give'|'leave'|'pickup', targetPlayerId})` 的三個新分支；不影響 `mode` 未提供或 `mode:'use'` 的既有行為

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/turnFlow.test.js` 找到既有的 `selectAction` item 相關測試附近，新增：

```js
test('selectAction item mode:give transfers the item to a same-room target player', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_003' });
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  other.floor = player.floor;
  other.x = player.x;
  other.y = player.y;
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'give', targetPlayerId: 'p2' });
  expect(result).toEqual({ kind: 'item', mode: 'give', itemId: 'item_003', targetPlayerId: 'p2' });
  expect(player.inventory).toEqual([]);
  expect(other.inventory).toEqual([{ id: 'item_003' }]);
  expect(player.actionPoints).toBe(3); // addPlayer resets AP to speed value (4, per makeStats' speed baseIndex) minus the 1 spent here
});

test('selectAction item mode:give throws TARGET_NOT_IN_ROOM when the target is elsewhere', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_003' });
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  other.floor = player.floor;
  other.x = player.x + 99;
  other.y = player.y;
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'give', targetPlayerId: 'p2' })
  ).toThrow('TARGET_NOT_IN_ROOM');
});

test('selectAction item mode:leave removes the item from inventory and adds it to the current room\'s droppedItems', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_003' });
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'leave' });
  expect(result).toEqual({ kind: 'item', mode: 'leave', itemId: 'item_003' });
  expect(player.inventory).toEqual([]);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  expect(room.droppedItems).toEqual([{ id: 'item_003' }]);
});

test('selectAction item mode:leave throws ITEM_NOT_HELD when the player does not hold it', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'not_held', mode: 'leave' })
  ).toThrow('ITEM_NOT_HELD');
});

test('selectAction item mode:pickup moves a dropped item from the room into inventory', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  room.droppedItems.push({ id: 'item_003' });
  const result = selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'pickup' });
  expect(result).toEqual({ kind: 'item', mode: 'pickup', itemId: 'item_003' });
  expect(player.inventory).toEqual([{ id: 'item_003' }]);
  expect(room.droppedItems).toEqual([]);
});

test('selectAction item mode:pickup throws ITEM_NOT_IN_ROOM when the room has no such dropped item', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'pickup' })
  ).toThrow('ITEM_NOT_IN_ROOM');
});
```

**注意**：這個檔案的 `makeGameStateWithPlayer` 目前只建立一位玩家；上面 give 的測試裡另外呼叫 `addPlayer` 加第二位玩家，`addPlayer`/`makeStats` 應該已經在檔案頂部 import 過（沿用既有的 `require` 陳述，不要重複定義）。`gameState.addPlayer` 會呼叫 `resetActionPoints`，把新玩家的 `actionPoints` 設成速度屬性的數值——這個檔案的 `makeStats()` 速度 `baseIndex:2`、`track:[2,3,4,5,6]`，換算數值是 4，所以起始 `actionPoints` 是 4，這也是上面 give 測試斷言 `3`（4 - 1）的依據。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/turnFlow.test.js --forceExit`
Expected: FAIL——目前 `selectAction` 的 `item` 分支完全不認得 `mode` 欄位，give/leave/pickup 都會被當成一般「使用」處理，`ITEM_NOT_HELD`/`TARGET_NOT_IN_ROOM` 這些新錯誤不會依照上面期望的方式拋出

- [ ] **Step 3: 實作**

修改 `server/src/game/turnFlow.js` 的 `selectAction` 函式，把 `item` 分支換成：

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
    if (!player.inventory.some((item) => item.id === itemId)) {
      throw new Error('ITEM_NOT_HELD');
    }
    const effectTargetId = targetPlayerId || playerId;
    if (effectTargetId !== playerId && !options.itemCanTargetOthers) {
      throw new Error('ITEM_CANNOT_TARGET_OTHERS');
    }
    const targetPlayer = requirePlayer(gameState, effectTargetId);
    if (
      targetPlayer.floor !== player.floor ||
      targetPlayer.x !== player.x ||
      targetPlayer.y !== player.y
    ) {
      throw new Error('TARGET_NOT_IN_ROOM');
    }
    player.actionPoints -= 1;
    return { kind: 'item', itemId, targetPlayerId: effectTargetId };
  }
```

（這段只是在原本的 `if (actionType === 'item') {...}` 開頭插入三個 `mode` 分支，`mode` 未提供時繼續往下走到原本沒有改過的「使用」邏輯，原本的程式碼本身不變）

在 `selectAction` 函式之前新增三個小函式：

```js
function getRoomAt(gameState, floor, x, y) {
  return gameState.board[floor].get(coordKey(x, y));
}

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
  targetPlayer.inventory.push(item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'give', itemId, targetPlayerId };
}

function leaveItemAction(gameState, player, itemId) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_HELD');
  }
  player.inventory.splice(index, 1);
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  room.droppedItems.push({ id: itemId });
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'leave', itemId };
}

function pickupItemAction(gameState, player, itemId) {
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  const index = room.droppedItems.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_IN_ROOM');
  }
  room.droppedItems.splice(index, 1);
  player.inventory.push({ id: itemId });
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'pickup', itemId };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat(item): add give/leave/pickup modes to selectAction's item action"
```

---

## Task 4: `turnFlow.js` — 召喚物移動與限定動作

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: `player.summons`（Task 2 的 `switch_control` 建立）、`getRoomAt`（Task 3 新增）
- Produces: `moveSummon(gameState, playerId, direction)`、`selectSummonAction(gameState, playerId, actionType, options)`；`advanceTurn` 換人時清空離開玩家的 `summons`（保險措施）

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/turnFlow.test.js` 新增：

```js
test('moveSummon moves the summon to an already-explored neighbor room and spends 1 of its own actionPoints', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [] });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: null };
  const result = moveSummon(gameState, 'p1', 'north');
  expect(result).toEqual({ kind: 'move', x: 0, y: -1 });
  expect(player.summons.x).toBe(0);
  expect(player.summons.y).toBe(-1);
  expect(player.summons.actionPoints).toBe(5);
});

test('moveSummon never offers open_door -- throws INVALID_MOVE_DIRECTION toward unexplored territory', () => {
  const { gameState, player } = makeGameStateWithPlayer(); // room deck has cards available for a human player's open_door
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: null };
  expect(() => moveSummon(gameState, 'p1', 'east')).toThrow('INVALID_MOVE_DIRECTION');
});

test('moveSummon throws NO_ACTIVE_SUMMON when the player has no summon', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => moveSummon(gameState, 'p1', 'north')).toThrow('NO_ACTIVE_SUMMON');
});

test('moveSummon throws NOT_ENOUGH_ACTION_POINTS when the summon is out of actionPoints', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [] });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 0, carryingItemId: null };
  expect(() => moveSummon(gameState, 'p1', 'north')).toThrow('NOT_ENOUGH_ACTION_POINTS');
});

test('selectSummonAction item mode:pickup picks up a dropped item at the summon\'s own position, not the player\'s', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [{ id: 'item_003' }] });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: -1, actionPoints: 6, carryingItemId: null };
  const result = selectSummonAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'pickup' });
  expect(result).toEqual({ kind: 'item', mode: 'pickup', itemId: 'item_003' });
  expect(player.summons.carryingItemId).toBe('item_003');
  expect(player.inventory).toEqual([]); // did not go to the player's own inventory
});

test('selectSummonAction item mode:pickup throws SUMMON_ALREADY_CARRYING when already holding something', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const room = gameState.board.ground.get(coordKey(0, 0));
  room.droppedItems.push({ id: 'item_099' });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: 'item_003' };
  expect(() =>
    selectSummonAction(gameState, 'p1', 'item', { itemId: 'item_099', mode: 'pickup' })
  ).toThrow('SUMMON_ALREADY_CARRYING');
});

test('selectSummonAction item mode:leave drops the carried item at the summon\'s current room', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: 'item_003' };
  const result = selectSummonAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'leave' });
  expect(result).toEqual({ kind: 'item', mode: 'leave', itemId: 'item_003' });
  expect(player.summons.carryingItemId).toBeNull();
  const room = gameState.board.ground.get(coordKey(0, 0));
  expect(room.droppedItems).toEqual([{ id: 'item_003' }]);
});

test('selectSummonAction actionType:dissipate clears player.summons and drops the carried item where the summon stood', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [] });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: -1, actionPoints: 0, carryingItemId: 'item_003' };
  const result = selectSummonAction(gameState, 'p1', 'dissipate', {});
  expect(result).toEqual({ kind: 'dissipate' });
  expect(player.summons).toBeNull();
  const room = gameState.board.ground.get(coordKey(0, -1));
  expect(room.droppedItems).toEqual([{ id: 'item_003' }]);
});

test('selectSummonAction actionType:dissipate works even when the summon has 0 actionPoints left', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 0, carryingItemId: null };
  const result = selectSummonAction(gameState, 'p1', 'dissipate', {});
  expect(result).toEqual({ kind: 'dissipate' });
  expect(player.summons).toBeNull();
});

test('selectSummonAction throws NO_ACTIVE_SUMMON when the player has no summon', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => selectSummonAction(gameState, 'p1', 'dissipate', {})).toThrow('NO_ACTIVE_SUMMON');
});

test('advanceTurn clears the outgoing player\'s summons as a safety net', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 3, carryingItemId: null };
  advanceTurn(gameState);
  expect(player.summons).toBeNull();
});
```

**注意**：`makeGameStateWithPlayer` 內部已經把 `gameState.turnOrder = ['p1']`、`gameState.currentPlayerIndex = 0` 設好（讓 `getCurrentTurnPlayerId` 預設就是 `p1`），所以上面大部分測試不用再手動設定；只有「advanceTurn 清空 summons」這個測試需要兩位玩家輪替，才手動把 `turnOrder` 覆寫成 `['p1', 'p2']`。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/turnFlow.test.js --forceExit`
Expected: FAIL——`moveSummon`/`selectSummonAction` 還不存在（`TypeError: ... is not a function`），`advanceTurn` 也還沒清空 `summons`

- [ ] **Step 3: 實作**

在 `server/src/game/turnFlow.js` 新增（放在 `moveToRoom` 之後即可）：

```js
function moveSummon(gameState, playerId, direction) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  const summon = player.summons;
  if (!summon) {
    throw new Error('NO_ACTIVE_SUMMON');
  }
  if (summon.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
  const doorSides = Array.isArray(room.doorSides) ? room.doorSides : [];
  if (
    !doorSides.includes(direction) ||
    !canMoveBetween(gameState.board, summon.floor, { x: summon.x, y: summon.y }, direction)
  ) {
    // Summons can only move into already-placed neighbor rooms -- never open a
    // new door, regardless of whether the room deck has cards left.
    throw new Error('INVALID_MOVE_DIRECTION');
  }
  const delta = DIRECTION_DELTA[direction];
  summon.x += delta.dx;
  summon.y += delta.dy;
  summon.actionPoints -= 1;
  return { kind: 'move', x: summon.x, y: summon.y };
}

const SUMMON_ITEM_MODES = ['pickup', 'leave'];

function selectSummonAction(gameState, playerId, actionType, options = {}) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  const summon = player.summons;
  if (!summon) {
    throw new Error('NO_ACTIVE_SUMMON');
  }
  if (actionType === 'dissipate') {
    if (summon.carryingItemId) {
      const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
      room.droppedItems.push({ id: summon.carryingItemId });
    }
    player.summons = null;
    return { kind: 'dissipate' };
  }
  if (actionType !== 'item' || !SUMMON_ITEM_MODES.includes(options.mode)) {
    throw new Error('INVALID_ACTION_TYPE');
  }
  if (summon.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }
  const { itemId, mode } = options;
  const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
  if (mode === 'leave') {
    if (summon.carryingItemId !== itemId) {
      throw new Error('ITEM_NOT_HELD');
    }
    room.droppedItems.push({ id: itemId });
    summon.carryingItemId = null;
    summon.actionPoints -= 1;
    return { kind: 'item', mode: 'leave', itemId };
  }
  // mode === 'pickup'
  if (summon.carryingItemId) {
    throw new Error('SUMMON_ALREADY_CARRYING');
  }
  const index = room.droppedItems.findIndex((i) => i.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_IN_ROOM');
  }
  room.droppedItems.splice(index, 1);
  summon.carryingItemId = itemId;
  summon.actionPoints -= 1;
  return { kind: 'item', mode: 'pickup', itemId };
}
```

修改既有的 `advanceTurn`：

```js
function advanceTurn(gameState) {
  requireTurnOrder(gameState);
  const outgoingPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
  const outgoingPlayer = getPlayer(gameState, outgoingPlayerId);
  if (outgoingPlayer) {
    outgoingPlayer.summons = null; // safety net -- should already be null before a turn can end
  }
  gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.turnOrder.length;
  const nextPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
  const nextPlayer = getPlayer(gameState, nextPlayerId);
  resetActionPoints(nextPlayer);
  return nextPlayerId;
}
```

最後，把 `module.exports` 加上 `moveSummon`、`selectSummonAction`：

```js
module.exports = {
  getAvailableDirections,
  moveToRoom,
  moveSummon,
  selectAction,
  selectSummonAction,
  isTurnOver,
  getCurrentTurnPlayerId,
  advanceTurn,
  canUseStairs,
  useStairs,
};
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat(summon): add moveSummon/selectSummonAction and advanceTurn safety net"
```

---

## Task 5: 回合手動結束機制（全體玩家）

**背景**：Task 4 審查時發現一個計畫原本沒設想到的落差——玩家使用犬靈道具（`switch_control`）本身要花 1 點行動力，如果玩家使用當下剩下剛好 1 點，行動力歸零後，既有的 `advanceTurnIfOver`（`socketHandlers.js`）會自動把回合結束，Task 4 剛做的安全網會立刻把剛建立的 `summons` 清空——玩家連操控召喚物的機會都沒有。

與開發者確認後決定：**回合結束機制全面改為手動**，不限於召喚物情境——行動力歸零不再自動結束回合，玩家透過新的 `game:endTurn` 動作自行決定何時結束（即使行動力還沒用完，只要沒有其他想做的事也可以提前結束）。前端「結束回合」按鈕留到 M2d 再做，這次只做後端機制。

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/game/turnFlow.test.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `player.summons`（Task 2/4）——操控召喚物期間不可結束回合，需先消散
- Produces: `endTurn(gameState, playerId)`（`turnFlow.js`，回傳下一位玩家的 id，同 `advanceTurn`），新的 `game:endTurn` socket 事件

### Part A — `turnFlow.js`：新增 `endTurn`

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/turnFlow.test.js` 找到既有的 `advanceTurn`/`isTurnOver` 測試附近，新增：

```js
test('endTurn advances the turn even when the current player still has unspent actionPoints', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.actionPoints = 3; // deliberately not exhausted
  const result = endTurn(gameState, 'p1');
  expect(result).toBe('p2');
  expect(gameState.turnOrder[gameState.currentPlayerIndex]).toBe('p2');
});

test('endTurn throws NOT_YOUR_TURN when called by a player who is not the current turn player', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  expect(() => endTurn(gameState, 'p2')).toThrow('NOT_YOUR_TURN');
});

test('endTurn throws SUMMON_ACTIVE when the player has an active summon', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.summons = { type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: null };
  expect(() => endTurn(gameState, 'p1')).toThrow('SUMMON_ACTIVE');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/game/turnFlow.test.js --forceExit`
Expected: FAIL — `endTurn is not a function`

- [ ] **Step 3: 實作**

在 `server/src/game/turnFlow.js` 新增（放在 `advanceTurn` 之後即可）：

```js
function endTurn(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (player.summons) {
    throw new Error('SUMMON_ACTIVE');
  }
  return advanceTurn(gameState);
}
```

把 `module.exports` 加上 `endTurn`：

```js
module.exports = {
  getAvailableDirections,
  moveToRoom,
  moveSummon,
  selectAction,
  selectSummonAction,
  isTurnOver,
  getCurrentTurnPlayerId,
  advanceTurn,
  endTurn,
  canUseStairs,
  useStairs,
};
```

**注意**：`isTurnOver` 保留不動——雖然它現在不再被任何地方自動呼叫觸發回合結束，但它是一個通用的純函式（判斷行動力是否歸零），未來前端可能用同樣邏輯判斷要不要提示玩家「行動力用完了，要結束回合嗎」。不要因為它暫時沒有內部呼叫者就刪除它或它的既有測試。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest test/game/turnFlow.test.js --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat(turn): add endTurn for manual turn-ending"
```

### Part B — `socketHandlers.js`：移除自動結束、新增 `game:endTurn`

這部分同時是「加新功能」跟「移除舊行為」，舊行為目前由 4 個地方呼叫同一個 `advanceTurnIfOver` 函式觸發：`game:move` handler、`game:selectAction` handler、`game:effectPromptRespond` handler、`handleEffectChoiceTimeout` 函式。這 4 個呼叫點全部要移除，`advanceTurnIfOver` 函式本身也要刪除（改動後沒有任何呼叫者了）。因為這是全域行為改變，這個 Part 的測試步驟包含改寫既有測試，不是單純新增。

- [ ] **Step 1: 寫失敗測試（新增 `game:endTurn` 測試）**

在 `server/test/socketHandlers.test.js` 找一個既有 `game:useStairs`/`game:selectAction` 測試附近，新增：

```js
test('game:endTurn advances the turn even when the current player still has unspent action points', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGame();

  const updatePromise = new Promise((resolve) => otherClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBeUndefined();
  expect(result.nextPlayerId).not.toBe(currentPlayerId);

  const update = await updatePromise;
  expect(update.turnOrder[update.currentPlayerIndex]).not.toBe(currentPlayerId);
  const newCurrentPlayer = update.players.find((p) => p.playerId === update.turnOrder[update.currentPlayerIndex]);
  expect(newCurrentPlayer.actionPoints).toBeGreaterThan(0); // reset by advanceTurn

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:endTurn rejects a caller who is not the current turn player', async () => {
  const { httpServer, clientA, clientB, otherClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBe('NOT_YOUR_TURN');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:endTurn is rejected while an effect choice is pending', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  await pendingChoicePromise;

  const result = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:endTurn rejects the caller while they are controlling an active summon', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).summons = {
    type: 'spiritDog', floor: 'ground', x: 0, y: 0, actionPoints: 6, carryingItemId: null,
  };

  const result = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBe('SUMMON_ACTIVE');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js --forceExit`
Expected: FAIL — 沒有 `game:endTurn` 這個事件，callback 永遠不會被呼叫（測試會 timeout）

- [ ] **Step 3: 實作 — 新增 handler，移除自動結束**

修改 `server/src/socketHandlers.js` 第 17 行的 import，移除 `isTurnOver`、`advanceTurn`（改由 `endTurn` 承接，兩者都不再被 `socketHandlers.js` 直接呼叫），加入 `endTurn`：

```js
const { moveToRoom, selectAction, useStairs, endTurn } = require('./game/turnFlow');
```

在 `game:useStairs` handler 之後、`game:effectPromptRespond` handler 之前，新增：

```js
    socket.on('game:endTurn', (payload, callback) => {
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
        if (hasPendingEffectChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        const nextPlayerId = endTurn(gameState, playerId);
        ack({ nextPlayerId });
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:endTurn error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });
```

刪除 `advanceTurnIfOver` 函式本身（原本在檔案後段，`hasPendingEffectChoice` 函式之前）：

```js
function advanceTurnIfOver(gameState, playerId) {
  const player = getPlayer(gameState, playerId);
  if (isTurnOver(player)) {
    advanceTurn(gameState);
  }
}
```

這整個函式直接刪除，不留殘餘。

修改 `game:move` handler 裡的這段（把 `let stillResolving = false;` 和最後的 `if (!stillResolving) { advanceTurnIfOver(...); }` 一併移除，因為 `stillResolving` 這個變數移除呼叫後就沒有其他用途了）：

原本：
```js
        let stillResolving = false;
        if (result.pendingCardDraw) {
          try {
            const drawOutcome = resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, result.pendingCardDraw.deck, effectChoiceTimeouts);
            stillResolving = drawOutcome.pending;
            if (drawOutcome.drawnCards) {
              socket.emit('game:cardsDrawn', { cards: drawOutcome.drawnCards });
            }
          } catch (drawErr) {
            console.error('resolveCardDraw error', drawErr);
          }
        }
        if (!stillResolving) {
          advanceTurnIfOver(gameState, playerId);
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
```

改為：
```js
        if (result.pendingCardDraw) {
          try {
            const drawOutcome = resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, result.pendingCardDraw.deck, effectChoiceTimeouts);
            if (drawOutcome.drawnCards) {
              socket.emit('game:cardsDrawn', { cards: drawOutcome.drawnCards });
            }
          } catch (drawErr) {
            console.error('resolveCardDraw error', drawErr);
          }
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
```

修改 `game:selectAction` handler 裡的對應段落，同樣道理移除 `stillResolving`：

原本：
```js
        let stillResolving = false;
        if (sourceEffects) {
          try {
            const resolverEntry = getResolver(effectResolverManager, roomCode);
            const targetForEffects = result.targetPlayerId || playerId;
            const effectResult = resolveEffects(gameState, resolverEntry.promptState, targetForEffects, sourceEffects, { now: Date.now() });
            const outcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, targetForEffects, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied);
            stillResolving = outcome.pending;
            if (outcome.drawnCards) {
              socket.emit('game:cardsDrawn', { cards: outcome.drawnCards });
            }
          } catch (err) {
            console.error('selectAction effect resolution error', err);
          }
        } else if (result.pending) {
          io.to(roomCode).emit('game:pendingAction', { playerId, actionType: result.kind });
        }

        if (!stillResolving) {
          advanceTurnIfOver(gameState, playerId);
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
```

改為：
```js
        if (sourceEffects) {
          try {
            const resolverEntry = getResolver(effectResolverManager, roomCode);
            const targetForEffects = result.targetPlayerId || playerId;
            const effectResult = resolveEffects(gameState, resolverEntry.promptState, targetForEffects, sourceEffects, { now: Date.now() });
            const outcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, targetForEffects, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied);
            if (outcome.drawnCards) {
              socket.emit('game:cardsDrawn', { cards: outcome.drawnCards });
            }
          } catch (err) {
            console.error('selectAction effect resolution error', err);
          }
        } else if (result.pending) {
          io.to(roomCode).emit('game:pendingAction', { playerId, actionType: result.kind });
        }

        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
```

修改 `game:effectPromptRespond` handler，移除 `if (!resolveOutcome.pending) { advanceTurnIfOver(gameState, choicePlayerId); }` 這個區塊（`resolveOutcome` 變數其餘用途——`.drawnCards`——保留不動）：

原本：
```js
        const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, choicePlayerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied);
        if (!resolveOutcome.pending) {
          advanceTurnIfOver(gameState, choicePlayerId);
        }
        if (resolveOutcome.drawnCards) {
```

改為：
```js
        const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, choicePlayerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied);
        if (resolveOutcome.drawnCards) {
```

修改 `handleEffectChoiceTimeout` 函式裡同樣的區塊：

原本：
```js
    const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied);
    if (!resolveOutcome.pending) {
      advanceTurnIfOver(gameState, playerId);
    }
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
```

改為：
```js
    const resolveOutcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, nextResult, effectChoiceTimeouts, consumeItemIfApplied);
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
```

- [ ] **Step 4: 執行測試確認新測試通過（既有測試會壞，屬於預期，Step 5 處理）**

Run: `cd server && npx jest test/socketHandlers.test.js --forceExit`
Expected: 新增的 4 個 `game:endTurn` 測試 PASS；以下 6 個既有測試會 FAIL（timeout，因為它們在等一個現在不會再發生的自動回合結束）——這是預期中的，Step 5 會逐一修正：
- `'when a move exhausts action points, the turn automatically advances to the next player'`
- `'the turn advances only after a pending effect choice is resolved via game:effectPromptRespond'`
- `'the turn advances only after a pending effect choice times out'`
- `'game:move into a room with an unknown drawType does not crash the room and still advances state'`
- `'an event-deck card requiring a choice defers the turn the same way an item-deck card does'`
- `'an omen-deck card requiring a choice defers the turn the same way an item-deck card does'`

- [ ] **Step 5: 修正 6 個既有測試**

這 6 個測試原本驗證的都是「行動力歸零（且若有待處理選擇，等選擇解決）後，回合自動換人」。新機制下這個前提不成立了，改寫成「回合不會自動換人，需要玩家自己呼叫 `game:endTurn` 才會換人」，驗證的行為改變，但測試的精神（這條路徑最終能正常換到下一位玩家、沒有卡死）保留。

**測試 1** — 找到 `test('when a move exhausts action points, the turn automatically advances to the next player', ...)`，整段改為：

```js
test('when a move exhausts action points, the turn does not auto-advance -- game:endTurn is required', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGame();

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // zeroes AP
  const update = await updatePromise;

  // AP is zero, but the turn must stay with the same player until they
  // explicitly end it -- see Task 5's manual-end-turn mechanism.
  expect(update.turnOrder[update.currentPlayerIndex]).toBe(currentPlayerId);
  const me = update.players.find((p) => p.playerId === currentPlayerId);
  expect(me.actionPoints).toBe(0);

  const nextUpdatePromise = new Promise((resolve) => otherClient.once('game:stateUpdate', resolve));
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);
  const newCurrentPlayer = nextUpdate.players.find((p) => p.playerId === nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]);
  expect(newCurrentPlayer.actionPoints).toBeGreaterThan(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

**測試 2** — 找到 `test('the turn advances only after a pending effect choice is resolved via game:effectPromptRespond', ...)`，整段改為：

```js
test('resolving a pending effect choice does not by itself advance the turn -- game:endTurn is still required', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;

  const respondedUpdatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });
  const respondedUpdate = await respondedUpdatePromise;
  expect(respondedUpdate.turnOrder[respondedUpdate.currentPlayerIndex]).toBe(currentPlayerId);

  // The choice is resolved now, so EFFECT_CHOICE_IN_PROGRESS no longer blocks
  // game:endTurn -- proves resolving the choice actually cleared the gate.
  const nextUpdatePromise = new Promise((resolve) => otherClient.once('game:stateUpdate', resolve));
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

**測試 3** — 找到 `test('the turn advances only after a pending effect choice times out', ...)`，把最後一段（等待 `game:stateUpdate` 顯示換人）改為：先確認逾時解決後回合仍是同一人，再手動呼叫 `game:endTurn` 確認換人。函式其餘部分（設定 `content`、觸發 `game:move`、等 `promptResolvedPromise`）不變，只改測試名稱與最後的斷言區塊：

```js
test('a pending effect choice that times out still requires game:endTurn to advance the turn', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 50,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const timedOutUpdatePromise = new Promise((resolve) => {
    currentClient.on('game:stateUpdate', (data) => {
      const me = data.players.find((p) => p.playerId === currentPlayerId);
      if (me.stats.might.currentIndex < me.stats.might.baseIndex) resolve(data);
    });
  });
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const timedOutUpdate = await timedOutUpdatePromise;
  expect(timedOutUpdate.turnOrder[timedOutUpdate.currentPlayerIndex]).toBe(currentPlayerId);

  const nextUpdatePromise = new Promise((resolve) => otherClient.once('game:stateUpdate', resolve));
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
}, 2000);
```

**測試 4** — 找到 `test('game:move into a room with an unknown drawType does not crash the room and still advances state', ...)`，整段改為：

```js
test('game:move into a room with an unknown drawType does not crash the room, and the turn still ends normally via game:endTurn', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'unknown_deck_type' }],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(result.error).toBeUndefined(); // moveToRoom itself succeeded

  const update = await updatePromise;
  // Despite the resolveCardDraw failure (UNKNOWN_DECK_TYPE), the room stays in
  // sync and nothing crashes -- see M2c-2 final review Important I3. The turn
  // itself no longer auto-advances (Task 5), so confirm it's still endable.
  expect(update.turnOrder[update.currentPlayerIndex]).toBe(currentPlayerId);

  const nextUpdatePromise = new Promise((resolve) => otherClient.once('game:stateUpdate', resolve));
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

**測試 5** — 找到 `test('an event-deck card requiring a choice defers the turn the same way an item-deck card does', ...)`，把最後一段（`advancedUpdatePromise`／斷言）改為手動呼叫 `game:endTurn`：函式開頭到 `blockedMove` 的斷言（`EFFECT_CHOICE_IN_PROGRESS`）都不變，只改最後這段：

原本：
```js
  const advancedUpdatePromise = new Promise((resolve) => {
    currentClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });
  const advancedUpdate = await advancedUpdatePromise;
  expect(advancedUpdate.turnOrder[advancedUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);
```

改為：
```js
  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });

  const advancedUpdatePromise = new Promise((resolve) => otherClient.once('game:stateUpdate', resolve));
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const advancedUpdate = await advancedUpdatePromise;
  expect(advancedUpdate.turnOrder[advancedUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);
```

（這個測試的解構賦值那行 `const { httpServer, clientA, clientB, currentClient, currentPlayerId } = await setUpStartedGameWithContent(content);` 要加上 `otherClient`，改成 `const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);`）

**測試 6** — 找到 `test('an omen-deck card requiring a choice defers the turn the same way an item-deck card does', ...)`，套用跟測試 5 完全相同的修改方式（同樣加上 `otherClient` 解構，同樣把最後的 `advancedUpdatePromise`／`effectPromptRespond` 區塊改成先送出 `effectPromptRespond`，再呼叫 `game:endTurn` 換人）。

- [ ] **Step 6: 順手修正一個現在敘述不準確的既有測試註解（非必要但建議一併處理）**

`test('game:selectAction room_action: resolves the current room\'s effects', ...)`（約在檔案第 1310 行）裡有這段：

```js
  // Opening the door to room_new zeroes AP and ends the turn immediately
  // (confirmed rule: entering a brand-new room never leaves AP for further
  // actions the same turn -- a room's "operation" waits until the player's
  // next turn). Simulate that next turn having come back around to this
  // player, already standing in the now-open room_new with fresh AP.
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  const gameState = getGameState(gameManager, roomCode);
  gameState.currentPlayerIndex = gameState.turnOrder.indexOf(currentPlayerId);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;
```

回合現在不會自動結束了，所以 `gameState.currentPlayerIndex = ...` 這行其實已經是不必要的重置（本來就沒變過），但這個測試的其餘部分（手動把 `actionPoints` 設回 1 來模擬「有行動力可以做房間動作」）仍然成立、不受影響。把註解與這行改為：

```js
  // Manually restore some actionPoints so there's a room action to perform
  // -- opening the door already spent them all on the move itself.
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;
```

（只刪除 `gameState.currentPlayerIndex = gameState.turnOrder.indexOf(currentPlayerId);` 這行並更新註解，`actionPoints = 1` 那行維持不變）

- [ ] **Step 7: 執行完整測試套件確認全部通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS，全部測試（新增的 + 修改過的 + 其餘既有的）都綠燈

- [ ] **Step 8: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(turn): replace automatic AP-triggered turn advance with manual game:endTurn"
```

---

## Task 6: `socketHandlers.js` — 接上召喚物分流與 give/leave/pickup

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `moveSummon`/`selectSummonAction`（Task 4）、`selectAction` 新的 `mode` 支援（Task 3）
- Produces: `game:move`/`game:selectAction` 在 `player.summons` 存在時走召喚物專用邏輯；`game:selectAction` 新增 `mode` 欄位透傳（give/leave/pickup）

- [ ] **Step 1: 寫失敗測試**

在 `server/test/socketHandlers.test.js` 檔案最後新增（沿用既有的 `setUpStartedGameWithContent`/`getGameState`/`getPlayer` 等 helper，不要重新定義）：

```js
test('game:selectAction item mode:give transfers an item to a same-room player via socket', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGame();
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' });

  const result = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003', mode: 'give', targetPlayerId: otherPlayerId }, resolve)
  );
  expect(result.error).toBeUndefined();
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([]);
  expect(getPlayer(gameState, otherPlayerId).inventory).toEqual([{ id: 'item_003' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item mode:leave then mode:pickup round-trips an item through a room\'s droppedItems', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' });

  const leaveResult = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003', mode: 'leave' }, resolve)
  );
  expect(leaveResult.error).toBeUndefined();
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([]);

  const pickupResult = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003', mode: 'pickup' }, resolve)
  );
  expect(pickupResult.error).toBeUndefined();
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_003' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('a player controlling a summon moves the summon via game:move, leaving the player\'s own position untouched', async () => {
  const content = makeContent({
    cards: {
      events: [], items: [],
      omens: [{ id: 'omen_004', name: '犬靈', effects: [{ type: 'switch_control', summonType: 'spiritDog', actionPoints: 6 }] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'omen_004' });
  gameState.board.ground.set('0,-1', { roomId: 'room_manual', x: 0, y: -1, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [] });

  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_004' }, resolve));
  expect(player.summons).toBeTruthy();
  const playerX = player.x;
  const playerY = player.y;

  const moveResult = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'north' }, resolve));
  expect(moveResult.error).toBeUndefined();
  expect(player.summons.x).toBe(0);
  expect(player.summons.y).toBe(-1);
  expect(player.x).toBe(playerX); // player's own position frozen
  expect(player.y).toBe(playerY);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction actionType:dissipate clears the summon and does not end the turn by itself', async () => {
  const content = makeContent({
    cards: {
      events: [], items: [],
      omens: [{ id: 'omen_004', name: '犬靈', effects: [{ type: 'switch_control', summonType: 'spiritDog', actionPoints: 6 }] }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'omen_004' });

  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_004' }, resolve));
  expect(player.summons).toBeTruthy();
  const apBeforeDissipate = player.actionPoints;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'dissipate' }, resolve));
  expect(result.error).toBeUndefined();
  expect(player.summons).toBeNull();
  // Dissipating is a pure state switch -- it must not itself spend the
  // player's own action points or force the turn to end.
  expect(player.actionPoints).toBe(apBeforeDissipate);
  expect(gameState.turnOrder[gameState.currentPlayerIndex]).toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx jest test/socketHandlers.test.js --forceExit`
Expected: FAIL——`mode` 目前完全被忽略（give/leave/pickup 都會被當成一般使用道具處理並嘗試解析 `effects`）；`actionType:'dissipate'` 會被 `selectAction` 拒絕成 `INVALID_ACTION_TYPE`；操控召喚物時 `game:move` 還是會移動玩家本人

- [ ] **Step 3: 實作**

**前置依賴**：這個任務接在 Task 5（回合手動結束機制）之後，Task 5 已經把 `server/src/socketHandlers.js` 頂部的 import 改成 `const { moveToRoom, selectAction, useStairs, endTurn } = require('./game/turnFlow');`（移除了 `isTurnOver`/`advanceTurn`，因為兩者的呼叫者 `advanceTurnIfOver` 已被刪除）。在這個基礎上加上 `moveSummon`、`selectSummonAction`：

```js
const { moveToRoom, moveSummon, selectAction, selectSummonAction, useStairs, endTurn } = require('./game/turnFlow');
```

修改 `game:move` handler，把原本緊接在 `hasPendingEffectChoice` 檢查之後的 `const { direction } = payload || {};` 往前挪到檢查之前一起解構，中間插入召喚物分流：

```js
        if (hasPendingEffectChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        const { direction } = payload || {};
        const player = getPlayer(gameState, playerId);
        if (player.summons) {
          const result = moveSummon(gameState, playerId, direction);
          ack(result);
          io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
          return;
        }
```

（`direction` 只解構一次，兩條路徑共用；原本 `moveToRoom(...)` 開始的既有邏輯完全不變，只是它上面那行重複的 `const { direction } = payload || {};` 要刪掉，因為現在提早解構過了）

修改 `game:selectAction` handler，同樣在 `hasPendingEffectChoice` 檢查之後插入分流，並在既有邏輯裡讓 `mode` 透傳：

```js
        if (hasPendingEffectChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        const player = getPlayer(gameState, playerId);
        if (player.summons) {
          const { actionType, itemId, mode } = payload || {};
          const result = selectSummonAction(gameState, playerId, actionType, { itemId, mode });
          ack(result);
          io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
          return;
        }
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

（`room_action` 分支、`selectAction(...)` 呼叫、`sourceEffects` 之後的處理都不變——只有 `item` 分支的 `itemContent` 查找那段，多包一層 `(!mode || mode === 'use')` 的條件，give/leave/pickup 這三種 `mode` 不需要查內容目錄，也不需要解析 `effects`，`sourceEffects` 對它們來說本來就會保持 `null`，走到既有的 `else if (result.pending)` 之後自然略過。回合是否結束現在完全由玩家另外呼叫 `game:endTurn` 決定，跟這個任務的 `mode` 分流無關，不需要在這裡處理）

**這裡有一個地方要注意**：召喚物分流那段呼叫 `getPlayer(gameState, playerId)` 拿到的 `player` 變數，跟後面既有邏輯裡沒有再宣告一次 `player` 變數（既有邏輯直接用 `playerId`），不會撞名，但插入分流之後，這個新的 `player` 變數在函式其餘部分仍然存在於作用域內——不影響既有邏輯運作（既有邏輯不會用到這個變數），純粹提醒你在複查 diff 時知道這是預期的。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx jest --forceExit`
Expected: PASS，全部既有測試也要綠燈

- [ ] **Step 5: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat(summon): wire game:move/game:selectAction to branch on player.summons, thread item modes"
```

---

## Task 7: 犬靈（omen_004）卡片內容

**Files:**
- Modify: `data/cards/omen-cards.json`

**Interfaces:**
- Consumes: `switch_control` 效果類型（Task 2）
- Produces: `omen_004` 的 `effects` 填入真實內容，`needsCustomLogic` 改 `false`

- [ ] **Step 1: 修改內容**

把 `data/cards/omen-cards.json` 裡 `omen_004`（犬靈）這筆改成：

```json
{ "id": "omen_004", "name": "犬靈", "text": "玩家的力量及意志上升一個級別，如果失去犬靈的追隨，玩家的意志及力量下降一個級別。玩家的回合中可差遣犬靈前往其他房間拾取物品，犬靈不可被丟棄、竊盜或轉交", "effects": [{ "type": "switch_control", "summonType": "spiritDog", "actionPoints": 6 }], "category": "general", "needsCustomLogic": false }
```

**注意**：卡面文字前半段「力量及意志上升一個級別」目前**不會**實際生效——這張卡的 `effects` 只放了 `switch_control`（召喚，對應「差遣犬靈」那句），沒有放 `stat_change`。如果開發者希望「持有犬靈期間」也要有被動的力量/意志加成，需要額外討論怎麼跟 `switch_control` 疊加（`effects` 陣列可以有多個效果，理論上可以加一個 `stat_change`，但「失去犬靈追隨才下降」的反向邏輯目前沒有追蹤機制，跟 M2c-3 已經記錄過的「書/女孩/聖符/瘋漢」同樣的已知限制）。這次先只做「差遣」這半段，被動加成部分留給開發者確認方向後再補，不要自己假設加不加。

- [ ] **Step 2: 驗證**

用 `node -e "JSON.parse(require('fs').readFileSync('data/cards/omen-cards.json','utf8')); console.log('OK')"` 確認 JSON 語法正確。

用一次性腳本（沿用 M2c-3 之前用過的驗證腳本模式：載入真實內容、對這張卡呼叫 `resolveEffects` 確認不拋錯）驗證 `switch_control` 效果本身可以正常解析。

- [ ] **Step 3: Commit**

```bash
git add data/cards/omen-cards.json
git commit -m "feat(m2c3): wire switch_control effect into omen_004 (犬靈) card content"
```

---

## 範圍外事項（本計畫不涵蓋，供之後參考）

- **前端 UI**：召喚物操控期間的限定行動選單（移動/撿取/遺留/消散，行動力為 0 時只有消散亮起）、房間遺留物品的顯示，這些都是 M2d 的範圍，這份計畫只做伺服器端邏輯
- **犬靈的 20 秒行動倒數**：跟專案其他 20 秒計時 UI 一樣延後，這次維持直接事件模式（沒有倒數，玩家自己決定何時消散）
- **`carryingItemId` 限制單一物品**：犬靈一次只能攜帶一件物品，這是設計文件已經定案的限制，不需要額外的「已達上限」訊息以外的處理
- **邪祟階段怪物不能撿取物品**：M3 範圍，現在沒有怪物實體，無從實作
