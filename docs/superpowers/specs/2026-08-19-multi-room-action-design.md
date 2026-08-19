# 房間多重行動機制設計文件

**日期**：2026-08-19
**範圍**：把「一個房間只能有一種 room_action」改成「一個房間可以同時提供多種行動，玩家按下「行動」時如果有多個選項要跳出選單」。這次順便把 LobbyC 下樓到地下室的樓梯、包廂房跳下舞廳兩個新機制一起做（開發者已於本次討論中確認具體規則）。武器/消耗品分類、傷害系統仍不在範圍內（已確認留給 M3）。

## 背景

目前 `game:selectAction actionType:'room_action'` 是「三選一」的固定優先序（`craftRecipes` 非空 → 合成；`effects` 裡有非 `onceOnlyPerPlayer` 的項目 → 一般效果解析；都沒有 → 預設走搜索），一個房間只會走其中一條路徑，`rooms.json` 的 `actions` 欄位目前純粹是描述性資料，沒有真正被讀取來決定行為。開發者已確認的具體案例：廚房要同時有搜索＋烹飪；未來的化學實驗室要同時有搜索＋調劑；保險庫要同時有搜索＋考驗；LobbyC 要同時有上樓＋下樓；包廂房、崩塌的房間都要有「跳下」。

## 資料格式

`actions` 欄位從「純文字標籤陣列」改成「結構化行動清單」，每一項自帶顯示文字、機制類型，以及（除 `search`／`craft` 外）自己的資料：

```json
"actions": [
  { "label": "搜索", "kind": "search" },
  { "label": "烹飪", "kind": "craft" },
  { "label": "上樓", "kind": "effects", "effects": [{ "type": "move_to_room", "targetRoomId": "room_upper_landing" }], "freeAction": true },
  { "label": "下樓", "kind": "effects", "effects": [{ "type": "move_to_room", "targetRoomId": "room_basement_landing" }], "freeAction": true },
  { "label": "考驗", "kind": "effects", "effects": [{ "type": "dice_check", "...": "..." }] },
  { "label": "跳下", "kind": "teleport" }
]
```

四種 `kind`：

- **`search`**：沿用房間既有的頂層 `item` 欄位（`null`／`"random_one"`／候選 id 陣列），機制完全不變，只是現在要先被選中才會觸發
- **`craft`**：沿用房間既有的頂層 `craftRecipes` 欄位，機制完全不變
- **`effects`**：效果內容**直接寫在這個行動項目自己的 `effects` 欄位**，不是房間共用的頂層 `effects`——這樣像 LobbyC 的「上樓」跟「下樓」才能各自獨立成一個選項，各自能有自己的 `freeAction`。涵蓋現有的「一般效果解析」（保險庫考驗）跟「樓梯」（`move_to_room`）兩種舊行為，都用同一個 `kind`，因為底層都是丟進既有的 `resolveEffects` 管線
- **`teleport`**：新的第三種機制，不透過 `resolveEffects`，是直接的座標傳送（下面「跳下機制」段落詳述）

**房間頂層的 `effects` 欄位語意單純化，只剩「結束回合被動加成」一種用途**（`onceOnlyPerPlayer:true`，透過 `game:endTurn` 觸發的 `applyRoomEndTurnBonus`）。之前這個欄位身兼兩種用途（room_action 觸發的效果 vs 結束回合被動加成）是搜索機制上線時發現的混淆根源之一，這次順便徹底切開：room_action 要用的效果全部搬進 `actions` 裡對應項目自己的 `effects`，房間頂層 `effects` 以後只給 `applyRoomEndTurnBonus` 讀。

沒有 `actions` 欄位的房間（其餘約 40 間 event/omen 房間）維持現有的程式碼層級預設 `[{ "label": "搜索", "kind": "search" }]`，這批房間資料不用動。

## 伺服器邏輯

**取得房間目前有效的行動清單**：新函式 `getRoomActions(roomDefinition, placedRoom)`，回傳這個房間**目前**（考慮到房間實體狀態）有效的 `actions` 陣列：
- 從 `roomDefinition.actions`（沒有就用預設的搜索）取得基礎清單
- 崩塌的房間的特例：如果清單裡有 `kind:"teleport"` 且 `placedRoom.roomId === 'room_collapsed_room'`，這一項**只有在 `placedRoom.collapseLink` 已存在時才保留**，否則從清單中濾掉（還沒有人摔下去過的崩塌房間，維持是一間普通房間，沒有「跳下」可選）

