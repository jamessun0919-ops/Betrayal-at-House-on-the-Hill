# 搜索機制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「進入 item 類型房間自動抽卡」改成「玩家主動選擇搜索行動才取得道具」，event/omen 房間維持自動觸發不變。

**Architecture:** 10 間現有 `drawType:"item"` 房間資料改為 `actions:["搜索"]`＋`item:"random_one"`（其中 room_vault 因為已有非空 `effects`，只改 `drawType`，不加新欄位）；房間被放置到地圖上時把靜態 `item` 欄位複製一份到地圖實體物件（避免污染共用靜態資料）；`game:selectAction actionType:'room_action'` 新增第三分支（沒有 `craftRecipes`、也沒有非空 `effects` 時的預設行為），檢查一回合限一次、依房間實體的 `item` 副本 vs 共用道具牌堆決定搜索結果，找到就 `addItem` 並重用既有 `game:cardDrawn` 訊息樣板，沒找到就廣播新事件 `game:searchEmpty`。

**Tech Stack:** Node.js + Socket.IO 後端（CommonJS，Jest 測試）、React 前端；本計畫僅涉及後端邏輯＋一個前端訊息監聽器，無新 UI 元件。

## Global Constraints

- 搜索消耗 1 點行動力，比照現有 `room_action` 慣例（這些房間沒有 `freeAction`）
- 每位玩家每回合限搜索一次（不分房間），`advanceTurn` 時重置
- `item` 欄位不會預先從共用道具牌堆移除；固定清單裡的 id 如果已被別的房間的 `random_one` 搶先抽走，視為搜不到
- 只修改這次確認的 10 間房間（`room_master_bedroom`／`room_game_room`／`room_larder`／`room_guest_1`／`room_gymnasium`／`room_vault`／`room_weapon_room`／`room_baby`／`room_bathroom_ground`／`room_bathroom_upper`），其餘房間的 `rooms.json`／`starting-rooms.json` 資料完全不動
- 對應設計文件：[docs/superpowers/specs/2026-08-18-search-mechanic-design.md](../specs/2026-08-18-search-mechanic-design.md)

---

## Task 1: 房間地圖實體新增 `item` 欄位（`boardGenerator.js`）

**Files:**
- Modify: `server/src/game/boardGenerator.js`
- Test: `server/test/game/boardGenerator.test.js`

**Interfaces:**
- Consumes: 無（獨立基礎建設任務）
- Produces: `placeNewRoom`/`placeRoomAt`/`placeFixedRoom` 建立的房間地圖實體物件，新增 `item` 欄位（值為 `null` / 字串 `"random_one"` / 陣列，複製自房間定義的 `item` 欄位，陣列一律用 `.slice()` 複製，不共用參照）。後續 Task 4 讀寫 `placedRoom.item`。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/boardGenerator.test.js` 檔案結尾（`STARTING_ROOMS` 常數已在檔案開頭定義，沿用即可）新增：

```javascript
test('placeNewRoom copies the room definition\'s item list onto the placed room, independent of the shared definition', () => {
  const board = createBoard(STARTING_ROOMS);
  const roomDefinition = { id: 'room_a', doors: 4, item: ['item_003', 'item_009'] };

  const placed = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'north', roomDefinition);
  expect(placed.item).toEqual(['item_003', 'item_009']);

  placed.item.push('item_099');
  expect(roomDefinition.item).toEqual(['item_003', 'item_009']); // 靜態定義不受污染
});

test('placeNewRoom defaults item to null when the room definition has no item field', () => {
  const board = createBoard(STARTING_ROOMS);
  const placed = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'north', { id: 'room_a', doors: 4 });
  expect(placed.item).toBeNull();
});

test('placeNewRoom preserves a string item value like "random_one" as-is', () => {
  const board = createBoard(STARTING_ROOMS);
  const placed = placeNewRoom(board, 'ground', { x: 5, y: 5 }, 'north', { id: 'room_a', doors: 4, item: 'random_one' });
  expect(placed.item).toBe('random_one');
});

test('placeRoomAt copies the room definition\'s item field onto the placed room, independent of the shared definition', () => {
  const board = createBoard(STARTING_ROOMS);
  const roomDefinition = { id: 'room_a', doors: 4, item: ['item_003'] };
  const placed = placeRoomAt(board, 'basement', 5, 5, roomDefinition, 'north');
  expect(placed.item).toEqual(['item_003']);
});

