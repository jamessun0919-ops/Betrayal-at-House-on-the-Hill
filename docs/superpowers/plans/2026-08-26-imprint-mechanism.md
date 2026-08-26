# 銘印（Imprint）機制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `imprint` omen category (8 cards, already reclassified in data) real mechanical support: a menu that only offers 查看 (plus 使用 for the one card that still needs active triggering), server-side rejection of give/leave, and a new `remove_imprint` effect that randomly strips one held imprint and automatically reverses its stat bonus.

**Architecture:** No new data structures — imprints stay in `player.inventory` exactly like today's omens. A new `remove_imprint` effect type (mirrors the existing `lose_item`/`stat_change` pattern) does the removal and computes the reversal by negating the removed card's own `stat_change` effects, so no card ever needs to author a separate "loss" effect. Give/leave rejection follows the exact pattern `wieldItemAction`/`wearItemAction` already established for category validation.

**Tech Stack:** Node.js/Express/Socket.IO (server), React/Vite (client), Jest (server tests only — this project has no frontend test runner).

## Global Constraints

- Storage: imprints live in `player.inventory`, same as any omen. No new player field, no new card field beyond the already-existing `category: "imprint"`.
- Menu: `category === 'imprint'` → default is 查看 only (no 給予/遺留/取消 — 查看 itself closes the menu); if the card also has `activatedOnUse: true`, show 使用 alongside 查看. Today this applies only to `omen_004`（獵犬）.
- `omen_008`（面具）is rewritten to a flat, unconditional passive grant (speed +2, knowledge -2) — no more `dice_check`/`toggle_active`/`activatedOnUse`.
- Reversal is automatic and computed from the removed card's own `effects` at removal time — never hand-authored per card.
- Out of scope (do not touch): `omen_001`/`010`/`011`/`012`/`013` (M3-blocked), `omen_009`'s room-check exemption (needs a new modifier hook, not part of this plan), `event_036`'s "boost one random ability" clause (no random-stat-pick mechanism exists yet — `event_036` keeps `needsCustomLogic: true` even after this plan lands).
- Server tests: `cd server && npm test` (Jest). Every task must end with the full suite green, not just its own new test file.
- Frontend: no automated test suite — verify with `cd client && npm run build` succeeding; manual browser check deferred to the developer/controller, not required per-task from implementers.

---

### Task 1: `remove_imprint` effect type

**Files:**
- Modify: `server/src/game/effectResolver.js` (new handler + HANDLERS registration)
- Modify: `server/src/socketHandlers.js` (thread `omenCatalog` into the 6 `resolveEffects` call sites — lines 349, 467, 897, 976-979, 1105, 1211 in the current file)
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Produces: effect `{ type: "remove_imprint" }` — no parameters. Looks up card definitions via `context.itemCatalog` and `context.omenCatalog` (both arrays of full card objects, matching the existing `itemCatalog` convention). Removes one randomly-chosen `category === 'imprint'` card from the acting player's inventory; no-op (not an error) if they hold none.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/game/effectResolver.test.js`, right after the existing `test('resolveEffects lose_item with destination "room" removes the item and drops it in the player\'s current room', ...)` block:

```javascript
test('resolveEffects remove_imprint removes the player\'s only imprint and reverses its stat_change effects', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'omen_002' });
  const baseKnowledge = player.stats.knowledge.currentIndex;
  player.stats.knowledge.currentIndex += 2; // simulate having already gained the imprint's +2 on acquire
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'remove_imprint' },
  ], { omenCatalog: [{ id: 'omen_002', category: 'imprint', effects: [{ type: 'stat_change', stat: 'knowledge', delta: 2 }] }] });
  expect(player.inventory).toEqual([]);
  expect(player.stats.knowledge.currentIndex).toBe(baseKnowledge);
});

