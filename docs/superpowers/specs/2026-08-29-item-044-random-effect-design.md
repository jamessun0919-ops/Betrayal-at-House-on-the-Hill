# item_044（有限手套）隨機效果機制 — 設計文件

## 目標

`item_044`（有限手套）卡面文字：「使用後隨機出現以下一個效果：1.移動到隨機一個鄰房 2.意志降低一個級別 3.知識降低一個級別 4.力量降低一個級別 5.速度降低一個級別 6.行動力歸零 7.消滅房間內其他所有角色」。

第7項（消滅房間內其他所有角色）已於 2026-08-29 確認設計（記錄在 [2026-08-29-item-038-temp-stat-swap-design.md](2026-08-29-item-038-temp-stat-swap-design.md) 附錄），實作留給 M3 傷害系統。本設計新增「不擲骰、直接隨機挑一項效果執行」的通用能力，這次只讓 `item_044` 使用第1-6項（各 1/6 機率），第7項等 M3 傷害系統做出來後直接在資料的 `options` 陣列補上第7個元素即可，不需要改動機制本身。

## 架構

### 1. 新效果類型 `random_effect`

```json
{ "type": "random_effect", "options": [ { "effects": [...] }, { "effects": [...] }, ... ] }
```

結構比照既有 `choice` 效果的 `options` 陣列，只是不需要 `optionId`／`label`（不會跳彈窗給玩家選，是伺服器直接隨機決定）。套用時均等機率隨機挑一個選項的 `effects` 執行：

```javascript
function handleRandomEffect(gameState, promptState, playerId, effect, context) {
  const index = Math.floor(Math.random() * effect.options.length);
  return resolveEffects(gameState, promptState, playerId, effect.options[index].effects, context);
}
```

跟既有 `handleRandomStatChange`（隨機挑「屬性」，套用固定 delta）的差異：`random_effect` 隨機挑的是整組「效果」，範圍更廣，任何效果類型組合都可以放進一個選項。

### 2. 新效果類型 `move_to_random_neighbor_room`

沿用 `event_029`（2026-08-29 return-to-previous-room 分支）剛建立的 `canMoveBetween` 門連接判斷邏輯：從目前房間走訪四個方向，篩出「已生成且門連接」的候選方向，均等機率隨機挑一個移動過去：

```javascript
function handleMoveToRandomNeighborRoom(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const candidates = [];
  for (const side of SIDES) {
    if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, side)) {
      candidates.push(side);
    }
  }
  if (candidates.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const chosenSide = candidates[Math.floor(Math.random() * candidates.length)];
  const delta = DIRECTION_DELTA[chosenSide];
  const enteredNewRoom = movePlayerTo(player, player.floor, player.x + delta.dx, player.y + delta.dy, OPPOSITE_SIDE[chosenSide]);
  return { pending: false, enteredNewRoom };
}
```

沒有任何合格鄰房時（死巷房間）無效果（`appliedCount:0`），比照 `move_to_previous_room` 等既有效果在異常狀態下不強行移動、不拋錯的慣例。跟 `move_to_previous_room` 不同的是，這是真的「走過一扇門」的移動，所以 `enteredFromSide` 給 `OPPOSITE_SIDE[chosenSide]`（比照一般開門移動的既有寫法），不是 `null`——玩家圖示會正確靠向對應的門那一側，不是置中。

## `item_044` 資料串接

```json
{
  "type": "random_effect",
  "options": [
    { "effects": [{ "type": "move_to_random_neighbor_room" }] },
    { "effects": [{ "type": "stat_change", "stat": "sanity", "delta": -1 }] },
    { "effects": [{ "type": "stat_change", "stat": "knowledge", "delta": -1 }] },
    { "effects": [{ "type": "stat_change", "stat": "might", "delta": -1 }] },
    { "effects": [{ "type": "stat_change", "stat": "speed", "delta": -1 }] },
    { "effects": [{ "type": "action_points", "setTo": 0 }] }
  ]
}
```

## 測試計畫

- `effectResolver.test.js`：`random_effect` 均等機率挑到每個選項並執行對應效果（用 `Math.random` mock 分別命中每個 index）；`move_to_random_neighbor_room` 正確從候選方向隨機挑一個移動、`enteredFromSide` 正確設定；沒有合格鄰房時無效果、不拋錯
- `socketHandlers.test.js`：`item_044` 端對端測試——mock `Math.random` 讓 `random_effect` 命中特定選項，確認對應效果真的發生（至少涵蓋「移動到鄰房」與其中一個屬性降低的案例）；讀取真實 `data/cards/item-cards.json` 的資料層完整性測試（比照 `item_038`／`event_029` 的既有先例）

## 範圍排除

- 第7項（消滅房間內其他所有角色）不在這次範圍內，等 M3 傷害系統做出來後再補進 `options` 陣列
- `random_effect` 不支援機率加權，均等機率（卡面文字沒有加權語意，不做超出需求的彈性）
- `move_to_random_neighbor_room` 不會觸發開新門/抽新房間卡（只在已生成的鄰房之間隨機挑，比照開發者已確認的「只限已生成且門連接的鄰房」範圍）
