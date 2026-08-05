# M2c-4（道具／操作動作接線）＋ M2c-5（邪祟考驗機制）— 設計文件

日期：2026-08-05
狀態：已與開發者確認核心決策，準備進入 `writing-plans`

## 背景

開發者要求 M2c-3（卡片內容）完成後要能手動跑一次完整的邪祟前遊戲迴圈（選擇行動→開門→移動→觸發效果→改變狀態→結束回合），並提出要補一個簡易 UI（M2d）。對照這個手動測試流程重新盤點 M2 收尾前的缺口，發現：

1. `turnFlow.js` 的 `selectAction` 目前仍是 M2b-2 留下的殼子（`{kind, pending:true}`），「道具」「操作」兩個動作完全沒有真實邏輯
2. `gameState.omenCount` 欄位存在但從未被遞增，也沒有任何「什麼時候觸發邪祟」的規則實作

本文件記錄這兩塊的架構決策。M2d（UI）不在本文件範圍內，留給下一輪單獨討論。

## 1. 範圍邊界（已確認）

- **不做兩層 20 秒計時提問 UI**（`turn-flow-and-action-points.md` 8/1 已核准的設計）。改用跟現有 `game:move` 一致的簡單直接事件模式：client 直接在 payload 帶齊所有必要資訊（`itemId`／`targetPlayerId`），伺服器驗證後直接執行，沒有倒數、沒有「逾時放棄回合」。**這是暫時簡化，20 秒計時要等 M2 完整測試跑完後再補回去**，已記錄在 Handover
- **「襲擊」動作維持現狀**（`{kind:'attack', pending:true}` 殼子不動）——這是 M3 戰鬥範圍
- **道具的目標選擇**：不做伺服器端二次提問，`game:selectAction` 的 payload 直接帶 `targetPlayerId`（不帶則預設自己），伺服器驗證目標玩家是否在同一房間**且該道具是否允許指定他人**（見第2.3節新增的 `canTargetOthers` 欄位）
- **房間「操作」先假設每個房間只有一種操作**：`turn-flow-and-action-points.md` 提過「同房間多種操作要再選一個」的情境，但目前 31 筆房間資料沒有這種案例，先不支援多選，等 M2c-3 內容真的出現這個需求再擴充
- **反應式道具（天使羽毛／詭異人偶／幸運兔腳／蠟燭）本次不支援主動使用**：這四張道具的使用時機都是「擲骰前/後可以選擇使用」，是卡在別的動作中間跳出來問的，不是「輪到你的回合主動選『道具』」這種主動式觸發，M2c-4 的 `game:selectAction` 是主動式的，涵蓋不到。跟 20 秒計時/反應式提問系統一起延後，**現在只要能正確持有／顯示這四張道具即可，不用能真的觸發它們的效果**（見 Handover 已記錄）

## 2. 「道具」動作

### 2.1 現有資料的一個關鍵限制

`playerEntity.js` 的 `addItem` 目前只存 `{id: itemId}`（M2c-1 的 `effectResolver.handleGrantItem` 就是這樣呼叫的），**不含道具的 `effects`/`name` 等完整內容**。所以要「使用」一個持有的道具時，`effects` 陣列必須從**靜態內容目錄**（`content.cards.items`，`index.js` 載入的道具卡定義）查表取得，不能從玩家的 inventory 條目本身拿到。

`turnFlow.js` 目前完全不依賴靜態內容目錄（`content` 只在 `gameManager.js`/`socketHandlers.js` 出現）。維持這個邊界：**`turnFlow.js` 只負責驗證「有沒有持有這個 itemId」跟行動力／回合歸屬，不做內容查表；內容查表跟呼叫 `resolveEffects` 都放在 `socketHandlers.js`**——這跟 `moveToRoom` 回傳 `pendingCardDraw: {deck}`、由 `socketHandlers.js` 實際抽卡解析的既有分工完全一致，不是新模式。

### 2.2 `turnFlow.js` 的 `selectAction` 簽名變更