test('createBoard sets item to null on the five starting rooms', () => {
  const board = createBoard(STARTING_ROOMS);
  expect(board.ground.get(coordKey(0, 1)).item).toBeNull(); // room_lobby_a
  expect(board.ground.get(coordKey(0, 0)).item).toBeNull(); // room_lobby_b
  expect(board.ground.get(coordKey(0, -1)).item).toBeNull(); // room_lobby_c
  expect(board.upper.get(coordKey(0, 0)).item).toBeNull(); // room_upper_landing
  expect(board.basement.get(coordKey(0, 0)).item).toBeNull(); // room_basement_landing
});
```

- [ ] **Step 2: 執行測試確認 RED**

Run: `cd server && npx jest test/game/boardGenerator.test.js --forceExit`
Expected: 上面 5 個新測試 FAIL（`placed.item`/`board.ground.get(...).item` 目前是 `undefined`，不是預期值）

- [ ] **Step 3: 實作**

在 `server/src/game/boardGenerator.js` 的 `coordKey` 函式後（第 14 行後）新增一個共用小函式：

```javascript
function cloneRoomItem(item) {
  if (Array.isArray(item)) return item.slice();
  return item === undefined ? null : item;
}
```

修改 `placeFixedRoom`（第 16-18 行），新增 `item: null`：

```javascript
function placeFixedRoom(grid, roomId, x, y, doorSides) {
  grid.set(coordKey(x, y), { roomId, x, y, doorSides: doorSides.slice(), droppedItems: [], item: null });
}
```

修改 `placeNewRoom` 裡建立 `placedRoom` 的物件字面值（第 100-106 行）：

```javascript
  const placedRoom = {
    roomId: roomDefinition.id,
    x: newCoord.x,
    y: newCoord.y,
    doorSides: Array.from(doorSides),
    droppedItems: [],
    item: cloneRoomItem(roomDefinition.item),
  };
```

修改 `placeRoomAt` 裡建立 `placedRoom` 的物件字面值（第 148-154 行）：

```javascript
  const placedRoom = {
    roomId: roomDefinition.id,
    x,
    y,
    doorSides: Array.from(doorSides),
    droppedItems: [],
    item: cloneRoomItem(roomDefinition.item),
  };
```

- [ ] **Step 4: 執行測試確認 GREEN**

Run: `cd server && npx jest test/game/boardGenerator.test.js --forceExit`
Expected: 全數 PASS

- [ ] **Step 5: 跑全套後端測試確認無回歸**

Run: `cd server && npx jest --forceExit`
Expected: 全數 PASS（含既有 `droppedItems`/`coordKey` 相關測試不受影響）

- [ ] **Step 6: Commit**

```bash
git add server/src/game/boardGenerator.js server/test/game/boardGenerator.test.js
git commit -m "feat: copy room item field onto placed-room map entities"
```

---

## Task 2: `player.searchedThisTurn` 每回合重置（`turnFlow.js`）

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: 無
- Produces: `advanceTurn` 呼叫後，離開回合的玩家 `player.searchedThisTurn` 重置為 `false`。後續 Task 4 讀寫 `player.searchedThisTurn`（未初始化時視為 falsy，比照既有 `summonUsedThisTurn` 的既有慣例，不需要在 `playerEntity.js` 的 `createPlayer` 額外初始化）。

- [ ] **Step 1: 寫失敗測試**

在 `server/test/game/turnFlow.test.js` 裡，緊接在既有的 `'advanceTurn resets the outgoing player\'s diceInterjectionUsedThisTurn to an empty array'` 測試（約第 853-861 行）之後新增：

```javascript
test('advanceTurn resets the outgoing player\'s searchedThisTurn to false', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0;
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.searchedThisTurn = true;
  advanceTurn(gameState);
  expect(player.searchedThisTurn).toBe(false);
});
```

（`makeGameStateWithPlayer`／`addPlayer`／`makeStats`／`advanceTurn` 都已經是這個測試檔案既有的 import／helper，不需要新增 import。）

- [ ] **Step 2: 執行測試確認 RED**

Run: `cd server && npx jest test/game/turnFlow.test.js -t "searchedThisTurn" --forceExit`
Expected: FAIL（`player.searchedThisTurn` 目前還是 `true`，因為 `advanceTurn` 沒有重置它）

- [ ] **Step 3: 實作**

在 `server/src/game/turnFlow.js` 的 `advanceTurn` 函式裡（約第 517-518 行），緊接在 `outgoingPlayer.diceInterjectionUsedThisTurn = [];` 之後新增一行：

```javascript
    outgoingPlayer.summonUsedThisTurn = false;
    outgoingPlayer.diceInterjectionUsedThisTurn = [];
    outgoingPlayer.searchedThisTurn = false;
