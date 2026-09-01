# Weapon Search-Draw Companion Ammo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a player searches and finds `item_001`（左輪手槍）or `item_020`（十字弩）, they automatically also receive the matching ammo item (`item_046`/`item_047`) in the same moment, with its own "found XX" broadcast, and both new items are correctly excluded from the "which item to leave behind" choice if this pushes the player over their carry limit.

**Architecture:** A new narrow-purpose boolean card field, `triggerOnDraw`, marks exactly these two cards. The server's existing search-handling code (`server/src/socketHandlers.js`'s `game:selectAction` `room_action` branch) gets a small addition: after adding the found card to inventory as it already does, if the card has `triggerOnDraw`, it directly applies each of the card's `grant_item` effects (adding the granted item, broadcasting its own `game:cardDrawn`), then folds every newly-acquired item id into the existing carry-limit check. No new effect type, no new client code, no reuse of the `resolveEffects`/`handleEffectResolveResult` generic pipeline (that pipeline's extra-card notification path, `game:cardsDrawn`, has no client listener today and doesn't fit this feature's requirement).

**Tech Stack:** Node.js/Express + Socket.IO server, Jest for tests. No client changes.

## Global Constraints

- `triggerOnDraw: true` is set on exactly `item_001` and `item_020` in `data/cards/item-cards.json` — no other card gets this field.
- The handler that processes `triggerOnDraw` supports only the `grant_item` effect type. Any other effect type in a `triggerOnDraw` card's `effects` array must throw `UNSUPPORTED_DRAW_TRIGGER_EFFECT` — this is a deliberate guard, not a gap to fill in later.
- Out of scope (do not implement): ammo consumption during an attack, item_020's "ammo drops to the room after the attack completes" behavior, item_012's secondary knowledge check, and anything else that requires the `attack` action to actually resolve (it is currently a stub — `server/src/game/turnFlow.js:594`, comment: `"attack" is still a stub — M3 (combat) resolves it.`). This plan touches nothing under the `attack` action type.

---

### Task 1: `triggerOnDraw` card field + search-handler support

**Files:**
- Modify: `data/cards/item-cards.json` (add `triggerOnDraw` to `item_001` and `item_020`)
- Modify: `server/src/socketHandlers.js:340-348` (the `game:selectAction` `room_action` search branch)
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: the existing `grant_item` effect handler (`server/src/game/effectResolver.js:91-95`, `addItem(player, {id: effect.itemId})` — already implemented, not touched by this task) and the existing `openInventoryChoiceIfNeeded(io, effectResolverManager, gameState, roomCode, playerId, cardContent, newlyAcquiredItemIds, inventoryChoiceTimeoutMs)` (`server/src/socketHandlers.js:688`, already implemented, not touched — it already accepts an array of newly-acquired ids).
- Produces: nothing consumed by a later task — this plan is a single task.

- [ ] **Step 1: Add `triggerOnDraw` to `item_001` and `item_020` in the data file**

Current `data/cards/item-cards.json` for `item_001` (near the top of the file):

```json
  {
    "id": "item_001",
    "name": "左輪手槍",
    "description": "警用手槍，但只有一顆子彈，不知道能否得到補給，應該要謹慎使用",
    "text": "此物品卡被抽出時，附帶抽出指定物品item_046。消耗item_046，以速度進行襲擊考驗，可多擲一顆骰子。可對本房間或相鄰房間的目標進行襲擊，若襲擊成功，目標受到肉體損傷。若襲擊失敗，發動襲擊的玩家不受肉體損傷。",
    "effects": [],
    "category": "weapon",
    "attackStat": "speed",
    "attackDice": "addition_one",
    "canTargetOthers": false,
    "needsCustomLogic": true
  },
```

Change the `"effects": []` line to add `triggerOnDraw` right after it, and populate the array:

```json
  {
    "id": "item_001",
    "name": "左輪手槍",
    "description": "警用手槍，但只有一顆子彈，不知道能否得到補給，應該要謹慎使用",
    "text": "此物品卡被抽出時，附帶抽出指定物品item_046。消耗item_046，以速度進行襲擊考驗，可多擲一顆骰子。可對本房間或相鄰房間的目標進行襲擊，若襲擊成功，目標受到肉體損傷。若襲擊失敗，發動襲擊的玩家不受肉體損傷。",
    "effects": [{ "type": "grant_item", "itemId": "item_046" }],
    "triggerOnDraw": true,
    "category": "weapon",
    "attackStat": "speed",
    "attackDice": "addition_one",
    "canTargetOthers": false,
    "needsCustomLogic": true
  },
```

Current `data/cards/item-cards.json` for `item_020`:

```json
  {
    "id": "item_020",
    "name": "十字弩",
```

(find the full block by its `"id": "item_020"` — it currently has `"effects": []` the same way). Change its `"effects": []` to `"effects": [{ "type": "grant_item", "itemId": "item_047" }]` and add `"triggerOnDraw": true` right after it, same placement pattern as `item_001` above.

`needsCustomLogic` stays `true` on both cards — the attack mechanics themselves are still unimplemented (M3 scope), only the draw-time ammo grant is being added by this plan.

