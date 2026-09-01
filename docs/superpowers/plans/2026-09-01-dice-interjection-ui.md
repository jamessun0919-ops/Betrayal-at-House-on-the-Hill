# Dice Interjection UI Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the "dice interjection" (擲骰道具介入) prompt: scope its popup to the acting player only, show each item's player-facing `diceInterjectionText`, and make the "override" mechanic (item_005 天使羽毛) auto-substitute the guaranteed-max roll instead of asking the player to type a number.

**Architecture:** Two independent layers, each its own task. Task 1 changes server-side roll-computation semantics for `diceInterjection.override` items (no more client-supplied `overrideValue`) and updates every test that exercises that path. Task 2 is a client-only UI pass: popup scoping (mirrors the existing `roomIntro`/`itemUseResolved` filter pattern already in this file) and swapping the bare item-name + number-input rendering for the new `diceInterjectionText` field, reading it from the same unfiltered `cardContent` the client already holds (no new socket payload needed).

**Tech Stack:** Node.js/Express + Socket.IO server (`server/`), React client (`client/`), Jest for server tests. No client-side test suite exists in this project — client changes are verified manually in the browser (established project pattern, see Handover.md's Debug Notes on this).

## Global Constraints

- `diceInterjection.override:true` currently only appears on `item_005`（天使羽毛）in `data/cards/item-cards.json`. This plan changes what `override:true` *means* project-wide (auto-max, no player input), not just this one card's data.
- Default die faces are `DIE_FACES = [0, 0, 1, 1, 2, 2]` (max face value 2), defined in `server/src/game/effectPipeline.js`. A card's own `diceInterjection.customFaces` array (e.g. item_049's `[1,1,1,2,2,2]`) overrides the faces used for that roll when present.
- This is an internal Socket.IO protocol between this project's own client and server — no external consumers, no backwards-compatibility shim needed. Remove dead fields/params cleanly rather than keeping them "just in case."
- Out of scope for this plan (do not touch): the countdown-timer UI for the 20s roll-choice deadline (tracked in `Handover.md` item 14, bundled with the turn-structure redesign discussion), and item_006's "used once per turn" option graying/hiding in the UI (no request for this yet).

---

### Task 1: Server — override auto-substitutes the max roll