test('resolveEffects remove_imprint picks the imprint at the index Math.random selects when multiple are held', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'omen_005' }, { id: 'omen_006' });
  const catalog = [
    { id: 'omen_005', category: 'imprint', effects: [{ type: 'stat_change', stat: 'sanity', delta: 1 }] },
    { id: 'omen_006', category: 'imprint', effects: [{ type: 'stat_change', stat: 'sanity', delta: 2 }] },
  ];
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'remove_imprint' },
  ], { omenCatalog: catalog });
  rngSpy.mockRestore();
  expect(player.inventory).toEqual([{ id: 'omen_005' }]); // omen_006 (index 1) was removed
});

test('resolveEffects remove_imprint does nothing when the player holds no imprints', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_003' });
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'remove_imprint' },
  ], { itemCatalog: [{ id: 'item_003', category: 'consumable' }] });
  expect(player.inventory).toEqual([{ id: 'item_003' }]);
});

test('resolveEffects remove_imprint ignores non-imprint cards even when present in the catalogs', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_003' }, { id: 'omen_003' });
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'remove_imprint' },
  ], {
    itemCatalog: [{ id: 'item_003', category: 'consumable' }],
    omenCatalog: [{ id: 'omen_003', category: 'consumable' }],
  });
  expect(player.inventory).toEqual([{ id: 'item_003' }, { id: 'omen_003' }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest effectResolver -t "remove_imprint"`
Expected: FAIL (`remove_imprint` is not a registered effect type yet — `UNSUPPORTED_EFFECT_TYPE`).

- [ ] **Step 3: Implement the handler**

In `server/src/game/effectResolver.js`, add this function right after `handleLoseItem` (which you'll find ends around where `destination` handling was added in a prior session — search for `function handleLoseItem`):

```javascript
function handleRemoveImprint(gameState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const catalog = [...((context && context.itemCatalog) || []), ...((context && context.omenCatalog) || [])];
  const imprintIds = player.inventory
    .map((item) => item.id)
    .filter((id) => {
      const cardDef = catalog.find((c) => c.id === id);
      return cardDef && cardDef.category === 'imprint';
    });
  if (imprintIds.length === 0) {
    return { pending: false };
  }
  const chosenId = imprintIds[Math.floor(Math.random() * imprintIds.length)];
  const cardDef = catalog.find((c) => c.id === chosenId);
  removeItem(player, chosenId);
  for (const cardEffect of cardDef.effects || []) {
    if (cardEffect.type === 'stat_change' && !cardEffect.restoreToBase) {
      changeStat(player, cardEffect.stat, -cardEffect.delta, gameState.hauntStarted);
    }
  }
  return { pending: false };
}
```

In the `HANDLERS` map (search for `const HANDLERS = Object.assign`), add:

```javascript
  remove_imprint: (gameState, promptState, playerId, effect, context) => handleRemoveImprint(gameState, playerId, effect, context),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest effectResolver -t "remove_imprint"`
Expected: PASS, all 4 new tests.

- [ ] **Step 5: Thread `omenCatalog` into `resolveEffects` calls**

`remove_imprint` only works in production once the server actually hands it an omen catalog to look cards up in — every existing `resolveEffects` call site currently passes `itemCatalog: content.cards.items` but never an omen equivalent. In `server/src/socketHandlers.js`, add `omenCatalog: content.cards.omens` alongside every existing `itemCatalog: content.cards.items` in a context object passed to `resolveEffects`. There are 6 call sites — search for `itemCatalog: content.cards.items` and `itemCatalog,` to find all of them; two are multi-line object literals, the rest are inline. For example, the inline form:

```javascript
{ now: Date.now(), itemCatalog: content.cards.items }
```
becomes:
```javascript
{ now: Date.now(), itemCatalog: content.cards.items, omenCatalog: content.cards.omens }
```

And the multi-line form (around where `sourceDeckType: deckType` appears):
```javascript
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, card.effects, {
    now: Date.now(),
    itemCatalog: content.cards.items,
    sourceDeckType: deckType,
  });
```
becomes:
```javascript
  const effectResult = resolveEffects(gameState, resolverEntry.promptState, playerId, card.effects, {
    now: Date.now(),
    itemCatalog: content.cards.items,
    omenCatalog: content.cards.omens,
    sourceDeckType: deckType,
  });
```

Apply the same one-line addition (`omenCatalog: content.cards.omens,`) to all 6 sites. Do not change any other field on these objects.

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green (confirms the `omenCatalog` addition didn't disturb `itemCatalog`-dependent behavior like dice interjection, which only reads `itemCatalog`).

- [ ] **Step 7: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js server/src/socketHandlers.js
git commit -m "feat: add remove_imprint effect type with automatic loss-reversal"
```

---

### Task 2: Server-side give/leave rejection for imprint-category cards

**Files:**
- Modify: `server/src/game/turnFlow.js:426-457` (`giveItemAction`, `leaveItemAction`, and their call sites in `selectAction`)
- Modify: `server/src/socketHandlers.js` (resolve `itemCategory` for `mode:'give'`/`mode:'leave'`, mirroring the existing `mode:'wield'`/`mode:'wear'` resolution)
- Test: `server/test/game/turnFlow.test.js`, `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `giveItemAction(gameState, player, itemId, targetPlayerId, itemCategory)` and `leaveItemAction(gameState, player, itemId, itemCategory)` — both now take a 5th/4th `itemCategory` parameter and throw `IMPRINT_CANNOT_BE_GIVEN` / `IMPRINT_CANNOT_BE_LEFT` when it's `'imprint'`. Existing callers that don't pass it get `undefined`, which is never `=== 'imprint'`, so this is backward compatible.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/game/turnFlow.test.js`, right after the existing give/leave tests (search for `test('selectAction item mode:leave preserves the item object`):

```javascript
test('selectAction item mode:give throws IMPRINT_CANNOT_BE_GIVEN for an imprint-category card', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'omen_002' });
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player2.floor = player.floor; player2.x = player.x; player2.y = player.y;
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'omen_002', mode: 'give', targetPlayerId: 'p2', itemCategory: 'imprint' })
  ).toThrow('IMPRINT_CANNOT_BE_GIVEN');
  expect(player.inventory).toEqual([{ id: 'omen_002' }]);
});

test('selectAction item mode:leave throws IMPRINT_CANNOT_BE_LEFT for an imprint-category card', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'omen_002' });
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'omen_002', mode: 'leave', itemCategory: 'imprint' })
  ).toThrow('IMPRINT_CANNOT_BE_LEFT');
  expect(player.inventory).toEqual([{ id: 'omen_002' }]);
});
```

Check the top of `server/test/game/turnFlow.test.js` for how `addPlayer` and `makeStats` are imported/defined in this file (they're already used elsewhere in the file for multi-player tests) — reuse the existing imports, don't add new ones.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest turnFlow -t "IMPRINT_CANNOT"`
Expected: FAIL (`giveItemAction`/`leaveItemAction` don't check category yet; the actions would currently succeed).

- [ ] **Step 3: Implement the turnFlow.js changes**

Replace (current lines 426-457):

```javascript
function giveItemAction(gameState, player, itemId, targetPlayerId) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_HELD');
  }
  const targetPlayer = requirePlayer(gameState, targetPlayerId);
  if (
    targetPlayer.floor !== player.floor ||
    targetPlayer.x !== player.x ||
    targetPlayer.y !== player.y
  ) {
    throw new Error('TARGET_NOT_IN_ROOM');
  }
  const [item] = player.inventory.splice(index, 1);
  clearEquipStateIfNeeded(player, itemId);
  addItem(targetPlayer, item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'give', itemId, targetPlayerId };
}

