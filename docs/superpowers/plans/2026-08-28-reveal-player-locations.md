# item_036 揭露玩家位置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Using `item_036`（老鷹木雕）tells the player which room every other player currently occupies, grouped by room, delivered as dynamically-composed text — the first card in this codebase whose feedback text is computed server-side per use rather than a fixed string per card.

**Architecture:** A new `reveal_player_locations` effect type in `server/src/game/effectResolver.js` gathers every other player's raw `{playerId, floor, x, y}` and passes it up through `resolveEffects`'s existing "extra field" propagation (the same pattern already used for `drawnCards`/`diceCheckResult`/`enteredNewRoom`). `server/src/socketHandlers.js` — which already has the room-name catalog (`content`) that `effectResolver.js` doesn't — resolves player/room names and composes the final grouped-by-room text, attaching it as an optional `revealText` field on the existing `game:itemUseResolved` socket event. The client (`client/src/DebugGameScreen.jsx`) prefers this dynamic text over the card's static `feedbacktextOccur` lookup when present, with zero change to any other item's behavior (the field is simply absent for every other card).

**Tech Stack:** Node.js/Express/Socket.IO (server) + React (client, one small change this time). Jest (server tests only — no client test suite; client changes are verified via build + manual browser check).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-28-reveal-player-locations-design.md` — read it if anything below is ambiguous, it governs.
- Scope: ONLY "other players" this time. "怪物/惡人" (monsters/villains) have no position data anywhere in the game state (M3 not built) — `item_036`'s `needsCustomLogic` stays `true`, reflecting that part is still unimplemented.
- `reveal_player_locations` gathers raw coordinates only (`{playerId, floor, x, y}`) — it must NOT look up room names or player display names itself. `effectResolver.js` has no room-name catalog; that resolution belongs in `socketHandlers.js`, which already has `content` in scope.
- Text format: group by room, join player names within a room with `、`, join room-groups with `；` — e.g. `Alice、Bob 在 廚房 內；Carol 在 圖書室 內`. When the acting player has no other players to reveal (solo), the text is the fixed string `目前沒有發現其他玩家的蹤跡`.
- The new `revealText` field on `game:itemUseResolved` is OPTIONAL — every other item's emitted payload must remain exactly `{playerId, itemId}`, unchanged. Only attach `revealText` when the effect chain actually produced a `revealedLocations` array.
- Client: `resolveSimplePopupBody`'s `itemUseResolved`/`eventNoCheck` branch must prefer a per-entry dynamic override text when present, falling back to the existing `card.feedbacktextOccur` lookup exactly as before when it's absent — zero behavior change for any card other than `item_036`.
- `item_036`'s card data: remove the placeholder `feedbacktextOccur` (`"xxx在xxx間內；ooo在ooo房間內"`) entirely — it becomes genuinely dead data once `revealText` always supplies the text for this card.
- Server tests: `cd server && npm test` (Jest) must be full-suite green. Client: `cd client && npm run build` must succeed; manual browser verification is required for this plan since it touches `client/`.

---

### Task 1: `reveal_player_locations` effect type + `revealText` composition in `socketHandlers.js`

**Files:**
- Modify: `server/src/game/effectResolver.js` (new handler, `resolveEffects` extra-field propagation, HANDLERS registration)
- Modify: `server/src/socketHandlers.js` (new `buildRevealText` helper, wiring into both `game:itemUseResolved` emit sites)
- Test: `server/test/game/effectResolver.test.js`, `server/test/socketHandlers.test.js`

**Interfaces:**
- Produces: effect `{ type: "reveal_player_locations" }` (no parameters) — on resolution, `resolveEffects`'s return value gains an optional `revealedLocations: [{ playerId, floor, x, y }, ...]` array (present whenever this effect type appears in the chain, even if empty). `buildRevealText(gameState, content, revealedLocations)` in `socketHandlers.js` — pure function, returns a composed string or `null` if `revealedLocations` isn't an array.
- Consumes: nothing from Task 2 (Task 2 depends on this task, not the reverse — do this task first).

- [ ] **Step 1: Write the failing `effectResolver` tests**

Add to `server/test/game/effectResolver.test.js`, at the very end of the file (after the existing `resolveEffects fall_to_basement drops the player into a new basement room at the same (x,y)` test):

```javascript