- [ ] **Step 2: Validate the JSON still parses and confirm exactly the intended 2 cards changed**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('data/cards/item-cards.json','utf8')); console.log('valid JSON')"
git diff data/cards/item-cards.json
```

Expected: `valid JSON`, and the diff shows changes only inside the `item_001` and `item_020` blocks (2 modified `"effects"` lines, 2 added `"triggerOnDraw"` lines, nothing else).

- [ ] **Step 3: Write the failing tests for the search-handler change**

Add these tests to `server/test/socketHandlers.test.js`. They use the existing `makeSearchRoomContent(itemField)` helper already defined in this file (`makeSearchRoomContent(['item_001'])` deterministically makes the search find `item_001`, matching the existing "fixed item list" test pattern a few tests above/below where you add these).

```javascript
test('game:selectAction room_action: finding a triggerOnDraw weapon also grants its companion item, with its own game:cardDrawn broadcast', async () => {
  const content = makeSearchRoomContent(['item_001']);
  content.cards.items = [
    {
      id: 'item_001',
      name: '左輪手槍',
      effects: [{ type: 'grant_item', itemId: 'item_046' }],
      triggerOnDraw: true,
    },
    { id: 'item_046', name: '左輪子彈' },
  ];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const cardDrawnEvents = [];
  currentClient.on('game:cardDrawn', (data) => cardDrawnEvents.push(data));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();

  expect(cardDrawnEvents).toHaveLength(2);
  expect(cardDrawnEvents[0]).toMatchObject({ deckType: 'item', cardId: 'item_001', cardName: '左輪手槍', hasCheck: false });
  expect(cardDrawnEvents[1]).toMatchObject({ deckType: 'item', cardId: 'item_046', cardName: '左輪子彈', hasCheck: false });

  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_001' }, { id: 'item_046' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: finding a non-triggerOnDraw item behaves exactly as before (no extra grant, no extra broadcast)', async () => {
  const content = makeSearchRoomContent(['item_002']);
  content.cards.items = [{ id: 'item_002', name: '測試道具', effects: [] }];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  const cardDrawnEvents = [];
  currentClient.on('game:cardDrawn', (data) => cardDrawnEvents.push(data));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();

  expect(cardDrawnEvents).toHaveLength(1);
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_002' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: a triggerOnDraw card plus its granted item together exceed the carry limit -- both are excluded from the leave-behind choice', async () => {
  const content = makeSearchRoomContent(['item_001']);
  content.cards.items = [
    { id: 'item_101', name: '道具一' },
    { id: 'item_102', name: '道具二' },
    {
      id: 'item_001',
      name: '左輪手槍',
      effects: [{ type: 'grant_item', itemId: 'item_046' }],
      triggerOnDraw: true,
    },
    { id: 'item_046', name: '左輪子彈' },
  ];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.actionPoints = 1;
  player.inventory.push({ id: 'item_101' }, { id: 'item_102' }); // this test's default character has might 3 (see makeStats() in this file) -- 2 held + 2 newly acquired = 4 > cap 3

  const pendingPromise = new Promise((resolve) => currentClient.once('game:inventoryChoicePending', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const pending = await pendingPromise;

  expect(pending.itemIds.sort()).toEqual(['item_101', 'item_102'].sort()); // item_001/item_046 excluded -- both newly acquired

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction room_action: a triggerOnDraw card with an unsupported effect type throws UNSUPPORTED_DRAW_TRIGGER_EFFECT', async () => {
  const content = makeSearchRoomContent(['item_001']);
  content.cards.items = [
    {
      id: 'item_001',
      name: '左輪手槍',
      effects: [{ type: 'stat_change', stat: 'might', delta: 1 }], // not grant_item -- must be rejected
      triggerOnDraw: true,
    },
  ];
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  getPlayer(getGameState(gameManager, roomCode), currentPlayerId).actionPoints = 1;

  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBe('UNSUPPORTED_DRAW_TRIGGER_EFFECT');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 4: Run the new tests to verify they fail**

Run: `cd server && npx jest test/socketHandlers.test.js -t "triggerOnDraw"`
Expected: FAIL — `item_001`/`item_020` in the real `data/cards/item-cards.json` don't matter here (these tests supply their own `content.cards.items`), but the production code in `socketHandlers.js` doesn't read `triggerOnDraw` yet, so the companion-grant tests will see only 1 `game:cardDrawn` event instead of 2, and the "unsupported effect" test won't throw.

- [ ] **Step 5: Implement the search-handler change**

Current code in `server/src/socketHandlers.js:340-348`:

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

Replace with:

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

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `cd server && npx jest test/socketHandlers.test.js -t "triggerOnDraw"`
Expected: PASS, 4 tests.

- [ ] **Step 7: Run the full server test suite**

Run: `cd server && npm test`
Expected: PASS, all tests green, no regressions in the existing search/inventory-choice tests (the `<3`-equivalent here — every existing search test uses cards without `triggerOnDraw`, so `searchOutcome.card.triggerOnDraw` is `undefined`/falsy for all of them and the new `if` block never executes, byte-for-byte preserving prior behavior for every other card).

- [ ] **Step 8: Commit**

```bash
git add data/cards/item-cards.json server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: weapon search-draw grants its companion ammo item

item_001 (左輪手槍) and item_020 (十字弩) now carry a triggerOnDraw
flag. Finding either via search immediately grants the matching ammo
item (item_046/item_047) with its own game:cardDrawn broadcast, and
both the weapon and its ammo are correctly excluded from the
leave-behind choice if this pushes the player over their carry limit.

Attack-time mechanics (ammo consumption, item_012's secondary check,
item_020's post-attack ammo drop) remain out of scope -- the attack
action itself is still an M3 stub."
```
