# 「回到前一個房間」機制 — 設計文件

## 目標

`event_004`（突發故障）、`event_029`（濃煙密布）、`event_035`（狂風襲來）三張事件卡都需要「把玩家送回上一個位置」的能力，目前完全沒有房間歷史追蹤機制。`event_029` 另外還需要「在房間留下持續性減骰標記，含已生成的門連接鄰房」的能力。本設計新增這兩項通用能力。

## 架構

### 1. `player.previousPosition` — 緊接著的上一個位置

`movePlayerTo`（`server/src/game/playerEntity.js`）是所有移動方式的唯一入口——一般移動、開門、樓梯、傳送、崩塌摔落全都經過這裡。在覆寫 `player.floor/x/y` 之前，先把舊位置存進新欄位：

```javascript
function movePlayerTo(player, floor, x, y, enteredFromSide = null) {
  player.previousPosition = { floor: player.floor, x: player.x, y: player.y };
  player.floor = floor;
  ...
```

`createPlayer` 的角色出生位置是直接指定座標，不經過 `movePlayerTo`，所以「開場後從沒移動過」時 `previousPosition` 保持初始值 `null`——天然對應「無前房可回時無效果」的規則（開發者已確認），不需要額外的「是否為第一次移動」判斷。

### 2. 新效果類型 `move_to_previous_room`

```json
{ "type": "move_to_previous_room" }
```

`previousPosition` 為 `null` 時無效果（回傳 `appliedCount: 0`，比照 `handleRemoveRoomDoors` 等既有效果在異常狀態下無效果不拋錯的慣例）；否則呼叫 `movePlayerTo(player, previousPosition.floor, previousPosition.x, previousPosition.y, null)`。`enteredFromSide` 給 `null`，比照現有 `move_to_room` 效果類型（`handleMoveToRoom`）的既有慣例——這類效果驅動的移動不會重新觸發新房間的抽卡，只有玩家主動的開門/移動才會。

### 3. `persistent_modifier` 新增 `appliesTo:"roomAndNeighbors"`

現有 `persistent_modifier` 只支援 `appliesTo:"player"`／`"room"`（`room` 固定套到玩家目前所在房間）。新增第三種值，套用範圍是「目前房間 + 已生成且門連接的鄰房」：

```javascript
} else if (effect.appliesTo === 'roomAndNeighbors') {
  const room = getRoomForPlayer(gameState, player);
  attachModifier(room, { effects: effect.effects, removeWhen: effect.removeWhen });
  for (const side of SIDES) {
    if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, side)) {
      const delta = DIRECTION_DELTA[side];
      const neighbor = gameState.board[player.floor].get(coordKey(player.x + delta.dx, player.y + delta.dy));
      attachModifier(neighbor, { effects: effect.effects, removeWhen: effect.removeWhen });
    }
  }
}
```

`canMoveBetween(board, floor, coord, direction)`（`server/src/game/boardGenerator.js`，已有並已匯出）直接判斷兩房是否門連接（開發者已確認「已生成的相鄰房間」要求門連接，不是單純格子相鄰），不需要新寫判斷邏輯。每個房間各自獨立呼叫 `attachModifier`（各自拿到獨立的 modifier id），符合「濃煙標記永久存在、不移除」的規則（開發者已確認，`removeWhen` 留空）。

## 三張卡資料串接

`event_029` 的效果順序有講究：濃煙標記要在玩家還站在「目前房間」（濃煙密布事件觸發的那個房間）時掛上去，玩家才移動走——所以 `persistent_modifier` 必須排在 `move_to_previous_room` 前面，順序不能反過來（反過來的話 `getRoomForPlayer` 會抓到玩家移動後的新房間，標記會掛錯地方）。

- `event_004`（突發故障）：`[{type:"action_points","setTo":0}, {type:"move_to_previous_room"}]`
- `event_035`（狂風襲來）：`[{type:"move_to_previous_room"}]`
- `event_029`（濃煙密布）：`[{type:"persistent_modifier","appliesTo":"roomAndNeighbors","effects":[{"hookType":"onBeforeRoll","delta":-1}]}, {type:"move_to_previous_room"}]`

`onBeforeRoll` 的 `delta:-1` 套用時走既有的 `applyModifiers`／骰子數 `Math.max(1, Math.min(8, ...))` 夾限流程，天然滿足「最少仍需擲一顆」的規則，不需要額外處理。

## 測試計畫

- `playerEntity.test.js`：`movePlayerTo` 正確把舊位置存進 `previousPosition`；`createPlayer` 初始化 `previousPosition` 為 `null`
- `effectResolver.test.js`：`move_to_previous_room` 正確移動、`previousPosition` 為 `null` 時無效果；`persistent_modifier` 的 `roomAndNeighbors` 正確套到目前房間＋門連接鄰房，且正確排除「格子相鄰但沒門連接」與「格子相鄰但還沒生成」的房間
- `socketHandlers.test.js`：三張卡各自的端對端測試——`event_004`／`event_035` 確認移動到前一個位置；`event_029` 確認濃煙標記正確掛在原房間與門連接鄰房、之後在這些房間擲骰確實少一顆

## 範圍排除

- 不處理「前一個位置」再往前追溯（只保留緊接著的一步，不做完整移動歷史堆疊）
- `event_029` 的濃煙標記不做任何移除條件（開發者已確認永久存在）
- `move_to_previous_room` 不重新觸發新房間的抽卡（比照既有 `move_to_room` 效果類型）
