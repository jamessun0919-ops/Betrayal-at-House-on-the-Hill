# 房間門狀態變動事件卡 設計文件

## 背景與目標

`event_014`（前進無門）／`event_015`（後無退路）／`event_016`（地板陷落）／`event_028`（秘密通道）4 張事件卡目前 `effects` 皆為空、`needsCustomLogic:false`（誤標，實際上需要新機制才能表達）。這 4 張卡都需要修改「房間的門狀態」（移除或新增），其中 3 張（015/016/028）在卡面文字上還要求「抽到時先檢查房間條件，不符合就重抽事件卡」。這份文件把這兩個新能力（條件重抽、門狀態變動）定案。

現況卡面文字（`data/cards/event-cards.json`）：

```
event_014（前進無門）：當前房間除了進入方向已開啟的房門之外，其他未探索的房間變成牆，美術圖不變，不可再被探索
event_015（後無退路）：抽出此卡時檢查，如果當前房間為單一門房型，重抽事件卡。本卡效果：當前房間進入方向已開啟的那個房門，變成牆的狀態不可被探索，美術圖不變，該門相鄰的房間狀態也同步改變，其他房間門狀態不變。
event_016（地板陷落）：抽出此卡時檢查，如果當前房間為地下室，重抽事件卡。落下至下一個樓層相同座標的房間，機制同崩塌的房間。（樓層敘述將由開發者修正為固定落到地下室，見下方）
event_028（秘密通道）：抽出此卡時檢查，如果當前房間為四門的房型，重抽事件卡。在其中一個隨機無門的牆面上，生成一個可通行的門。如果該位置有對應的鄰房並且無門，則兩個房間都生成新的門相通
```

## 前置事實確認

查證現有程式碼確認以下兩點，作為設計依據：

- **這 4 張卡的抽卡時機通常伴隨明確的進入方向，但有一個例外會讓 `enteredFromSide` 為 `null`。** 事件卡只在新開門進入房間時觸發抽卡（`turnFlow.js` 的 `open_door` 流程，`pendingCardDraw` 只在 `placeNewRoom` 之後設置，且一定緊接 `movePlayerTo(player, ..., OPPOSITE_SIDE[direction])`），這個路徑下 `player.enteredFromSide` 必定是有效方向。**例外**：`room_collapsed_room` 的 `drawType:"event"` 會在骰速度檢定失敗、玩家透過 `dropToBasement` 落到地下室之後才解析事件卡效果——`dropToBasement`／`movePlayerTo` 會把 `enteredFromSide` 設為 `null`（落下不是「從某個方向開門進入」），此時若抽到的正是 014/015（`remove_room_doors`），卡片解析時看到的就是 `null`。`remove_room_doors` 的實作（`effectResolver.js` 的 `handleRemoveRoomDoors`）已對此加了防呆：`enteredFromSide` 為 `null` 時直接回傳 `{ pending: false, appliedCount: 0 }`（無操作），不會假設它必為有效方向，也不會因此清空剛放置、通常還沒有鄰房的地下室房間的所有門。
- **現有崩塌機制不施加物理傷害。** `applyCollapseCheck`（`turnFlow.js:263-292`）的 fail 分支明確記載「不施加物理傷害，因為 M3 傷害分配系統（玩家自選哪個屬性承受傷害）尚未存在，這是刻意保留的缺口」。event_016 卡面 `feedbacktextOccur`「落地時受了一點傷」延用同樣的缺口範圍，這次不施加傷害（開發者確認）。

## 能力一：`redrawIf` 條件重抽

卡片資料新增欄位：

```json
"redrawIf": { "check": "<檢查名稱>", "op": "==", "value": <值> }
```

本次需要兩種檢查：

- `roomDoorCount`：當前房間**即時**（非卡面原始房型定義，因為 014/028 本身會動態改變門數）`doorSides` 陣列長度
- `playerFloor`：當前玩家樓層

3 張卡的 `redrawIf`：

```
event_015：{ "check": "roomDoorCount", "op": "==", "value": 1 }
event_016：{ "check": "playerFloor",   "op": "==", "value": "basement" }
event_028：{ "check": "roomDoorCount", "op": "==", "value": 4 }
```

**抽卡流程**：仿照 `roomDeck.js` 既有的 `drawFeasibleRoom` 模式（`shift()` 抽出 → 條件不符 `push()` 回牌堆最下面 → 重抽，`attempts = deck.cards.length` 保底避免整副牌都不符合時卡死），為事件牌堆實作對應版本。重抽被拒絕的卡片放回牌堆**最下面**，下次還會抽到（開發者確認，非直接棄置）。

## 能力二：門狀態變動效果類型

`doorSides` 是既有 board 資料模型裡，放置在 `board[floor]`（`Map`，key 為 `coordKey(x,y)`）的房間實例上的**可變陣列**，本身沒有不可變性限制，可以直接 push/splice，不需要新增資料欄位或改動房間放置邏輯。`canMoveBetween` 的雙邊門一致判斷（兩側都要有門才算通）會自然套用新的門狀態，不需另外修改。

