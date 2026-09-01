# 武器搜索連帶彈藥（A 類武器機制第一部分）— 設計文件

## 目標

`item_001`（左輪手槍）／`item_020`（十字弩）卡面都寫「此物品卡被抽出時，附帶抽出指定物品」（item_046 左輪子彈／item_047 十字弩箭）。這是武器攻擊機制整體的一部分，但攻擊本身完全卡在 M3（`turnFlow.js:594` 的 `attack` action 目前是純空殼，註解直接寫「M3 (combat) resolves it」）。跟開發者確認過範圍：**這次只做「搜索拾到武器時自動連帶取得彈藥」這一小塊**，攻擊時消耗彈藥、十字弩用完彈藥留在房間、`item_012` 獻祭之劍的知識考驗後果，這些都完全綁在攻擊流程裡面，留給 M3 一次設計。

## 架構

### 1. 新增卡片欄位 `triggerOnDraw`

只加在 `item_001`／`item_020` 兩張卡（`data/cards/item-cards.json`）：

```json
"triggerOnDraw": true,
"effects": [{ "type": "grant_item", "itemId": "item_046" }]
```

`item_020` 同理，`itemId` 改成 `"item_047"`。`grant_item` 效果類型已經存在（`server/src/game/effectResolver.js:91-95` 的 `handleGrantItem`：`addItem(player, {id: effect.itemId})`），不需要新增效果類型。

**為什麼需要一個新欄位，不能直接看 `effects` 是否非空**：目前 `data/cards/item-cards.json` 裡另外還有 18 張消耗品/可重複使用類道具（急救箱、嗅鹽…）也都有非空的 `effects`，但那些設計是「玩家主動使用時才觸發」，不能被這次改動誤觸發。`triggerOnDraw` 明確標記「這張卡的 `effects` 要在搜索拾到的當下立即執行」，只有這兩張卡會是 `true`。

**命名比照既有慣例**：跟 `activatedOnUse`／`consumesItem`／`needsCustomLogic` 一樣是窄用途的 camelCase 布林欄位。

### 2. 搜索處理邏輯改動

現有程式碼（`server/src/socketHandlers.js:340-348`，`game:selectAction` 的 `room_action` 分支裡）：

```javascript
const searchOutcome = performSearch(gameState, placedRoom);
if (searchOutcome.found) {
  addItem(currentPlayer, { id: searchOutcome.card.id });
  io.to(roomCode).emit('game:cardDrawn', { playerId, deckType: 'item', cardId: searchOutcome.card.id, cardName: searchOutcome.card.name, hasCheck: false });
  openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, playerId, content.cards, [searchOutcome.card.id], inventoryChoiceTimeoutMs);
} else {
  io.to(roomCode).emit('game:searchEmpty', { playerId, roomId: placedRoom.roomId });
}
```

改成：

```javascript
const searchOutcome = performSearch(gameState, placedRoom);
if (searchOutcome.found) {
  addItem(currentPlayer, { id: searchOutcome.card.id });
  io.to(roomCode).emit('game:cardDrawn', { playerId, deckType: 'item', cardId: searchOutcome.card.id, cardName: searchOutcome.card.name, hasCheck: false });
  const newlyAcquiredIds = [searchOutcome.card.id];
  if (searchOutcome.card.triggerOnDraw) {
    for (const effect of searchOutcome.card.effects) {
      if (effect.type !== 'grant_item') {
        throw new Error('UNSUPPORTED_DRAW_TRIGGER_EFFECT');
      }
      addItem(currentPlayer, { id: effect.itemId });
      const grantedCard = content.cards.items.find((i) => i.id === effect.itemId);
      io.to(roomCode).emit('game:cardDrawn', { playerId, deckType: 'item', cardId: effect.itemId, cardName: grantedCard ? grantedCard.name : effect.itemId, hasCheck: false });
      newlyAcquiredIds.push(effect.itemId);
    }
  }
  openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, playerId, content.cards, newlyAcquiredIds, inventoryChoiceTimeoutMs);
} else {
  io.to(roomCode).emit('game:searchEmpty', { playerId, roomId: placedRoom.roomId });
}
```

