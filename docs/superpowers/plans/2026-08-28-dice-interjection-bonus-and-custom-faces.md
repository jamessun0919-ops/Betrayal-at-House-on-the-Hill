# item_048/049 骰子介入新能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `item_048`（海盜金幣）grants a bonus item when the check it was used on passes; `item_049`（賭神骰子）temporarily swaps the dice faces for one roll. Both build on `diceInterjection`, which currently has no "know if the check passed" or "custom dice faces" capability.

**Architecture:** `dice_check` tiers gain an explicit `pass: true|false` field (card-author-declared, not guessed) — this both unblocks `item_048`'s "if passed" logic AND fixes a pre-existing fragile heuristic in `socketHandlers.js` (`game:checkResolved`'s `passed` field previously guessed from tier effect content, already known to misjudge at least one real card). `item_048` adds a `bonusOnPass` field to `diceInterjection`, merged into the resolved effects array only when the matched tier's `pass` is `true`. `item_049` adds a `customFaces` field, threaded through `rollDice`'s new optional `faces` parameter — only at the one call site that's actually reachable in production for a non-`override` interjection (`computeInterjectedRoll`'s `bonusDice` branch in `effectResolver.js`; `diceInterjection.js`'s own `resolveFinalRoll` is NOT this call site, despite having a similar-looking branch — see Task 2 for why).

**Tech Stack:** Node.js (server only — no client or card-UI changes in this plan). Jest (server tests).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-28-dice-interjection-bonus-and-custom-faces-design.md` — read it if anything below is ambiguous, it governs.
- `pass` is a plain boolean field added directly to each `tier` object inside a card's `dice_check` effect — sits alongside the existing `min`/`max`/`effects` keys, no new nesting.
- The 8 existing cards using `dice_check` (`event_001`/`005`/`009`/`010`/`022`, `item_009`/`027`, `omen_003`) each need every one of their tiers marked with the correct `pass` value — the exact mapping is in the design doc's table. Do not guess a card's pass/fail split from its effects; use the table.
- `bonusOnPass` only fires when ALL of: an interjection item was actually used (`context.interjectionChoice` present) AND the matched tier's `pass === true` AND the item's `diceInterjection.bonusOnPass` is a non-empty array. It must NOT fire on a failed check even if `bonusDice` was still applied.
- The returned `diceCheckResult.tierEffects` must stay exactly the matched tier's own `effects` — never include `bonusOnPass` — so existing `feedbacktextDice` / `game:checkResolved` display logic is unaffected by this change.
- `customFaces` must be threaded through the `computeInterjectedRoll` `bonusDice` branch in `server/src/game/effectResolver.js` (NOT `resolveFinalRoll` in `server/src/game/diceInterjection.js` — that function's bonusDice branch is unit-tested but not actually reachable from production for a non-`override` interjection; verify this yourself by tracing `computeInterjectedRoll`'s two branches before writing code, don't take it on faith).
- `rollDice`'s new `faces` parameter must default to the existing `DIE_FACES` constant — every pre-existing call site (5 of them, none passing a 3rd argument) must keep behaving identically.
- Server tests: `cd server && npm test` (Jest). Every task must end with the full suite green, not just its own new test file.
- `data/cards/event-cards.json`, `data/cards/item-cards.json`, `data/cards/omen-cards.json` are large hand-maintained files also edited directly by the developer between sessions — use precise text-level `Edit` (exact old_string/new_string) on just the target tiers/cards, never a full-file JSON.parse/stringify rewrite. Before editing, re-read each target block to confirm it still matches this plan's "Before" text; if it doesn't, stop and report the actual current content rather than guessing.
- No frontend/client changes in this plan.

---

### Task 1: `pass` field on `dice_check` tiers + fix `game:checkResolved`'s `passed` heuristic

**Files:**
- Modify: `server/src/game/effectResolver.js` (`handleDiceCheck`)
- Modify: `server/src/socketHandlers.js` (`game:checkResolved` emit)
- Test: `server/test/game/effectResolver.test.js`, `server/test/socketHandlers.test.js`

**Interfaces:**
- Produces: `diceCheckResult` (already an existing return field of `resolveEffects`/`handleDiceCheck`) gains a new `pass: boolean` field, copied directly from the matched tier's `pass` field.
- Consumes: nothing from other tasks. Tasks 2 and 3 both depend on this task landing first (Task 3 reads `tier.pass` inside the same function this task modifies).

- [ ] **Step 1: Write the failing tests**

Add to `server/test/game/effectResolver.test.js`, near the existing dice_check tests (search for `computeInterjectedRoll is exported and applies a chosen interjection's cost/bonus directly` and insert after that test's closing `});`):