```

- [ ] **Step 4: 執行測試確認 GREEN**

Run: `cd server && npx jest test/game/turnFlow.test.js -t "searchedThisTurn" --forceExit`
Expected: PASS

- [ ] **Step 5: 跑全套後端測試確認無回歸**

Run: `cd server && npx jest --forceExit`
Expected: 全數 PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat: reset searchedThisTurn each turn"
```

---

## Task 3: `data/rooms/rooms.json` 資料變更（10 間房間）

**Files:**
- Modify: `data/rooms/rooms.json`

**Interfaces:**
- Consumes: 無
- Produces: 10 間房間的 `drawType` 改為 `null`；其中 9 間（`room_master_bedroom`／`room_game_room`／`room_larder`／`room_guest_1`／`room_gymnasium`／`room_weapon_room`／`room_baby`／`room_bathroom_ground`／`room_bathroom_upper`）新增 `"actions": ["搜索"]`／`"item": "random_one"`；`room_vault` 只改 `drawType`，不新增欄位（它已有非空 `effects`，新欄位會是死資料，已跟開發者確認維持這樣）。後續 Task 4 的整合測試會用合成的 `content` fixture，不依賴這份真實檔案，但手動驗證／最終上線都要靠這份資料。

- [ ] **Step 1: 依序對 9 間房間做以下編輯**（每間房間的 `"id"` 都是檔案內唯一字串，可以用來定位）

`room_master_bedroom`（把
```
    "drawType": "item",
    "text": "",
    "effects": [],
    "needsCustomLogic": false
  },
```
前面緊接著 `"id": "room_master_bedroom"` 的那個區塊）改成：
```
    "drawType": null,
    "text": "",
    "effects": [],
    "needsCustomLogic": false,
    "actions": ["搜索"],
    "item": "random_one"
  },
```

`room_game_room`：同樣把該房間區塊裡的
```
    "drawType": "item",
    "text": "",
    "effects": [],
    "needsCustomLogic": false
  },
```
改成：
```
    "drawType": null,
    "text": "",
    "effects": [],
    "needsCustomLogic": false,
    "actions": ["搜索"],
    "item": "random_one"
  },
```

`room_larder`：把該房間區塊裡的
```
    "drawType": "item",
```
改成：
```
    "drawType": null,
```
並把該房間區塊結尾的
```
    "needsCustomLogic": false
  },
```
（緊接在 `effects` 陣列的 `stat_change`／`might` 那組之後）改成：
```
    "needsCustomLogic": false,
    "actions": ["搜索"],
    "item": "random_one"
  },
```

`room_guest_1`：把
```
    "drawType": "item",
    "text": "",
    "effects": [],
    "needsCustomLogic": false
  },
```
改成：
```
    "drawType": null,
    "text": "",
    "effects": [],
    "needsCustomLogic": false,
    "actions": ["搜索"],
    "item": "random_one"
  },
```

`room_gymnasium`：把該房間區塊裡的 `"drawType": "item",` 改成 `"drawType": null,`，並把該房間區塊結尾的
```
    "needsCustomLogic": false
  },
```
（緊接在 `effects` 陣列的 `stat_change`／`speed` 那組之後）改成：
```
    "needsCustomLogic": false,
    "actions": ["搜索"],
    "item": "random_one"
  },
```

`room_weapon_room`：把
```
    "drawType": "item",
    "text": "",
    "effects": [],
    "needsCustomLogic": false
  },
```
改成：
```
    "drawType": null,
    "text": "",
    "effects": [],
    "needsCustomLogic": false,
    "actions": ["搜索"],
    "item": "random_one"
  },
```

