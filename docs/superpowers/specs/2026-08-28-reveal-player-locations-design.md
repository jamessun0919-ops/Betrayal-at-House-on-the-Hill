# item_036 揭露玩家位置 設計文件

## 背景與目標

`item_036`（老鷹木雕）卡面文字：「使用後可以得知其他玩家/怪物/惡人位在哪個房間內」，`feedbacktextOccur` 目前是佔位字「xxx在xxx間內；ooo在ooo房間內」。

**範圍確認（開發者確認）**：這次只實作「其他玩家」部分。「怪物/惡人」目前完全沒有位置資料可查（M3 尚未建立任何怪物/惡人實體追蹤），維持 `needsCustomLogic:true`，等 M3 建立怪物/惡人實體後再補上。

**新能力確認**：現有回饋文字彈窗機制（`game:itemUseResolved`）只支援卡片自己固定寫死的 `feedbacktextOccur` 字串，前端用 `itemId` 查表顯示；完全沒有「伺服器動態算出內容、前端顯示動態文字」這種管道。這是本專案第一次需要動態組合的回饋文字。

## 架構決策

**新效果類型 `reveal_player_locations`**（`server/src/game/effectResolver.js`）：解析時蒐集「除了自己以外」所有其他玩家目前的 `{playerId, floor, x, y}`，透過 `resolveEffects` 既有的「額外欄位往上傳遞」機制（跟 `drawnCards`／`diceCheckResult`／`enteredNewRoom` 完全一樣的模式）新增一個 `revealedLocations` 欄位往外傳。`effectResolver.js` 不查房間名稱、不組文字——這裡完全沒有房間資料表可查，只回傳座標。

**文字組合放在 `server/src/socketHandlers.js`**（既有 `content`／房間資料在這裡才拿得到，`findRoomDefinition` 這個既有函式已經在這個檔案）：偵測到 `effectResult.revealedLocations` 存在時，用 `findRoomDefinition` 查每個座標所在房間的名稱、`getPlayer` 查每位玩家的顯示名稱，依「同房間合併成一行」規則（開發者確認）組合成最終文字，透過既有的 `game:itemUseResolved` 事件多帶一個可選欄位 `revealText` 送出。沒有其他玩家時（極端情況，例如只剩自己一人），回傳固定文字「目前沒有發現其他玩家的蹤跡」。

**前端沿用既有彈窗機制**（`client/src/DebugGameScreen.jsx`）：`onItemUseResolved` 收到事件時，把 `data.revealText`（可能是 `undefined`）一併放進彈窗佇列項目；`resolveSimplePopupBody` 顯示 `itemUseResolved` 種類的彈窗內文時，優先使用這個動態文字，沒有才照舊查卡片的 `feedbacktextOccur`（完全向下相容——沒有 `revealText` 欄位的一般道具行為完全不變）。

## 資料格式

`revealedLocations` 陣列每一項：`{ playerId, floor, x, y }`（不含房間名稱，room name 在 socketHandlers.js 才查）。

文字組合範例（同房間合併成一行）：
```
Alice、Bob 在 廚房 內；Carol 在 圖書室 內
```
（各房間之間用「；」分隔，同房間玩家名稱間用「、」分隔，格式仿照卡片原本的佔位字「xxx在xxx間內」）

## `item_036` 最終定義

```json
"text": "使用後可以得知其他玩家位在哪個房間內。（怪物/惡人位置待後續版本補上）",
"effects": [{ "type": "reveal_player_locations" }],
"needsCustomLogic": true
```

移除原本的佔位 `feedbacktextOccur`（`"xxx在xxx間內；ooo在ooo房間內"`）——這張卡的回饋文字這次改成完全動態組合，這個欄位變成永遠不會被讀到的死資料。`needsCustomLogic` 維持 `true`，反映「怪物/惡人」部分尚未實作。

## 範圍排除（這次不處理）

- 怪物/惡人位置：M3 尚未建立任何怪物/惡人實體追蹤，等 M3 做出來後再回頭補這張卡
- 房間座標／樓層不在顯示文字中出現，只顯示房間名稱（如果之後同名房間造成混淆，屬於後續可以再議的細節，這次不處理）

## 測試重點

- `reveal_player_locations`：正確蒐集除了自己以外的所有其他玩家座標，不包含自己；玩家人數為 0（單人房間）時回傳空陣列，不拋錯
- `revealedLocations` 正確透過 `resolveEffects` 的既有彙整機制往外傳遞（比照 `drawnCards` 的既有測試模式）
- socket 層端到端測試：兩位玩家在不同房間 → `game:itemUseResolved` 帶正確組合文字（含房間名稱查詢正確）；兩位玩家在同一房間 → 合併成一行；只有自己一人時 → 回傳固定的「沒有發現其他玩家蹤跡」文字
- 一般道具（沒有 `revealedLocations`）的既有 `game:itemUseResolved` 行為維持不變（回歸測試，確認 `revealText` 欄位不存在時不影響任何既有測試）