test('resolveEffects reveal_player_locations gathers every other player\'s floor/x/y, excluding the acting player', () => {
  const gameState = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  const p2 = gameState.players.get('p2');
  p2.floor = 'ground';
  p2.x = 5;
  p2.y = 5;
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'reveal_player_locations' },
  ]);
  expect(result.revealedLocations).toEqual([{ playerId: 'p2', floor: 'ground', x: 5, y: 5 }]);
});

test('resolveEffects reveal_player_locations returns an empty array when the acting player is alone', () => {
  const gameState = makeGameStateWithPlayer();
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'reveal_player_locations' },
  ]);
  expect(result.revealedLocations).toEqual([]);
});
```

Check the top of `server/test/game/effectResolver.test.js` for the `addPlayer`/`makeStats` imports — both are already used by this file's own `makeGameStateWithPlayer` helper and the `fall_to_basement` test, reuse them, don't add new imports.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest effectResolver -t "reveal_player_locations"`
Expected: FAIL (`reveal_player_locations` is not a registered effect type yet — `UNSUPPORTED_EFFECT_TYPE`).

- [ ] **Step 3: Implement `handleRevealPlayerLocations`**

In `server/src/game/effectResolver.js`, add this function right after `handleFallToBasement` (search for `function handleFallToBasement`; insert right after its closing `}`):

```javascript
function handleRevealPlayerLocations(gameState, playerId) {
  requirePlayer(gameState, playerId);
  const revealedLocations = [];
  for (const other of gameState.players.values()) {
    if (other.playerId === playerId) continue;
    revealedLocations.push({ playerId: other.playerId, floor: other.floor, x: other.x, y: other.y });
  }
  return { pending: false, revealedLocations };
}
```

- [ ] **Step 4: Thread `revealedLocations` through `resolveEffects`**

In `server/src/game/effectResolver.js`, find `function resolveEffects` and update it:

Before:
```javascript
function resolveEffects(gameState, promptState, playerId, effects, context = {}) {
  if (!Array.isArray(effects)) {
    throw new Error('INVALID_EFFECTS_LIST');
  }
  requirePlayer(gameState, playerId);
  let appliedCount = 0;
  let drawnCards = [];
  let diceCheckResult = null;
  let enteredNewRoom = null;
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
    if (result && Array.isArray(result.drawnCards)) {
      drawnCards = drawnCards.concat(result.drawnCards);
    }
    if (result && result.diceCheckResult) {
      diceCheckResult = result.diceCheckResult;
    }
    if (result && result.enteredNewRoom !== undefined) {
      enteredNewRoom = result.enteredNewRoom;
    }
  }
  const output = { pending: false, appliedCount };
  if (drawnCards.length > 0) {
    output.drawnCards = drawnCards;
  }
  if (diceCheckResult) {
    output.diceCheckResult = diceCheckResult;
  }
  if (enteredNewRoom !== null) {
    output.enteredNewRoom = enteredNewRoom;
  }
  return output;
}
```
After:
```javascript
function resolveEffects(gameState, promptState, playerId, effects, context = {}) {
  if (!Array.isArray(effects)) {
    throw new Error('INVALID_EFFECTS_LIST');
  }
  requirePlayer(gameState, playerId);
  let appliedCount = 0;
  let drawnCards = [];
  let diceCheckResult = null;
  let enteredNewRoom = null;
  let revealedLocations = null;
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
    if (result && Array.isArray(result.drawnCards)) {
      drawnCards = drawnCards.concat(result.drawnCards);
    }
    if (result && result.diceCheckResult) {
      diceCheckResult = result.diceCheckResult;
    }
    if (result && result.enteredNewRoom !== undefined) {
      enteredNewRoom = result.enteredNewRoom;
    }
    if (result && Array.isArray(result.revealedLocations)) {
      revealedLocations = result.revealedLocations;
    }
  }
  const output = { pending: false, appliedCount };
  if (drawnCards.length > 0) {
    output.drawnCards = drawnCards;
  }
  if (diceCheckResult) {
    output.diceCheckResult = diceCheckResult;
  }
  if (enteredNewRoom !== null) {
    output.enteredNewRoom = enteredNewRoom;
  }
  if (revealedLocations !== null) {
    output.revealedLocations = revealedLocations;
  }
  return output;
}
```