```js
function selectAction(gameState, playerId, actionType, options = {}) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (!ACTION_TYPES.includes(actionType)) {
    throw new Error('INVALID_ACTION_TYPE');
  }
  if (player.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }

  if (actionType === 'item') {
    const { itemId, targetPlayerId } = options;
    if (!player.inventory.some((item) => item.id === itemId)) {
      throw new Error('ITEM_NOT_HELD');
    }
    const effectTargetId = targetPlayerId || playerId;
    if (effectTargetId !== playerId && !options.itemCanTargetOthers) {
      throw new Error('ITEM_CANNOT_TARGET_OTHERS');
    }
    const targetPlayer = requirePlayer(gameState, effectTargetId);
    if (
      targetPlayer.floor !== player.floor ||
      targetPlayer.x !== player.x ||
      targetPlayer.y !== player.y
    ) {
      throw new Error('TARGET_NOT_IN_ROOM');
    }
    player.actionPoints -= 1;
    return { kind: 'item', itemId, targetPlayerId: effectTargetId };
  }

  if (actionType === 'room_action') {
    if (!options.hasRoomAction) {
      throw new Error('NO_ROOM_ACTION_AVAILABLE');
    }
    player.actionPoints -= 1;
    return { kind: 'room_action' };
  }

  player.actionPoints -= 1;
  return { kind: actionType, pending: true }; // attack 維持殼子
}
```

`options.hasRoomAction` 是**呼叫端（`socketHandlers.js`）事先算好、傳進來的布林值**——因為「這個房間有沒有操作」也需要查靜態內容目錄（見第3節），維持 `turnFlow.js` 不碰內容目錄的邊界，同時讓「沒有操作可做」這個檢查跟行動力扣除保持原子性（不會出現「扣了行動力但其實這個房間根本沒東西可操作」的情況）。

### 2.3 新增卡片資料欄位（開發者手填，agent 只補 schema）

檢查過三份卡片資料，結論：

- **`data/cards/item-cards.json`**：新增兩個欄位。**`category`**（`"weapon"` / `"consumable"` / `"general"` 三選一）——武器類（左輪手槍/斧頭/獻祭之劍/炸藥）現在效果留空，等 M3 才會真的用到；消耗品/一般的差異見下方第2.4節「生效後是否消失」的規則。**`canTargetOthers`**（布林值，預設 `false`）——目前 12 張已填內容裡，只有治療藥膏／嗅鹽的卡面文字明確寫「可選擇使用在自己或同房間玩家」，其餘應該都是 `false`，但實際數值由你逐張確認填入，agent 不代填
- **`data/rooms/rooms.json`**：不需要新欄位——房間「操作」沒有「能不能對別人用」的概念，操作永遠是操作者自己觸發
- **`data/cards/omen-cards.json`**：只新增 **`category`** 一個欄位（不需要 `canTargetOthers`——預兆卡是持有後自動生效/回合中主動觸發，沒有「指定同房間他人」的機制）。13 張裡 `戒指`／`長矛` 應該是 `"weapon"`，**沒有任何一張應該是 `"consumable"`**——所有預兆卡都要保留在場上計入 `omenCount`（見第5節），這是預兆牌庫的核心機制，如果你發現自己想把某張預兆填成 `consumable`，先停下來跟 agent 確認是不是哪裡理解錯了
- **`data/cards/event-cards.json`**：**不需要新欄位**。11 張事件卡全部是「一次性觸發、當場結算」，沒有「持有後選擇時機使用」的概念；唯一的例外「電池耗盡」是持續到條件解除的 debuff，已經有 `persistent_modifier`／`removeWhen` 機制處理，不屬於這次要補的分類

`category` 三個值目前只有 `item`／`omen` 會用到，`item` 的 `consumable` 會實際影響引擎行為（見下方2.4節），`omen` 的 `weapon` 純粹是給你跟未來 M3 參考的分類標記，本次不影響任何執行邏輯。

### 2.4 道具「生效後是否消失」的規則

