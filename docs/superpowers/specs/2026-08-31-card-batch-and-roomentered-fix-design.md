# 5張卡片新機制＋roomEntered廣播缺口修正 — 設計文件

## 目標

補完 Handover 待辦清單項目11剩餘的5張卡：`event_013`（割破背包）／`event_026`（透入的陽光）／`event_031`（紅藍藥丸）／`event_033`（傳送門）／`item_040`（一疊紙牌）。查證過程中發現一個既有架構缺口（`game:roomEntered` 廣播沒有涵蓋事件卡/選項/逾時/擲骰介入等路徑），一併修正。

## 架構

### 1. 新效果類型 `restore_or_advance`（event_026 用）

```json
{ "type": "restore_or_advance", "stat": "sanity" }
```

重用既有 `playerEntity.js` 的 `isBelowBase(player, stat)` helper：低於角色初始級別（`baseIndex`）就補到初始級別（等同 `restoreToBase`）；已經在初始級別或以上就再提升一級（`delta:+1`，走既有 `changeStat` 的正常上溢邏輯，不需要另外處理爆表）。

```javascript
function handleRestoreOrAdvance(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  const statTrack = player.stats[effect.stat];
  if (!statTrack) {
    throw new Error('UNKNOWN_STAT');
  }
  if (isBelowBase(player, effect.stat)) {
    changeStat(player, effect.stat, statTrack.baseIndex - statTrack.currentIndex, gameState.hauntStarted);
  } else {
    changeStat(player, effect.stat, 1, gameState.hauntStarted);
  }
  return { pending: false };
}
```

`event_026` 資料：`[{type:"action_points",setTo:0}, {type:"restore_or_advance",stat:"sanity"}, {type:"restore_or_advance",stat:"knowledge"}]`（意志、知識各自獨立判斷）。

### 2. `event_031`（紅藍藥丸）— 完全重用既有機制，不新增效果類型

卡面「紅色／藍色／放棄」三個按鈕的效果**完全相同**（開發者已確認放棄也一樣觸發）：50/50 意志+1／意志-1。直接用既有 `choice` 包 `random_effect`：

```json
{
  "type": "choice",
  "description": "紅色藥丸還是藍色藥丸？",
  "timeoutMs": 20000,
  "defaultOptionId": "give_up",
  "options": [
    { "optionId": "red", "label": "紅色", "effects": [{"type":"random_effect","options":[{"effects":[{"type":"stat_change","stat":"sanity","delta":1}]},{"effects":[{"type":"stat_change","stat":"sanity","delta":-1}]}]}] },
    { "optionId": "blue", "label": "藍色", "effects": [ /* 同上 */ ] },
    { "optionId": "give_up", "label": "放棄", "effects": [ /* 同上 */ ] }
  ]
}
```

三個選項各自掛一份獨立的 `random_effect`（各自獨立擲一次機率，不是共用同一次隨機結果——玩家看到的「選擇」本身無意義，但每次觸發都是全新的 50/50）。

### 3. `item_040`（一疊紙牌）— 重用 `random_effect`，只擴充文字查找

沿用 `item_044` 已建立的 `random_effect`／`randomEffectIndex` 管線，6個選項全部 `effects:[]`（卡面本身「不觸發任何效果」）：

```json
{ "type": "random_effect", "options": [ {"effects":[]}, {"effects":[]}, {"effects":[]}, {"effects":[]}, {"effects":[]}, {"effects":[]} ] }
```

`item_040` 的 `feedbacktextOccur` 已經是陣列型（6句花色文字，2026-08-29 開發者補完），跟 `item_044` 用的 `feedbacktextDice`（dict，key `"1"`~`"7"`）是兩種不同格式。`socketHandlers.js` 的 `buildRandomEffectText` 目前只認 `feedbacktextDice`，需要擴充成先看 `feedbacktextOccur` 是不是陣列：

```javascript
function buildRandomEffectText(content, sourceId, randomEffectIndex) {
  if (typeof randomEffectIndex !== 'number') return null;
  const card = content.cards.items.find((c) => c.id === sourceId)
    || content.cards.events.find((c) => c.id === sourceId)
    || content.cards.omens.find((c) => c.id === sourceId);
  if (!card) return null;
  if (Array.isArray(card.feedbacktextOccur)) {
    return card.feedbacktextOccur[randomEffectIndex] || null;
  }
  if (!card.feedbacktextDice) return null;
  return card.feedbacktextDice[String(randomEffectIndex + 1)] || null;
}
```

