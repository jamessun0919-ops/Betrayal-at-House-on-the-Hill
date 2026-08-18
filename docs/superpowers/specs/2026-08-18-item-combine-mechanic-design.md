# 道具合成機制設計文件（廚房烹飪，第一組配方）

**日期**：2026-08-18
**範圍**：只做「道具合成」的通用機制＋接上唯一現有的具體配方（泡麵＋礦泉水→烹飪過的食物，需在廚房）。**「搜索行動取代自動抽卡」不在本次範圍內**，屬於另一場獨立 brainstorming 的題目，這次完全不動現有的進房自動抽卡機制。武器/消耗品分類、限定使用次數、屬性門檻三個問題已跟開發者確認併入 M3 戰鬥系統設計時處理，本文件不涵蓋。

## 背景

`item_021`（烹飪過的食物）的 `text` 已寫明「在廚房使用泡麵（`item_017`）跟礦泉水（`item_016`）加工出的食物」，但目前資料庫完全沒有「道具 A+B→C」的資料格式或引擎邏輯。

## 資料格式

**`data/cards/item-cards.json`**：`item_016`（礦泉水）、`item_017`（泡麵）新增布林欄位 `"isMaterial": true`。純粹是前端判斷道具點選選單要不要顯示「使用」按鈕用，不影響既有 `category` 欄位（`category` 的複合格式問題已確認留給 M3 一併處理，本次不動）。

**`data/rooms/rooms.json`** 的 `room_kitchen`：新增兩個欄位（其餘 53 間房間這次不動，這兩個欄位只有廚房有）：
```json
"actions": ["烹飪"],
"craftRecipes": [
  { "id": "recipe_cooked_food", "ingredients": ["item_016", "item_017"], "result": "item_021" }
]
```
`actions` 目前只作為描述性欄位（標示這間房有「烹飪」這個特殊行動），實際判斷邏輯依據 `craftRecipes` 是否存在；`craftRecipes` 是列表，之後其他房間（例如假設中的化學實驗室）要加新配方時，直接照同樣格式加一筆即可，不需要改程式碼。

## 伺服器行為（`server/src/socketHandlers.js`，`game:selectAction` 的 `room_action` 分支）

現有邏輯（`findRoomDefinition` 取得房間定義後，直接把 `roomDefinition.effects` 當成 `sourceEffects` 送進效果解析器）在算出 `roomDefinition` 之後、決定 `sourceEffects` 之前，新增一個判斷分支：

1. 若 `roomDefinition.craftRecipes` 是非空陣列：
   - 檢查目前玩家的 `inventory` 是否**同時持有**某一組配方 `ingredients` 列出的全部道具 id（多筆配方時，取第一組全部滿足的；目前只有一筆配方，不影響）
   - **都不滿足** → 直接拋出 `MISSING_CRAFT_MATERIALS`（在呼叫 `selectAction` 之前拋出，因此**不會扣行動力**，跟現有其他錯誤代碼一樣被外層 `catch` 接住、透過 `ack({error})` 回傳給前端，沒有新增額外的訊息機制）
   - **有一組滿足** → 動態組出 `sourceEffects`：
     ```js
     [{
       type: 'choice',
       description: '要不要進行烹飪？',
       options: [
         { optionId: 'yes', label: '是', effects: [
           { type: 'lose_item', itemId: 'item_016' },
           { type: 'lose_item', itemId: 'item_017' },
           { type: 'grant_item', itemId: 'item_021' },
         ] },
         { optionId: 'no', label: '否', effects: [] },
       ],
     }]
     ```
     `type: 'choice'`／`grant_item`／`lose_item` 三種效果類型都已存在於 `effectResolver.js`（`grant_item`/`lose_item` 只吃 `effect.itemId`），**完全不需要新增效果解析邏輯**。接著沿用現有流程：`selectOptions.hasRoomAction = true`、`selectOptions.freeRoomAction = Boolean(roomDefinition.freeAction)`（廚房沒有 `freeAction`，維持扣 1 點行動力），呼叫既有的 `selectAction`，再走既有的「有 `sourceEffects` 就送進 `resolveEffects`」流程——不需要新的 socket 事件、不需要新的前端彈窗元件，`game:effectPendingChoice`／`pendingEffectChoice` 既有的選擇提示 UI（`DebugGameScreen.jsx`）本來就會通用渲染 `description`／`options[].label`，原樣可用。

2. 若 `roomDefinition.craftRecipes` 不存在（其餘房間）：完全維持現有邏輯不變。

**已跟開發者確認的行為**：材料足夠、行動力已扣，但玩家在「要不要進行烹飪？」選「否」時，這 1 點行動力**依然會被消耗**（跟現有其他房間操作/考驗一致——「發動房間操作」本身就是會扣行動力的動作，選擇內容是後續步驟）。

## 前端行為（`client/src/gameplay/CharacterPanel.jsx`）

道具清單點選道具名稱後的選項彈窗（目前是「使用／遺留／取消」）：查詢該道具的 `isMaterial`（透過既有的 `mapUtils.js` 的 `findCardInfo(itemId, cardContent)`，回傳完整卡片物件），若為 `true` 則不顯示「使用」按鈕，只顯示「遺留／取消」。**副作用**：`CharacterPanel.jsx` 目前有一個只回傳 `name` 的本地函式 `findCardName`，跟共用的 `findCardInfo`是重複邏輯——既然這次已經需要完整卡片物件（要讀 `isMaterial`），改用共用的 `findCardInfo` 取代本地的 `findCardName`，移除重複程式碼。

「缺少烹飪需要的材料」的呈現：`MISSING_CRAFT_MATERIALS` 透過既有的 `actionError` 顯示機制呈現（`DebugGameScreen.jsx` 目前所有 `game:selectAction` 錯誤代碼都是這樣直接顯示，例如 `NOT_ENOUGH_ACTION_POINTS`），跟現有其他錯誤代碼的呈現方式一致，不特別另外做人類可讀翻譯（這是除錯頁面既有的通用慣例，不是本次新引入的例外）。

## 測試

`server/test/socketHandlers.test.js` 新增：
- 玩家在廚房、背包持有 `item_016`+`item_017`，`room_action` → 收到 `game:effectPendingChoice`（`description`/`options` 正確），行動力已扣 1
- 上述情境玩家選「是」→ `item_016`/`item_017` 從背包移除、`item_021` 加入背包
- 上述情境玩家選「否」→ 背包不變，行動力仍已扣 1（跟選「是」前的扣款狀態相同，不會退還）
- 玩家在廚房但背包缺材料（無 `item_016` 或無 `item_017`）→ ack 回傳 `MISSING_CRAFT_MATERIALS`，行動力未扣
- 玩家在其他既有 `room_action` 房間（例如保險庫）→ 行為完全不變（回歸測試，確保新分支沒有影響既有邏輯）

## 自我檢查

- 無佔位符／TBD
- 資料格式、伺服器行為、前端行為三段互相一致（`craftRecipes` 欄位名稱、`isMaterial` 欄位名稱、`MISSING_CRAFT_MATERIALS` 錯誤代碼在各段落引用一致）
- 範圍單一（只有廚房一組配方＋通用機制），不涉及「搜索取代自動抽卡」或武器/消耗品分類問題