function leaveItemAction(gameState, player, itemId) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_HELD');
  }
  const [item] = player.inventory.splice(index, 1);
  clearEquipStateIfNeeded(player, itemId);
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  room.droppedItems.push(item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'leave', itemId };
}
```

with:

```javascript
function giveItemAction(gameState, player, itemId, targetPlayerId, itemCategory) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_HELD');
  }
  if (itemCategory === 'imprint') {
    throw new Error('IMPRINT_CANNOT_BE_GIVEN');
  }
  const targetPlayer = requirePlayer(gameState, targetPlayerId);
  if (
    targetPlayer.floor !== player.floor ||
    targetPlayer.x !== player.x ||
    targetPlayer.y !== player.y
  ) {
    throw new Error('TARGET_NOT_IN_ROOM');
  }
  const [item] = player.inventory.splice(index, 1);
  clearEquipStateIfNeeded(player, itemId);
  addItem(targetPlayer, item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'give', itemId, targetPlayerId };
}

function leaveItemAction(gameState, player, itemId, itemCategory) {
  const index = player.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error('ITEM_NOT_HELD');
  }
  if (itemCategory === 'imprint') {
    throw new Error('IMPRINT_CANNOT_BE_LEFT');
  }
  const [item] = player.inventory.splice(index, 1);
  clearEquipStateIfNeeded(player, itemId);
  const room = getRoomAt(gameState, player.floor, player.x, player.y);
  room.droppedItems.push(item);
  player.actionPoints -= 1;
  return { kind: 'item', mode: 'leave', itemId };
}
```

Then in `selectAction` (search for `if (mode === 'give')`), replace:

```javascript
    if (mode === 'give') {
      return giveItemAction(gameState, player, itemId, targetPlayerId);
    }
    if (mode === 'leave') {
      return leaveItemAction(gameState, player, itemId);
    }