前端完全不用改（`DebugGameScreen.jsx` 已經是 `overrideText: data.revealText || data.randomEffectText`，`item_044` 那次就做好了）。

### 4. 新效果類型 `lose_random_item`（event_013 用）

只在玩家背包裡屬於 `itemCatalog`（一般道具卡）的物品中隨機挑一件移除（不含預兆/銘印，開發者已確認範圍）。沒有任何一般道具時無效果（`appliedCount:0`），比照 `remove_imprint` 等既有「找不到候選就不作為」慣例。`destination` 欄位重用既有 `lose_item` 的「回牌堆／留房間」邏輯，抽成共用小函式避免重複：

```javascript
function routeLostItemToDestination(gameState, player, itemId, destination, itemCatalog) {
  if (destination === 'deck') {
    const cardDef = itemCatalog.find((c) => c.id === itemId);
    if (!cardDef) {
      throw new Error('UNKNOWN_ITEM_CARD');
    }
    gameState.itemDeck.cards.push(cardDef);
  } else if (destination === 'room') {
    const room = getRoomForPlayer(gameState, player);
    room.droppedItems.push({ id: itemId });
  }
}

function handleLoseRandomItem(gameState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const itemCatalog = (context && context.itemCatalog) || [];
  const candidateIds = player.inventory
    .map((item) => item.id)
    .filter((id) => itemCatalog.some((c) => c.id === id));
  if (candidateIds.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const chosenId = candidateIds[Math.floor(Math.random() * candidateIds.length)];
  removeItem(player, chosenId);
  routeLostItemToDestination(gameState, player, chosenId, effect.destination, itemCatalog);
  return { pending: false };
}
```

`handleLoseItem`（既有 `lose_item`）改呼叫同一個 `routeLostItemToDestination`，行為不變（純內部重構）。

`event_013` 資料：`[{type:"lose_random_item", destination:"deck"}]`（卡面文字「該物品放回牌堆中」）。

### 5. 新效果類型 `move_to_random_other_player_room`（event_033 用）

隨機挑一位**其他**玩家，移動到他目前所在的座標。沒有其他玩家時無效果（理論上邊界情況，單人測試/最後一人時會用到）：

```javascript
function handleMoveToRandomOtherPlayerRoom(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const others = [...gameState.players.values()].filter((p) => p.playerId !== playerId);
  if (others.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const target = others[Math.floor(Math.random() * others.length)];
  const enteredNewRoom = movePlayerTo(player, target.floor, target.x, target.y);
  return { pending: false, enteredNewRoom };
}
```

比照 `move_to_previous_room`／`move_to_room`，`enteredFromSide` 用預設 `null`（不是真的走門過去，圖示置中）。

### 6. `game:roomEntered` 廣播缺口修正（架構層級，影響所有5張卡＋既有卡片）

**問題**：查證後發現 `game:roomEntered` 廣播目前只在 `game:selectAction`（使用道具）路徑手動組了一段（`socketHandlers.js` 目前的 349-386行區塊），`resolveCardDraw`（事件/預兆卡抽卡，含 `event_013`/`026`/`031`/`033` 全部）共用的 `handleEffectResolveResult` 完全沒有這段廣播——`event_033`「傳送門」隨機移動到的房間有可能是全新房間，目前的架構下玩家會被靜默傳送，前端不會跳出房間介紹彈窗。這個缺口同時也存在於「選項效果」（`game:effectPromptRespond`）、逾時預設選項、擲骰道具介入 resume 等路徑——`handleEffectResolveResult` 是這些全部路徑共用的收斂點。

**修法**：把廣播邏輯搬進 `handleEffectResolveResult` 本體（用函式內已經取得的 `player`／`playerId`），同時刪除 `game:selectAction` 那段重複的局部廣播，改成單一入口：