**規則（開發者已定案）**：不論主動/反應式使用時機，道具**生效後**依 `category` 決定：`consumable` → 從背包移除；`general`（或 `weapon`，但 weapon 本次不會真的被使用）→ 不移除。「生效」的判斷方式：**如果這次使用實際套用了至少一個效果就算生效；如果卡在骰子考驗失敗、對應分支的 `effects` 是空陣列（例如魔術方塊骰數 <6），就算沒生效，不觸發消耗品移除規則**。

這需要 `effectResolver.resolveEffects`（M2c-1 已合併的模組）的回傳值多帶一個 `appliedCount`（實際套用了幾個效果），詳見第4.1節。

## 3. 「操作」動作

### 3.1 房間效果資料現況

`data/rooms/rooms.json` 已經有房間專屬的操作文字（例如「保險庫」），格式是 `effects:[]`／`needsCustomLogic:true`，跟卡片的 schema 完全一樣——這塊內容併入 M2c-3 一起草擬（見 Handover 已更新的範圍）。

### 3.2 已放置房間物件目前遺失 `effects` 欄位

`boardGenerator.js` 的 `placeNewRoom` 目前只把 `{roomId, x, y, doorSides}` 存進 board（見程式碼第83-88行），**不會複製房間定義的 `effects` 欄位**。

**決定：不修改 `placeNewRoom`／board 的資料結構**（改了要動 `canMoveBetween`、序列化等既有依賴這個形狀的程式碼，風險比較高）。改成跟道具一樣的模式：`socketHandlers.js` 在需要時用 `placedRoom.roomId` 去 `content.rooms`／`content.startingRooms` 兩個陣列查表取得完整房間定義（含 `effects`）。新增一個小型查表輔助函式：

```js
function findRoomDefinition(content, roomId) {
  return (
    content.rooms.find((r) => r.id === roomId) ||
    content.startingRooms.find((r) => r.id === roomId)
  );
}
```

### 3.3 `game:selectAction` handler 對 `room_action` 的處理

這裡只示意 `room_action` 這一段的查表邏輯（用 `sourceEffects`/`sourceId` 命名，呼應第4.3節完整流程的最終版本，不要用不同變數名重複實作）：

```js
if (actionType === 'room_action') {
  const currentPlayer = getPlayer(gameState, playerId);
  const placedRoom = gameState.board[currentPlayer.floor].get(coordKey(currentPlayer.x, currentPlayer.y));
  const roomDefinition = findRoomDefinition(content, placedRoom.roomId);
  sourceEffects =
    roomDefinition && Array.isArray(roomDefinition.effects) && roomDefinition.effects.length > 0
      ? roomDefinition.effects
      : null;
  selectOptions.hasRoomAction = Boolean(sourceEffects);
  sourceId = placedRoom.roomId;
}
```

`selectAction` 收到 `hasRoomAction:false` 會拋 `NO_ROOM_ACTION_AVAILABLE`（**這是明確錯誤，不是「視為無事發生」**——玩家選了「操作」但房間沒東西可操作，是無效請求，不像抽卡遇到空牌庫那樣是正常遊戲進程的一部分）。

## 4. 效果解析與 `socketHandlers.js` 的整體流程

### 4.1 `effectResolver.resolveEffects` 新增 `appliedCount`（回頭調整 M2c-1 已合併的程式碼）

`resolveEffects` 的回傳值目前是 `{pending}`（或 `{pending:true, promptId, ...}`）。新增 `appliedCount`（實際套用了幾個效果，`dice_check` 命中空陣列分支時為 0）：

```js
function resolveEffects(gameState, promptState, playerId, effects, context = {}) {
  if (!Array.isArray(effects)) {
    throw new Error('INVALID_EFFECTS_LIST');
  }
  requirePlayer(gameState, playerId);
  let appliedCount = 0;
  for (const effect of effects) {
    const handler = HANDLERS[effect.type];
    if (!handler) {
      throw new Error('UNSUPPORTED_EFFECT_TYPE');
    }
    const result = handler(gameState, promptState, playerId, effect, context);
    if (result && result.pending) {
      return result;
    }
    appliedCount += (result && typeof result.appliedCount === 'number') ? result.appliedCount : 1;
  }
  return { pending: false, appliedCount };
}
```