**`game:selectAction actionType:'room_action'` 的新流程**：
1. 呼叫 `getRoomActions` 取得目前有效清單
2. 清單長度為 0：拋 `NO_ROOM_ACTION_AVAILABLE`（理論上不會發生，因為預設一定有搜索，只有崩塌房間濾掉跳下之後、又剛好也沒有其他行動時才可能，這種房間本來就會落回預設搜索，不會變空）
3. 清單長度為 1：直接執行這一項，**不需要玩家額外指定 `actionIndex`**（維持現有單一行動房間的既有互動方式，不強迫多一次選擇）
4. 清單長度 ≥ 2：payload 必須帶 `actionIndex`（前端已經看得到同一份清單，由玩家選好再送出）；沒帶或 index 超出範圍 → 拋 `INVALID_ACTION_INDEX`
5. 依選中項目的 `kind` 分派：
   - `search`／`craft`：邏輯完全不變（沿用現有 `performSearch`／`craftRecipes` 判斷），只是現在從「房間唯一的行動」變成「清單裡挑出來的那一項」
   - `effects`：`sourceEffects = 選中項目.effects`；`freeRoomAction = Boolean(選中項目.freeAction)`（原本是讀 `roomDefinition.freeAction`，現在讀行動項目自己的）
   - `teleport`：見下方「跳下機制」

## 跳下機制（`kind: "teleport"`）

兩個具體案例，**都消耗 1 點行動力**（開發者已確認統一跟包廂房一致，沒有 `freeAction`）：

- **崩塌的房間**：讀 `placedRoom.collapseLink`（既有欄位，紀錄摔下去之後對應的地下室房間座標），移動玩家過去。**這是既有 `jumpIntoCollapsedRoom` 函式的邏輯**，這次改動只有兩點：①原本免費，現在改成跟其他主動選擇的行動一致，消耗 1 點行動力；②原本是 `game:selectAction` 裡的特殊分支（跳過整個 `craftRecipes`/`effects`/`search` 判斷），現在正式收編成 `actions` 清單裡的一個 `kind:"teleport"` 項目，跟其他行動一樣走 `getRoomActions`→選單→分派的標準流程
- **包廂房**：移動到配對的舞廳（同座標、對面樓層），使用既有的 `pairedFloorFor`/`isBallroomOrGallery` 判斷邏輯直接算出目標房間，不需要額外資料欄位（因為包廂房／舞廳的配對放置在 `placeBallroomGalleryPair` 時就已經決定座標，不像崩塌房間需要另外記錄連結）

**不受這次改動影響、維持原樣**：崩塌的房間**第一次**被開門進入時，速度考驗失敗導致的摔落，是移動本身（`game:move`）附帶的必然效果，不是 room_action，不算「跳下」這個行動選項的一部分，不扣任何額外行動力（跟現行機制完全一樣）。

**已知缺口，這次不處理**：包廂房跳下舞廳理論上會有掉落傷害考驗，跟崩塌房間摔落應該套用同一套傷害機制——但傷害系統本身還沒實作（M3 範圍），這次「跳下」這個動作本身可以做，但不會有任何傷害效果，等 M3 傷害系統做出來後再補。

## 前端選單

`FocusedRoomView`/`DebugGameScreen` 已經能從 `roomContent`（房間靜態內容，含 `actions` 欄位）跟目前房間的 `currentRoom`（board 實體，含 `collapseLink`）算出「這個房間現在有效的行動清單」（跟伺服器的 `getRoomActions` 同一套邏輯，前端重算一份，不新增 socket 事件）：

- 清單長度 ≤ 1：「行動」按鈕維持現有行為，點下去直接送出（清單長度 0 的邊界情況目前不會發生，但函式呼叫時如果清單真的是空的，仍然送出不帶 `actionIndex` 的請求，讓伺服器端的既有防呆處理，不需要前端額外擋）
- 清單長度 ≥ 2：點「行動」跳出一個選單（沿用既有「一列按鈕」樣式，跟道具給予的對象選擇、卡片效果選擇同一種既有 UI 模式），列出每個行動的 `label`，點選其中一個才送出 `game:selectAction { actionType:'room_action', actionIndex }`

## 資料遷移範圍

以下房間的 `rooms.json`／`starting-rooms.json` 資料需要改成新格式：