```

with:

```javascript
    if (mode === 'give') {
      return giveItemAction(gameState, player, itemId, targetPlayerId, itemCategory);
    }
    if (mode === 'leave') {
      return leaveItemAction(gameState, player, itemId, itemCategory);
    }
```

(`itemCategory` is already destructured from `options` a few lines above this block — it's the same variable `wieldItemAction`/`wearItemAction` already use.)

- [ ] **Step 4: Run the turnFlow tests**

Run: `cd server && npx jest turnFlow`
Expected: PASS, including the 2 new tests and all pre-existing give/leave tests (they don't pass `itemCategory`, so it's `undefined`, never `=== 'imprint'`, so they're unaffected).

- [ ] **Step 5: Resolve `itemCategory` server-side for give/leave in socketHandlers.js**

Passing `itemCategory` from the client would let a modified client lie about it — resolve it server-side from the trusted card catalog, exactly like `mode:'wield'`/`mode:'wear'` already do. In `server/src/socketHandlers.js`, find:

```javascript
        if (actionType === 'item' && (mode === 'wield' || mode === 'wear')) {
          const itemContent = content.cards.items.find((i) => i.id === itemId);
          selectOptions.itemCategory = itemContent ? itemContent.category : null;
        }
```

Add immediately after it:

```javascript
        if (actionType === 'item' && (mode === 'give' || mode === 'leave')) {
          const itemContent = content.cards.items.find((i) => i.id === itemId) || content.cards.omens.find((o) => o.id === itemId);
          selectOptions.itemCategory = itemContent ? itemContent.category : null;
        }
```

(Note this checks `content.cards.omens` too, unlike the wield/wear block above it — imprints are omens, wield/wear items never are.)

- [ ] **Step 6: Write a socket-level integration test**

Add to `server/test/socketHandlers.test.js`, near the existing give/leave tests (search for `mode: 'give', targetPlayerId: otherPlayerId`):

```javascript
test('game:selectAction item mode:give rejects an imprint-category card even if the client omits itemCategory', async () => {
  const content = makeContent({
    cards: { events: [], items: [], omens: [{ id: 'omen_002', name: '古書', category: 'imprint', effects: [] }] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, otherPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'omen_002' });

  const result = await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'omen_002', mode: 'give', targetPlayerId: otherPlayerId }, resolve)
  );

  expect(result.error).toBe('IMPRINT_CANNOT_BE_GIVEN');
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'omen_002' }]);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

