# Phase-Gate selectAction (Stage B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `turnFlow.js`'s `selectAction` dispatcher's single top-level strict-turn ownership check (`getCurrentTurnPlayerId`/`NOT_YOUR_TURN`) with per-branch phase gates (`requirePhase`, from the already-merged Stage A work), so each of its sub-actions is gated by the correct phase — `player_move` for self-contained actions, `player_interact` for actions that target another player.

**Architecture:** `requirePhase(gameState, playerId, expectedPhase)` (in `server/src/game/phaseFlow.js`, already implemented and merged in Stage A) is called once per branch inside `selectAction`, before that branch's own business-logic checks (access-control-first, matching Stage A's ordering). The dynamic branch (generic item use with no `mode`) computes its target first, then picks `player_move` or `player_interact` based on whether the target is the caller themself. `endTurn`, `moveSummon`, and `selectSummonAction` are NOT touched — they remain on the old model, for a later stage.

**Tech Stack:** Node.js server, Jest for tests. No client changes.

## Global Constraints

- `selectAction`'s existing `INVALID_ACTION_TYPE` and `NOT_ENOUGH_ACTION_POINTS` checks stay at the top of the function, in their current position and order — they are phase-independent and unchanged.
- Every `requirePhase` call happens before that branch's own business-logic checks (e.g. `ITEM_NOT_HELD`, `TARGET_NOT_IN_ROOM`) — access control fires first, matching the ordering `moveToRoom`/`useStairs` already use.
- Phase classification (fixed, from the 2026-09-02 classification design doc): `player_move` — `mode: 'leave'/'pickup'/'wield'/'unwield'/'wear'/'unwear'`, `actionType: 'room_action'`, and the generic item-use path when the target is the caller themself. `player_interact` — `mode: 'give'`, the generic item-use path when the target is a different player, and `actionType: 'attack'`.
- No new error codes — every `requirePhase` call reuses the existing `PLAYER_NOT_FOUND`/`NOT_YOUR_PHASE`/`ALREADY_LOCKED` from `phaseFlow.js`.
- `endTurn`, `moveSummon`, `selectSummonAction` in `server/src/game/turnFlow.js` are NOT touched — they keep using `getCurrentTurnPlayerId`/`NOT_YOUR_TURN` exactly as today.
- This plan does this all in one task (not split across multiple plans or tasks) — the production change and its ripple-effect test fixes are one indivisible correctness question, per the developer's explicit scoping decision.
- Baseline before this plan: 22 suites / 726 tests, all passing (Stage A already merged).

---

### Task 1: Phase-gate `selectAction`'s dispatcher branches

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Modify: `server/test/game/turnFlow.test.js`
- Modify: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `requirePhase(gameState, playerId, expectedPhase)` from `server/src/game/phaseFlow.js` (already implemented in Stage A — throws `PLAYER_NOT_FOUND`/`NOT_YOUR_PHASE`/`ALREADY_LOCKED`, returns `undefined` on success).
- Produces: nothing consumed by a later task — this plan (Stage B) ends here. Stage C (AP ownership handover) is a separate future plan.

- [ ] **Step 1: Write the new failing tests for phase-gated `selectAction`**

In `server/test/game/turnFlow.test.js`, find this existing test (it currently asserts behavior that will no longer be true — `selectAction` will no longer check turn order at all):

```javascript
test('selectAction throws NOT_YOUR_TURN when called by a player who is not the current turn player', () => {
  const { gameState } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0; // p1's turn
  expect(() => selectAction(gameState, 'p2', 'item')).toThrow('NOT_YOUR_TURN');
});
```

Replace it with these 14 tests:

```javascript
test('selectAction throws NOT_YOUR_PHASE for mode:leave when not in player_move', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  expect(() => selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'leave' })).toThrow('NOT_YOUR_PHASE');
});

test('selectAction throws NOT_YOUR_PHASE for mode:pickup when not in player_move', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  expect(() => selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'pickup' })).toThrow('NOT_YOUR_PHASE');
});

test('selectAction throws NOT_YOUR_PHASE for mode:wield when not in player_move', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  expect(() => selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'wield' })).toThrow('NOT_YOUR_PHASE');
});

test('selectAction throws NOT_YOUR_PHASE for mode:unwield when not in player_move', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  expect(() => selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'unwield' })).toThrow('NOT_YOUR_PHASE');
});

test('selectAction throws NOT_YOUR_PHASE for mode:wear when not in player_move', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  expect(() => selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'wear' })).toThrow('NOT_YOUR_PHASE');
});

test('selectAction throws NOT_YOUR_PHASE for mode:unwear when not in player_move', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  expect(() => selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'unwear' })).toThrow('NOT_YOUR_PHASE');
});

test('selectAction throws NOT_YOUR_PHASE for room_action when not in player_move', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  expect(() => selectAction(gameState, 'p1', 'room_action', { hasRoomAction: true })).toThrow('NOT_YOUR_PHASE');
});

test('selectAction throws NOT_YOUR_PHASE for a self-targeted item action when not in player_move', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  expect(() => selectAction(gameState, 'p1', 'item', { itemId: 'item_003' })).toThrow('NOT_YOUR_PHASE');
});

test('selectAction throws NOT_YOUR_PHASE for mode:give when not in player_interact', () => {
  const { gameState } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'give', targetPlayerId: 'p2' })
  ).toThrow('NOT_YOUR_PHASE');
});

test('selectAction throws NOT_YOUR_PHASE for an other-targeted item action when not in player_interact, even with itemCanTargetOthers', () => {
  const { gameState } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_003', targetPlayerId: 'p2', itemCanTargetOthers: true })
  ).toThrow('NOT_YOUR_PHASE');
});

test('selectAction throws NOT_YOUR_PHASE for attack when not in player_interact', () => {
  const { gameState } = makeGameStateWithPlayer();
  expect(() => selectAction(gameState, 'p1', 'attack')).toThrow('NOT_YOUR_PHASE');
});

test('selectAction throws ALREADY_LOCKED for a move-type action when the player has already locked their phase', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.phaseLocked = true;
  expect(() => selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'wear' })).toThrow('ALREADY_LOCKED');
});

test('selectAction throws ALREADY_LOCKED for mode:give when the player has already locked their phase', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  gameState.currentPhase = 'player_interact';
  player.phaseLocked = true;
  expect(() =>
    selectAction(gameState, 'p1', 'item', { itemId: 'item_003', mode: 'give', targetPlayerId: 'p2' })
  ).toThrow('ALREADY_LOCKED');
});

test('selectAction no longer restricts by turn order -- a second real player can act too, as long as the phase and lock state allow it', () => {
  const { gameState } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0; // still "p1's turn" under the old model, which selectAction no longer consults
  const result = selectAction(gameState, 'p2', 'room_action', { hasRoomAction: true });
  expect(result).toEqual({ kind: 'room_action' });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: FAIL — the 14 new tests fail (`selectAction` still throws `NOT_YOUR_TURN`/doesn't throw `NOT_YOUR_PHASE`/`ALREADY_LOCKED` yet); all other tests in the file still pass except the 9 existing tests that Step 4 will fix (they currently pass because `selectAction` still checks the old model, which is satisfied by the default single-player turn order these tests set up).

- [ ] **Step 3: Rewrite `selectAction` in `server/src/game/turnFlow.js`**

No new import is needed — `requirePhase` is already imported at the top of this file from Stage A (`const { requirePhase } = require('./phaseFlow');`). This step only replaces the function body. Replace the entire function:

```javascript
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
    const { itemId, targetPlayerId, mode, itemCategory } = options;
    if (mode === 'give') {
      return giveItemAction(gameState, player, itemId, targetPlayerId, itemCategory);
    }
    if (mode === 'leave') {
      return leaveItemAction(gameState, player, itemId, itemCategory);
    }
    if (mode === 'pickup') {
      return pickupItemAction(gameState, player, itemId);
    }
    if (mode === 'wield') {
      return wieldItemAction(gameState, player, itemId, itemCategory);
    }
    if (mode === 'unwield') {
      return unwieldItemAction(gameState, player, itemId);
    }
    if (mode === 'wear') {
      return wearItemAction(gameState, player, itemId, itemCategory);
    }
    if (mode === 'unwear') {
      return unwearItemAction(gameState, player, itemId);
    }
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
    // Unreachable via the real socket path since the search mechanic (2026-08-18):
    // socketHandlers.js's room_action branch always sets hasRoomAction true --
    // craftRecipes/effects claim it, and any room that has neither defaults to
    // the search branch. Kept (and still unit-tested directly) as a defensive
    // guard, not a dead check to remove -- a future actionType or caller that
    // doesn't go through that branch selection would still need this.
    if (!options.hasRoomAction) {
      throw new Error('NO_ROOM_ACTION_AVAILABLE');
    }
    // Some room actions (e.g. the entrance-hall stairs rooms) are declared
    // free, matching the pre-existing "stairs cost no action points" rule --
    // most room actions (e.g. the vault's dice check) still cost 1.
    if (!options.freeRoomAction) {
      player.actionPoints -= 1;
    }
    return { kind: 'room_action' };
  }

  player.actionPoints -= 1;
  // "attack" is still a stub — M3 (combat) resolves it.
  return { kind: actionType, pending: true };
}
```

with:

```javascript
function selectAction(gameState, playerId, actionType, options = {}) {
  const player = requirePlayer(gameState, playerId);
  if (!ACTION_TYPES.includes(actionType)) {
    throw new Error('INVALID_ACTION_TYPE');
  }
  if (player.actionPoints < 1) {
    throw new Error('NOT_ENOUGH_ACTION_POINTS');
  }

  if (actionType === 'item') {
    const { itemId, targetPlayerId, mode, itemCategory } = options;
    if (mode === 'give') {
      requirePhase(gameState, playerId, 'player_interact');
      return giveItemAction(gameState, player, itemId, targetPlayerId, itemCategory);
    }
    if (mode === 'leave') {
      requirePhase(gameState, playerId, 'player_move');
      return leaveItemAction(gameState, player, itemId, itemCategory);
    }
    if (mode === 'pickup') {
      requirePhase(gameState, playerId, 'player_move');
      return pickupItemAction(gameState, player, itemId);
    }
    if (mode === 'wield') {
      requirePhase(gameState, playerId, 'player_move');
      return wieldItemAction(gameState, player, itemId, itemCategory);
    }
    if (mode === 'unwield') {
      requirePhase(gameState, playerId, 'player_move');
      return unwieldItemAction(gameState, player, itemId);
    }
    if (mode === 'wear') {
      requirePhase(gameState, playerId, 'player_move');
      return wearItemAction(gameState, player, itemId, itemCategory);
    }
    if (mode === 'unwear') {
      requirePhase(gameState, playerId, 'player_move');
      return unwearItemAction(gameState, player, itemId);
    }
    const effectTargetId = targetPlayerId || playerId;
    requirePhase(gameState, playerId, effectTargetId === playerId ? 'player_move' : 'player_interact');
    if (!player.inventory.some((item) => item.id === itemId)) {
      throw new Error('ITEM_NOT_HELD');
    }
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
    requirePhase(gameState, playerId, 'player_move');
    // Unreachable via the real socket path since the search mechanic (2026-08-18):
    // socketHandlers.js's room_action branch always sets hasRoomAction true --
    // craftRecipes/effects claim it, and any room that has neither defaults to
    // the search branch. Kept (and still unit-tested directly) as a defensive
    // guard, not a dead check to remove -- a future actionType or caller that
    // doesn't go through that branch selection would still need this.
    if (!options.hasRoomAction) {
      throw new Error('NO_ROOM_ACTION_AVAILABLE');
    }
    // Some room actions (e.g. the entrance-hall stairs rooms) are declared
    // free, matching the pre-existing "stairs cost no action points" rule --
    // most room actions (e.g. the vault's dice check) still cost 1.
    if (!options.freeRoomAction) {
      player.actionPoints -= 1;
    }
    return { kind: 'room_action' };
  }

  requirePhase(gameState, playerId, 'player_interact');
  player.actionPoints -= 1;
  // "attack" is still a stub — M3 (combat) resolves it.
  return { kind: actionType, pending: true };
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: the 14 new tests PASS. Several pre-existing tests now FAIL — specifically the ones exercising `mode: 'give'`, an other-targeted item action, or `actionType: 'attack'` as a *positive* (non-throwing) case, because the shared `makeGameStateWithPlayer` helper defaults `gameState.currentPhase` to `'player_move'` (set in Stage A), and these actions now require `'player_interact'`. Step 5 fixes them. This is expected — do not treat it as a regression to investigate further, just proceed to Step 5.

- [ ] **Step 5: Fix the existing tests that need `player_interact` phase**

In `server/test/game/turnFlow.test.js`, these 9 existing tests call an action that is now classified as `player_interact` (`mode: 'give'`, an other-targeted item use, or `actionType: 'attack'`) but rely on the helper's default `player_move` phase. Each needs one line added: `gameState.currentPhase = 'player_interact';`, placed immediately after the `const { gameState, ... } = makeGameStateWithPlayer();` line.

Test 1 — search for `'selectAction deducts 1 action point and returns a pending marker for attack (still a stub)'`:

```javascript
test('selectAction deducts 1 action point and returns a pending marker for attack (still a stub)', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const startingAP = player.actionPoints;
```

becomes:

```javascript
test('selectAction deducts 1 action point and returns a pending marker for attack (still a stub)', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  const startingAP = player.actionPoints;
```

Test 2 — search for `'selectAction item: succeeds targeting another player in the same room when itemCanTargetOthers is true'`:

```javascript
test('selectAction item: succeeds targeting another player in the same room when itemCanTargetOthers is true', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  // addPlayer always places new players at the entrance hall (0,0), same as p1.
  player.inventory.push({ id: 'item_003' });
```

becomes:

```javascript
test('selectAction item: succeeds targeting another player in the same room when itemCanTargetOthers is true', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  // addPlayer always places new players at the entrance hall (0,0), same as p1.
  player.inventory.push({ id: 'item_003' });
```

Test 3 — search for `'selectAction item: throws ITEM_CANNOT_TARGET_OTHERS when targeting another player without permission'`:

```javascript
test('selectAction item: throws ITEM_CANNOT_TARGET_OTHERS when targeting another player without permission', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.inventory.push({ id: 'item_010' });
```

becomes:

```javascript
test('selectAction item: throws ITEM_CANNOT_TARGET_OTHERS when targeting another player without permission', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player.inventory.push({ id: 'item_010' });
```

Test 4 — search for `'selectAction item: throws TARGET_NOT_IN_ROOM when the target is elsewhere, even with itemCanTargetOthers'`:

```javascript
test('selectAction item: throws TARGET_NOT_IN_ROOM when the target is elsewhere, even with itemCanTargetOthers', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player2.x = 5; // move p2 out of the entrance hall
  player.inventory.push({ id: 'item_003' });
```

becomes:

```javascript
test('selectAction item: throws TARGET_NOT_IN_ROOM when the target is elsewhere, even with itemCanTargetOthers', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player2.x = 5; // move p2 out of the entrance hall
  player.inventory.push({ id: 'item_003' });
```

Test 5 — search for `'selectAction item mode:give transfers the item to a same-room target player'`:

```javascript
test('selectAction item mode:give transfers the item to a same-room target player', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_003' });
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
```

becomes:

```javascript
test('selectAction item mode:give transfers the item to a same-room target player', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  player.inventory.push({ id: 'item_003' });
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
```

Test 6 — search for `'selectAction item mode:give clears the giver\'s wieldedWeaponId when giving away the wielded weapon'`:

```javascript
test('selectAction item mode:give clears the giver\'s wieldedWeaponId when giving away the wielded weapon', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_001' });
  player.wieldedWeaponId = 'item_001';
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
```

becomes:

```javascript
test('selectAction item mode:give clears the giver\'s wieldedWeaponId when giving away the wielded weapon', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  player.inventory.push({ id: 'item_001' });
  player.wieldedWeaponId = 'item_001';
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
```

Test 7 — search for `'selectAction item mode:give clears the giver\'s wornGearIds when giving away a worn gear item'`:

```javascript
test('selectAction item mode:give clears the giver\'s wornGearIds when giving away a worn gear item', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_008' });
  player.wornGearIds = ['item_008'];
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
```

becomes:

```javascript
test('selectAction item mode:give clears the giver\'s wornGearIds when giving away a worn gear item', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  player.inventory.push({ id: 'item_008' });
  player.wornGearIds = ['item_008'];
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
```

Test 8 — search for `'selectAction item mode:give throws TARGET_NOT_IN_ROOM when the target is elsewhere'`:

```javascript
test('selectAction item mode:give throws TARGET_NOT_IN_ROOM when the target is elsewhere', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'item_003' });
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  other.floor = player.floor;
  other.x = player.x + 99;
```

becomes:

```javascript
test('selectAction item mode:give throws TARGET_NOT_IN_ROOM when the target is elsewhere', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  player.inventory.push({ id: 'item_003' });
  const other = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  other.floor = player.floor;
  other.x = player.x + 99;
```

Test 9 — search for `'selectAction item mode:give throws IMPRINT_CANNOT_BE_GIVEN for an imprint-category card'`:

```javascript
test('selectAction item mode:give throws IMPRINT_CANNOT_BE_GIVEN for an imprint-category card', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.inventory.push({ id: 'omen_002' });
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
```

becomes:

```javascript
test('selectAction item mode:give throws IMPRINT_CANNOT_BE_GIVEN for an imprint-category card', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  player.inventory.push({ id: 'omen_002' });
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
```

- [ ] **Step 6: Run the file again to verify only the socket-level tests remain**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: PASS, all tests in the file green.

- [ ] **Step 7: Fix the 3 affected tests in `server/test/socketHandlers.test.js`**

Test 1 — search for `'game:selectAction spends 1 action point, broadcasts game:pendingAction, and updates state'`:

```javascript
test('game:selectAction spends 1 action point, broadcasts game:pendingAction, and updates state', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  // 'attack' is the only actionType still a stub (item/room_action get real
  // logic in M2c-4) -- this test's original intent was "still a stub", not
  // "specifically item".
  const pendingActionPromise = new Promise((resolve) => currentClient.once('game:pendingAction', resolve));
```

becomes:

```javascript
test('game:selectAction spends 1 action point, broadcasts game:pendingAction, and updates state', async () => {
  const { httpServer, clientA, clientB, currentClient, gameManager, roomCode } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  gameState.currentPhase = 'player_interact';

  // 'attack' is the only actionType still a stub (item/room_action get real
  // logic in M2c-4) -- this test's original intent was "still a stub", not
  // "specifically item".
  const pendingActionPromise = new Promise((resolve) => currentClient.once('game:pendingAction', resolve));
```

`getGameState` is already imported at the top of this test file (used by the neighboring `game:move`/`game:lockPhase` tests) — no new import needed.

Test 2 — search for `'game:selectAction item mode:give transfers an item to a same-room player via socket'`:

```javascript
test('game:selectAction item mode:give transfers an item to a same-room player via socket', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGame();
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' });
```

becomes:

```javascript
test('game:selectAction item mode:give transfers an item to a same-room player via socket', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGame();
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  gameState.currentPhase = 'player_interact';
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_003' });
```

Test 3 — search for `'game:selectAction item mode:give rejects an imprint-category card even if the client omits itemCategory'`:

```javascript
test('game:selectAction item mode:give rejects an imprint-category card even if the client omits itemCategory', async () => {
  const content = makeContent({
    cards: { events: [], items: [], omens: [{ id: 'omen_002', name: '古書', category: 'imprint', effects: [] }] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'omen_002' });
```

becomes:

```javascript
test('game:selectAction item mode:give rejects an imprint-category card even if the client omits itemCategory', async () => {
  const content = makeContent({
    cards: { events: [], items: [], omens: [{ id: 'omen_002', name: '古書', category: 'imprint', effects: [] }] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, aliceId, bobId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const otherPlayerId = currentPlayerId === aliceId ? bobId : aliceId;
  const gameState = getGameState(gameManager, roomCode);
  gameState.currentPhase = 'player_interact';
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'omen_002' });
```

The two tests in this file asserting `ROLL_CHOICE_IN_PROGRESS`/`INVENTORY_CHOICE_IN_PROGRESS` for `game:selectAction` with `actionType: 'attack'` do **not** need any change — `socketHandlers.js`'s `game:selectAction` handler checks `hasPendingRollChoice`/`hasPendingInventoryChoice` before ever calling into `turnFlow.js`'s `selectAction`, so those tests never reach the new phase-gating logic at all.

- [ ] **Step 8: Run the full server test suite**

Run: `cd server && npm test`
Expected: PASS, all suites green. Starting from the 726-test baseline: Step 1 replaced 1 test with 14 (net +13). No other test count changes (Steps 5 and 7 only add one line each to existing tests, they don't add or remove tests). Total: 726 + 13 = **739 tests**, 0 regressions.

- [ ] **Step 9: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js server/test/socketHandlers.test.js
git commit -m "feat: phase-gate selectAction's dispatcher branches

selectAction no longer checks getCurrentTurnPlayerId at all -- each
sub-action now calls requirePhase with the phase its own classification
requires (player_move for self-contained actions: leave/pickup/wield/
unwield/wear/unwear/room_action/self-targeted item use; player_interact
for actions that target another player: give/other-targeted item use/
attack). endTurn/moveSummon/selectSummonAction are untouched (Stage C/D
of the 2026-09-02 classification design doc, and Handover item 8's NPC
work respectively).

Same known effect as Stage A: in a real multi-player game, any real
unlocked player can now perform any of these actions at any time,
since gameState.currentPhase never advances without client UI. Solo
play (today's manual test workflow) is unaffected."
```