**不需要改任何一個 `HANDLERS` 裡的個別 handler**——`handleDiceCheck` 本來就是直接 `return resolveEffects(gameState, promptState, playerId, tier.effects, context)`，新的 `appliedCount` 會自動透過這個遞迴呼叫往外層傳遞（外層迴圈讀到 `result.appliedCount` 就會用它，不會誤判成「1 個效果」）；其餘 handler（`stat_change`/`grant_item`/`lose_item`/`persistent_modifier`）回傳值不變，外層迴圈讀不到 `result.appliedCount` 時退回算「1 個效果」，行為完全一致。

驗證：魔術方塊 `effects = [{type:'dice_check', stat:'knowledge', tiers:[{min:6,max:8,effects:[grant_item,grant_item]},{min:0,max:5,effects:[]}]}]`——骰數 ≥6 命中成功分支，內層 `resolveEffects` 處理 2 個 `grant_item`，回傳 `appliedCount:2`，外層原樣傳遞；骰數 <6 命中空陣列分支，內層迴圈不執行，回傳 `appliedCount:0`，外層原樣傳遞——**這正是「有沒有生效」的判斷依據**。

### 4.2 `handleEffectResolveResult` 新增消耗品移除邏輯＋介面改名

**一個必要的介面調整**：`handleEffectResolveResult`／`resolveCardDraw` 目前的參數與廣播事件欄位叫 `cardId`（`game:cardDrawn`/`game:effectResolved`/`game:effectPendingChoice` 的 payload 都有 `cardId` 欄位）。道具／房間操作觸發的效果解析不是「卡片」，繼續叫 `cardId` 會誤導。**改名為 `sourceId`**（`handleEffectResolveResult` 的參數、三個廣播事件的 payload 欄位都跟著改），呼叫端各自傳入對應的 id（抽卡傳 `card.id`、用道具傳 `itemId`、操作房間傳 `placedRoom.roomId`）。

**新增參數 `consumeItemIfApplied`**（布林值，只有「道具使用且 `category==='consumable'`」這個呼叫路徑會傳 `true`，抽卡跟操作房間都傳 `false`/省略）。`pendingChoice` 物件也要多存這個欄位，因為道具效果如果卡在 `choice` 提問，要等提問真正解決（`game:effectPromptRespond` 或逾時）才知道最終 `appliedCount`，這個旗標要能撐過那段等待：

```js
function handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied = false) {
  const resolverEntry = getResolver(effectResolverManager, roomCode);
  if (effectResult.pending) {
    resolverEntry.pendingChoice = {
      promptId: effectResult.promptId,
      options: effectResult.options,
      defaultOptionId: effectResult.defaultOptionId,
      playerId,
      sourceId,
      consumeItemIfApplied,
    };
    io.to(roomCode).emit('game:effectPendingChoice', {
      playerId,
      promptId: effectResult.promptId,
      description: effectResult.description,
      options: effectResult.options,
    });
    const delayMs = Math.max(effectResult.deadline - Date.now(), 0);
    const handle = setTimeout(() => {
      handleEffectChoiceTimeout(io, effectResolverManager, gameState, roomCode, effectResult.promptId, effectChoiceTimeouts);
    }, delayMs);
    effectChoiceTimeouts.set(roomCode, handle);
    return { pending: true };
  }
  resolverEntry.pendingChoice = null;
  if (consumeItemIfApplied && effectResult.appliedCount > 0) {
    const player = getPlayer(gameState, playerId);
    removeItem(player, sourceId);
  }
  io.to(roomCode).emit('game:effectResolved', { playerId, sourceId });
  return { pending: false };
}
```

`handleEffectChoiceTimeout`／`game:effectPromptRespond` handler 這兩個既有的收尾路徑，呼叫 `handleEffectResolveResult` 時要多帶 `resolverEntry.pendingChoice.consumeItemIfApplied`（從剛才存的 `pendingChoice` 讀回來），維持跟即時解析路徑一致的行為。

### 4.3 `game:selectAction` 完整流程