Check the surrounding existing give tests in this file for the exact destructured names `setUpStartedGameWithContent` returns (e.g. whether the second player's id is called `otherPlayerId` or something else) and match that convention exactly.

- [ ] **Step 7: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green.

- [ ] **Step 8: Commit**

```bash
git add server/src/game/turnFlow.js server/src/socketHandlers.js server/test/game/turnFlow.test.js server/test/socketHandlers.test.js
git commit -m "feat: reject give/leave for imprint-category cards, resolved server-side"
```

---

### Task 3: Card data — `omen_008` rewrite, `event_036`/`item_050` wiring, stale test fix

**Files:**
- Modify: `data/cards/omen-cards.json` (`omen_008`)
- Modify: `data/cards/event-cards.json` (`event_036`)
- Modify: `data/cards/item-cards.json` (`item_050`)
- Modify: `server/test/game/turnFlow.test.js` (2 tests currently using `omen_008` to exercise a mechanic it no longer has)

**Interfaces:**
- Consumes: `remove_imprint` effect type from Task 1.

**Use the `Edit` tool with exact `old_string`/`new_string` matches for every JSON edit below — never rewrite these files by parsing and re-serializing them; that reformats the whole file and makes the diff unreviewable.** Before each edit, re-read the target block with `grep -n '"card_id"' -A N data/cards/whatever.json` — these files are actively edited by the developer in parallel sessions, so don't trust a stale in-context copy.

- [ ] **Step 1: Rewrite `omen_008` to a flat passive imprint**

In `data/cards/omen-cards.json`, find the `omen_008` entry (currently has a `dice_check`/`toggle_active` effects block and `"activatedOnUse": true`). Replace its `effects` and remove the `activatedOnUse` line:

Before:
```json
    "text": "持有「面具」時，玩家速度上升兩個級別，知識下降兩個級別。若失去「面具」，速度下降兩個級別，知識上升兩個級別。", 
    "effects": [{
    "type": "dice_check",
    "stat": "sanity",
    "tiers": [
      { "min": 4, "max": 8, "effects": [{
        "type": "toggle_active",
        "itemId": "omen_008",
        "activeEffects": [{ "type": "stat_change", "stat": "knowledge", "delta": 2 }, { "type": "stat_change", "stat": "sanity", "delta": -2 }],
        "inactiveEffects": [{ "type": "stat_change", "stat": "knowledge", "delta": -2 }, { "type": "stat_change", "stat": "sanity", "delta": 2 }]
      }] },
      { "min": 0, "max": 3, "effects": [] }
    ]
  }], 
    "activatedOnUse": true, 
    "category": "imprint", 
    "needsCustomLogic": false 
},
```

After:
```json
    "text": "持有「面具」時，玩家速度上升兩個級別，知識下降兩個級別。若失去「面具」，速度下降兩個級別，知識上升兩個級別。", 
    "effects": [
      { "type": "stat_change", "stat": "speed", "delta": 2 },
      { "type": "stat_change", "stat": "knowledge", "delta": -2 }
    ], 
    "category": "imprint", 
    "needsCustomLogic": false 
},
```

- [ ] **Step 2: Wire `remove_imprint` into `event_036`**

In `data/cards/event-cards.json`, find `event_036`. Its "boost one random ability" clause has no mechanism yet (see Global Constraints) — add the removal effect and correct `needsCustomLogic` to reflect that the card is still incomplete:

Before:
```json
    "text": "如果角色身上有銘印，隨機消滅一個銘印，並提升一個隨機能力的級別。",
    "feedbacktextOccur": "你手臂上的一個詭異印記消失，你感覺一股能量改造了你的身體。",
    "effects": [],
    "needsCustomLogic": false
```

After:
```json
    "text": "如果角色身上有銘印，隨機消滅一個銘印，並提升一個隨機能力的級別。",
    "feedbacktextOccur": "你手臂上的一個詭異印記消失，你感覺一股能量改造了你的身體。",
    "effects": [{ "type": "remove_imprint" }],
    "needsCustomLogic": true
```

- [ ] **Step 3: Wire `remove_imprint` into `item_050`, fix its `canTargetOthers`**

In `data/cards/item-cards.json`, find `item_050`. Its text says "對自己或對同房間玩家使用" (self or a same-room player) but `canTargetOthers` is currently `false` — same kind of mismatch fixed for `item_032` in an earlier session.

Before:
```json
    "text": "對自己或對同房間玩家使用，消除其身上的一個銘蔭效果。",
    "effects": [],
    "category": "consumable",
    "feedbacktextOccur":"「你使用聖水消除了身上的詭異印記」",
    "canTargetOthers": false,
    "needsCustomLogic": false
```

After:
```json
    "text": "對自己或對同房間玩家使用，消除其身上的一個銘蔭效果。",
    "effects": [{ "type": "remove_imprint" }],
    "category": "consumable",
    "feedbacktextOccur":"「你使用聖水消除了身上的詭異印記」",
    "canTargetOthers": true,
    "needsCustomLogic": false
```

- [ ] **Step 4: Validate JSON syntax**

Run: `cd "C:\Users\User\Desktop\Betrayal at House on the Hill" && node -e "JSON.parse(require('fs').readFileSync('data/cards/omen-cards.json','utf8')); JSON.parse(require('fs').readFileSync('data/cards/event-cards.json','utf8')); JSON.parse(require('fs').readFileSync('data/cards/item-cards.json','utf8')); console.log('all valid')"`
Expected: `all valid`

- [ ] **Step 5: Write a cross-player integration test for `item_050`**

The design spec calls out this exact scenario: using 聖水 on another player must remove the *target's* imprint, not the user's own. This exercises the existing `canTargetOthers`/`targetForEffects` machinery together with `remove_imprint` for the first time — add a socket-level test proving it end to end. Add to `server/test/socketHandlers.test.js`, near the `item_021`/other `canTargetOthers` tests (search for `canTargetOthers: true` to find a neighboring test's setup pattern for a two-player same-room scenario):

```javascript
test('game:selectAction item use of item_050 (聖水) on another player removes the target\'s imprint, not the user\'s', async () => {
  const content = makeContent({
    cards: {
      events: [], items: [
        { id: 'item_050', name: '聖水', effects: [{ type: 'remove_imprint' }], category: 'consumable', canTargetOthers: true },
      ],
      omens: [
        { id: 'omen_002', name: '古書', category: 'imprint', effects: [{ type: 'stat_change', stat: 'knowledge', delta: 2 }] },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, otherPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_050' }, { id: 'omen_002' });
  getPlayer(gameState, otherPlayerId).inventory.push({ id: 'omen_002' });

  await new Promise((resolve) =>
    currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_050', targetPlayerId: otherPlayerId }, resolve)
  );

  expect(getPlayer(gameState, otherPlayerId).inventory).toEqual([]);
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'omen_002' }]); // item_050 itself is consumed by consumeItemIfApplied, the user's own omen_002 is untouched

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

Check the surrounding existing `canTargetOthers` tests in this file for the exact call shape used to target another player (whether `targetPlayerId` goes at the top level of the payload or elsewhere) and match that convention exactly — this snippet shows the intended assertions, not necessarily the exact payload shape.

- [ ] **Step 6: Fix the 2 stale `turnFlow.test.js` tests that used `omen_008` for its old mechanic**

These two tests (search for `'omen_008', active: true`) exist to verify that `mode:'leave'`/`mode:'pickup'` preserve arbitrary extra fields on an inventory item object — they used `omen_008` only because it used to carry a `toggle_active`-driven `active` flag as a convenient real-world example. After Step 1, `omen_008` no longer has that mechanic, so keep testing the same generic behavior with a made-up id instead of a real card (these functions never look up card content — they only move plain `{id, ...}` objects between arrays):

Before:
```javascript
test('selectAction item mode:leave preserves the item object\'s extra fields (e.g. an activated mask\'s active flag)', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'omen_008', active: true });
  selectAction(gameState, 'p1', 'item', { itemId: 'omen_008', mode: 'leave' });
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  expect(room.droppedItems).toEqual([{ id: 'omen_008', active: true }]);
});

