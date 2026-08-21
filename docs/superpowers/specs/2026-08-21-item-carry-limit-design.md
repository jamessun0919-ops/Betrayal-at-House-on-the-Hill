# 物品攜帶數量上限機制 設計文件

> **狀態：設計已核准，尚未實作。**

## 背景與目標

玩家能攜帶的道具卡數量（只計算道具卡，不含預兆卡）上限＝目前的力量值。取得道具後如果超過上限，需要選擇遷留一件在該房間（此遺留行為不扣行動力）。

目標：不管道具是透過哪一種方式取得（搜索、卡片效果、給予、撿取），都要一致套用這個上限規則，並且不影響既有的「暫停等待玩家選擇」流程慣例。

## 關鍵發現：目前有 3 條完全獨立的「道具進背包」路徑

- `server/src/game/playerEntity.js` 的 `addItem()`：6 個呼叫點（起始道具、卡片 `grant_item` 效果、搜索、`draw_card`/`preview_and_choose` 抽卡效果）
- `server/src/game/turnFlow.js` 的 `giveItemAction`：直接 `targetPlayer.inventory.push(item)`
- `server/src/game/turnFlow.js` 的 `pickupItemAction`：直接 `player.inventory.push(item)`

後兩者沒有經過 `addItem()`。這次改動會讓 `giveItemAction`／`pickupItemAction` 也改成呼叫 `addItem()`，讓**所有**道具進背包的動作都經過同一個函式，上限檢查只需要寫在一個地方，未來新增任何取得道具的路徑也會自動套用，不會漏掉。

`addItem()` 本身維持「一定成功加進背包」——道具卡不會因為超過上限被拒絕加入，只是加入後可能連帶需要選一件遷留。

## 資料模型：判斷「道具卡」與計算上限

新增輔助函式 `countHeldItems(player, cardContent)`：只計算背包裡 `id` 對應到 `cardContent.items`（道具卡）的筆數，預兆卡（`cardContent.omens`）不計入。跟前端既有的 `isOmenCard` 判斷邏輯共用同一份 `cardContent` 資料，不另外維護一套分類規則。

上限＝ `getStatValue(player, 'might')`（目前的力量值，含級距/overflow，跟其他機制使用的算法一致）。

**已確認：力量值變動（受傷/被治療）不會回溯觸發遷留選擇**——只在實際取得新道具的當下檢查一次。玩家可能因為受傷而「合法」持有超過新上限的道具，直到下次再取得新道具時才會被要求遷留（可能要遷留不只一件，直到回到上限內）。

## 新的暫停狀態：`pendingInventoryChoice`

這次的選項是「玩家當下持有哪些道具卡」，是動態產生、依當時背包內容決定，跟既有 `pendingChoice`（卡片作者預先寫死的固定分支選項）性質不同，所以**不重用 `pendingChoice` 的資料結構**，新增一個平行的暫停狀態欄位——延續本專案既有的架構慣例（`pendingChoice`／`pendingRollChoice` 都是「不同性質的暫停各自開一個新欄位」，不是這次臨時發明）。

```js
// resolverEntry.pendingInventoryChoice
{
  playerId,
  itemIds: [...],        // 玩家目前持有的道具卡 id 清單（動態產生，不含預兆卡）
  triggeredByItemId,     // 這次觸發超過上限的那一件道具 id，逾時預設遷留這件
  deadline
}
```

新增：
- socket 事件 `game:inventoryChoicePending`（廣播提示彈窗，含 `playerId`／`itemIds`）
- socket 事件 `game:inventoryChoiceRespond`（玩家回應要遷留哪一件的道具 id）
- 逾時計時器（比照既有 `effectChoiceTimeouts` 的做法），**逾時預設自動遷留剛取得的那一件**（`triggeredByItemId`），維持玩家原本持有的道具不變
- 未解決前，任何會推進遊戲狀態的新動作（`game:move`／`game:selectAction`／`game:endTurn` 等）一律擋下，回傳 `INVENTORY_CHOICE_IN_PROGRESS`，沿用既有「效果卡在提問未解決時不可以推進狀態」的通用介面約定