```js
socket.on('game:selectAction', (payload, callback) => {
  const ack = ...;
  try {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return ack({ error: 'NOT_IN_ROOM' });
    const gameState = getGameState(gameManager, roomCode);
    if (!gameState) return ack({ error: 'GAME_NOT_STARTED' });
    if (hasPendingEffectChoice(effectResolverManager, roomCode)) {
      return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
    }
    const { actionType, itemId, targetPlayerId } = payload || {};
    const selectOptions = { itemId, targetPlayerId };
    let sourceEffects = null;
    let sourceId = null;
    let consumeItemIfApplied = false;

    if (actionType === 'item') {
      const itemContent = content.cards.items.find((i) => i.id === itemId);
      selectOptions.itemCanTargetOthers = Boolean(itemContent && itemContent.canTargetOthers);
      sourceEffects = itemContent ? itemContent.effects : [];
      sourceId = itemId;
      consumeItemIfApplied = Boolean(itemContent && itemContent.category === 'consumable');
    }

    if (actionType === 'room_action') {
      const currentPlayer = getPlayer(gameState, playerId);
      const placedRoom = gameState.board[currentPlayer.floor].get(coordKey(currentPlayer.x, currentPlayer.y));
      const roomDefinition = findRoomDefinition(content, placedRoom.roomId);
      sourceEffects =
        roomDefinition && Array.isArray(roomDefinition.effects) && roomDefinition.effects.length > 0
          ? roomDefinition.effects
          : null;
      selectOptions.hasRoomAction = Boolean(sourceEffects);
      sourceId = placedRoom.roomId;
    }

    const result = selectAction(gameState, playerId, actionType, selectOptions);
    ack(result);

    let stillResolving = false;
    if (sourceEffects) {
      try {
        const resolverEntry = getResolver(effectResolverManager, roomCode);
        const targetForEffects = result.targetPlayerId || playerId;
        const effectResult = resolveEffects(gameState, resolverEntry.promptState, targetForEffects, sourceEffects, { now: Date.now() });
        const outcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, targetForEffects, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied);
        stillResolving = outcome.pending;
      } catch (err) {
        console.error('selectAction effect resolution error', err);
      }
    } else if (result.pending) {
      io.to(roomCode).emit('game:pendingAction', { playerId, actionType: result.kind }); // attack 殼子維持不變
    }

    if (!stillResolving) {
      advanceTurnIfOver(gameState, playerId);
    }
    io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
  } catch (err) {
    console.error('game:selectAction error', err);
    ack({ error: err.message || 'BAD_REQUEST' });
  }
});
```

注意這裡把「道具內容查表」也移到 `selectAction(...)` 呼叫**之前**（跟 room_action 一樣），因為 `itemCanTargetOthers` 現在要傳進 `selectOptions` 給 `turnFlow.js` 做原子驗證（見第2.2節的 `ITEM_CANNOT_TARGET_OTHERS` 檢查），不能像之前設計那樣等 `ack(result)` 之後才查。

## 5. 邪祟考驗機制（M2c-5）

**規則（開發者已定案）**：每次抽到一張預兆卡，`gameState.omenCount` 遞增後，骰數量等於當前 `omenCount` 的骰子（沿用 `effectPipeline.rollDice`，0/0/1/1/2/2 面），總和 **>5** 觸發邪祟（`gameState.hauntStarted = true`）。這不是實體遊戲「抽到同名預兆第二張」的規則——我們的 13 張預兆互不重複，那條規則不適用。

### 5.1 觸發點

放在 `resolveCardDraw`（`socketHandlers.js`）判斷 `deckType === 'omen'` 時，**在抽卡廣播之後、效果解析之前**遞增並檢查：