**刻意不重用 `resolveEffects`/`handleEffectResolveResult` 這條既有通用效果管線**：這條管線（`resolveCardDraw` 等既有呼叫點在用）設計上是把額外抽到的卡透過 `game:cardsDrawn` 私人事件通知抽卡玩家（`socket.emit('game:cardsDrawn', {cards: drawOutcome.drawnCards})`）——但查證過**前端目前完全沒有監聽 `game:cardsDrawn` 這個事件**，是死資料，沒辦法滿足「彈藥也要跳出自己的『找到了 XX』訊息」這個已跟開發者確認的需求（見下方「連帶取得道具的訊息」）。改成窄範圍直接處理：只支援 `triggerOnDraw` 底下的 `grant_item` 這一種效果類型，遇到其他類型直接拋錯（防呆，避免未來有人在別的卡上標 `triggerOnDraw:true` 卻塞了不支援的效果類型，卻沒人發現）。這不是通用機制，之後如果有其他武器也要用「搜索拾到時觸發」但效果比 `grant_item` 複雜，屆時再擴充，不現在預先設計。

### 3. 連帶取得道具的訊息（已跟開發者確認）

彈藥廣播自己的 `game:cardDrawn`（`deckType:'item', hasCheck:false`），前端既有的 `onCardDrawn`／訊息欄／`itemDrawNoCheck` 彈窗邏輯不需要修改，會自動比照左輪手槍本身，各自跳出「XX 在房間裡找到了 YY」的訊息——玩家會依序看到兩則訊息（先武器本身、後彈藥），不需要任何前端程式碼改動。

### 4. 攜帶上限

`openInventoryChoiceIfNeeded`（`socketHandlers.js:688-719`）本來就接受一個 `newlyAcquiredItemIds` 陣列，不限單一道具。把武器本身跟自動給予的彈藥都放進同一份 `newlyAcquiredIds` 陣列傳進去，兩者都會被視為「這次新取得」，判斷攜帶上限超標時的預設遺留對象（`pickInventoryChoiceDefault`）不會挑到這兩件剛拿到的道具——不需要修改 `openInventoryChoiceIfNeeded` 本身。

## 測試計畫

`server/test/socketHandlers.test.js` 新增測試，比照既有搜索相關測試的既有寫法：
- 搜到 `item_001` 時，玩家背包同時多出 `item_001`／`item_046`
- 廣播順序：先收到 `item_001` 的 `game:cardDrawn`，再收到 `item_046` 的 `game:cardDrawn`
- 搜到一張沒有 `triggerOnDraw` 的一般道具時，行為完全不變（沒有額外的 `game:cardDrawn` 廣播、沒有額外道具進背包）——確認既有搜索測試不受影響
- 搜到 `item_001`／`item_046` 兩件道具合計超過力量上限時，`game:inventoryChoicePending` 的 `itemIds`（可選擇遺留的清單）不包含這兩件剛取得的道具
- （可選）搜到一張假設標了 `triggerOnDraw:true` 但 `effects` 是非 `grant_item` 類型的卡片時，拋出 `UNSUPPORTED_DRAW_TRIGGER_EFFECT`——確認防呆生效

## 範圍排除

- 攻擊時消耗彈藥、十字弩用完彈藥留在房間、`item_012` 獻祭之劍的知識考驗後果——完全綁在攻擊流程裡，`attack` action 目前是空殼，留給 M3 一次設計，這次不寫任何相關程式碼
- `item_011`／`item_018`／`item_019`（跟開發者確認過是標準攻擊，只是骰子加成/判定屬性不同，不算需要額外機制的複雜卡）、`item_035`（跟開發者確認過「偷竊」是這次遊戲對「搶奪」機制的設計調整，屬於 M3 攻擊結果類型之一，不是獨立機制）——都留給 M3，這次不動
- `item_043`（硬木棍「襲擊失敗不受反擊傷害」）——開發者要求列入 M3 討論，這次只記錄不處理