`room_baby`：同樣把
```
    "drawType": "item",
    "text": "",
    "effects": [],
    "needsCustomLogic": false
  },
```
改成：
```
    "drawType": null,
    "text": "",
    "effects": [],
    "needsCustomLogic": false,
    "actions": ["搜索"],
    "item": "random_one"
  },
```

`room_bathroom_ground`：把
```
    "drawType": "item",
    "text": "",
    "effects": [],
    "needsCustomLogic": false
  },
```
改成：
```
    "drawType": null,
    "text": "",
    "effects": [],
    "needsCustomLogic": false,
    "actions": ["搜索"],
    "item": "random_one"
  },
```

`room_bathroom_upper`：把
```
    "drawType": "item",
    "text": "",
    "effects": [],
    "needsCustomLogic": false
  },
```
改成：
```
    "drawType": null,
    "text": "",
    "effects": [],
    "needsCustomLogic": false,
    "actions": ["搜索"],
    "item": "random_one"
  },
```

- [ ] **Step 2: `room_vault` 只改 `drawType`**

把 `room_vault` 區塊裡的
```
    "drawType": "item",
```
改成：
```
    "drawType": null,
```
（`effects`／`needsCustomLogic:true` 維持不動，不新增 `actions`/`item`。）

- [ ] **Step 3: 驗證 JSON 合法且欄位正確**

Run:
```bash
cd "C:\Users\User\Desktop\Betrayal at House on the Hill"
node -e "
const rooms = require('./data/rooms/rooms.json');
const expectFull = ['room_master_bedroom','room_game_room','room_larder','room_guest_1','room_gymnasium','room_weapon_room','room_baby','room_bathroom_ground','room_bathroom_upper'];
for (const id of expectFull) {
  const r = rooms.find(x => x.id === id);
  const ok = r.drawType === null && Array.isArray(r.actions) && r.actions[0] === '搜索' && r.item === 'random_one';
  console.log(id, ok ? 'OK' : 'MISMATCH: ' + JSON.stringify({drawType:r.drawType, actions:r.actions, item:r.item}));
}
const vault = rooms.find(x => x.id === 'room_vault');
console.log('room_vault', (vault.drawType === null && vault.actions === undefined && vault.item === undefined) ? 'OK' : 'MISMATCH');
"
```
Expected: 全部印出 `OK`

- [ ] **Step 4: 跑全套後端測試確認無回歸**

Run: `cd server && npx jest --forceExit`
Expected: 全數 PASS（純內容資料異動，這個階段還沒有程式碼讀取新欄位，理論上不影響任何既有邏輯——Task 4 完成後才會真正被讀取）

- [ ] **Step 5: Commit**

```bash
git add data/rooms/rooms.json
git commit -m "data(rooms): convert item-drawType rooms to the search mechanic"
```

---

## Task 4: 搜索 room_action 邏輯（`socketHandlers.js`）

**Files:**
- Modify: `server/src/socketHandlers.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: Task 1 的 `placedRoom.item`；Task 2 的 `player.searchedThisTurn`；既有的 `gameState.itemDeck`（`{cards: [...]}`，`hasCards(deck)`/`drawCard(deck)` 來自 `./game/cardDeck`，已經是這個檔案既有的 import）；既有的 `addItem(player, {id})`（來自 `./game/playerEntity`，已經是這個檔案既有的 import）
- Produces: 新的伺服器函式 `performSearch(gameState, placedRoom)`，回傳 `{found: false}` 或 `{found: true, card}`（`card` 是從 `gameState.itemDeck.cards` 移除的完整卡片物件，含 `id`/`name`）；新廣播事件 `game:searchEmpty`，payload `{playerId, roomId}`；新錯誤代碼 `ALREADY_SEARCHED_THIS_TURN`

**這個任務會修改一段你在前一個任務（道具合成機制，已經合併）留下的既有程式碼**，目前 `server/src/socketHandlers.js` 裡 `actionType === 'room_action'` 的處理區塊（約第 240-291 行）長這樣：

```javascript
        if (actionType === 'room_action') {
          const currentPlayer = getPlayer(gameState, playerId);
          const placedRoom = gameState.board[currentPlayer.floor].get(coordKey(currentPlayer.x, currentPlayer.y));

          if (placedRoom.roomId === 'room_collapsed_room' && placedRoom.collapseLink) {
            const jumpResult = jumpIntoCollapsedRoom(gameState, playerId);
            ack(jumpResult);
            const enteredRoom = gameState.board.basement.get(coordKey(jumpResult.x, jumpResult.y));
            io.to(roomCode).emit('game:roomEntered', { playerId, roomId: enteredRoom.roomId });
            io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
            return;
          }

          const roomDefinition = findRoomDefinition(content, placedRoom.roomId);

          if (roomDefinition && Array.isArray(roomDefinition.craftRecipes) && roomDefinition.craftRecipes.length > 0) {
            const currentPlayer = getPlayer(gameState, playerId);
            const heldIds = currentPlayer.inventory.map((item) => item.id);
            const recipe = roomDefinition.craftRecipes.find((r) => r.ingredients.every((id) => heldIds.includes(id)));
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
          } else {
            sourceEffects =
              roomDefinition && Array.isArray(roomDefinition.effects) && roomDefinition.effects.length > 0
                ? roomDefinition.effects
                : null;
          }
          selectOptions.hasRoomAction = Boolean(sourceEffects);
          selectOptions.freeRoomAction = Boolean(roomDefinition && roomDefinition.freeAction);
          sourceId = placedRoom.roomId;
        }
