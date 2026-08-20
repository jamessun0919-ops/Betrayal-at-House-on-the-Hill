# 先判斷合理房型再抽房間卡 設計文件

> **狀態：已實作並合併進 `main`。** 全分支審查抓到 1 個 Critical（舞廳/包廂重抽迴圈的無限迴圈風險），已修復並複審通過——詳見下方「串接進 `moveToRoom`」與「已知限制」的終止性論證。

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

把現有的兩處 `drawRoom(gameState.roomDeck, player.floor)` 都換成 `drawFeasibleRoom(gameState.roomDeck, player.floor, isFeasible)`，`isFeasible` 是一個小閉包，把這次開門的座標／方向代入 `isDoorLayoutFeasible`。

**⚠️ 全分支審查後修正（見下方「已知限制」的終止性論證）**：舞廳/包廂配對的既有重抽迴圈原本規劃「不需要改動任何判斷邏輯」，但全分支審查抓到一個 Critical——`drawFeasibleRoom` 的可行性篩選會打破 `drawRoom` 原本隱含的「重抽一定會換到別張牌」保證，在特定盤面下會讓這個迴圈永久卡死（server 掛起）。修正後的實際程式碼會在迴圈外宣告一個 `rejectedIds` 集合，每次拒絕重抽時把被拒絕的房間 id 記進去，重抽時額外排除已經被拒絕過的 id：

```js
const isFeasible = (room) => isDoorLayoutFeasible(gameState.board, player.floor, { x: player.x, y: player.y }, direction, room.doors, room.doorPattern);
let roomDefinition = drawFeasibleRoom(gameState.roomDeck, player.floor, isFeasible);
const rejectedIds = new Set();
while (isBallroomOrGallery(roomDefinition.id)) {
  // ...既有的配對座標衝突檢查邏輯不變...
  rejectedIds.add(roomDefinition.id);
  gameState.roomDeck.cards.push(roomDefinition);
  roomDefinition = drawFeasibleRoom(
    gameState.roomDeck,
    player.floor,
    (room) => !rejectedIds.has(room.id) && isFeasible(room)
  );
}
```

配對座標是否被佔用（`hasRoomForFloor`／`pairedOccupied` 的判斷邏輯）本身維持不變，只有重抽時多套用一層「排除已拒絕過的 id」。

## 已知限制

- **即使做了這個機制，仍然無法完全消除退化成單門房的情況**：`drawFeasibleRoom` 找不到任何符合門型的卡時，會退回原本的 `drawRoom` 行為、之後可能被 `computeDoorLayout` 退化成單門房——這個極端情況（牌庫剩下的卡全部門型都跟目前位置衝突）沒辦法完全消除，只是發生機率大幅降低。這個殘留情況已經由「房間圖片旋轉機制」功能的 `computeRotation`（遇到門數不合時回退角度 0，不拋錯）當作安全網處理過，兩個機制不互斥、也不需要互相依賴。
- **舞廳/包廂重抽迴圈的終止性論證**：`rejectedIds` 保證同一張房間卡在同一次 `moveToRoom` 呼叫裡不會被重複判定為「可行」而重抽到；一旦排除掉所有已拒絕的房間，`drawFeasibleRoom` 找不到符合條件的卡時會退回 `drawRoom(deck, floor)`——因為 `drawFeasibleRoom` 失敗的搜尋一輪保證會把牌堆順序完整還原（見上方「篩選抽卡」段落），剛被拒絕、推到牌堆尾端的那張房間卡在這次 `drawRoom` 呼叫時仍然在尾端，而 `hasRoomForFloor` 已經保證牌堆裡還有其他同樓層的卡排在它前面，所以 `drawRoom` 一定會抽到別張——恢復了這個迴圈在這次改動之前就有的「重抽一定會前進」保證。
- **牌堆順序的長期偏移**：`drawFeasibleRoom` 除了樓層不符的牌，也會把「符合樓層但暫時不可行」的牌轉到牌堆尾端。長期下來，門位限制較嚴的房型（4 門房、2 門 opposite）會系統性地更容易沉到牌堆後段，使抽牌分布不再是單純的洗牌均勻分布。這是這個機制刻意的設計結果（優先抽可行的房型），不是缺陷，記錄供之後留意。

## 範圍排除

- **只改主要開門路徑**（`moveToRoom`）。崩塌房間掉落地下室的生成（`applyCollapseCheck`，`guaranteedSide` 隨機選、不是玩家選的方向）維持原樣不動——地下室通常是尚未探索的新地區，鄰房衝突機率本來就低，先不處理。
- 純伺服器端邏輯改動，`getAvailableDirections`（決定要不要顯示「開門」選項）不需要修改——它只判斷「這個方向有沒有門、有沒有房間、牌庫還有沒有卡」，不涉及具體門型是否可行，可行性判斷延後到實際抽卡放置時才發生。
- 前端完全不需要改動。

## 測試重點

- `isDoorLayoutFeasible`：對已知的鄰房衝突情境（例如既有測試 `doorLayout.test.js` 的 `'falls back to entry-only when no rotation can satisfy conflicting neighbor requirements'` 案例），驗證回傳 `false`；對沒有衝突的情境驗證回傳 `true`。
- `drawFeasibleRoom`：牌堆裡有符合門型的卡時，優先抽到它（即使它不是牌堆最前面那張）；牌堆裡完全沒有符合門型的卡時，退回 `drawRoom` 原本行為，且牌堆順序不受影響。
- `moveToRoom` 整合測試：在真實會產生鄰房衝突的盤面配置下開門，驗證放置的房間不再退化成單門（門數等於宣告值）；舞廳/包廂配對衝突＋門型不可行同時發生時，兩個重抽條件都正確生效。