**Files:**
- Modify: `server/src/game/effectPipeline.js` (export `DIE_FACES`)
- Modify: `server/src/game/diceInterjection.js` (`resolveFinalRoll`)
- Modify: `server/src/game/effectResolver.js:377-400` (`computeInterjectedRoll`'s override branch)
- Modify: `server/src/socketHandlers.js:514-563` (`game:diceChoiceRespond` handler)
- Test: `server/test/game/diceInterjection.test.js`
- Test: `server/test/game/effectResolver.test.js` (one existing test rewritten)
- Test: `server/test/socketHandlers.test.js` (two existing tests rewritten)

**Interfaces:**
- Consumes: nothing from other tasks (this task is self-contained).
- Produces: `resolveFinalRoll(baseCount, chosenDiceInterjection, rng)` — **signature changed**, dropped the `overrideValue` parameter (was the 3rd of 4 params, now there are only 3). Every caller in this codebase is updated within this task. `game:diceChoiceRespond` payload no longer includes/reads `overrideValue`. Task 2 (client) must not send an `overrideValue` field in the `game:diceChoiceRespond` emit and must not render a number-input for override items — it can simply omit the field entirely.

- [ ] **Step 1: Export `DIE_FACES` from `effectPipeline.js`**

Current file (`server/src/game/effectPipeline.js`) ends with:

```js
module.exports = { rollDice, applyModifiers, evaluateTiers };
```

Change to:

```js
module.exports = { rollDice, applyModifiers, evaluateTiers, DIE_FACES };
```

That's the only change to this file — `DIE_FACES` itself (line 1) is already declared as a top-level `const`, it just wasn't exported.

- [ ] **Step 2: Run the existing effectPipeline tests to confirm nothing broke**

Run: `cd server && npx jest test/game/effectPipeline.test.js`
Expected: PASS (this step only adds an export, no behavior changed yet)

- [ ] **Step 3: Rewrite `resolveFinalRoll` in `diceInterjection.js` to auto-max on override**

Current full file (`server/src/game/diceInterjection.js`):

```js
const { rollDice } = require('./effectPipeline');

function findInterjectionOptions(player, itemCatalog, sourceDeckType) {
  if (!Array.isArray(itemCatalog)) {
    throw new Error('INVALID_ITEM_CATALOG');
  }
  const used = player.diceInterjectionUsedThisTurn || [];
  const options = [];
  for (const invItem of player.inventory || []) {
    const content = itemCatalog.find((c) => c.id === invItem.id);
    if (!content || !content.diceInterjection) continue;
    if (content.category === 'gear' && !player.wornGearIds.includes(invItem.id)) continue;
    const di = content.diceInterjection;
    if (di.scope === 'eventTriggered' && sourceDeckType !== 'event') continue;
    if (di.scope === 'diceCheckOnly' && sourceDeckType === null) continue;
    if (!di.consumesItem && used.includes(invItem.id)) continue;
    options.push({ itemId: invItem.id, name: content.name, diceInterjection: di });
  }
  return options;
}

function resolveFinalRoll(baseCount, chosenDiceInterjection, overrideValue, rng) {
  if (chosenDiceInterjection && chosenDiceInterjection.override) {
    if (!Number.isInteger(overrideValue) || overrideValue < 0 || overrideValue > 8) {
      throw new Error('INVALID_OVERRIDE_VALUE');
    }
    return overrideValue;
  }
  const boostedCount = baseCount + (chosenDiceInterjection ? (chosenDiceInterjection.bonusDice || 0) : 0);
  const clampedCount = Math.max(1, Math.min(8, boostedCount));
  return rollDice(clampedCount, rng);
}

module.exports = { findInterjectionOptions, resolveFinalRoll };
```

Replace the top `require` and the `resolveFinalRoll` function with:

```js
const { rollDice, DIE_FACES } = require('./effectPipeline');
```

```js
function resolveFinalRoll(baseCount, chosenDiceInterjection, rng) {
  if (chosenDiceInterjection && chosenDiceInterjection.override) {
    const faces = chosenDiceInterjection.customFaces || DIE_FACES;
    return baseCount * Math.max(...faces);
  }
  const boostedCount = baseCount + (chosenDiceInterjection ? (chosenDiceInterjection.bonusDice || 0) : 0);
  const clampedCount = Math.max(1, Math.min(8, boostedCount));
  return rollDice(clampedCount, rng);
}
```

`findInterjectionOptions` and `module.exports` at the bottom are unchanged.

- [ ] **Step 4: Rewrite the affected tests in `server/test/game/diceInterjection.test.js`**

The existing calls to `resolveFinalRoll` pass an `overrideValue` argument that no longer exists in the signature. Lines 106-131 of the current file are:

```js
test('resolveFinalRoll with no chosen interjection rolls baseCount dice, clamped to [1,8]', () => {
  const rng = () => 0.99; // every die -> face 2
  expect(resolveFinalRoll(3, null, undefined, rng)).toBe(6); // 3 dice * 2
  expect(resolveFinalRoll(0, null, undefined, rng)).toBe(2); // clamped up to 1 die
  expect(resolveFinalRoll(10, null, undefined, rng)).toBe(16); // clamped down to 8 dice
});

test('resolveFinalRoll with a bonusDice interjection adds to the dice count before rolling', () => {
  const rng = () => 0.99; // every die -> face 2
  const di = { bonusDice: 2 };
  expect(resolveFinalRoll(3, di, undefined, rng)).toBe(10); // (3+2) dice * 2
});

test('resolveFinalRoll with an override interjection returns the override value directly, ignoring rng', () => {
  const rng = () => { throw new Error('should not be called'); };
  const di = { override: true };
  expect(resolveFinalRoll(3, di, 5, rng)).toBe(5);
});

test('resolveFinalRoll throws INVALID_OVERRIDE_VALUE for an out-of-range or non-integer override value', () => {
  const di = { override: true };
  expect(() => resolveFinalRoll(3, di, 9, () => 0)).toThrow('INVALID_OVERRIDE_VALUE');
  expect(() => resolveFinalRoll(3, di, -1, () => 0)).toThrow('INVALID_OVERRIDE_VALUE');
  expect(() => resolveFinalRoll(3, di, 2.5, () => 0)).toThrow('INVALID_OVERRIDE_VALUE');
  expect(() => resolveFinalRoll(3, di, undefined, () => 0)).toThrow('INVALID_OVERRIDE_VALUE');
});
```

Replace this whole block (all 4 tests) with:

```js
test('resolveFinalRoll with no chosen interjection rolls baseCount dice, clamped to [1,8]', () => {
  const rng = () => 0.99; // every die -> face 2
  expect(resolveFinalRoll(3, null, rng)).toBe(6); // 3 dice * 2
  expect(resolveFinalRoll(0, null, rng)).toBe(2); // clamped up to 1 die
  expect(resolveFinalRoll(10, null, rng)).toBe(16); // clamped down to 8 dice
});

test('resolveFinalRoll with a bonusDice interjection adds to the dice count before rolling', () => {
  const rng = () => 0.99; // every die -> face 2
  const di = { bonusDice: 2 };
  expect(resolveFinalRoll(3, di, rng)).toBe(10); // (3+2) dice * 2
});

test('resolveFinalRoll with an override interjection auto-substitutes the max possible roll for the default dice faces, ignoring rng', () => {
  const rng = () => { throw new Error('should not be called'); };
  const di = { override: true };
  expect(resolveFinalRoll(3, di, rng)).toBe(6); // 3 dice * default max face (2)
});

test('resolveFinalRoll with an override interjection uses the item\'s own customFaces max, if present', () => {
  const rng = () => { throw new Error('should not be called'); };
  const di = { override: true, customFaces: [3, 3, 4, 4, 5, 5] };
  expect(resolveFinalRoll(2, di, rng)).toBe(10); // 2 dice * custom max face (5)
});
```

(The `INVALID_OVERRIDE_VALUE` test is deleted outright — that validation no longer exists, there's nothing left to assert.)

- [ ] **Step 5: Run the diceInterjection tests to verify Step 4's rewrite passes**

Run: `cd server && npx jest test/game/diceInterjection.test.js`
Expected: PASS, 15 tests (11 unchanged `findInterjectionOptions` tests + 4 rewritten `resolveFinalRoll` tests)

- [ ] **Step 6: Update `computeInterjectedRoll`'s call site in `effectResolver.js`**

Current code at `server/src/game/effectResolver.js:377-400`:

```js
function computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice, context) {
  if (!interjectionChoice) {
    const adjustedCount = Math.max(1, Math.min(8, applyModifiers(baseCount, modifiers, 'onBeforeRoll', context)));
    const rolled = rollDice(adjustedCount, context.rng);
    return applyModifiers(rolled, modifiers, 'onAfterRoll', context);
  }
  const player = requirePlayer(gameState, playerId);
  const { itemId, diceInterjection, overrideValue } = interjectionChoice;
  if (Array.isArray(diceInterjection.cost) && diceInterjection.cost.length > 0) {
    resolveEffects(gameState, promptState, playerId, diceInterjection.cost, context);
  }
  if (diceInterjection.consumesItem) {
    removeItem(player, itemId);
  } else {
    player.diceInterjectionUsedThisTurn = [...(player.diceInterjectionUsedThisTurn || []), itemId];
  }
  if (diceInterjection.override) {
    return resolveFinalRoll(baseCount, diceInterjection, overrideValue, context.rng);
  }
  const boostedCount = baseCount + (diceInterjection.bonusDice || 0);
  const adjustedCount = Math.max(1, Math.min(8, applyModifiers(boostedCount, modifiers, 'onBeforeRoll', context)));
  const rolled = rollDice(adjustedCount, context.rng, diceInterjection.customFaces);
  return applyModifiers(rolled, modifiers, 'onAfterRoll', context);
}
```

Change two lines: the destructure drops `overrideValue`, and the override call drops the argument:

```js
  const player = requirePlayer(gameState, playerId);
  const { itemId, diceInterjection } = interjectionChoice;
```

```js
  if (diceInterjection.override) {
    return resolveFinalRoll(baseCount, diceInterjection, context.rng);
  }
```

Everything else in the function (imports at the top of the file, `module.exports` at the bottom) is unchanged — `resolveFinalRoll` is already imported via the existing `const { findInterjectionOptions, resolveFinalRoll } = require('./diceInterjection');` at the top of `effectResolver.js`.

- [ ] **Step 7: Rewrite the one affected test in `server/test/game/effectResolver.test.js`**

Current test at line 1109-1130:

```js
test('resolveEffects dice_check resumed with a chosen override item returns the override value directly and removes the consumable item', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_005' });
  const diceInterjection = { scope: 'any', override: true, consumesItem: true };
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 2,
      tiers: [
        { min: 5, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] },
        { min: 0, max: 4, effects: [] },
      ],
    },
  ], {
    rng: () => { throw new Error('should not roll when overriding'); },
    interjectionChoice: { itemId: 'item_005', diceInterjection, overrideValue: 6 },
  });
  expect(result.pending).toBe(false);
  expect(player.stats.might.currentIndex).toBe(3); // override 6 -> matched the 5-8 tier
  expect(player.inventory).toEqual([]); // consumable item removed
});
```

Replace with (note `diceCount` changed from 2 to 3 so the auto-max value of `3 * 2 = 6` lands in the same 5-8 "pass" tier the original test demonstrated — with the old `diceCount: 2` the auto-max would be `2 * 2 = 4`, which falls in the 0-4 tier and would defeat the point of the test):

```js
test('resolveEffects dice_check resumed with a chosen override item auto-substitutes the max possible roll and removes the consumable item', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_005' });
  const diceInterjection = { scope: 'any', override: true, consumesItem: true };
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 3,
      tiers: [
        { min: 5, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] },
        { min: 0, max: 4, effects: [] },
      ],
    },
  ], {
    rng: () => { throw new Error('should not roll when overriding'); },
    interjectionChoice: { itemId: 'item_005', diceInterjection },
  });
  expect(result.pending).toBe(false);
  expect(player.stats.might.currentIndex).toBe(3); // auto max: 3 dice * face max 2 = 6 -> matched the 5-8 tier
  expect(player.inventory).toEqual([]); // consumable item removed
});
```

Leave every other test in this file untouched, including the "does not leak interjectionChoice into a nested effect" test (line ~1132) and the `computeInterjectedRoll` tests for item_006/item_049 (line ~1300-1358) — none of them assert a specific override-derived value, they still pass unchanged (their stray `overrideValue: undefined`/`overrideValue: 5` object keys are now simply ignored, harmlessly, by the destructure in Step 6).

- [ ] **Step 8: Run effectResolver tests to verify Step 7's rewrite passes**

Run: `cd server && npx jest test/game/effectResolver.test.js`
Expected: PASS (all tests, including the ~8 unrelated ones touching `overrideValue: undefined`/`overrideValue: 5` literals that were left alone)

- [ ] **Step 9: Remove the `overrideValue` validation in `socketHandlers.js`'s `game:diceChoiceRespond` handler**

Current code at `server/src/socketHandlers.js:514-563`:

```js
    socket.on('game:diceChoiceRespond', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const gameState = getGameState(gameManager, roomCode);
        if (!gameState) {
          return ack({ error: 'GAME_NOT_STARTED' });
        }
        const resolverEntry = getResolver(effectResolverManager, roomCode);
        if (!resolverEntry || !resolverEntry.pendingRollChoice) {
          return ack({ error: 'NO_ACTIVE_ROLL_CHOICE' });
        }
        const { promptId, optionId, overrideValue } = payload || {};
        const { playerId: choicePlayerId, options, resumeKind, resumeContext } = resolverEntry.pendingRollChoice;

        // Validate BEFORE consuming the prompt (respondToPrompt below) so a
        // malformed response doesn't destroy the item or drop the pending
        // choice -- the player can simply retry with a valid overrideValue.
        if (optionId !== '__skip__') {
          const candidateOption = options.find((o) => o.itemId === optionId);
          if (candidateOption && candidateOption.diceInterjection.override) {
            if (!Number.isInteger(overrideValue) || overrideValue < 0 || overrideValue > 8) {
              return ack({ error: 'INVALID_OVERRIDE_VALUE' });
            }
          }
        }

        const result = respondToPrompt(resolverEntry.promptState, { promptId, playerId, optionId });
        clearRollChoiceTimeout(roomCode, rollChoiceTimeouts);
        resolverEntry.pendingRollChoice = null;
        io.to(roomCode).emit('game:promptResolved', result);

        const chosenOption = optionId === '__skip__' ? null : options.find((o) => o.itemId === optionId);
        const interjectionChoice = chosenOption
          ? { itemId: chosenOption.itemId, diceInterjection: chosenOption.diceInterjection, overrideValue }
          : null;

        const outcome = resumeRollChoice(io, effectResolverManager, gameState, roomCode, choicePlayerId, resumeKind, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, socket);
        if (outcome.drawnCards) {
          socket.emit('game:cardsDrawn', { cards: outcome.drawnCards });
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
        ack({});
      } catch (err) {
        console.error('game:diceChoiceRespond error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
```

Replace with (three changes: drop `overrideValue` from the payload destructure, delete the whole validation block, drop `overrideValue` from the `interjectionChoice` object literal):

```js
    socket.on('game:diceChoiceRespond', (payload, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          return ack({ error: 'NOT_IN_ROOM' });
        }
        const gameState = getGameState(gameManager, roomCode);
        if (!gameState) {
          return ack({ error: 'GAME_NOT_STARTED' });
        }
        const resolverEntry = getResolver(effectResolverManager, roomCode);
        if (!resolverEntry || !resolverEntry.pendingRollChoice) {
          return ack({ error: 'NO_ACTIVE_ROLL_CHOICE' });
        }
        const { promptId, optionId } = payload || {};
        const { playerId: choicePlayerId, options, resumeKind, resumeContext } = resolverEntry.pendingRollChoice;

        const result = respondToPrompt(resolverEntry.promptState, { promptId, playerId, optionId });
        clearRollChoiceTimeout(roomCode, rollChoiceTimeouts);
        resolverEntry.pendingRollChoice = null;
        io.to(roomCode).emit('game:promptResolved', result);

        const chosenOption = optionId === '__skip__' ? null : options.find((o) => o.itemId === optionId);
        const interjectionChoice = chosenOption
          ? { itemId: chosenOption.itemId, diceInterjection: chosenOption.diceInterjection }
          : null;

        const outcome = resumeRollChoice(io, effectResolverManager, gameState, roomCode, choicePlayerId, resumeKind, resumeContext, interjectionChoice, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs, socket);
        if (outcome.drawnCards) {
          socket.emit('game:cardsDrawn', { cards: outcome.drawnCards });
        }
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
        ack({});
      } catch (err) {
        console.error('game:diceChoiceRespond error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
```

(The closing `});` for the `socket.on(...)` call, a few lines further down, is unchanged — only the body shown above changes.)

- [ ] **Step 10: Rewrite the two affected tests in `server/test/socketHandlers.test.js`**

**10a.** The test at line 1087-1127 (`game:move into room_collapsed_room with an eligible interjection item pauses for a roll choice, then game:diceChoiceRespond resolves the fall`) currently sends `overrideValue: 0` and expects a guaranteed fail. With auto-max, the result no longer depends on client input, and the default test character's `speed` stat (from this file's `makeStats()` helper: `speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, ... }`, so `getStatValue` returns `track[2] = 4`) makes the auto-max roll `4 * 2 = 8`, which clears `COLLAPSE_CHECK_MIN` (5, defined in `server/src/game/turnFlow.js`) — the check now passes instead of failing.

Current (lines 1112-1123):

```js
  const pending = await pendingPromise;
  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  const respondResult = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_005', overrideValue: 0 }, resolve)
  );
  expect(respondResult.error).toBeUndefined();
  await resolvedPromise;

  expect(player.floor).toBe('basement'); // overrideValue 0 < 5, guaranteed fail
  expect(player.x).toBe(1);
  expect(player.y).toBe(1);
```

Replace with:

```js
  const pending = await pendingPromise;
  const resolvedPromise = new Promise((resolve) => currentClient.once('game:promptResolved', resolve));
  const respondResult = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_005' }, resolve)
  );
  expect(respondResult.error).toBeUndefined();
  await resolvedPromise;

  // item_005's override auto-substitutes the max possible roll (default test
  // character speed 4 * default face max 2 = 8), which clears
  // COLLAPSE_CHECK_MIN (5) -- the player stays on the ground floor.
  expect(player.floor).toBe('ground');
  expect(player.x).toBe(1);
  expect(player.y).toBe(1);
```

Also update the test's own title (line 1087) since "resolves the fall" is no longer accurate:

```js
test('game:move into room_collapsed_room with an eligible interjection item pauses for a roll choice, then game:diceChoiceRespond resolves it', async () => {
```

**10b.** The entire test at line 4824-4864 (`game:diceChoiceRespond with a malformed overrideValue is rejected before the item is consumed, and the roll choice stays open`) tests validation that no longer exists. Replace the whole test (keep the `makeOverrideInterjectionContent()` helper above it at line 4799-4822 unchanged — it's still used) with:

```js
test('game:diceChoiceRespond with an override interjection item auto-substitutes the max roll -- no overrideValue needed or accepted', async () => {
  const content = makeOverrideInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager, effectResolverManager } =
    await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_003' }, { id: 'item_005' });

  const pendingPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_003' }, resolve));
  const pending = await pendingPromise;

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  const respondResult = await new Promise((resolve) =>
    currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_005' }, resolve)
  );
  expect(respondResult.error).toBeUndefined();
  await effectResolvedPromise;

  // item_003's dice_check has one wide 0-8 tier, so any roll matches it --
  // this test's point is that the response succeeds and the item is consumed
  // without the client ever sending an overrideValue.
  expect(player.inventory).toEqual([{ id: 'item_003' }]);
  expect(getResolver(effectResolverManager, roomCode).pendingRollChoice).toBeNull();

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 11: Run the full server test suite**

Run: `cd server && npm test`
Expected: PASS, all tests green (no regressions elsewhere)

- [ ] **Step 12: Commit**

```bash
git add server/src/game/effectPipeline.js server/src/game/diceInterjection.js server/src/game/effectResolver.js server/src/socketHandlers.js server/test/game/diceInterjection.test.js server/test/game/effectResolver.test.js server/test/socketHandlers.test.js
git commit -m "feat: dice interjection override auto-substitutes the max roll

item_005 (天使羽毛)'s card text promises a guaranteed pass. The
previous implementation required the player to type a 0-8 override
value themselves, which didn't actually guarantee anything. override
now computes baseCount * (the roll's max possible face value) on the
server, and no longer accepts a client-supplied overrideValue."
```

---

### Task 2: Client — popup scoping and diceInterjectionText display

**Files:**
- Modify: `client/src/DebugGameScreen.jsx`

**Interfaces:**
- Consumes: Task 1's server contract — `game:diceChoiceRespond` no longer needs (and Task 1's server ignores) an `overrideValue` field. `data/cards/item-cards.json`'s `diceInterjectionText` field (already present on `item_005`/`006`/`010`/`048`/`049`, filled in by the developer) flows to the client unfiltered via the existing `cardContent` state populated at `game:started` -- no server change needed to read it.
- Produces: nothing consumed by a later task (this is the last task in this plan).

- [ ] **Step 1: Scope `onDiceChoicePending` and `onEffectPendingChoice` to the acting player**

Current code (`client/src/DebugGameScreen.jsx`, in the `useEffect` that registers socket listeners):

```js
    function onEffectPendingChoice(data) {
      setPendingEffectChoice(data);
    }
    function onEffectResolved(data) {
      setMessages((prev) => [...prev, `效果已解析完成：${JSON.stringify(data)}`]);
      setPendingEffectChoice(null);
    }
    function onDiceChoicePending(data) {
      setPendingRollChoice(data);
    }
```

Replace with (mirrors the existing `onItemUseResolved`/`onInventoryChoicePending` pattern already in this same file, which both start with `if (data.playerId !== playerId) return;`):

```js
    function onEffectPendingChoice(data) {
      if (data.playerId !== playerId) return;
      setPendingEffectChoice(data);
    }
    function onEffectResolved(data) {
      setMessages((prev) => [...prev, `效果已解析完成：${JSON.stringify(data)}`]);
      setPendingEffectChoice(null);
    }
    function onDiceChoicePending(data) {
      if (data.playerId !== playerId) return;
      setPendingRollChoice(data);
    }
```

`onEffectResolved` is unchanged — it only clears local state and appends to the shared message log, there's nothing player-specific to filter there.

- [ ] **Step 2: Verify `playerId` is in scope at this point in the file**

Run a quick check that this component receives `playerId` as a prop (it's already used by the neighboring `onRoomEntered`/`onItemUseResolved`/`onInventoryChoicePending` filters a few lines above/below, so this should already be true, but confirm before moving on):

```bash
grep -n "playerId" client/src/DebugGameScreen.jsx | head -5
```

Expected: shows `export default function DebugGameScreen({ socket, roomCode, playerId, ...` near the top of the file, confirming `playerId` is a prop already in scope throughout this component.

- [ ] **Step 3: Simplify `handleRollChoiceRespond` -- drop the now-unused `overrideValue` parameter**

Current code:

```js
  function handleRollChoiceRespond(optionId, overrideValue) {
    if (!pendingRollChoice) return;
    socket.emit('game:diceChoiceRespond', { promptId: pendingRollChoice.promptId, optionId, overrideValue }, (res) => {
      if (res && res.error) {
        console.error('[game:diceChoiceRespond]', res.error);
        setActionError(res.error);
      }
    });
  }
```

Replace with:

```js
  function handleRollChoiceRespond(optionId) {
    if (!pendingRollChoice) return;
    socket.emit('game:diceChoiceRespond', { promptId: pendingRollChoice.promptId, optionId }, (res) => {
      if (res && res.error) {
        console.error('[game:diceChoiceRespond]', res.error);
        setActionError(res.error);
      }
    });
  }
```

- [ ] **Step 4: Replace the `pendingRollChoice` render block -- remove the number input, add `diceInterjectionText`**

Current code (the JSX block rendering the roll-choice popup):

```jsx
              {pendingRollChoice && (
                <div>
                  <p>擲骰道具介入：要不要使用道具？</p>
                  <ul>
                    {pendingRollChoice.options.map((o) => (
                      <li key={o.itemId}>
                        {o.name}
                        {o.diceInterjection.override ? (
                          <>
                            <input
                              type="number"
                              min="0"
                              max="8"
                              value={overrideInput}
                              onChange={(e) => setOverrideInput(e.target.value)}
                            />
                            <button onClick={() => handleRollChoiceRespond(o.itemId, Number(overrideInput))}>
                              使用
                            </button>
                          </>
                        ) : (
                          <button onClick={() => handleRollChoiceRespond(o.itemId, undefined)}>使用</button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => handleRollChoiceRespond('__skip__', undefined)}>不使用道具</button>
                </div>
              )}
```

Replace with:

```jsx
              {pendingRollChoice && (
                <div>
                  <p>擲骰道具介入：要不要使用道具？</p>
                  <ul>
                    {pendingRollChoice.options.map((o) => {
                      const cardInfo = findCardInfo(o.itemId, cardContent);
                      return (
                        <li key={o.itemId}>
                          <strong>{o.name}</strong>
                          {cardInfo && cardInfo.diceInterjectionText && <p>{cardInfo.diceInterjectionText}</p>}
                          <button onClick={() => handleRollChoiceRespond(o.itemId)}>使用</button>
                        </li>
                      );
                    })}
                  </ul>
                  <button onClick={() => handleRollChoiceRespond('__skip__')}>不使用道具</button>
                </div>
              )}
```

`findCardInfo` and `cardContent` are already imported/in scope in this file (used a few dozen lines above, in `onCardDrawn`) -- no new import needed.

- [ ] **Step 5: Remove the now-dead `overrideInput` state**

Current code (near the top of the component, with the other `useState` declarations):

```js
  const [overrideInput, setOverrideInput] = useState('0');
```

Delete this line entirely -- after Step 4, nothing in the file reads or writes `overrideInput`/`setOverrideInput` anymore. Confirm with:

```bash
grep -n "overrideInput" client/src/DebugGameScreen.jsx
```

Expected: no matches (empty output) after deleting the line.

- [ ] **Step 6: Manual browser verification**

There is no client-side test suite in this project (server tests only) -- this step is the actual verification for this task, following this project's established pattern of manual browser checks for frontend-only changes.

1. Restart both dev servers fresh (per this project's rule: never rely on hot-reload alone after a code change -- close and restart):
   - Stop any running `server`/`client` preview servers.
   - Start `server` (`.claude/launch.json` entry `server`, port 3001).
   - Start `client` (`.claude/launch.json` entry `client`, port 5173).
2. Open two browser tabs, create a lobby in one, join it from the other, pick two different characters, start the game.
3. On the acting player's tab: get an item with `diceInterjection` into that player's inventory and trigger a roll that offers it as an interjection option (e.g. give the player `item_006`（詭異人偶）or `item_005`（天使羽毛）via a debug/dev path, or move into a room whose `leaveCheck` triggers the prompt).
4. Confirm on the ACTING player's tab: the "擲骰道具介入" popup appears, each offered item shows its name AND its `diceInterjectionText` (the developer-authored explanation), and there is no number input anywhere in the popup (not even for item_005).
5. Confirm on the OTHER (non-acting) player's tab, at the same moment: no popup appears at all.
6. Click "使用" on an `override:true` item (item_005) if reachable in this test scenario, or on a `bonusDice` item otherwise; confirm the check resolves without any client-side error in the browser console or server-side error in the terminal, and (if item_005 was used) that the check result is consistent with a guaranteed-max roll.
7. Check server terminal output and browser console for errors throughout.

- [ ] **Step 7: Commit**

```bash
git add client/src/DebugGameScreen.jsx
git commit -m "feat: scope dice-interjection/effect-choice popups to the acting player, show diceInterjectionText

onDiceChoicePending and onEffectPendingChoice now filter by playerId
like the existing roomIntro/itemUseResolved popups do. The roll-choice
popup now shows each item's diceInterjectionText and no longer renders
a number input for override items (server-side override is now
auto-max, see the companion server-side commit)."
```