```javascript
// 緊接在 handleEffectResolveResult 內 `const player = getPlayer(gameState, playerId);` 之後
if (effectResult.enteredNewRoom !== undefined) {
  const enteredRoom = gameState.board[player.floor].get(coordKey(player.x, player.y));
  io.to(roomCode).emit('game:roomEntered', { playerId, roomId: enteredRoom.roomId, enteredNewRoom: effectResult.enteredNewRoom });
}
```

（此處不需要再檢查 `!effectResult.pending`——函式在更早的 `if (effectResult.pending) { ... return }` 已經處理過 pending 分支並提前返回，能執行到這裡代表已確定不是 pending。）

`game:selectAction` 目前重複的一段（`if (!effectResult.pending && effectResult.enteredNewRoom !== undefined) {...}`，用 `targetForEffects` 查房間）整段刪除——`handleEffectResolveResult` 呼叫時傳入的 `playerId` 參數本來就是 `targetForEffects`（呼叫端寫法：`handleEffectResolveResult(..., targetForEffects, ...)`），搬進去後收件對象與廣播內容完全等價，不會漏廣播也不會重複廣播。**但送出順序會變**：搬進去後 `game:roomEntered` 在 `handleEffectResolveResult` 內部就送出，早於呼叫端在函式回傳後才送的 `game:itemUseResolved`（搬移前順序相反）。前端把兩者塞進同一個彈窗佇列，這代表「使用道具」情境下彈窗順序會改變（例如 `item_044` 移動類選項，從「先道具文字→後房間介紹」變成「先房間介紹→後道具文字」）。這項順序變更已於 2026-08-31 提交給開發者確認並接受，不視為缺陷。

查過 `handleEffectResolveResult` 的全部6個呼叫點（`game:selectAction`、`game:effectPromptRespond`、`applyRoomEndTurnBonus`、`resolveCardDraw`、`handleEffectChoiceTimeout`、`resumeRollChoice`），確認都沒有各自另外處理 `roomEntered`，搬進共用函式不會造成任何路徑重複廣播。

## 測試計畫

- `playerEntity.test.js`：`isBelowBase` 已有既有測試覆蓋，不需新增
- `effectResolver.test.js`：
  - `restore_or_advance`：低於初始級別時補到初始（含爆表情境不受影響，因為只在「低於初始」分支才會走這條路，不會跟爆表的「降到最低」邏輯混在一起）；等於/高於初始級別時 `delta:+1`
  - `lose_random_item`：背包只有一般道具時正確隨機移除其中一件；背包混有預兆/銘印時只會抽中一般道具；背包沒有一般道具時 `appliedCount:0` 不拋錯；`destination:"deck"`／`"room"` 兩種路由正確
  - `move_to_random_other_player_room`：均等機率挑到不同的其他玩家；只有自己一人時 `appliedCount:0`
  - `random_effect`（`item_040` 情境）：`effects:[]` 的選項執行後仍正確回傳 `randomEffectIndex`
- `socketHandlers.test.js`：
  - `buildRandomEffectText` 陣列型 `feedbacktextOccur` 索引正確；dict 型（既有 `item_044`）不受影響
  - `event_033` 端對端：mock 隨機挑到的其他玩家，確認移動後正確收到 `game:roomEntered`（含 `enteredNewRoom:true` 案例，驗證這次修的缺口）
  - `event_031` 端對端：`game:effectPromptRespond` 選任一選項後正確觸發 50/50 屬性變化
  - 讀取真實 `data/cards/event-cards.json`／`item-cards.json` 的資料層完整性測試（比照既有先例）
  - 迴歸測試：`game:selectAction` 既有的 `move_to_room`／`move_to_random_neighbor_room` 等已上線效果的 `roomEntered` 廣播行為不變（搬移後用既有測試確認零斷言變動或補上等價斷言）

## 範圍排除

- `lose_random_item` 不支援排除特定 id（例如「不能選到武器」），目前資料沒有這種需求
- `move_to_random_other_player_room` 不處理「目標玩家後續又移動」的競態（同一次效果解析內是原子操作，跟其他效果類型一致）
- `event_031` 三個選項各自獨立擲一次 50/50，不是「先選再擲同一次」，因為卡面文字本身就說「事件後果與玩家選擇無關」，沒有共享同一次結果的必要性