```

- [ ] **Step 1: 寫失敗測試（搜索找到 random_one 道具）**

在 `server/test/socketHandlers.test.js` 裡，找到既有的
```javascript
test('game:selectAction room_action: throws NO_ROOM_ACTION_AVAILABLE when the current room has no effects', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();
  // Default starting room (entrance hall) has no `effects` field.

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBe('NO_ROOM_ACTION_AVAILABLE');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```
**這個測試斷言的行為在新設計下不再成立，整段替換成**：

```javascript
test('game:selectAction room_action: a room with no effects/craftRecipes defaults to search, and the starting entrance hall finds nothing (item defaults to null)', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGame();
  // Default starting room (entrance hall) has no `effects`/`craftRecipes`/`item` field -- search defaults apply.
  const gameState = getGameState(gameManager, roomCode);
  const apBeforeSearch = getPlayer(gameState, currentPlayerId).actionPoints;

  const searchEmptyPromise = new Promise((resolve) => currentClient.once('game:searchEmpty', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const searchEmpty = await searchEmptyPromise;
  expect(searchEmpty.playerId).toBe(currentPlayerId);

  expect(getPlayer(gameState, currentPlayerId).actionPoints).toBe(apBeforeSearch - 1);

  clientA.close();
  clientB.close();
  httpServer.close();
});

function makeSearchRoomContent(itemField) {
  return makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', item: itemField }],
  });
}

