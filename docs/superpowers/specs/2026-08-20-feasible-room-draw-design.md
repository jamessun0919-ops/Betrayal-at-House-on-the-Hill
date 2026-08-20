# 先判斷合理房型再抽房間卡 設計文件

> **狀態：設計已核准，尚未實作。**

## 背景與目標

開門進入新房間時，目前的流程是先隨機抽一張房間卡，再嘗試幫它湊出一組跟已放置鄰房不衝突的門位置（`computeDoorLayout`）。如果這張卡宣告的門數（`doors`）在目前的位置怎麼湊都會跟鄰房衝突，`computeDoorLayout` 既有的規則（這次改動之前就存在）會直接放棄湊出宣告的門數，把房間強制退化成只剩入口那一扇門——不管這間房原本宣告幾扇門。

這個退化情況會造成房間美術圖跟真實遊戲邏輯的門數不一致（房間圖片仍照原本門數繪製，但只有入口方向真的能通行），也是這次「房間圖片旋轉機制」（[2026-08-20-room-image-rotation-design.md](2026-08-20-room-image-rotation-design.md)）全分支審查抓到的 Critical 問題最終根源——那次審查用真實 `rooms.json` 模擬 500 局遊戲，**全部都會踩到**這個退化情況，平均在第 8 間房就會發生。

目標：抽房間卡時，優先抽一張「不需要退化就能放進這個位置」的卡，大幅減少（但無法完全消除，見下方「已知限制」）退化成單門房的情況。

## 設計

### 可行性檢查：`isDoorLayoutFeasible`（`server/src/game/boardGenerator.js`）

新增匯出函式：

```js
function isDoorLayoutFeasible(board, floor, fromCoord, direction, doors, doorPattern) {
  const grid = board[floor];
  const delta = DIRECTION_DELTA[direction];
  const targetCoord = { x: fromCoord.x + delta.dx, y: fromCoord.y + delta.dy };
  const entrySide = OPPOSITE_SIDE[direction];
  const getNeighborRequirement = makeNeighborRequirementReader(grid, targetCoord);
  const doorSides = computeDoorLayout(doors, entrySide, getNeighborRequirement, doorPattern || null);
  return doorSides.size === doors;
}
```

不重新設計一套「合理房型」的判斷規則，而是**直接重用現有的 `computeDoorLayout`**（跟 `placeNewRoom`/`placeRoomAt` 用的是同一套引擎）當作可行性檢查器：實際跑一次真正的門位配置演算法，如果算出來的門位數量等於這個房型宣告的 `doors` 數量，代表這個房型不用退化就能放進這個位置；如果算出來的比較少，代表會撞上既有的退化 fallback。這樣保證可行性判斷永遠跟實際放置時的引擎結果一致，不會有兩套邏輯各自維護、彼此漂移的風險。

參數形狀（`board, floor, fromCoord, direction, doors, doorPattern`）刻意比照現有 `placeNewRoom` 的呼叫慣例，呼叫端不需要知道 `entrySide`／鄰房查詢的內部細節。

### 篩選抽卡：`drawFeasibleRoom`（`server/src/game/roomDeck.js`）

新增函式：

```js
function drawFeasibleRoom(deck, floor, isFeasible) {
  const attempts = deck.cards.length;
  for (let i = 0; i < attempts; i++) {
    const room = deck.cards.shift();
    if ((room.floor === floor || room.floor === 'any') && isFeasible(room)) {
      return room;
    }
    deck.cards.push(room);
  }
  // 整副牌都試過一輪，找不到「樓層對、門型又可行」的卡——回退成原本的
  // drawRoom（只看樓層），可能之後會被 computeDoorLayout 的既有 fallback
  // 退化，這是刻意接受的極端情況，見設計文件「已知限制」。
  return drawRoom(deck, floor);
}
```

