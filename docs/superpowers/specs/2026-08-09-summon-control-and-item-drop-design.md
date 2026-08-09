# 召喚物操控切換＋道具給予/遺留 — 設計文件

日期：2026-08-09
狀態：已跟開發者逐項確認，等開發者過目後轉 `writing-plans`

## 範圍

這份設計涵蓋兩個原本被歸類在「M2c-3 內容撰寫」但實際上牽涉新架構的機制：

1. **召喚物操控切換**：預兆卡「犬靈」（原「狗」，開發者已改名）——玩家可以在自己回合內，暫時把操控權切換到一個受限行動的召喚實體，之後切換回來。`summons` 欄位設計成可擴充，不限定犬靈這一種召喚物。
2. **道具的「給予」與「遺留」動作**：在既有的「使用」之外，新增兩種道具處理方式——直接轉交給同房間另一位玩家、或留在房間裡讓之後路過的人撿。

這兩者互相依賴（犬靈的「撿取」「遺留」動作，操作的正是道具遺留機制新增的房間狀態），所以放在同一份文件討論。

**明確排除（M3 範圍）**：召喚物「不能主動襲擊與被襲擊」——目前襲擊機制完全沒做，這條規則現在無從實作，只需要記錄下來，等 M3 設計戰鬥系統/怪物系統時要記得排除召喚物這種實體不能被鎖定攻擊。犬靈行動的 20 秒倒數（正式版規格）沿用專案既有的「20 秒計時 UI 延後」慣例，這次不做，等 M2 完整測試跑完後跟其他 20 秒倒數一起補。

## 一、資料結構

### 1.1 玩家物件新增 `summons` 欄位

```js
player.summons = null; // 沒有召喚物在場時
// 召喚犬靈後：
player.summons = {
  type: 'spiritDog',
  floor: 'ground',
  x: 0,
  y: 0,
  actionPoints: 6,
  carryingItemId: null, // 撿到東西後填入該道具 id，只能同時帶一件
};
```

`summons` 是玩家物件上的**單一欄位**（不是陣列/字典），因為目前規則一次只能有一個召喚物在場（同一回合只能切換一次來回，切回玩家時召喚物就消散）。欄位名稱刻意不叫 `spiritDog`，是因為未來可能有其他召喚物類型，屆時共用同一個欄位、用 `type` 分辨即可，不需要改資料結構。

### 1.2 房間動態狀態新增 `droppedItems` 欄位

放在**每局遊戲當下的房間狀態**（`gameState.board.ground`/`gameState.board.upper` 裡實際放置的房間物件），不是 `data/rooms/rooms.json` 的靜態房間內容——因為遺留的道具是特定對局裡發生的事，不是房間本身的固定屬性。

```js
{
  roomId: 'room_foyer',
  x: 4, y: 0,
  doorSides: [...],
  droppedItems: [], // 新增；每筆是 { id: 'item_010' }，可以有多筆
}
```

`createBoard`（固定起始房間）與 `placeNewRoom`（開新房間）建立房間物件時，都要預設帶上 `droppedItems: []`。

## 二、召喚物操控切換

### 2.1 觸發：使用犬靈道具卡 → 新效果類型 `switch_control`

犬靈（omen_004）的 `effects`：

```json
[{ "type": "switch_control", "summonType": "spiritDog", "actionPoints": 6 }]
```

`handleSwitchControl(gameState, playerId, effect)`：

```js
function handleSwitchControl(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  player.summons = {
    type: effect.summonType,
    floor: player.floor,
    x: player.x,
    y: player.y,
    actionPoints: effect.actionPoints,
    carryingItemId: null,
  };
  return { pending: false };
}
```

召喚物一開始跟玩家站在同一個房間。這個效果透過既有的 `game:selectAction actionType:'item'` 流程觸發，玩家用掉的 1 點行動力是「使用道具」這個動作本身的既有消耗（`turnFlow.selectAction` 既有邏輯，不需要修改），召喚物的 6 點行動力完全獨立，不會跟玩家自己的行動力互相影響。

### 2.2 操控中的行動限制

玩家目前是否在操控召喚物，看 `player.summons` 是否為 `null` 判斷。操控召喚物期間：
- 玩家本人的座標/行動力完全凍結，不受任何影響（`player.x`/`player.y`/`player.floor`/`player.actionPoints` 都不變）
- 其他玩家與環境不會有任何動作（單一玩家獨占行動的既有慣例，跟選角色階段一樣）
- 行動選單限定四種：**移動／撿取／遺留／消散**，其餘一律不可選

移動只能到已存在的相鄰房間，不能開新房間（沿用既有的 `blocksOpenDoor` 語意，但召喚物是**固有限制**，不是掛在玩家身上的 `persistent_modifier`——不需要真的建立一個 modifier 物件，`getAvailableDirections` 針對召喚物直接跳過 `open_door` 分支即可）。