test('game:selectAction room_action with item:"random_one": finds a card from the shared item deck, adds it to inventory, and clears the room to null', async () => {
  const content = makeSearchRoomContent('random_one');
  content.cards.items = [{ id: 'item_001', name: '測試道具', effects: [] }];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.deckType).toBe('item');
  expect(cardDrawn.cardId).toBe('item_001');

  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_001' }]);
  expect(gameState.itemDeck.cards).toEqual([]);
  const placedRoom = gameState.board.ground.get(coordKey(1, 1));
  expect(placedRoom.item).toBeNull();

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: 執行測試確認 RED**

在執行測試前，先在 `server/test/socketHandlers.test.js` 檔案開頭（第 9 行 `const { attachModifier } = require('../src/game/modifiers');` 之後）新增一行 import（這個檔案目前還沒有 import `coordKey`，上面的測試會用到它）：

```javascript
const { coordKey } = require('../src/game/boardGenerator');
```

Run: `cd server && npx jest test/socketHandlers.test.js -t "room_action" --forceExit`
Expected: 兩個新測試 FAIL（`NO_ROOM_ACTION_AVAILABLE` 仍然被拋出；`game:cardDrawn`/`game:searchEmpty` 從未被觸發過）

- [ ] **Step 3: 實作 `performSearch` 與新的 room_action 分支**

在 `server/src/socketHandlers.js` 的 `resolveCardDraw` 函式（第 721 行）之前新增：

```javascript
function performSearch(gameState, placedRoom) {
  const itemDeck = gameState.itemDeck;

  if (placedRoom.item === 'random_one') {
    if (!hasCards(itemDeck)) {
      return { found: false };
    }
    const card = drawCard(itemDeck);
    placedRoom.item = null;
    return { found: true, card };
  }

  if (Array.isArray(placedRoom.item) && placedRoom.item.length > 0) {
    const availableIds = placedRoom.item.filter((id) => itemDeck.cards.some((c) => c.id === id));
    if (availableIds.length === 0) {
      return { found: false };
    }
    const chosenId = availableIds[Math.floor(Math.random() * availableIds.length)];
    const index = itemDeck.cards.findIndex((c) => c.id === chosenId);
    const [card] = itemDeck.cards.splice(index, 1);
    placedRoom.item = placedRoom.item.filter((id) => id !== chosenId);
    return { found: true, card };
  }

  return { found: false };
}
```

把 `if (actionType === 'room_action') { ... }` 整段（上面引用的既有程式碼）替換成：

```javascript
        if (actionType === 'room_action') {
          const currentPlayer = getPlayer(gameState, playerId);
          const placedRoom = gameState.board[currentPlayer.floor].get(coordKey(currentPlayer.x, currentPlayer.y));

          if (placedRoom.roomId === 'room_collapsed_room' && placedRoom.collapseLink) {
            const jumpResult = jumpIntoCollapsedRoom(gameState, playerId);
            ack(jumpResult);
            const enteredRoom = gameState.board.basement.get(coordKey(jumpResult.x, jumpResult.y));
            io.to(roomCode).emit('game:roomEntered', { playerId, roomId: enteredRoom.roomId });
            io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
            return;
          }

          const roomDefinition = findRoomDefinition(content, placedRoom.roomId);
          let isSearchAction = false;

          if (roomDefinition && Array.isArray(roomDefinition.craftRecipes) && roomDefinition.craftRecipes.length > 0) {
            const heldIds = currentPlayer.inventory.map((item) => item.id);
            const recipe = roomDefinition.craftRecipes.find((r) => r.ingredients.every((id) => heldIds.includes(id)));
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
          } else if (roomDefinition && Array.isArray(roomDefinition.effects) && roomDefinition.effects.length > 0) {
            sourceEffects = roomDefinition.effects;
          } else {
            isSearchAction = true;
            if (currentPlayer.searchedThisTurn) {
              throw new Error('ALREADY_SEARCHED_THIS_TURN');
            }
          }
          selectOptions.hasRoomAction = Boolean(sourceEffects) || isSearchAction;
          selectOptions.freeRoomAction = Boolean(roomDefinition && roomDefinition.freeAction);
          sourceId = placedRoom.roomId;

          if (isSearchAction) {
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

（這個替換同時清掉了上一個任務遺留的重複 `const currentPlayer` 宣告——原本 `craftRecipes` 分支內又宣告了一次 `currentPlayer`，其實跟外層是同一個玩家，現在改成直接重用外層那個。）

- [ ] **Step 4: 執行測試確認 GREEN**

Run: `cd server && npx jest test/socketHandlers.test.js -t "room_action" --forceExit`
Expected: 全數 PASS

- [ ] **Step 5: 補齊其餘場景的測試（一次寫完，一次驗證）**

繼續在 `server/test/socketHandlers.test.js` 新增：

```javascript
test('game:selectAction room_action with item:"random_one": finds nothing when the shared item deck is empty, and the item field is unchanged', async () => {
  const content = makeSearchRoomContent('random_one');
  content.cards.items = [];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const searchEmptyPromise = new Promise((resolve) => currentClient.once('game:searchEmpty', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  await searchEmptyPromise;

  const placedRoom = gameState.board.ground.get(coordKey(1, 1));
  expect(placedRoom.item).toBe('random_one'); // 沒有真的抽到，狀態不變

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with a fixed item list: finds one of the listed ids still present in the shared deck and removes it from the room\'s own list', async () => {
  const content = makeSearchRoomContent(['item_001', 'item_002']);
  content.cards.items = [{ id: 'item_002', name: '測試道具', effects: [] }]; // item_001 already taken elsewhere
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  const cardDrawn = await cardDrawnPromise;
  expect(cardDrawn.cardId).toBe('item_002');

  const placedRoom = gameState.board.ground.get(coordKey(1, 1));
  expect(placedRoom.item).toEqual(['item_001']);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action with a fixed item list: finds nothing when every listed id has already been taken from the shared deck', async () => {
  const content = makeSearchRoomContent(['item_001']);
  content.cards.items = []; // item_001 already gone (taken by another room's random_one)
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const searchEmptyPromise = new Promise((resolve) => currentClient.once('game:searchEmpty', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  await searchEmptyPromise;

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: a second search in the same turn is rejected with ALREADY_SEARCHED_THIS_TURN, without spending an action point', async () => {
  const content = makeSearchRoomContent('random_one');
  content.cards.items = [
    { id: 'item_001', name: '測試道具1', effects: [] },
    { id: 'item_002', name: '測試道具2', effects: [] },
  ];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 2;

  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  const afterFirst = getPlayer(gameState, currentPlayerId).actionPoints;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBe('ALREADY_SEARCHED_THIS_TURN');
  expect(getPlayer(gameState, currentPlayerId).actionPoints).toBe(afterFirst); // 沒有再扣一次

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: existing craftRecipes/effects rooms are unaffected by the search branch (regression)', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const effectResolved = await effectResolvedPromise;
  expect(effectResolved.sourceId).toBe('room_new');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 6: 執行測試確認 GREEN**

Run: `cd server && npx jest test/socketHandlers.test.js -t "room_action" --forceExit`
Expected: 全數 PASS（連同 Step 1 的測試，總共 7 個新/改寫測試）

- [ ] **Step 7: 跑全套後端測試確認無回歸**

Run: `cd server && npx jest --forceExit`
Expected: 全數 PASS

- [ ] **Step 8: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: add search room_action (replaces item-room auto-draw)"
```

---

## Task 5: 前端「搜索沒找到」訊息（`DebugGameScreen.jsx`）

**Files:**
- Modify: `client/src/DebugGameScreen.jsx`

**Interfaces:**
- Consumes: Task 4 廣播的 `game:searchEmpty`（payload `{playerId, roomId}`）
- Produces: 訊息欄新增一則「{玩家名稱} 搜索了房間，但沒有找到任何東西」訊息

**沒有自動化前端測試套件（`client/package.json` 只有 `build`，沒有 test script）**，這個任務用 `npm run build` 驗證語法正確，實機驗證留到全部任務完成後的手動瀏覽器驗證階段。

- [ ] **Step 1: 新增事件監聽器**

在 `client/src/DebugGameScreen.jsx` 的 `useEffect`（第 65 行開始）裡，緊接在 `onRoomEntered` 函式（第 115-119 行）之後新增：

```javascript
    function onSearchEmpty(data) {
      const playerName = findPlayerName(data.playerId, gameState?.players);
      setMessages((prev) => [...prev, `${playerName} 搜索了房間，但沒有找到任何東西`]);
    }
```

在 `socket.on('game:roomEntered', onRoomEntered);`（第 142 行）之後新增：

```javascript
    socket.on('game:searchEmpty', onSearchEmpty);
```

在對應的 `socket.off('game:roomEntered', onRoomEntered);`（第 156 行）之後新增：

```javascript
    socket.off('game:searchEmpty', onSearchEmpty);
```

- [ ] **Step 2: 驗證 build 通過**

Run: `cd client && npm run build`
Expected: 成功（無語法錯誤）

- [ ] **Step 3: Commit**

```bash
git add client/src/DebugGameScreen.jsx
git commit -m "feat: show a message when a search finds nothing"
```

---

## 全部任務完成後：手動驗證

1. 關閉並重啟本機測試伺服器（後端 `server/src/index.js`、前端 `client`）
2. 雙人建房→選角→進遊戲，走到其中一間已轉換的搜索房間（例如武器室／嬰兒房），按「行動」，確認：
   - 第一次搜索：找到道具（訊息欄出現「XX 在房間裡找到了 YY」）或沒找到（「XX 搜索了房間，但沒有找到任何東西」），行動力減 1
   - 同一回合再按一次「行動」：`actionError` 顯示 `ALREADY_SEARCHED_THIS_TURN`，行動力不變
   - 結束回合後，同一位玩家可以再搜索一次
3. 走到既有的合成房間（廚房）／保險庫，確認「行動」行為不受影響（合成/開保險箱邏輯照舊）
4. 檢查 console 無錯誤