(Only the `revealedLocations` lines are new — every other line is unchanged, shown in full so the diff context is unambiguous.)

- [ ] **Step 5: Register the handler**

In the `HANDLERS` map (search for `const HANDLERS = Object.assign`), add this line right after the `fall_to_basement:` line:

```javascript
  reveal_player_locations: (gameState, promptState, playerId) => handleRevealPlayerLocations(gameState, playerId),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && npx jest effectResolver -t "reveal_player_locations"`
Expected: PASS, both new tests.

- [ ] **Step 7: Write the failing `socketHandlers` tests**

Add to `server/test/socketHandlers.test.js`, near the other `game:itemUseResolved` tests (search for `test('game:selectAction item use with no dice_check broadcasts game:itemUseResolved`):

```javascript
const REVEAL_ITEM_ROOMS = [{ id: 'room_kitchen', name: '廚房', doors: 4, floor: 'ground' }];
const REVEAL_ITEM_CARD = { id: 'item_036', name: '老鷹木雕', effects: [{ type: 'reveal_player_locations' }], category: 'reusable', canTargetOthers: false };

test('game:selectAction item_036 reveals another player\'s room via revealText on game:itemUseResolved', async () => {
  const content = makeContent({
    rooms: REVEAL_ITEM_ROOMS,
    cards: { events: [], items: [REVEAL_ITEM_CARD], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, otherPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_036' });
  const otherPlayer = getPlayer(gameState, otherPlayerId);
  otherPlayer.floor = 'ground';
  otherPlayer.x = 99;
  otherPlayer.y = 99;
  gameState.board.ground.set(coordKey(99, 99), { roomId: 'room_kitchen', x: 99, y: 99, doorSides: ['north'], droppedItems: [], item: null });

  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_036' }, resolve));
  const data = await itemUseResolvedPromise;

  expect(data.revealText).toContain('廚房');
  expect(data.revealText).toContain(otherPlayer.name);

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_036 groups two other players in the same room onto one line', async () => {
  const content = makeContent({
    rooms: REVEAL_ITEM_ROOMS,
    cards: { events: [], items: [REVEAL_ITEM_CARD], omens: [] },
  });
  // setUpStartedGameWithContent only sets up 2 real socket clients/players (clientA/clientB) --
  // for a THIRD player, insert a synthetic player object directly into gameState.players (a Map)
  // after setup, rather than a third real socket client. Only the fields getPlayer/buildRevealText
  // actually read are required: playerId, name, floor, x, y.
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, otherPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_036' });
  const otherPlayer = getPlayer(gameState, otherPlayerId);
  otherPlayer.floor = 'ground';
  otherPlayer.x = 99;
  otherPlayer.y = 99;
  gameState.players.set('synthetic_p3', { playerId: 'synthetic_p3', name: 'Carol-synthetic', floor: 'ground', x: 99, y: 99, inventory: [] });
  gameState.board.ground.set(coordKey(99, 99), { roomId: 'room_kitchen', x: 99, y: 99, doorSides: ['north'], droppedItems: [], item: null });

  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_036' }, resolve));
  const data = await itemUseResolvedPromise;

  // Both other players share room_kitchen -> exactly one room-group, both names on it
  expect(data.revealText).toContain('廚房');
  expect(data.revealText).toContain(otherPlayer.name);
  expect(data.revealText).toContain('Carol-synthetic');
  expect(data.revealText.split('；').length).toBe(1); // one room-group, not two separate lines
  expect(data.revealText).toMatch(/、/); // the two names are joined with 、 within that one group

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_036 used while alone (no other players) returns the fixed fallback text', async () => {
  const content = makeContent({
    cards: { events: [], items: [REVEAL_ITEM_CARD], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, otherPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_036' });
  gameState.players.delete(otherPlayerId); // simulate being alone -- only the acting player remains

  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_036' }, resolve));
  const data = await itemUseResolvedPromise;

  expect(data.revealText).toBe('目前沒有發現其他玩家的蹤跡');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction a normal item without reveal_player_locations still emits game:itemUseResolved with no revealText field', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [{ id: 'item_001', name: '測試道具', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }], category: 'consumable' }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_001' });

  const itemUseResolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_001' }, resolve));
  const data = await itemUseResolvedPromise;

  expect(data).toEqual({ playerId: currentPlayerId, itemId: 'item_001' });
  expect(data.revealText).toBeUndefined();

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

Check the top of `server/test/socketHandlers.test.js` for the `getPlayer`/`coordKey`/`getGameState` imports — they're already imported (used pervasively throughout this file), reuse them, don't add new import lines.

- [ ] **Step 8: Implement `buildRevealText` and wire it into `socketHandlers.js`**

Add this function in `server/src/socketHandlers.js` near `findRoomDefinition` (search for `function findRoomDefinition`; insert right after its closing `}`):

```javascript
function buildRevealText(gameState, content, revealedLocations) {
  if (!Array.isArray(revealedLocations)) {
    return null;
  }
  if (revealedLocations.length === 0) {
    return '目前沒有發現其他玩家的蹤跡';
  }
  const namesByRoom = new Map();
  for (const loc of revealedLocations) {
    const otherPlayer = getPlayer(gameState, loc.playerId);
    const room = gameState.board[loc.floor].get(coordKey(loc.x, loc.y));
    const roomDefinition = findRoomDefinition(content, room.roomId);
    const roomName = (roomDefinition && roomDefinition.name) || '未知房間';
    if (!namesByRoom.has(roomName)) {
      namesByRoom.set(roomName, []);
    }
    namesByRoom.get(roomName).push(otherPlayer.name);
  }
  return [...namesByRoom.entries()].map(([roomName, names]) => `${names.join('、')} 在 ${roomName} 內`).join('；');
}
```

Then find the `game:itemUseResolved` emission block (search for `io.to(roomCode).emit('game:itemUseResolved', { playerId, itemId });`):

Before:
```javascript
            if (actionType === 'item' && (!mode || mode === 'use') && !effectResult.pending && !effectResult.diceCheckResult) {
              io.to(roomCode).emit('game:itemUseResolved', { playerId, itemId });
              if (targetForEffects !== playerId) {
                io.to(roomCode).emit('game:itemUseResolved', { playerId: targetForEffects, itemId });
              }
            }
