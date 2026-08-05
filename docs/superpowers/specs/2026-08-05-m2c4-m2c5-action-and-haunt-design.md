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
- **道具的目標選擇**：不做伺服器端二次提問，`game:selectAction` 的 payload 直接帶 `targetPlayerId`（不帶則預設自己），伺服器只驗證目標玩家是否在同一房間
- **房間「操作」先假設每個房間只有一種操作**：`turn-flow-and-action-points.md` 提過「同房間多種操作要再選一個」的情境，但目前 31 筆房間資料沒有這種案例，先不支援多選，等 M2c-3 內容真的出現這個需求再擴充

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

```js
if (actionType === 'room_action') {
  const currentPlayer = getPlayer(gameState, playerId);
  const placedRoom = gameState.board[currentPlayer.floor].get(coordKey(currentPlayer.x, currentPlayer.y));
  const roomDefinition = findRoomDefinition(content, placedRoom.roomId);
  roomActionEffects =
    roomDefinition && Array.isArray(roomDefinition.effects) && roomDefinition.effects.length > 0
      ? roomDefinition.effects
      : null;
  selectOptions.hasRoomAction = Boolean(roomActionEffects);
}
```

`selectAction` 收到 `hasRoomAction:false` 會拋 `NO_ROOM_ACTION_AVAILABLE`（**這是明確錯誤，不是「視為無事發生」**——玩家選了「操作」但房間沒東西可操作，是無效請求，不像抽卡遇到空牌庫那樣是正常遊戲進程的一部分）。

## 4. `socketHandlers.js` 的 `game:selectAction` 整體流程

沿用 M2c-2 已經修好的 `handleEffectResolveResult`（含 `pendingChoice`／`EFFECT_CHOICE_IN_PROGRESS`／延後 `advanceTurnIfOver` 的死鎖防護，見 Handover「除錯注意事項」），**不重新設計**。

**一個必要的介面調整**：`handleEffectResolveResult`／`resolveCardDraw` 目前的參數與廣播事件欄位叫 `cardId`（`game:cardDrawn`/`game:effectResolved`/`game:effectPendingChoice` 的 payload 都有 `cardId` 欄位）。道具／房間操作觸發的效果解析不是「卡片」，繼續叫 `cardId`會誤導。**改名為 `sourceId`**（`handleEffectResolveResult` 的參數、三個廣播事件的 payload 欄位都跟著改），呼叫端各自傳入對應的 id（抽卡傳 `card.id`、用道具傳 `itemId`、操作房間傳 `placedRoom.roomId`）。這是目前唯一需要回頭調整既有已合併程式碼的地方，其餘都是新增。

完整流程：

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

    if (actionType === 'item') {
      const itemContent = content.cards.items.find((i) => i.id === itemId);
      sourceEffects = itemContent ? itemContent.effects : [];
      sourceId = itemId;
    }

    let stillResolving = false;
    if (sourceEffects) {
      try {
        const resolverEntry = getResolver(effectResolverManager, roomCode);
        const targetForEffects = result.targetPlayerId || playerId;
        const effectResult = resolveEffects(gameState, resolverEntry.promptState, targetForEffects, sourceEffects, { now: Date.now() });
        const outcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, targetForEffects, sourceId, effectResult, effectChoiceTimeouts);
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

1. `turnFlow.js`：`selectAction` 簽名擴充（item/room_action 真實邏輯）
2. `socketHandlers.js`：`game:selectAction` handler 改寫（含 `findRoomDefinition` 輔助函式）、`handleEffectResolveResult`／相關廣播的 `cardId`→`sourceId` 改名、`resolveCardDraw` 加邪祟考驗
3. 測試：item 使用（自己/同房間他人）、`ITEM_NOT_HELD`/`TARGET_NOT_IN_ROOM`、room_action 成功／`NO_ROOM_ACTION_AVAILABLE`、邪祟考驗遞增與觸發（含用注入的 rng 讓測試能控制骰出的結果）、`cardId`→`sourceId` 改名沒有破壞 M2c-2 既有測試（測試檔也要同步改欄位名）

## 範圍外事項（記錄供後續參考）

- 兩層 20 秒計時提問 UI——延後到 M2 完整測試跑完後再補
- 房間單一操作以外的多操作選擇——目前資料沒有這個案例，出現時再設計
- **伺服器不驗證「這個道具是否真的允許指定別的玩家當目標」**——只檢查目標是否在同房間，不檢查卡面文字是否支援「自己或他人」（例如治療藥膏支援，但大部分道具只能用在自己身上）。交給 M2c-3 的內容作者跟未來 M2d 的 UI（只顯示合理選項）自然把關，不在伺服器端加驗證——這個專案是朋友圈自用，不是防作弊導向
- M3：邪祟後的所有戰鬥/陣營內容
- M2d：簡易使用者介面，另外討論