邏輯完全比照現有 `drawRoom`（樓層不合就搬到牌堆尾端、換下一張），只是多一個 `isFeasible(room)` 判斷條件。整副牌試過一輪都找不到符合的卡時，直接呼叫既有的 `drawRoom(deck, floor)` 退回原本行為。**這一輪失敗的搜尋不會弄亂牌堆順序**：每張牌被 `shift()` 之後如果不符合就 `push()` 回尾端，一輪跑完（`attempts` 次）陣列會剛好繞回原本的順序，所以緊接著呼叫 `drawRoom` 拿到的還是原本洗牌後該輪到的那張牌，不是被搜尋過程污染過的順序。

### 串接進 `moveToRoom`（`server/src/game/turnFlow.js`）

把現有的兩處 `drawRoom(gameState.roomDeck, player.floor)` 都換成 `drawFeasibleRoom(gameState.roomDeck, player.floor, isFeasible)`，`isFeasible` 是一個小閉包，把這次開門的座標／方向代入 `isDoorLayoutFeasible`：

```js
const isFeasible = (room) => isDoorLayoutFeasible(gameState.board, player.floor, { x: player.x, y: player.y }, direction, room.doors, room.doorPattern);
let roomDefinition = drawFeasibleRoom(gameState.roomDeck, player.floor, isFeasible);
while (isBallroomOrGallery(roomDefinition.id)) {
  // ...既有的配對座標衝突檢查邏輯不變...
  roomDefinition = drawFeasibleRoom(gameState.roomDeck, player.floor, isFeasible);
}
```

**舞廳/包廂配對的既有重抽迴圈不需要改動任何判斷邏輯**：配對座標是否被佔用是另一個獨立條件（檢查的是另一個樓層的座標），跟這次新增的門型可行性檢查完全無關，只是重抽時一樣呼叫新的 `drawFeasibleRoom`，兩個機制自然疊加。`hasRoomForFloor`（判斷「牌庫是否還有這個樓層的卡」，決定要不要允許最後一張卡強制通過配對衝突檢查的既有例外）維持只看牌堆卡片數量，不牽扯門型可行性判斷，避免混淆兩個獨立的既有規則。

## 已知限制

即使做了這個機制，`drawFeasibleRoom` 找不到任何符合門型的卡時，仍然會退回原本的 `drawRoom` 行為、之後可能被 `computeDoorLayout` 退化成單門房——這個極端情況（牌庫剩下的卡全部門型都跟目前位置衝突）沒辦法完全消除，只是發生機率大幅降低。這個殘留情況已經由「房間圖片旋轉機制」功能的 `computeRotation`（遇到門數不合時回退角度 0，不拋錯）當作安全網處理過，兩個機制不互斥、也不需要互相依賴。

## 範圍排除

- **只改主要開門路徑**（`moveToRoom`）。崩塌房間掉落地下室的生成（`applyCollapseCheck`，`guaranteedSide` 隨機選、不是玩家選的方向）維持原樣不動——地下室通常是尚未探索的新地區，鄰房衝突機率本來就低，先不處理。
- 純伺服器端邏輯改動，`getAvailableDirections`（決定要不要顯示「開門」選項）不需要修改——它只判斷「這個方向有沒有門、有沒有房間、牌庫還有沒有卡」，不涉及具體門型是否可行，可行性判斷延後到實際抽卡放置時才發生。
- 前端完全不需要改動。

## 測試重點

- `isDoorLayoutFeasible`：對已知的鄰房衝突情境（例如既有測試 `doorLayout.test.js` 的 `'falls back to entry-only when no rotation can satisfy conflicting neighbor requirements'` 案例），驗證回傳 `false`；對沒有衝突的情境驗證回傳 `true`。
- `drawFeasibleRoom`：牌堆裡有符合門型的卡時，優先抽到它（即使它不是牌堆最前面那張）；牌堆裡完全沒有符合門型的卡時，退回 `drawRoom` 原本行為，且牌堆順序不受影響。
- `moveToRoom` 整合測試：在真實會產生鄰房衝突的盤面配置下開門，驗證放置的房間不再退化成單門（門數等於宣告值）；舞廳/包廂配對衝突＋門型不可行同時發生時，兩個重抽條件都正確生效。