test('selectAction item mode:leave then mode:pickup round-trips the item object without losing extra fields', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'omen_008', active: true });
  selectAction(gameState, 'p1', 'item', { itemId: 'omen_008', mode: 'leave' });
  selectAction(gameState, 'p1', 'item', { itemId: 'omen_008', mode: 'pickup' });
  expect(player.inventory).toEqual([{ id: 'omen_008', active: true }]);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  expect(room.droppedItems).toEqual([]);
```

After (only the literal id/comment change — everything else, including the closing lines you can't see above, stays exactly as-is):
```javascript
test('selectAction item mode:leave preserves the item object\'s extra fields (e.g. a toggled flag)', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'test_flagged_item', active: true });
  selectAction(gameState, 'p1', 'item', { itemId: 'test_flagged_item', mode: 'leave' });
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  expect(room.droppedItems).toEqual([{ id: 'test_flagged_item', active: true }]);
});

test('selectAction item mode:leave then mode:pickup round-trips the item object without losing extra fields', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'test_flagged_item', active: true });
  selectAction(gameState, 'p1', 'item', { itemId: 'test_flagged_item', mode: 'leave' });
  selectAction(gameState, 'p1', 'item', { itemId: 'test_flagged_item', mode: 'pickup' });
  expect(player.inventory).toEqual([{ id: 'test_flagged_item', active: true }]);
  const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
  expect(room.droppedItems).toEqual([]);