```
After:
```javascript
            if (actionType === 'item' && (!mode || mode === 'use') && !effectResult.pending && !effectResult.diceCheckResult) {
              const revealText = buildRevealText(gameState, content, effectResult.revealedLocations);
              const itemUsePayload = { playerId, itemId };
              if (revealText) {
                itemUsePayload.revealText = revealText;
              }
              io.to(roomCode).emit('game:itemUseResolved', itemUsePayload);
              if (targetForEffects !== playerId) {
                const targetPayload = { playerId: targetForEffects, itemId };
                if (revealText) {
                  targetPayload.revealText = revealText;
                }
                io.to(roomCode).emit('game:itemUseResolved', targetPayload);
              }
            }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd server && npx jest socketHandlers -t "item_036|revealText"`
Expected: PASS, all 4 new tests.

- [ ] **Step 10: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green (confirms every other item's `game:itemUseResolved` payload is unchanged — `revealText` truly absent when `revealedLocations` is absent).

- [ ] **Step 11: Commit**

```bash
git add server/src/game/effectResolver.js server/src/socketHandlers.js server/test/game/effectResolver.test.js server/test/socketHandlers.test.js
git commit -m "feat: add reveal_player_locations effect type and revealText composition"
```

---

### Task 2: Client dynamic-text support + `item_036` data wiring

**Files:**
- Modify: `client/src/DebugGameScreen.jsx` (`onItemUseResolved` handler, `resolveSimplePopupBody`)
- Modify: `data/cards/item-cards.json` (`item_036`)

**Interfaces:**
- Consumes: the `revealText` field on `game:itemUseResolved` from Task 1.

- [ ] **Step 1: Thread `revealText` into the popup queue entry**

In `client/src/DebugGameScreen.jsx`, find `function onItemUseResolved(data)` (search for `function onItemUseResolved`):

Before:
```javascript
    function onItemUseResolved(data) {
      if (data.playerId !== playerId) return;
      setPendingCheckQueue((prev) => [
        ...prev,
        { noCheck: true, kind: 'itemUseResolved', sourceId: data.itemId, queueId: nextCheckQueueId.current++ },
      ]);
    }