- **9 間現有搜索房間**（`room_master_bedroom`/`room_game_room`/`room_larder`/`room_guest_1`/`room_gymnasium`/`room_weapon_room`/`room_baby`/`room_bathroom_ground`/`room_bathroom_upper`）：`actions:["搜索"]` → `actions:[{"label":"搜索","kind":"search"}]`
- **廚房**（`room_kitchen`）：`actions:["烹飪"]` → `actions:[{"label":"搜索","kind":"search"},{"label":"烹飪","kind":"craft"}]`（新增搜索，之前沒有；`item` 欄位目前是 `undefined`，比照其他搜索房間補上 `"random_one"`）
- **保險庫**（`room_vault`）：目前完全沒有 `actions` 欄位（`effects` 是頂層的考驗內容）→ 新增 `actions:[{"label":"搜索","kind":"search"},{"label":"考驗","kind":"effects","effects":[...既有的 dice_check...]}]`＋`item:"random_one"`；頂層 `effects` 欄位移除（內容搬進 `actions` 裡的考驗項目）
- **崩塌的房間**（`room_collapsed_room`）：新增 `actions:[{"label":"搜索","kind":"search"},{"label":"跳下","kind":"teleport"}]`＋`item:"random_one"`（這間房目前完全沒有 `actions`/`item`/`drawType` 欄位，是這次順便補齊）
- **包廂房**（`room_gallery`）：新增 `actions:[{"label":"搜索","kind":"search"},{"label":"跳下","kind":"teleport"}]`＋`item:"random_one"`（這間房目前也完全沒有 `actions`/`item` 欄位）
- **LobbyC**（`room_lobby_c`，`starting-rooms.json`）：目前頂層 `effects` 是上樓的 `move_to_room`＋`freeAction:true` → 改成 `actions:[{"label":"上樓","kind":"effects","effects":[...],"freeAction":true},{"label":"下樓","kind":"effects","effects":[{"type":"move_to_room","targetRoomId":"room_basement_landing"}],"freeAction":true}]`；頂層 `effects`/`freeAction` 欄位移除
- **二樓平台**（`room_upper_landing`，`starting-rooms.json`）：目前頂層 `effects` 是下樓回 LobbyC 的 `move_to_room` → 改成 `actions:[{"label":"下樓","kind":"effects","effects":[...],"freeAction":true}]`；頂層 `effects`/`freeAction` 欄位移除
- **食品儲藏室／健身房**：`actions:["搜索"]`（字串格式）→ 改成新的物件格式 `[{"label":"搜索","kind":"search"}]`，頂層 `effects`（`onceOnlyPerPlayer` 加成）維持不動（這個欄位以後專屬結束回合加成用途，這兩間房本來就只用在這裡）
- **禮拜堂／圖書室**：完全不用改，這兩間房只有結束回合加成、沒有任何 room_action，維持現有的「沒有 `actions` 欄位 → 預設搜索」規則即可（開發者過去已經確認過這兩間房維持現狀）

**地下平台**（`room_basement_landing`）目前完全沒有任何 room_action，這次也不新增（跟其他兩個地下室平台一樣，維持純佔位房間，不在這次範圍內）。

## 測試計畫

- `getRoomActions`（新函式）：單一行動房間回傳原清單；崩塌房間在 `collapseLink` 不存在/存在時的濾除行為；沒有 `actions` 欄位時的預設搜索
- `game:selectAction room_action`：
  - 清單長度 1 的房間，不帶 `actionIndex` 一樣能執行（既有測試的回歸驗證）
  - 清單長度 ≥ 2 的房間，帶正確 `actionIndex` 能分別觸發 `search`／`craft`／`effects`／`teleport` 四種 kind
  - 不帶 `actionIndex` 或帶超出範圍的值 → `INVALID_ACTION_INDEX`
  - 崩塌房間跳下：`collapseLink` 不存在時「跳下」不在清單裡（`INVALID_ACTION_INDEX`，因為清單裡沒有這一項）；存在時可以正確跳、扣 1 點行動力
  - 包廂房跳下：正確移動到配對的舞廳座標、扣 1 點行動力，不套用任何傷害
  - LobbyC 上樓／下樓：分別正確移動、都不扣行動力（`freeAction:true`）
  - 二樓平台下樓：正確移動回 LobbyC、不扣行動力
  - 保險庫：搜索／考驗兩個選項都能分別正確觸發
  - 廚房：搜索／烹飪兩個選項都能分別正確觸發
- 既有測試需要更新：所有直接呼叫 `game:selectAction room_action` 且依賴單一行動房間预設行為的測試（craftRecipes 分支、search 分支的既有測試）需要確認在新的 `getRoomActions` 包裝下依然通過（多數房間清單長度仍是 1，預期不用改斷言，只需要確認測試 fixture 的 `actions`/`effects` 欄位格式如果有寫死字串格式要跟著更新）

## 自我檢查

- 無佔位符／TBD（包廂房掉落傷害的缺口已明確記錄為「已知缺口，這次不處理」，不是遺漏）
- 資料格式、伺服器邏輯、跳下機制、前端選單、資料遷移範圍五段互相一致（`kind` 種類、`freeAction` 語意、`getRoomActions` 函式名稱在各段落引用一致）
- 範圍單一（多重行動選單機制＋兩個跳下案例＋既有房間的資料遷移），不涉及傷害系統本身、道具合成的第二個真實案例（化學實驗室，仍待開發者提供實際房間/道具內容）