```

- [ ] **Step 7: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green. (Confirms `omen_008`'s old `toggle_active` test in `effectResolver.test.js` is unaffected — it constructs its own synthetic `toggle_active` effect object and never reads `data/cards/omen-cards.json`, so it doesn't care what `omen_008`'s real card data now says.)

- [ ] **Step 8: Commit**

```bash
git add data/cards/omen-cards.json data/cards/event-cards.json data/cards/item-cards.json server/test/socketHandlers.test.js server/test/game/turnFlow.test.js
git commit -m "feat: rewrite omen_008 to passive imprint, wire remove_imprint into event_036/item_050"
```

---

### Task 4: Frontend menu — imprint category rules

**Files:**
- Modify: `client/src/gameplay/CharacterPanel.jsx:201` (add `activatedOnUse` to `selectedItem` state), `client/src/gameplay/CharacterPanel.jsx:257-288` (menu branching)

**Interfaces:**
- Consumes: `category: 'imprint'` (already on the 6 imprint omens' data) and `activatedOnUse` (already on `omen_004`, removed from `omen_008` by Task 3).
- No change to `onSelectAction`'s call shape — imprint's 使用 button calls the same existing `handleUseItem`.

- [ ] **Step 1: Add `activatedOnUse` to the `selectedItem` state**

At line 201, replace:
```javascript
                  onClick={() => setSelectedItem({ itemId: item.id, name: findCardName(item.id, cardContent), description: findCardInfo(item.id, cardContent)?.description || '', isMaterial: Boolean(findCardInfo(item.id, cardContent)?.isMaterial), category: findCardCategory(item.id, cardContent), isOmen: isOmenCard(item.id, cardContent) })}
```
with:
```javascript
                  onClick={() => setSelectedItem({ itemId: item.id, name: findCardName(item.id, cardContent), description: findCardInfo(item.id, cardContent)?.description || '', isMaterial: Boolean(findCardInfo(item.id, cardContent)?.isMaterial), category: findCardCategory(item.id, cardContent), isOmen: isOmenCard(item.id, cardContent), activatedOnUse: Boolean(findCardInfo(item.id, cardContent)?.activatedOnUse) })}
