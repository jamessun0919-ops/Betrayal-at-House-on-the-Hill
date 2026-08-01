# 卡片資料填寫說明

這個資料夾放三種共用卡牌的內容：`event-cards.json`（事件卡）、`item-cards.json`（道具卡）、`omen-cards.json`（預兆/詛咒卡）。這些檔案目前是**空白範本**，請對照實體卡片，把內容填進去。填完之後這些檔案會被 M2（探索引擎）直接讀取使用，所以請盡量照著現有欄位格式填寫，不要自己加欄位。

## 共用欄位格式

每張卡是陣列裡的一個物件：

```json
{
  "id": "event_001",
  "name": "卡片標題（如果卡片本身沒有標題，可以留空字串）",
  "text": "卡片上完整的文字內容（唸給玩家聽的敘述、規則說明都放這裡）",
  "effects": [
    { "type": "stat_change", "stat": "might", "delta": -1 }
  ]
}
```

- `id`：不用想太多，依序編號即可（`event_001`、`event_002`...），不要重複
- `name`：卡片標題，如果原文只有一段敘述沒有標題，留空字串 `""` 即可
- `text`：把卡片上的文字**照抄**貼進來，越完整越好，之後遊戲畫面會直接顯示這段文字
- `effects`：卡片造成的機制效果，用下面的效果詞彙描述。**如果一張卡的效果太複雜、下面的詞彙描述不出來，沒關係，把 `effects` 留空陣列 `[]`，並在旁邊加一個 `"needsCustomLogic": true` 欄位標記，之後我會另外處理**，不用勉強塞進現有詞彙

## 效果詞彙（`effects` 陣列可用的類型）

| type | 說明 | 範例 |
|---|---|---|
| `stat_change` | 屬性增減 | `{ "type": "stat_change", "stat": "sanity", "delta": -1 }`（`stat` 可填 `might`/`speed`/`knowledge`/`sanity`） |
| `dice_check` | 擲骰考驗，依結果分支 | `{ "type": "dice_check", "stat": "knowledge", "success": [...], "failure": [...] }`（`success`/`failure` 裡面再放效果陣列） |
| `draw_card` | 抽一張指定牌庫的卡 | `{ "type": "draw_card", "deck": "item" }`（`deck` 可填 `event`/`item`/`omen`） |
| `add_item` / `remove_item` | 取得/失去道具 | `{ "type": "add_item", "itemId": "item_003" }` |
| `move` | 移動（少用，多半是事件卡專屬效果） | `{ "type": "move", "target": "same_floor_any_room" }` |
| `conditional` | 條件分支 | `{ "type": "conditional", "if": "...", "then": [...], "else": [...] }` |

不確定怎麼填也沒關係，先把 `text` 填好，`effects` 空著或用 `needsCustomLogic` 標記，之後我們可以一起討論怎麼轉成效果詞彙。

## 目前已知的內容

`omen-cards.json` 已經預先填好 13 種真實預兆卡名稱（從生存者手冊的「邪祟劇本查詢表」查到的），`name` 欄位是真的，但 `text` 欄位還是空的，麻煩對照實體卡片補上文字。其中 **書、戒指、聖符、女孩** 這 4 張是劇本1〈神鬼痴漢〉會用到的，麻煩優先填。

`event-cards.json`、`item-cards.json` 完全是空的範本（只留一個範例物件示範格式），因為這兩類卡片的名稱我這邊完全沒有資料來源，需要你從實體卡片一張一張填入。範例物件請直接刪掉或覆蓋掉。

## 需要多少張

依照我們先前的討論，MVP 測試階段的目標數量：
- 事件卡、道具卡：各抓「劇本1、劇本10有明確提到需要的」+ 額外 10 張，湊出隨機性
- 預兆卡：13 種都可以填（比額外10張還多一點，沒關係，全部填滿即可，畢竟真實數量就是13種）
