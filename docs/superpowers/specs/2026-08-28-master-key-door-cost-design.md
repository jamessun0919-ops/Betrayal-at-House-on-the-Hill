# item_028 萬能鑰匙（開門行動力折扣）設計文件

## 背景與目標

`item_028`（萬能鑰匙）卡面文字：「持有萬能鑰匙可以將解鎖房間的行動力由２點降為１點」。Handover 原本記錄這需要「新增一種 `persistent_modifier` 掛鉤類型」，但查證後確認：現有 `persistent_modifier`／`modifiers` 陣列機制是「效果解析時附加一個可能之後要移除的修飾」（例如 `blocksOpenDoor`），設計上沒有「只要持有某張卡就自動套用、卡片離手就自動移除」這種生命週期；`omen` 卡「抽到時自動套用效果」也是抽卡動作專屬，不是任何 `addItem` 都會觸發。這份文件把實際採用的機制定案。

## 架構決策

**開門扣行動力的當下，直接查詢玩家背包是否持有 `item_028`**，不透過 `modifiers` 陣列或任何附加/移除的生命週期機制。理由：
- 不需要在搜索、合成產出、給予接收、道具牌堆抽取等所有「取得道具」的入口補上自動掛載邏輯，範圍小很多
- 沒有「卡片離手時要不要自動反轉」的問題——每次都是即時查詢當下背包狀態，道具給出去/遺留/失去，下一次開門就自動變回原價，不會有殘留或忘記移除的風險
- 跟現有 `COLLAPSED_ROOM_ID`／`BALLROOM_ID`／`GALLERY_ID` 硬編特定 ID 的既有前例一致（這次是硬編道具 ID，不是房間 ID）

`item_028` 卡片資料本身**不需要任何修改**——`effects` 維持空陣列，`needsCustomLogic` 已經是 `false`（正確，機制完全不透過 `effects` 表達）。整個功能只改 `server/src/game/turnFlow.js`。

## 實作內容

`OPEN_DOOR_AP_COST`（`turnFlow.js:16`）目前有兩個使用點：
- `getAvailableDirections`（`:50`）：`canAffordOpenDoor = player.actionPoints >= OPEN_DOOR_AP_COST`，決定「開門」這個選項要不要出現在可用方向清單
- `moveToRoom`（:179）：`player.actionPoints -= OPEN_DOOR_AP_COST`，實際扣款

兩處都要用一致的折扣後費用，否則會出現「顯示可以開門但扣款金額對不上」（或反過來）的不一致。新增一個共用函式，兩處都改呼叫它：

```javascript
const OPEN_DOOR_AP_COST = 2;
const OPEN_DOOR_AP_COST_WITH_MASTER_KEY = 1;
const MASTER_KEY_ITEM_ID = 'item_028';

function getOpenDoorCost(player) {
  const holdsMasterKey = player.inventory.some((item) => item.id === MASTER_KEY_ITEM_ID);
  return holdsMasterKey ? OPEN_DOOR_AP_COST_WITH_MASTER_KEY : OPEN_DOOR_AP_COST;
}
```

- `getAvailableDirections`：`canAffordOpenDoor = player.actionPoints >= getOpenDoorCost(player)`
- `moveToRoom`：`player.actionPoints -= getOpenDoorCost(player)`

## 範圍排除（這次不處理）

- `item_028` 目前 `category:"reusable"`，選單會顯示「使用」按鈕，但這個機制完全被動、沒有任何主動觸發的效果——點擊「使用」不會有任何反應（`effects` 是空陣列，`resolveEffects` 對空陣列本來就是安全的無操作）。這是既有的卡片分類選擇，這次不重新討論 `category` 是否該換成別的分類，僅記錄供之後參考。

## 測試重點

- 持有 `item_028` 時，開門的可負擔判斷與實際扣款都用 1 點行動力
- 沒有持有時，維持原本 2 點行動力（既有行為不變，回歸測試）
- 只有 1 點行動力、持有 `item_028`：可以開門（因為折扣後費用剛好負擔得起），且開門後行動力歸零
- 只有 1 點行動力、沒有持有 `item_028`：開門選項不出現在可用方向清單裡（原有行為，用來確認折扣沒有意外影響到「沒持有」的情況）
- 遺留／給予 `item_028` 後，下一次開門立即恢復 2 點行動力費用（驗證即時查詢、無殘留狀態）