```

- [ ] **Step 2: Add the imprint menu branch**

At lines 257-288 (the button row inside `{showGiveTargets ? (...) : (...)}`), replace the entire `<div style={{ display: 'flex', gap: 8 }}>...</div>` block (the `else` branch of `showGiveTargets`):

Before:
```jsx
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedItem.isOmen ? (
                  !selectedItem.isMaterial && (
                    <button onClick={handleUseItem}>使用</button>
                  )
                ) : (
                  <>
                    {selectedItem.category === 'weapon' && (
                      player.wieldedWeaponId === selectedItem.itemId ? (
                        <button onClick={handleUnwieldItem}>取下</button>
                      ) : (
                        <button onClick={handleWieldItem}>手持</button>
                      )
                    )}
                    {selectedItem.category === 'gear' && (
                      player.wornGearIds.includes(selectedItem.itemId) ? (
                        <button onClick={handleUnwearItem}>取下</button>
                      ) : (
                        <button onClick={handleWearItem}>配戴</button>
                      )
                    )}
                    {(selectedItem.category === 'consumable' || selectedItem.category === 'reusable') && !selectedItem.isMaterial && (
                      <button onClick={handleUseItem}>使用</button>
                    )}
                  </>
                )}
                {roommates && roommates.length > 0 && (
                  <button onClick={() => setShowGiveTargets(true)}>給予</button>
                )}
                <button onClick={handleLeaveItem}>遺留</button>
                <button onClick={closeItemMenu}>取消</button>
              </div>
```

After:
```jsx
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedItem.category === 'imprint' ? (
                  <>
                    {selectedItem.activatedOnUse && (
                      <button onClick={handleUseItem}>使用</button>
                    )}
                    <button onClick={closeItemMenu}>查看</button>
                  </>
                ) : selectedItem.isOmen ? (
                  !selectedItem.isMaterial && (
                    <button onClick={handleUseItem}>使用</button>
                  )
                ) : (
                  <>
                    {selectedItem.category === 'weapon' && (
                      player.wieldedWeaponId === selectedItem.itemId ? (
                        <button onClick={handleUnwieldItem}>取下</button>
                      ) : (
                        <button onClick={handleWieldItem}>手持</button>
                      )
                    )}
                    {selectedItem.category === 'gear' && (
                      player.wornGearIds.includes(selectedItem.itemId) ? (
                        <button onClick={handleUnwearItem}>取下</button>
                      ) : (
                        <button onClick={handleWearItem}>配戴</button>
                      )
                    )}
                    {(selectedItem.category === 'consumable' || selectedItem.category === 'reusable') && !selectedItem.isMaterial && (
                      <button onClick={handleUseItem}>使用</button>
                    )}
                  </>
                )}
                {selectedItem.category !== 'imprint' && roommates && roommates.length > 0 && (
                  <button onClick={() => setShowGiveTargets(true)}>給予</button>
                )}
                {selectedItem.category !== 'imprint' && (
                  <button onClick={handleLeaveItem}>遺留</button>
                )}
                {selectedItem.category !== 'imprint' && (
                  <button onClick={closeItemMenu}>取消</button>
                )}
              </div>
```

Note the `category === 'imprint'` check is now the *first* branch, checked before `selectedItem.isOmen` — this mirrors the existing priority rule from the item-equip-mechanism feature (isOmen must be checked before category for non-imprint omens), extended one level: imprint-category omens now take priority over the general isOmen branch, and non-imprint omens fall through to the unchanged isOmen behavior exactly as before.

- [ ] **Step 3: Verify — build**

Run: `cd client && npm run build`
Expected: builds with no errors.

- [ ] **Step 4: Manual browser verification**

Start both servers, open the game, get an imprint-category omen into a player's inventory (any of `omen_002`/`004`/`005`/`006`/`007`/`008` — easiest is to check the `omenDeck` draw order or temporarily push one via a debug path if the game doesn't reach one quickly by normal play). Confirm:
- Clicking a non-`omen_004` imprint shows only a 查看 button; clicking it closes the menu with no error.
- Clicking `omen_004`（獵犬）shows both 使用 and 查看.
- No 給予/遺留/取消 buttons appear for any imprint.
- Non-imprint items and omens are visually and functionally unchanged (weapon/gear/consumable/reusable menus, plain omen 使用 menu, give/leave still present).
- No console errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/gameplay/CharacterPanel.jsx
git commit -m "feat: imprint-category menu (view-only, no give/leave)"
```

---

## Final Verification

- [ ] `cd server && npm test` — full suite green
- [ ] `cd client && npm run build` — clean build
- [ ] Manual playthrough per Task 4 Step 4
- [ ] No console errors during the playthrough