### `remove_room_doors`

```json
{ "type": "remove_room_doors", "mode": "entry" }
{ "type": "remove_room_doors", "mode": "unexplored_except_entry" }
```

執行時從 `context` 取得當前玩家所在房間實例與 `player.enteredFromSide`：

- **`mode: "entry"`（015 用）**：從當前房間 `doorSides` 移除 `enteredFromSide`；同步移除鄰房（進入方向對面，此時必定已放置）對應面（`OPPOSITE_SIDE[enteredFromSide]`）的 `doorSides`。
- **`mode: "unexplored_except_entry"`（014 用）**：對當前房間 `doorSides` 中除 `enteredFromSide` 以外的每個方向，若該方向鄰房座標**尚未放置房間**（`!board[floor].has(coordKey(nx,ny))`），從 `doorSides` 移除；已放置鄰房的方向（已探索）維持不變。此模式不需同步鄰房（鄰房本就不存在）。

### `add_room_door`

```json
{ "type": "add_room_door", "target": "random_doorless_wall" }
```

（028 用）從當前房間 `doorSides` 未涵蓋的方向中隨機選一個（`redrawIf` 已保證至少存在一個無門方向），加入當前房間 `doorSides`。檢查該方向鄰房座標是否已放置房間：若已放置，且鄰房對應面（`OPPOSITE_SIDE[方向]`）尚未在其 `doorSides` 內，一併加入鄰房 `doorSides`（即使鄰房已有門朝這邊，加入動作天然冪等，不會重複）；鄰房尚未放置則只動當前房間，形成新的未探索開門機會。

### `fall_to_basement`（016 用）

```json
{ "type": "fall_to_basement" }
```

現有 `applyCollapseCheck` 的 fail 分支（畫線抽房、`placeRoomAt`、記錄 `collapseLink`、`movePlayerTo`）目前寫死在骰子檢定失敗的分支裡。將這段邏輯抽成共用函式（例如 `dropToBasement(gameState, player, currentRoom)`），`applyCollapseCheck` 的 fail 分支與這個新效果類型都呼叫它。**統一固定落到地下室**，不論觸發時玩家在哪個樓層（開發者確認；`event_016` 卡面「二樓→一樓」的舊敘述由開發者負責修正文字，改成不分樓層一律落到地下室）。不施加傷害（見上方「前置事實確認」）。

**回饋文字**：以上 4 個效果類型執行後都不另外跳出專屬彈窗，沿用卡片既有的 `feedbacktextOccur`／`description`，走現有的 `eventNoCheck`／`eventIntro` 彈窗流程，跟其他機制型事件卡一致，不需要新 UI。

## 4 張卡最終定義

| 卡片 | redrawIf | effects | needsCustomLogic |
|---|---|---|---|
| event_014 | 無 | `[{"type":"remove_room_doors","mode":"unexplored_except_entry"}]` | false |
| event_015 | `roomDoorCount==1` | `[{"type":"remove_room_doors","mode":"entry"}]` | false |
| event_016 | `playerFloor=="basement"` | `[{"type":"fall_to_basement"}]` | false |
| event_028 | `roomDoorCount==4` | `[{"type":"add_room_door","target":"random_doorless_wall"}]` | false |

## 範圍排除（這次不處理）

- **落下傷害**：event_016 的「受了一點傷」延用現有崩塌機制的缺口，等 M3 傷害分配系統實作後再一併補上，這次 `fall_to_basement` 不施加任何傷害效果。
- **`resumeRollChoice` 等擲骰續行路徑對 `dropToBasement` 共用函式的影響**：`applyCollapseCheck` 在骰子介入（dice interjection）情境下有獨立的 resume 路徑（`resumeCollapseCheck`），這次重構只抽出 fail 分支本體，不改動 resume 路徑的呼叫方式，維持原行為。

## 測試重點

- `redrawIf` 通用重抽邏輯：符合條件放行、不符合條件重抽、重抽次數上限保底（整副牌都不符合時不死循環）、被拒卡片正確放回牌堆最下面
- `remove_room_doors`：`mode:"entry"` 正確同步移除鄰房對應面；`mode:"unexplored_except_entry"` 正確跳過已探索方向、只移除未探索方向，且不觸碰鄰房
- `add_room_door`：鄰房已存在時雙邊同步新增門；鄰房不存在時只動當前房間；重複執行不會產生重複的 doorSides 項目
- `dropToBasement` 抽成共用函式後，`applyCollapseCheck` 既有測試全數維持通過（重構不可破壞既有行為）
- `fall_to_basement` 效果類型的單元測試（含固定落到地下室，不論觸發樓層）
- 4 張卡各自的 `needsCustomLogic` 更新為 `false` 後，卡片資料驗證測試（若有）需同步更新
