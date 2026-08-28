# 隨機屬性提升 + 房間條件效果 設計文件

## 背景與目標

`item_027`（魔力樂譜）與 `event_036`（能量轉換）都需要「隨機提升一項能力」，這是目前完全沒有的能力——現有 `choice` 效果永遠是玩家自己選，沒有「電腦自動隨機選一項屬性」這種機制。`item_027` 另外還需要「只有在特定房間（`room_organ`／`room_piano`）使用才生效，其他房間無事發生」，這也是完全沒有的能力——現有效果系統沒有任何「依玩家當前房間決定要不要生效」的判斷。這份文件把這兩個新能力定案。

開發者提供的 `item_027` 最新卡面內容（已在 `data/cards/item-cards.json` 手動修改，尚未 commit）：

```
text："於特定房間行動需要的道具。在room_organ或room_piano使用，增加隨機一點能力。在非特定的房間無事發生"
feedbacktextOccur："你演奏了這份樂譜，這是首配合彌撒進行的頌恩聖歌．你因此充滿了力量（能力隨機上升一級別）"
category："consumable"（原本誤標成 decoration）
```

`event_036` 現況（`remove_imprint` 已於銘印機制那次連上，只差隨機加值這部分）：
```
text："如果角色身上有銘印，隨機消滅一個銘印，並提升一個隨機能力的級別。"
effects：[{ "type": "remove_imprint" }]
needsCustomLogic：true（卡在隨機加值這部分）
```

## 能力一：`random_stat_change`

```json
{ "type": "random_stat_change", "delta": 1 }
```

從 `might`／`speed`／`knowledge`／`sanity` 四項均等隨機選一項，套用 `delta`（等同對隨機選中的屬性執行一次 `stat_change`）。`event_036` 直接使用；`item_027` 包在下面的 `room_gate` 裡面使用。

## 能力二：`room_gate`

```json
{ "type": "room_gate", "roomIds": ["room_organ", "room_piano"], "effects": [ ... ] }
```

檢查玩家當前所在房間（`gameState.board[player.floor].get(coordKey(player.x, player.y))` 的 `roomId`）是否在 `roomIds` 清單內：
- **符合**：解析內層 `effects` 陣列（走既有 `resolveEffects` 遞迴）
- **不符合**：不執行任何動作，回傳 `{ pending: false, appliedCount: 0 }`——**道具不消耗**（開發者確認，跟 `remove_imprint` 無銘印可消除時的既有慣例一致），玩家可以帶著道具到正確房間再試一次

這是通用的「包裝效果」模式，跟現有 `dice_check`／`choice` 一樣把其他效果包在裡面，之後如果還有其他「只在特定房間才生效」的卡片可以直接重用，不需要再寫新效果類型。

## 兩張卡最終定義

**`item_027`**：
```json
"effects": [
  { "type": "room_gate", "roomIds": ["room_organ", "room_piano"], "effects": [
    { "type": "random_stat_change", "delta": 1 }
  ] }
],
"needsCustomLogic": false
```

**`event_036`**：
```json
"effects": [
  { "type": "remove_imprint" },
  { "type": "random_stat_change", "delta": 1 }
],
"needsCustomLogic": false
```

（`event_036` 的兩個效果依序執行：先消除銘印，再隨機加值，順序對應卡面文字「隨機消滅一個銘印，並提升一個隨機能力的級別」的敘述順序。）

## 範圍排除（這次不處理）

- `item_027` 原本 Handover 待辦項目描述成「合成材料類道具，需要開發者補充配方所屬房間」——開發者這次澄清實際上不是 `craftRecipes` 合成機制，而是單純的房間條件消耗品，此文件不涉及 `craftRecipes`。

## 測試重點

- `random_stat_change`：四項屬性都可能被選中（用 `Math.random` mock 分別驗證四種選中結果）、`delta` 正確套用到選中的屬性、其他三項屬性不受影響
- `room_gate`：玩家在清單內的房間時正確解析內層 `effects`；玩家在清單外的房間時內層 `effects` 完全不執行、回傳 `appliedCount:0`；巢狀 `room_gate` 內的 `random_stat_change` 兩者組合正確運作（`item_027` 的實際使用情境）
- `event_036`：`remove_imprint` 與 `random_stat_change` 依序執行，兩者互不影響（銘印移除的反轉計算不會被隨機加值干擾，反之亦然）
