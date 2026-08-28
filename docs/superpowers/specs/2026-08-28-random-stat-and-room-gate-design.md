# 隨機屬性提升 + 房間條件效果 設計文件

## 背景與目標

`item_027`（魔力樂譜）與 `event_036`（能量轉換）原本都被認為需要「隨機提升一項能力」，但釐清後發現只有 `event_036` 真的需要這個能力——`item_027` 的實際機制以房間資料為準（見下方），是知識考驗＋固定提升速度，不是隨機。「電腦自動隨機選一項屬性」目前完全沒有（現有 `choice` 效果永遠是玩家自己選）。`item_027` 另外需要「只有在特定房間（`room_organ`／`room_piano`）使用才生效，其他房間無事發生」，這也是完全沒有的能力——現有效果系統沒有任何「依玩家當前房間決定要不要生效」的判斷。`event_036` 還需要第三個能力：讓既有的 `remove_imprint` 能夠「只有真的消除到銘印時，才連動觸發後續效果」，避免沒有銘印的玩家白拿隨機加值。這份文件把這三個新能力定案。

**機制權威來源的釐清（重要）**：`item_027` 卡片自己的 `text`／`feedbacktextOccur`（開發者稍早在 `data/cards/item-cards.json` 手動修改、尚未 commit）寫的是「隨機增加一點能力、無考驗」，但 `room_organ`／`room_piano` 兩個房間自己的 `text` 欄位（`data/rooms/rooms.json:489`／`:869`，兩間房內容一致）寫的是：

> 「玩家攜帶有完整樂譜item_027，在此房間執行行動(演奏)，通過知識考驗（＞５），提升速度一個級別。通過考驗後，物品完整樂譜消失。」

兩邊不一致。**開發者確認以房間資料為準**：知識考驗（骰數 6+ 通過）、固定提升速度一個級別（不是隨機）、通過考驗後道具才消失（沒通過道具保留）。`item_027` 卡片自己的 `text`／`feedbacktextOccur` 需要一併修正成符合這個機制的敘述，不再是舊的隨機版本（見下方最終定義）。

**觸發方式的架構決策**：開發者原本提議改用「房間操作（`room_action`）」觸發、由房間檢查玩家是否持有 `item_027`。查證後確認：
- 現有 `room_action` 分派邏輯（`socketHandlers.js` 的 `getRoomActions`／`room_action` 分支）完全沒有「檢查玩家是否持有特定道具才能觸發」的概念——`craftRecipes` 雖然也檢查持有道具，但邏輯不同（無條件消耗多個道具換一個新道具，不是「單一道具+擲骰決定要不要消耗」），這條路線需要一個全新能力
- Handover 既有定義（8/1 已核准）：「道具」＝使用手上持有卡片的主動能力；「操作」＝房間本身觸發的機制，不含卡片能力。`item_027`「演奏」本質上是使用手上的樂譜卡，照這個既有定義應該歸類成「道具」
- 更進一步查證發現：既有的「使用道具」流程已經有 `appliedCount` 決定是否消耗道具的機制（`socketHandlers.js:1050`：`consumeItemIfApplied && effectResult.appliedCount > 0` 才真的移除道具），這剛好完美對應「過關才消失」的需求，不需要額外寫任何消耗邏輯

**開發者確認：維持道具觸發（方案A）**，不改用房間操作觸發。

## 能力一：`random_stat_change`（`event_036` 用）

```json
{ "type": "random_stat_change", "delta": 1 }
```

從 `might`／`speed`／`knowledge`／`sanity` 四項均等隨機選一項，套用 `delta`（等同對隨機選中的屬性執行一次 `stat_change`）。只有 `event_036` 使用這個效果類型；`item_027` 不需要（機制已確認是固定速度，不是隨機，見上方）。

## 能力二：`room_gate`（`item_027` 用）

```json
{ "type": "room_gate", "roomIds": ["room_organ", "room_piano"], "effects": [ ... ] }
```

檢查玩家當前所在房間（`gameState.board[player.floor].get(coordKey(player.x, player.y))` 的 `roomId`）是否在 `roomIds` 清單內：
- **符合**：解析內層 `effects` 陣列（走既有 `resolveEffects` 遞迴）
- **不符合**：不執行任何動作，回傳 `{ pending: false, appliedCount: 0 }`——`appliedCount:0` 會讓既有的「使用道具」流程判定沒有套用效果，道具因此不會被消耗（`socketHandlers.js:1050`），玩家可以帶著道具到正確房間再試一次

這是通用的「包裝效果」模式，跟現有 `dice_check`／`choice` 一樣把其他效果包在裡面，之後如果還有其他「只在特定房間才生效」的卡片可以直接重用，不需要再寫新效果類型。