「消散」永遠可以選（即使行動力是 0），選擇後：
- 召喚物目前攜帶的道具（`carryingItemId` 不為 null 的話）掉落在召喚物**當下所在的房間**（呼叫遺留道具的邏輯，見 3.2）
- `player.summons = null`
- **消散不等於結束回合**，純粹是切換狀態——回合是否結束，還是看玩家自己的 `actionPoints` 是否歸零，走既有的 `isTurnOver`/`advanceTurn` 邏輯，`turnFlow.js` 不需要新增任何「還在操控召喚物就不能結束回合」的檢查

行動力歸零時（`summons.actionPoints === 0`），選單上移動/撿取/遺留都變暗不可選，只剩消散可選（前端 UI 判斷；伺服器端一律照 `summons.actionPoints` 驗證，跟一般行動力檢查同一套慣例）。

換到別的玩家回合時，如果這位玩家還在操控召喚物中途沒切回來（理論上不會發生，因為沒切回來就結束不了自己的回合），保險起見 `advanceTurn` 觸發時順便清掉 `player.summons = null`。

### 2.3 socket 事件

召喚物操控期間，玩家端仍然用既有的 `game:move`／`game:selectAction` 送出動作，伺服器收到時先檢查 `player.summons` 是否存在：
- 存在 → 這個動作是在操控召喚物，套用 2.2 的限制版邏輯，消耗/寫入的是 `player.summons.x/y/floor/actionPoints`，不是玩家本體欄位
- 不存在 → 照舊有邏輯處理玩家本人的動作

「消散」是一個新的 `actionType`：`game:selectAction { actionType: 'dissipate' }`（不需要 `itemId`，因為不是針對特定道具）。

## 三、道具「給予」與「遺留」

### 3.1 給予（`give`）—— 轉交道具給同房間玩家

目前完全沒有這個機制（開發者確認是要新增的，不是之前討論過忘記做），機制類似 M3 會出現的偷竊/搶奪，但這裡是**雙方同意的單純轉交**，不是強制搶奪。

```
game:selectAction { actionType: 'item', mode: 'give', itemId: 'item_003', targetPlayerId: 'p2' }
```

驗證：目標玩家必須跟自己在同一個房間（沿用 `turnFlow.js` 現有 `TARGET_NOT_IN_ROOM` 檢查的邏輯）、自己必須持有該道具。成立的話：從自己的 `inventory` 移除該道具、加入目標玩家的 `inventory`，不解析該道具的 `effects`（純粹換人持有，跟「使用」是兩回事）。消耗 1 點行動力（跟其他道具動作一致）。

### 3.2 遺留（`leave`）—— 放在房間裡

```
game:selectAction { actionType: 'item', mode: 'leave', itemId: 'item_003' }
```

召喚物操控中一樣送這個事件；伺服器依 `player.summons` 是否存在決定要動 `inventory` 還是 `carryingItemId`（召喚物沒有 `inventory`，只有單一的 `carryingItemId`），不需要另外開一個專用事件。

驗證：自己（或操控中的召喚物）必須持有該道具。成立的話：從持有者的 `inventory`（或召喚物的 `carryingItemId`）移除，加入目前所在房間的 `droppedItems` 陣列。可以有多筆遺留物品疊放在同一個房間，不會互相覆蓋。消耗 1 點行動力（召喚物消耗的是 `summons.actionPoints`）。

**用詞說明**：不使用「丟棄」，避免跟「銷毀」混淆——遊戲裡沒有主動銷毀道具的動作，道具「用一次就消失」的情況（治療藥膏等）在卡面文字上寫的是「消失」，不是「丟棄」。

### 3.3 撿取（`pickup`）—— 從房間拿走遺留物品

任何實體（一般玩家、犬靈這類召喚物、未來的叛徒）站在有 `droppedItems` 的房間時，行動選單多一個「撿取」選項。**例外**：邪祟階段產生的怪物不能撿取物品（M3 範圍，現在無從實作，記錄供 M3 參考）。

```
game:selectAction { actionType: 'item', mode: 'pickup', itemId: 'item_003' }
```

驗證：目前所在房間的 `droppedItems` 必須包含該道具。成立的話：從房間的 `droppedItems` 移除，加入自己的 `inventory`（召喚物則存進 `carryingItemId`，因為召喚物一次只能帶一件——如果 `carryingItemId` 已經有東西，這個動作不可選/拒絕）。消耗 1 點行動力。

## 四、待實作階段細節（不在這份設計文件鎖死，交給計畫階段依實際程式碼決定）

- `game:selectAction` 的 payload 目前是 `{actionType, itemId, targetPlayerId}`，新增 `mode` 欄位後要怎麼在 `socketHandlers.js`／`turnFlow.js` 分派到 give/leave/pickup/use 四種邏輯，確切函式切分留給實作階段
- `serializeGameState` 不需要修改——`summons` 掛在玩家物件上、`droppedItems` 掛在房間物件上，兩者都已經被現有的序列化邏輯（`Array.from(gameState.players.values())`／房間陣列）整包帶出去