```
After:
```javascript
    function onItemUseResolved(data) {
      if (data.playerId !== playerId) return;
      setPendingCheckQueue((prev) => [
        ...prev,
        { noCheck: true, kind: 'itemUseResolved', sourceId: data.itemId, overrideText: data.revealText, queueId: nextCheckQueueId.current++ },
      ]);
    }
```

- [ ] **Step 2: Prefer the override text in `resolveSimplePopupBody`**

Find `function resolveSimplePopupBody` (search for `function resolveSimplePopupBody`):

Before:
```javascript
  if (entry.kind === 'eventNoCheck' || entry.kind === 'itemUseResolved') {
    return (card && card.feedbacktextOccur) || '待補充';
  }
```
After:
```javascript
  if (entry.kind === 'eventNoCheck' || entry.kind === 'itemUseResolved') {
    return entry.overrideText || (card && card.feedbacktextOccur) || '待補充';
  }
```

- [ ] **Step 3: Verify — build**

Run: `cd client && npm run build`
Expected: builds with no errors.

- [ ] **Step 4: Re-read the current `item_036` block and confirm it matches**

Run `grep -n '"id": "item_036"' -A 10 data/cards/item-cards.json` and confirm the current content matches the "Before" block below exactly — this file is actively edited by the developer between sessions. If it doesn't match, stop and report the actual current content rather than guessing.

- [ ] **Step 5: Edit `item_036`**

In `data/cards/item-cards.json`:

Before:
```json
    "id": "item_036",
    "name": "老鷹木雕",
    "description": "古樸風格的老鷹木雕，雙眼是兩顆深邃的黑色寶石，寄宿著老鷹的靈魂供你驅使",
    "text": "使用後可以得知其他玩家/怪物/惡人位在哪個房間內。",
    "feedbacktextOccur": "xxx在xxx間內；ooo在ooo房間內",
    "effects": [],
    "category": "reusable",
    "canTargetOthers": false,
    "needsCustomLogic": false
  },
```
After:
```json
    "id": "item_036",
    "name": "老鷹木雕",
    "description": "古樸風格的老鷹木雕，雙眼是兩顆深邃的黑色寶石，寄宿著老鷹的靈魂供你驅使",
    "text": "使用後可以得知其他玩家位在哪個房間內。（怪物/惡人位置待後續版本補上）",
    "effects": [{ "type": "reveal_player_locations" }],
    "category": "reusable",
    "canTargetOthers": false,
    "needsCustomLogic": true
  },
```

- [ ] **Step 6: Validate JSON syntax**

Run: `cd "C:\Users\User\Desktop\Betrayal at House on the Hill" && node -e "JSON.parse(require('fs').readFileSync('data/cards/item-cards.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 7: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green.

- [ ] **Step 8: Manual browser verification**

Start both servers (or use the project's dev launch config), get two players into the same game, give one player `item_036` (via a debug path or by placing it reachable in the item deck), have them use it while the other player stands in a different room. Confirm:
- The using player sees a popup with dynamically composed text naming the other player and their room (not "待補充", not the literal old placeholder text)
- No console/server errors
- Using a normal item (one with a static `feedbacktextOccur`) still shows its own fixed text correctly — confirms the fallback path is unbroken

- [ ] **Step 9: Commit**

```bash
git add client/src/DebugGameScreen.jsx data/cards/item-cards.json
git commit -m "feat: wire item_036 (老鷹木雕) to reveal_player_locations, client renders dynamic revealText"
```

---

## Final Verification

- [ ] `cd server && npm test` — full suite green
- [ ] `cd client && npm run build` — clean build
- [ ] Manual playthrough per Task 2 Step 8
- [ ] No console errors during the playthrough