## 串接進每個取得道具的入口點

**共用檢查函式**：新增一個共用函式（例如 `openInventoryChoiceIfNeeded`），內容是「呼叫 `countHeldItems` 比對上限，超過就設定 `pendingInventoryChoice` 並廣播 `game:inventoryChoicePending`」。所有取得道具的路徑都呼叫這一個函式，不在兩套流程裡各寫一份判斷邏輯。

**經過 `resolveEffects` 的路徑**（卡片 `grant_item`／`draw_card`／預兆牌等）：在 `socketHandlers.js` 的 `handleEffectResolveResult`——這是所有卡片效果解析完、決定「回合能不能繼續推進」的唯一出口——**既有的 `pendingChoice` 判斷之後**，呼叫共用檢查函式。超過上限就回傳 `pending:true`，沿用既有的「效果卡在提問未解決時，不可以呼叫任何會推進遊戲狀態的動作」約定。

**不經過 `resolveEffects` 的路徑**（撿取／給予／搜索，在 `turnFlow.js`／`socketHandlers.js` 直接處理）：動作成功後呼叫同一個共用檢查函式。這幾個動作本身仍然正常完成並 `ack`（道具確實已經進背包），只是額外開啟 `pendingInventoryChoice`，比照既有「進房間的動作本身已經發生，只是後續的考驗還在等待」的模式（例如崩塌房間掉落時的 `collapseCheckPending`），不是讓整個動作卡住不完成。

**玩家回應遷留哪一件之後**：把選中的道具從背包移到目前所在房間的 `droppedItems`（不扣行動力），接著重新呼叫共用檢查函式——如果一次取得多件、遷留一件後還是超過上限，立刻再開一次 `pendingInventoryChoice`，直到回到上限以內，才真正繼續原本被延後的回合推進／狀態廣播。

## 前端

`CharacterPanel.jsx` 新增一個「選擇遷留道具」彈窗：監聽 `game:inventoryChoicePending`，列出玩家目前持有的道具卡（用既有的 `findCardName`/`cardContent` 查表取得名稱）讓玩家選一件按下遷留，送出 `game:inventoryChoiceRespond`。畫面風格比照現有的卡片效果選擇彈窗（`game:effectPendingChoice` 那一套呈現方式），不重新設計一套 UI。

## 已確認的邊界情況

- **選擇範圍**：自由選擇目前持有的任一道具卡，包含剛取得的那一件（不限制只能遷留新道具）。
- **逾時預設**：自動遷留剛取得的那一件，維持玩家原本持有的道具不變。
- **一次取得多件超過上限**：依序詢問直到回到上限內，不是只問一次。
- **力量值下降不回溯檢查**：只在取得新道具當下檢查，已持有的道具不會因為力量值下降被強制遷留。
- **上限可能為 0 或以下**：力量值本身若因傷害降到很低，上限也會跟著變低（甚至 0），這是規則本身的自然結果，不特別處理下限。

## 範圍排除

- 召喚物攜帶的道具（`summon.carryingItemId`，單一欄位、本來就只能帶 1 件）不受這個上限機制影響，維持原樣。
- 這次不處理「力量值變動時回溯檢查」，已在上方確認為刻意排除的範圍。

## 測試重點

- `countHeldItems`：正確分辨道具卡與預兆卡，只計道具卡。
- `addItem`／`giveItemAction`／`pickupItemAction`：三條路徑取得道具後都會正確觸發共用檢查函式（含「剛好等於上限、不觸發」與「超過上限、觸發」兩種邊界）。
- 一次取得多件超過上限：依序開啟多次 `pendingInventoryChoice`，直到回到上限內。
- `pendingInventoryChoice` 未解決前，`game:move`／`game:selectAction`／`game:endTurn` 都正確擋下並回傳 `INVENTORY_CHOICE_IN_PROGRESS`。
- 逾時：正確自動遷留 `triggeredByItemId`，不影響玩家原本持有的其他道具。
- 力量值下降但已持有道具超過新上限：不觸發任何遷留提示（回溯不檢查）。