```javascript

test('resolveEffects dice_check propagates the matched tier\'s pass value into diceCheckResult', () => {
  const gameState = makeGameStateWithPlayer();
  const rng = jest.fn().mockReturnValue(0.99); // every die -> face 2

  const passResult = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'dice_check', diceCount: 1, tiers: [{ min: 0, max: 8, pass: true, effects: [] }] },
  ], { rng });
  expect(passResult.diceCheckResult.pass).toBe(true);

  const failResult = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'dice_check', diceCount: 1, tiers: [{ min: 0, max: 8, pass: false, effects: [] }] },
  ], { rng });
  expect(failResult.diceCheckResult.pass).toBe(false);
});
```

Add to `server/test/socketHandlers.test.js`, near the existing `EVENT_001_DICE_CHECK` fixture (search for `const EVENT_001_DICE_CHECK = {`):

First, update the fixture itself (this is a required change, not new test code — the existing fixture will make `checkResolved.passed` become `undefined` once Task 1's production code change lands, since it currently has no `pass` field on any tier):

Before:
```javascript
const EVENT_001_DICE_CHECK = {
  id: 'event_001',
  name: '腐敗惡臭',
  effects: [{
    type: 'dice_check',
    stat: 'sanity',
    tiers: [
      { min: 5, max: 8, effects: [{ type: 'stat_change', stat: 'sanity', delta: 1 }] },
      { min: 1, max: 4, effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
      { min: 0, max: 0, effects: [
        { type: 'stat_change', stat: 'might', delta: -1 },
        { type: 'stat_change', stat: 'speed', delta: -1 },
        { type: 'stat_change', stat: 'knowledge', delta: -1 },
        { type: 'stat_change', stat: 'sanity', delta: -1 },
      ] },
    ],
  }],
};
```
After:
```javascript
const EVENT_001_DICE_CHECK = {
  id: 'event_001',
  name: '腐敗惡臭',
  effects: [{
    type: 'dice_check',
    stat: 'sanity',
    tiers: [
      { min: 5, max: 8, pass: true, effects: [{ type: 'stat_change', stat: 'sanity', delta: 1 }] },
      { min: 1, max: 4, pass: false, effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
      { min: 0, max: 0, pass: false, effects: [
        { type: 'stat_change', stat: 'might', delta: -1 },
        { type: 'stat_change', stat: 'speed', delta: -1 },
        { type: 'stat_change', stat: 'knowledge', delta: -1 },
        { type: 'stat_change', stat: 'sanity', delta: -1 },
      ] },
    ],
  }],
};
```

(This mirrors the `pass` values this plan's Task 4 will apply to the REAL `event_001` card in `data/cards/event-cards.json` — this fixture is a hand-copied duplicate used only in this test file.)

Then add this new test right after the existing `drawing a card whose effect is a dice_check broadcasts a cardCheck game:checkResolved to the whole room` test (search for that test's closing `});`):

```javascript

test('game:checkResolved passed field reflects the tier\'s explicit pass flag, not a guess from tierEffects content', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_x',
        name: '測試',
        effects: [{
          type: 'dice_check',
          diceCount: 4, // max achievable sum is 4*2=8 -- enough to actually reach the min:8 tier below
          tiers: [
            // "passed" tier that still applies a negative stat_change -- the
            // old heuristic (guessing from tierEffects) would have said
            // false here; the fix must read the explicit pass:true instead.
            { min: 8, max: 8, pass: true, effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            // "failed" tier with no effects at all -- the old heuristic
            // would have said true here (no negative stat_change present).
            { min: 0, max: 7, pass: false, effects: [] },
          ],
        }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient } = await setUpStartedGameWithContent(content);

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // guaranteed to land in the min:8 (pass:true) tier
  const checkResolvedPromise = new Promise((resolve) => otherClient.once('game:checkResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const checkResolved = await checkResolvedPromise;
  rngSpy.mockRestore();

  expect(checkResolved.passed).toBe(true);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest effectResolver -t "pass value into diceCheckResult"`
Run: `cd server && npx jest socketHandlers -t "explicit pass flag"`
Expected: FAIL — `diceCheckResult.pass` is `undefined` (not `true`/`false`) since the production code doesn't read/propagate `tier.pass` yet; the socketHandlers test fails because `checkResolved.passed` is still computed by the old heuristic (`false`, since the pass tier's effect has a negative `stat_change`) instead of the expected `true`.

- [ ] **Step 3: Propagate `tier.pass` into `diceCheckResult`**

In `server/src/game/effectResolver.js`, find `function handleDiceCheck` and replace its tail:

Before:
```javascript
  const finalSum = computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice || null, restContext);
  const tier = evaluateTiers(finalSum, effect.tiers);
  const nestedResult = resolveEffects(gameState, promptState, playerId, tier.effects, restContext);
  return {
    ...nestedResult,
    diceCheckResult: { stat: effect.stat, diceCount: baseCount, rolled: finalSum, tierEffects: tier.effects },
  };
}
```
After:
```javascript
  const finalSum = computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice || null, restContext);
  const tier = evaluateTiers(finalSum, effect.tiers);
  const nestedResult = resolveEffects(gameState, promptState, playerId, tier.effects, restContext);
  return {
    ...nestedResult,
    diceCheckResult: { stat: effect.stat, diceCount: baseCount, rolled: finalSum, tierEffects: tier.effects, pass: tier.pass },
  };
}
```

- [ ] **Step 4: Fix the `game:checkResolved` `passed` field**

In `server/src/socketHandlers.js`, find the `game:checkResolved` emit for `checkKind: 'cardCheck'` (search for `checkKind: 'cardCheck'`):

Before:
```javascript
      passed: !effectResult.diceCheckResult.tierEffects.some((e) => e.type === 'stat_change' && e.delta < 0),
```
After:
```javascript
      passed: effectResult.diceCheckResult.pass,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx jest effectResolver socketHandlers -t "pass"`
Expected: PASS, including the new tests from Step 1.

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green (this also re-confirms every pre-existing `checkResolved`/`dice_check` test — none of which reference `pass` in their tier fixtures except the updated `EVENT_001_DICE_CHECK` — still passes; those other fixtures' `diceCheckResult.pass` will simply be `undefined`, which no existing assertion checks).

- [ ] **Step 7: Commit**

```bash
git add server/src/game/effectResolver.js server/src/socketHandlers.js server/test/game/effectResolver.test.js server/test/socketHandlers.test.js
git commit -m "feat: add explicit pass field to dice_check tiers, fix game:checkResolved's passed heuristic"
```

---

### Task 2: `item_049` — `customFaces` for one roll

**Files:**
- Modify: `server/src/game/effectPipeline.js` (`rollDice`)
- Modify: `server/src/game/effectResolver.js` (`computeInterjectedRoll`)
- Test: `server/test/game/effectPipeline.test.js`, `server/test/game/effectResolver.test.js`

**Interfaces:**
- Produces: `rollDice(count, rng, faces)` — new optional 3rd parameter, defaults to the existing `DIE_FACES` constant.
- Consumes: nothing from Task 1 (fully independent — do this task in any order relative to Task 1).

- [ ] **Step 1: Write the failing `rollDice` tests**

Add to `server/test/game/effectPipeline.test.js`, right after the existing `rollDice defaults to Math.random when no rng is given` test:

```javascript

test('rollDice uses a custom faces array when provided, instead of the default DIE_FACES', () => {
  const values = [0, 0.2, 0.4, 0.6, 0.8, 0.99]; // -> indices 0..5
  let call = 0;
  const rng = () => values[call++];
  const customFaces = [1, 1, 1, 2, 2, 2]; // same bucket layout as DIE_FACES, shifted up by 1 for indices 0-1
  expect(rollDice(6, rng, customFaces)).toBe(1 + 1 + 1 + 2 + 2 + 2); // 9, vs 6 with the default DIE_FACES
});

test('rollDice falls back to the default DIE_FACES when faces is not provided', () => {
  const rng = () => 0; // index 0
  expect(rollDice(1, rng)).toBe(0); // DIE_FACES[0] === 0
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest effectPipeline -t "customFaces|custom faces|falls back"`
Expected: FAIL (`rollDice` doesn't accept a 3rd argument yet — the custom-faces test gets the default-faces result instead).

- [ ] **Step 3: Add the `faces` parameter to `rollDice`**

In `server/src/game/effectPipeline.js`:

Before:
```javascript
function rollDice(count, rng = Math.random) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('INVALID_DICE_COUNT');
  }
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * DIE_FACES.length);
    sum += DIE_FACES[index];
  }
  return sum;
}
```
After:
```javascript
function rollDice(count, rng = Math.random, faces = DIE_FACES) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('INVALID_DICE_COUNT');
  }
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * faces.length);
    sum += faces[index];
  }
  return sum;
}
```

- [ ] **Step 4: Run the `rollDice` tests to verify they pass**

Run: `cd server && npx jest effectPipeline`
Expected: PASS, full file green (this also re-confirms every pre-existing `rollDice` test — none pass a 3rd argument — behaves identically with the new default).

- [ ] **Step 5: Write the failing `computeInterjectedRoll` test**

Add to `server/test/game/effectResolver.test.js`, right after the (now-updated, from Task 1) `computeInterjectedRoll is exported and applies a chosen interjection's cost/bonus directly` test:

```javascript

test('computeInterjectedRoll uses the chosen interjection\'s customFaces for the roll', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_049' });
  const rng = jest.fn().mockReturnValue(0); // face index 0
  const diceInterjection = {
    scope: 'any',
    customFaces: [1, 1, 1, 2, 2, 2], // index 0 -> face 1, vs default DIE_FACES index 0 -> face 0
    consumesItem: true,
  };
  const result = computeInterjectedRoll(
    gameState,
    createPromptState(),
    'p1',
    1,
    [],
    { itemId: 'item_049', diceInterjection, overrideValue: undefined },
    { rng }
  );
  expect(result).toBe(1); // with the default DIE_FACES this would be 0 -- proves customFaces was actually used
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd server && npx jest effectResolver -t "customFaces"`
Expected: FAIL (`computeInterjectedRoll`'s `bonusDice` branch doesn't read `customFaces` yet, so the roll still uses the default faces and returns `0`, not `1`).

- [ ] **Step 7: Thread `customFaces` through `computeInterjectedRoll`**

In `server/src/game/effectResolver.js`, find `function computeInterjectedRoll` and update its `bonusDice` branch (the LAST 4 lines of the function, after the `if (diceInterjection.override)` block):

Before:
```javascript
  const boostedCount = baseCount + (diceInterjection.bonusDice || 0);
  const adjustedCount = Math.max(1, Math.min(8, applyModifiers(boostedCount, modifiers, 'onBeforeRoll', context)));
  const rolled = rollDice(adjustedCount, context.rng);
  return applyModifiers(rolled, modifiers, 'onAfterRoll', context);
}
```
After:
```javascript
  const boostedCount = baseCount + (diceInterjection.bonusDice || 0);
  const adjustedCount = Math.max(1, Math.min(8, applyModifiers(boostedCount, modifiers, 'onBeforeRoll', context)));
  const rolled = rollDice(adjustedCount, context.rng, diceInterjection.customFaces);
  return applyModifiers(rolled, modifiers, 'onAfterRoll', context);
}
```

(Do NOT touch the `!interjectionChoice` branch earlier in this same function, nor `diceInterjection.js`'s `resolveFinalRoll` — neither is the production call site for a non-`override` interjection's roll. `rollDice`'s new 3rd parameter defaults to `undefined` → `DIE_FACES` when `diceInterjection.customFaces` isn't set, so every other card's roll is unaffected.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd server && npx jest effectResolver -t "customFaces"`
Expected: PASS.

- [ ] **Step 9: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green.

- [ ] **Step 10: Commit**

```bash
git add server/src/game/effectPipeline.js server/src/game/effectResolver.js server/test/game/effectPipeline.test.js server/test/game/effectResolver.test.js
git commit -m "feat: add customFaces support to rollDice and computeInterjectedRoll"
```

---

### Task 3: `item_048` — `bonusOnPass`

**Files:**
- Modify: `server/src/game/effectResolver.js` (`handleDiceCheck`)
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Consumes: Task 1's `tier.pass` (this task's code reads it from the same `tier` variable Task 1 already introduced pass-reading for). Do this task after Task 1.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/game/effectResolver.test.js`, right after Task 2's `computeInterjectedRoll uses the chosen interjection's customFaces for the roll` test:

```javascript

test('resolveEffects dice_check applies bonusOnPass effects when the interjection item is used and the matched tier has pass:true', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_048' });
  const rng = jest.fn().mockReturnValue(0.99); // every die -> face 2
  const diceInterjection = { scope: 'any', bonusDice: -1, consumesItem: true, bonusOnPass: [{ type: 'stat_change', stat: 'might', delta: 1 }] };
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 4,
      tiers: [
        { min: 6, max: 8, pass: true, effects: [] },
        { min: 0, max: 5, pass: false, effects: [] },
      ],
    },
  ], { rng, interjectionChoice: { itemId: 'item_048', diceInterjection, overrideValue: undefined } });
  expect(result.pending).toBe(false);
  expect(player.stats.might.currentIndex).toBe(3); // baseIndex 2 + 1 from bonusOnPass -- (4-1 dice)*2=6 lands in the min:6-8 pass tier
  expect(player.inventory).toEqual([]); // consumesItem -- removed
});

test('resolveEffects dice_check does not apply bonusOnPass effects when the matched tier has pass:false', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_048' });
  const rng = jest.fn().mockReturnValue(0); // every die -> face 0
  const diceInterjection = { scope: 'any', bonusDice: -1, consumesItem: true, bonusOnPass: [{ type: 'stat_change', stat: 'might', delta: 1 }] };
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    {
      type: 'dice_check',
      diceCount: 4,
      tiers: [
        { min: 6, max: 8, pass: true, effects: [] },
        { min: 0, max: 5, pass: false, effects: [] },
      ],
    },
  ], { rng, interjectionChoice: { itemId: 'item_048', diceInterjection, overrideValue: undefined } });
  expect(result.pending).toBe(false);
  expect(player.stats.might.currentIndex).toBe(2); // unchanged -- fail tier (sum=0, min:0-5), bonusOnPass not applied
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest effectResolver -t "bonusOnPass"`
Expected: FAIL (`bonusOnPass` isn't read anywhere yet, so `might.currentIndex` stays at the baseline `2` in the first test instead of the expected `3`).

- [ ] **Step 3: Merge `bonusOnPass` into the resolved effects when the tier passes**

In `server/src/game/effectResolver.js`, find `function handleDiceCheck` (already modified by Task 1) and replace its tail again:

Before:
```javascript
  const finalSum = computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice || null, restContext);
  const tier = evaluateTiers(finalSum, effect.tiers);
  const nestedResult = resolveEffects(gameState, promptState, playerId, tier.effects, restContext);
  return {
    ...nestedResult,
    diceCheckResult: { stat: effect.stat, diceCount: baseCount, rolled: finalSum, tierEffects: tier.effects, pass: tier.pass },
  };
}
```
After:
```javascript
  const finalSum = computeInterjectedRoll(gameState, promptState, playerId, baseCount, modifiers, interjectionChoice || null, restContext);
  const tier = evaluateTiers(finalSum, effect.tiers);
  const bonusOnPass = (tier.pass && interjectionChoice && Array.isArray(interjectionChoice.diceInterjection.bonusOnPass))
    ? interjectionChoice.diceInterjection.bonusOnPass
    : [];
  const nestedResult = resolveEffects(gameState, promptState, playerId, [...tier.effects, ...bonusOnPass], restContext);
  return {
    ...nestedResult,
    diceCheckResult: { stat: effect.stat, diceCount: baseCount, rolled: finalSum, tierEffects: tier.effects, pass: tier.pass },
  };
}
```

(Note `diceCheckResult.tierEffects` still reports only `tier.effects` — the `bonusOnPass` effects are executed but never appear in `tierEffects`, per the Global Constraints.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest effectResolver -t "bonusOnPass"`
Expected: PASS, both new tests.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green.

- [ ] **Step 6: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat: add bonusOnPass to diceInterjection, merged into effects only when the tier passes"
```

---

### Task 4: Card data — `pass` on the 8 existing `dice_check` cards + wire `item_048`/`item_049`

**Files:**
- Modify: `data/cards/event-cards.json` (`event_001`, `event_005`, `event_009`, `event_010`, `event_022`)
- Modify: `data/cards/item-cards.json` (`item_009`, `item_027`, `item_048`, `item_049`)
- Modify: `data/cards/omen-cards.json` (`omen_003`)
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `pass` field handling (Task 1), `customFaces` (Task 2), `bonusOnPass` (Task 3). Do this task last.

For every edit below: **re-read the current block first** (`grep -n '"id": "<card_id>"' -A N data/cards/<file>.json`) and confirm it matches the "Before" text exactly before editing — these files are actively edited by the developer between sessions. If any block doesn't match, stop and report the actual current content rather than forcing the edit. Use precise text-level `Edit` calls, never a full-file rewrite.

- [ ] **Step 1: `event_001`** (`data/cards/event-cards.json`)

Before:
```json
    "effects": [{
      "type": "dice_check",
      "stat": "sanity",
      "tiers": [
        { "min": 5, "max": 8, "effects": [{ "type": "stat_change", "stat": "sanity", "delta": 1 }] },
        { "min": 1, "max": 4, "effects": [{ "type": "stat_change", "stat": "might", "delta": -1 }] },
        { "min": 0, "max": 0, "effects": [
          { "type": "stat_change", "stat": "might", "delta": -1 },
          { "type": "stat_change", "stat": "speed", "delta": -1 },
          { "type": "stat_change", "stat": "knowledge", "delta": -1 },
          { "type": "stat_change", "stat": "sanity", "delta": -1 }
        ] }
      ]
    }],
    "needsCustomLogic": false
  },
  {
    "id": "event_002",
```
After:
```json
    "effects": [{
      "type": "dice_check",
      "stat": "sanity",
      "tiers": [
        { "min": 5, "max": 8, "pass": true, "effects": [{ "type": "stat_change", "stat": "sanity", "delta": 1 }] },
        { "min": 1, "max": 4, "pass": false, "effects": [{ "type": "stat_change", "stat": "might", "delta": -1 }] },
        { "min": 0, "max": 0, "pass": false, "effects": [
          { "type": "stat_change", "stat": "might", "delta": -1 },
          { "type": "stat_change", "stat": "speed", "delta": -1 },
          { "type": "stat_change", "stat": "knowledge", "delta": -1 },
          { "type": "stat_change", "stat": "sanity", "delta": -1 }
        ] }
      ]
    }],
    "needsCustomLogic": false
  },
  {
    "id": "event_002",
```

- [ ] **Step 2: `event_005`** (`data/cards/event-cards.json`)

Before:
```json
    "effects": [{
      "type": "dice_check",
      "diceCount": 2,
      "tiers": [
        { "min": 3, "max": 4, "effects": [{ "type": "draw_card", "deck": "item", "count": 1 }] },
        { "min": 0, "max": 2, "effects": [] }
      ]
    }],
    "needsCustomLogic": false
  },
  {
    "id": "event_006",
```
After:
```json
    "effects": [{
      "type": "dice_check",
      "diceCount": 2,
      "tiers": [
        { "min": 3, "max": 4, "pass": true, "effects": [{ "type": "draw_card", "deck": "item", "count": 1 }] },
        { "min": 0, "max": 2, "pass": false, "effects": [] }
      ]
    }],
    "needsCustomLogic": false
  },
  {
    "id": "event_006",
```

- [ ] **Step 3: `event_009`** (`data/cards/event-cards.json`)

Before:
```json
    "effects": [{
      "type": "dice_check",
      "stat": "sanity",
      "tiers": [
        { "min": 4, "max": 8, "effects": [] },
        { "min": 0, "max": 3, "effects": [{ "type": "stat_change", "stat": "might", "delta": -1 }] }
      ]
    }],
    "needsCustomLogic": false
  },
  {
    "id": "event_010",
```
After:
```json
    "effects": [{
      "type": "dice_check",
      "stat": "sanity",
      "tiers": [
        { "min": 4, "max": 8, "pass": true, "effects": [] },
        { "min": 0, "max": 3, "pass": false, "effects": [{ "type": "stat_change", "stat": "might", "delta": -1 }] }
      ]
    }],
    "needsCustomLogic": false
  },
  {
    "id": "event_010",
```

- [ ] **Step 4: `event_010`** (`data/cards/event-cards.json`)

Before:
```json
    "effects": [{
      "type": "dice_check",
      "stat": "knowledge",
      "tiers": [
        { "min": 4, "max": 8, "effects": [{
          "type": "choice",
          "description": "選擇一項能力提升一個級別",
          "timeoutMs": 20000,
          "defaultOptionId": "might",
          "options": [
            { "optionId": "might", "label": "力量", "effects": [{ "type": "stat_change", "stat": "might", "delta": 1 }] },
            { "optionId": "speed", "label": "速度", "effects": [{ "type": "stat_change", "stat": "speed", "delta": 1 }] },
            { "optionId": "knowledge", "label": "知識", "effects": [{ "type": "stat_change", "stat": "knowledge", "delta": 1 }] },
            { "optionId": "sanity", "label": "意志", "effects": [{ "type": "stat_change", "stat": "sanity", "delta": 1 }] }
          ]
        }] },
        { "min": 0, "max": 3, "effects": [] }
      ]
    }],
    "needsCustomLogic": false
  },
```
After:
```json
    "effects": [{
      "type": "dice_check",
      "stat": "knowledge",
      "tiers": [
        { "min": 4, "max": 8, "pass": true, "effects": [{
          "type": "choice",
          "description": "選擇一項能力提升一個級別",
          "timeoutMs": 20000,
          "defaultOptionId": "might",
          "options": [
            { "optionId": "might", "label": "力量", "effects": [{ "type": "stat_change", "stat": "might", "delta": 1 }] },
            { "optionId": "speed", "label": "速度", "effects": [{ "type": "stat_change", "stat": "speed", "delta": 1 }] },
            { "optionId": "knowledge", "label": "知識", "effects": [{ "type": "stat_change", "stat": "knowledge", "delta": 1 }] },
            { "optionId": "sanity", "label": "意志", "effects": [{ "type": "stat_change", "stat": "sanity", "delta": 1 }] }
          ]
        }] },
        { "min": 0, "max": 3, "pass": false, "effects": [] }
      ]
    }],
    "needsCustomLogic": false
  },
```

- [ ] **Step 5: `event_022`** (`data/cards/event-cards.json`)

Before:
```json
    "effects": [{
      "type": "dice_check",
      "stat": "sanity",
      "tiers": [
        { "min": 4, "max": 8, "effects": [{ "type": "draw_card", "deck": "item", "count": 1 }] },
        { "min": 0, "max": 3, "effects": [{ "type": "stat_change", "stat": "knowledge", "delta": -1 }] }
      ]
```
After:
```json
    "effects": [{
      "type": "dice_check",
      "stat": "sanity",
      "tiers": [
        { "min": 4, "max": 8, "pass": true, "effects": [{ "type": "draw_card", "deck": "item", "count": 1 }] },
        { "min": 0, "max": 3, "pass": false, "effects": [{ "type": "stat_change", "stat": "knowledge", "delta": -1 }] }
      ]
```

- [ ] **Step 6: `item_009`** (`data/cards/item-cards.json`)

Before:
```json
    "effects": [
      {
        "type": "dice_check",
        "stat": "knowledge",
        "tiers": [
          {
            "min": 5,
            "max": 8,
            "effects": [
              {
                "type": "draw_card",
                "deck": "item",
                "count": 2
              }
            ]
          },
          {
            "min": 0,
            "max": 4,
            "effects": []
          }
        ]
      }
    ],
    "category": "consumable",
    "canTargetOthers": false,
    "needsCustomLogic": false
```
After:
```json
    "effects": [
      {
        "type": "dice_check",
        "stat": "knowledge",
        "tiers": [
          {
            "min": 5,
            "max": 8,
            "pass": true,
            "effects": [
              {
                "type": "draw_card",
                "deck": "item",
                "count": 2
              }
            ]
          },
          {
            "min": 0,
            "max": 4,
            "pass": false,
            "effects": []
          }
        ]
      }
    ],
    "category": "consumable",
    "canTargetOthers": false,
    "needsCustomLogic": false
```

- [ ] **Step 7: `item_027`** (`data/cards/item-cards.json`)

Before:
```json
      "effects": [{
        "type": "dice_check",
        "stat": "knowledge",
        "tiers": [
          { "min": 6, "max": 16, "effects": [{ "type": "stat_change", "stat": "speed", "delta": 1 }] },
          { "min": 0, "max": 5, "effects": [] }
        ]
      }]
```
After:
```json
      "effects": [{
        "type": "dice_check",
        "stat": "knowledge",
        "tiers": [
          { "min": 6, "max": 16, "pass": true, "effects": [{ "type": "stat_change", "stat": "speed", "delta": 1 }] },
          { "min": 0, "max": 5, "pass": false, "effects": [] }
        ]
      }]
```

- [ ] **Step 8: `omen_003`** (`data/cards/omen-cards.json`)

Before:
```json
    "type": "dice_check",
    "stat": "knowledge",
    "tiers": [
      { "min": 4, "max": 8, "effects": [{ "type": "preview_and_choose", "deck": "event", "count": 3, "description": "選擇一張事件卡", "timeoutMs": 20000 }] },
      { "min": 1, "max": 3, "effects": [{ "type": "stat_change", "stat": "sanity", "delta": -1 }] },
      { "min": 0, "max": 0, "effects": [{ "type": "stat_change", "stat": "sanity", "delta": -2 }] }
    ]
```
After:
```json
    "type": "dice_check",
    "stat": "knowledge",
    "tiers": [
      { "min": 4, "max": 8, "pass": true, "effects": [{ "type": "preview_and_choose", "deck": "event", "count": 3, "description": "選擇一張事件卡", "timeoutMs": 20000 }] },
      { "min": 1, "max": 3, "pass": false, "effects": [{ "type": "stat_change", "stat": "sanity", "delta": -1 }] },
      { "min": 0, "max": 0, "pass": false, "effects": [{ "type": "stat_change", "stat": "sanity", "delta": -2 }] }
    ]
```

- [ ] **Step 9: `item_048`** (`data/cards/item-cards.json`)

Before:
```json
    "id": "item_048",
    "name": "海盜金幣",
    "description": "傳說中能夠實現貪婪者願望，但是會讓使用者詛咒纏身的金幣。",
    "text": "每當玩家需要擲骰子前可以選擇使用此物品，該次考驗減少一顆骰子，如該考驗通過，則額外隨機取得一件物品（原考驗內容與結果不受影響）。",
    "effects": [],
    "category": "consumable",
    "canTargetOthers": false,
    "needsCustomLogic": false
  },
```
After:
```json
    "id": "item_048",
    "name": "海盜金幣",
    "description": "傳說中能夠實現貪婪者願望，但是會讓使用者詛咒纏身的金幣。",
    "text": "每當玩家需要擲骰子前可以選擇使用此物品，該次考驗減少一顆骰子，如該考驗通過，則額外隨機取得一件物品（原考驗內容與結果不受影響）。",
    "effects": [],
    "diceInterjection": { "scope": "any", "consumesItem": true, "bonusDice": -1, "bonusOnPass": [{ "type": "draw_card", "deck": "item", "count": 1 }] },
    "category": "consumable",
    "canTargetOthers": false,
    "needsCustomLogic": false
  },
```

- [ ] **Step 10: `item_049`** (`data/cards/item-cards.json`)

Before:
```json
    "id": "item_049",
    "name": "賭神骰子",
    "description": "傳說中的賭神隨身攜帶的骰子，使用前記得驗牌",
    "text": "每當玩家需要擲骰子前可以選擇使用此物品，該次擲骰的骰子六面點數設定從[0,0,1,1,2,2]改為[1,1,1,2,2,2]，考驗完成後修改回原設定。",
    "effects": [],
    "category": "consumable",
    "canTargetOthers": false,
    "needsCustomLogic": false
  },
```
After:
```json
    "id": "item_049",
    "name": "賭神骰子",
    "description": "傳說中的賭神隨身攜帶的骰子，使用前記得驗牌",
    "text": "每當玩家需要擲骰子前可以選擇使用此物品，該次擲骰的骰子六面點數設定從[0,0,1,1,2,2]改為[1,1,1,2,2,2]，考驗完成後修改回原設定。",
    "effects": [],
    "diceInterjection": { "scope": "any", "consumesItem": true, "customFaces": [1, 1, 1, 2, 2, 2] },
    "category": "consumable",
    "canTargetOthers": false,
    "needsCustomLogic": false
  },
```

(Note: `scope: "any"` — matching the existing `diceInterjection.js` `findInterjectionOptions` values seen elsewhere in this codebase's card data, e.g. `item_005`/`item_006` in `server/test/game/diceInterjection.test.js`'s fixture — makes both items offerable on any dice_check, not just event-triggered ones, matching their card text "每當玩家需要擲骰子前".)

- [ ] **Step 11: Validate JSON syntax**

Run: `cd "C:\Users\User\Desktop\Betrayal at House on the Hill" && node -e "JSON.parse(require('fs').readFileSync('data/cards/event-cards.json','utf8')); JSON.parse(require('fs').readFileSync('data/cards/item-cards.json','utf8')); JSON.parse(require('fs').readFileSync('data/cards/omen-cards.json','utf8')); console.log('all valid')"`
Expected: `all valid`

- [ ] **Step 12: Write the failing end-to-end socket tests**

Add to `server/test/socketHandlers.test.js`, near the `EVENT_001_DICE_CHECK` fixture area (search for `test('drawing a card whose effect is a dice_check broadcasts`, insert new tests after that test's closing `});`):

```javascript

test('game:selectAction item_048 grants a bonus item only when the check it was used on passes', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_x',
        name: '測試',
        effects: [{
          type: 'dice_check',
          diceCount: 5,
          tiers: [
            { min: 4, max: 10, pass: true, effects: [] },
            { min: 0, max: 3, pass: false, effects: [] },
          ],
        }],
      }],
      items: [{
        id: 'item_048',
        name: '海盜金幣',
        effects: [],
        diceInterjection: { scope: 'any', consumesItem: true, bonusDice: -1, bonusOnPass: [{ type: 'draw_card', deck: 'item', count: 1 }] },
        category: 'consumable',
      }, {
        id: 'item_100',
        name: '測試獎勵道具',
        effects: [],
        category: 'decoration',
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_048' });
  // The item deck built from content.cards.items still contains BOTH item_048
  // and item_100 as drawable cards -- filter it down to just item_100 so the
  // bonus draw_card below is deterministic (otherwise it could randomly draw
  // item_048 back out of the deck instead, making the assertion flaky).
  gameState.itemDeck.cards = gameState.itemDeck.cards.filter((c) => c.id === 'item_100');

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // 4 dice (5-1 bonusDice) * face 2 = 8, lands in the pass tier
  const cardsDrawnPromise = new Promise((resolve) => currentClient.once('game:cardsDrawn', resolve));
  const diceOptionsPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pending = await diceOptionsPromise;
  await new Promise((resolve) => currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_048' }, resolve));
  const cardsDrawn = await cardsDrawnPromise;
  rngSpy.mockRestore();

  expect(cardsDrawn.cards.some((c) => c.id === 'item_100')).toBe(true); // the bonus draw actually happened
  expect(getPlayer(gameState, currentPlayerId).inventory.some((i) => i.id === 'item_048')).toBe(false); // consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_049 changes the roll outcome via its custom dice faces', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_x',
        name: '測試',
        effects: [{
          type: 'dice_check',
          diceCount: 1,
          tiers: [
            { min: 1, max: 8, pass: true, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] },
            { min: 0, max: 0, pass: false, effects: [] },
          ],
        }],
      }],
      items: [{
        id: 'item_049',
        name: '賭神骰子',
        effects: [],
        diceInterjection: { scope: 'any', consumesItem: true, customFaces: [1, 1, 1, 2, 2, 2] },
        category: 'consumable',
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_049' });

  // Every die face 0 under the DEFAULT DIE_FACES would land on min:0 (fail),
  // but item_049's customFaces [1,1,1,2,2,2] has no 0 face at all -- proves
  // customFaces was actually applied, not just the default table.
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  const diceOptionsPromise = new Promise((resolve) => currentClient.once('game:diceChoicePending', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pending = await diceOptionsPromise;
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:diceChoiceRespond', { promptId: pending.promptId, optionId: 'item_049' }, resolve));
  await effectResolvedPromise;
  rngSpy.mockRestore();

  expect(getPlayer(gameState, currentPlayerId).stats.might.currentIndex).toBe(3); // baseIndex 2 + 1 -- pass tier hit, only reachable with customFaces
  expect(getPlayer(gameState, currentPlayerId).inventory.some((i) => i.id === 'item_049')).toBe(false); // consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

The event names, payload shapes, and flow above are already verified against the production code (`handleRollChoicePending`/`resumeRollChoice`'s `'diceCheck'` branch in `server/src/socketHandlers.js`): `game:diceChoicePending` carries `{playerId, promptId, options, deadline}`; `game:diceChoiceRespond` takes `{promptId, optionId}` (`optionId` must equal the chosen option's `itemId`, e.g. `'item_048'` — `playerId` is read server-side from `socket.data`, not sent in the payload). Use the snippets as-is.

- [ ] **Step 13: Run tests to verify they pass**

Run: `cd server && npx jest socketHandlers -t "item_048|item_049"`
Expected: PASS, both new tests.

- [ ] **Step 14: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green.

- [ ] **Step 15: Commit**

```bash
git add data/cards/event-cards.json data/cards/item-cards.json data/cards/omen-cards.json server/test/socketHandlers.test.js
git commit -m "feat: add pass field to the 8 existing dice_check cards, wire item_048/item_049"
```

---

## Final Verification

- [ ] `cd server && npm test` — full suite green
- [ ] `node -e "JSON.parse(require('fs').readFileSync('data/cards/event-cards.json','utf8')); JSON.parse(require('fs').readFileSync('data/cards/item-cards.json','utf8')); JSON.parse(require('fs').readFileSync('data/cards/omen-cards.json','utf8'))"` — valid JSON
- [ ] No `client/` files touched (this plan is server-only)