## `item_027` 最終定義

`category` 維持 `"consumable"`（開發者已修正），`effects` 用 `room_gate` 包 `dice_check`：

```json
"text": "於特定房間行動需要的道具。在room_organ或room_piano使用，通過知識考驗（骰數６以上），提升速度一個級別。未通過考驗或在非特定房間使用，皆無事發生，道具保留。",
"feedbacktextDice": {
  "6+": "你演奏了這份樂譜，這是首配合彌撒進行的頌恩聖歌。你因此充滿了力量（速度提升一個級別）",
  "0-5": "你嘗試演奏，但彈得荒腔走板，什麼也沒發生"
},
"effects": [
  { "type": "room_gate", "roomIds": ["room_organ", "room_piano"], "effects": [
    { "type": "dice_check", "stat": "knowledge", "tiers": [
      { "min": 6, "max": 8, "effects": [{ "type": "stat_change", "stat": "speed", "delta": 1 }] },
      { "min": 0, "max": 5, "effects": [] }
    ]}
  ]}
],
"needsCustomLogic": false
```

（`feedbacktextOccur` 改用 `feedbacktextDice`，因為結果現在依考驗骰數分支，跟其他 `dice_check` 型卡片的既有寫法一致；不在正確房間使用時，`room_gate` 直接無效果，不會跳出 `feedbacktextDice` 的任何一種文字，走既有「使用道具但沒有可見效果」的既有行為。）

`room_organ`／`room_piano` 兩個房間自己的 `effects:[]`／`needsCustomLogic:false` **不需要修改**——機制完全在道具側觸發，房間本身不需要任何 `room_action` 效果，房間的 `text` 只是敘述性文字（跟房間介紹一致的既有寫法）。

## 能力三：`remove_imprint` 擴充可選的巢狀 `effects`

卡面文字「**如果**角色身上有銘印，隨機消滅一個銘印，**並**提升一個隨機能力的級別」——「有銘印」是整個效果（消除+加值）的前提，不是兩個各自獨立的效果。如果單純把 `random_stat_change` 當成第二個平行的頂層效果，沒有銘印的玩家也會白拿一次隨機加值，跟卡面語氣不符。

比照 `dice_check`／`choice`／`room_gate` 已有的「包裝巢狀效果」模式，擴充既有的 `remove_imprint`（`server/src/game/effectResolver.js` 的 `handleRemoveImprint`）：新增可選欄位 `effects`，**只有真的消除到一張銘印時**才解析這個巢狀效果陣列；玩家身上沒有銘印時，整個 `remove_imprint`（含巢狀部分）維持既有行為，回傳 `{ pending: false, appliedCount: 0 }`，巢狀效果完全不執行。

這個擴充需要 `handleRemoveImprint` 補上 `promptState` 參數（HANDLERS 註冊時已經收到這個參數，但目前沒有往下傳），才能呼叫 `resolveEffects` 遞迴解析巢狀效果。

## `event_036` 最終定義

```json
"effects": [
  { "type": "remove_imprint", "effects": [
    { "type": "random_stat_change", "delta": 1 }
  ] }
],
"needsCustomLogic": false
```

（有銘印：消除銘印＋隨機加值一起發生，對應卡面「隨機消滅一個銘印，並提升一個隨機能力的級別」；沒有銘印：整張卡無事發生，不會白拿加值。）

## 範圍排除（這次不處理）

- `item_027` 原本 Handover 待辦項目描述成「合成材料類道具，需要開發者補充配方所屬房間」——這次澄清實際上不是 `craftRecipes` 合成機制，此文件不涉及 `craftRecipes`。

## 測試重點

- `random_stat_change`：四項屬性都可能被選中（用 `Math.random` mock 分別驗證四種選中結果）、`delta` 正確套用到選中的屬性、其他三項屬性不受影響
- `room_gate`：玩家在清單內的房間時正確解析內層 `effects`；玩家在清單外的房間時內層 `effects` 完全不執行、回傳 `appliedCount:0`
- `item_027` 端到端（socket 層測試）：在 `room_organ`／`room_piano` 使用且擲骰過關 → 速度+1、道具從背包消失；在同樣房間但擲骰沒過關 → 速度不變、道具仍在背包；在非 `room_organ`／`room_piano` 的房間使用 → 無事發生、道具仍在背包
- `remove_imprint` 巢狀 `effects` 擴充：有銘印可消除時，巢狀效果正確執行（`event_036` 情境：銘印移除的反轉計算不會被隨機加值干擾，反之亦然）；沒有銘印時，巢狀效果完全不執行、`appliedCount` 維持 `0`（既有無銘印行為不變）