```js
function resolveCardDraw(io, effectResolverManager, gameState, roomCode, playerId, deckType, effectChoiceTimeouts) {
  const deckField = DECK_FIELD_BY_TYPE[deckType];
  if (!deckField) {
    throw new Error('UNKNOWN_DECK_TYPE');
  }
  const deck = gameState[deckField];
  if (!hasCards(deck)) {
    return { pending: false };
  }
  const card = drawCard(deck);
  io.to(roomCode).emit('game:cardDrawn', { playerId, deckType, cardId: card.id, cardName: card.name });

  if (deckType === 'omen' && !gameState.hauntStarted) {
    gameState.omenCount += 1;
    const rollSum = rollDice(gameState.omenCount);
    io.to(roomCode).emit('game:hauntCheck', { omenCount: gameState.omenCount, rollSum });
    if (rollSum > 5) {
      gameState.hauntStarted = true;
      io.to(roomCode).emit('game:hauntStarted', { omenCount: gameState.omenCount, rollSum });
    }
  }

  const resolverEntry = getResolver(effectResolverManager, roomCode);
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, card.effects, { now: Date.now() });
  return handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, playerId, card.id, effectResult, effectChoiceTimeouts);
}
```

`!gameState.hauntStarted` 這個防護是避免邪祟已經開始後、預兆牌庫如果之後（M3）還會被抽到時重複觸發——本次 M2c-5 範圍內邪祟只會發生一次就結束測試，這個防護是面向未來的最小成本防呆，不是新設計決策。

### 5.2 新增 Socket 事件

- **`game:hauntCheck`**（廣播）：`{omenCount, rollSum}`——每次邪祟考驗都會發，不管有沒有觸發，讓玩家知道「這次骰了多少」
- **`game:hauntStarted`**（廣播）：`{omenCount, rollSum}`——只在真的觸發時額外發一次，明確標記「遊戲進入邪祟階段」，這是本次手動測試流程的終點信號

### 5.3 範圍外

邪祟開始後的所有內容（陣營指派、`onAttack`/`onDamageTaken`、`game:hauntStarted` 之後玩家還能不能繼續移動／使用道具等）——全部是 M3。M2c-5 只負責正確設定 `hauntStarted` 跟廣播，不處理任何後續玩法變化。

## 6. 任務拆分

規模比 M2c-1/M2c-2 小很多，預期不用再拆子計畫，一份計畫涵蓋：

1. `data/cards/item-cards.json`／`data/cards/omen-cards.json`：補 `category` 欄位 schema（`item` 另外補 `canTargetOthers`）——agent 只補欄位框架跟合理預設值（`category:"general"`、`canTargetOthers:false`），實際數值由開發者逐張確認修正，不是 agent 的任務
2. `effectResolver.js`：`resolveEffects` 新增 `appliedCount` 回傳（見4.1節，不改任何個別 handler）
3. `turnFlow.js`：`selectAction` 簽名擴充（item/room_action 真實邏輯，含 `ITEM_CANNOT_TARGET_OTHERS`／`NO_ROOM_ACTION_AVAILABLE` 檢查）
4. `socketHandlers.js`：`game:selectAction` handler 改寫（含 `findRoomDefinition` 輔助函式）、`handleEffectResolveResult`／相關廣播的 `cardId`→`sourceId` 改名＋新增 `consumeItemIfApplied` 參數、`resolveCardDraw` 加邪祟考驗
5. 測試：item 使用（自己/同房間他人）、`ITEM_NOT_HELD`/`TARGET_NOT_IN_ROOM`/`ITEM_CANNOT_TARGET_OTHERS`、消耗品生效後從背包移除／骰子考驗失敗不移除（比照魔術方塊的兩種分支各測一次）、room_action 成功／`NO_ROOM_ACTION_AVAILABLE`、邪祟考驗遞增與觸發（含用注入的 rng 讓測試能控制骰出的結果）、`cardId`→`sourceId` 改名沒有破壞 M2c-2 既有測試（測試檔也要同步改欄位名）

## 範圍外事項（記錄供後續參考）

- 兩層 20 秒計時提問 UI——延後到 M2 完整測試跑完後再補
- 房間單一操作以外的多操作選擇——目前資料沒有這個案例，出現時再設計
- **反應式道具（天使羽毛／詭異人偶／幸運兔腳／蠟燭）本次不支援主動使用**——見第1節，跟計時/反應式提問系統一起延後
- M3：邪祟後的所有戰鬥/陣營內容
- M2d：簡易使用者介面，另外討論
