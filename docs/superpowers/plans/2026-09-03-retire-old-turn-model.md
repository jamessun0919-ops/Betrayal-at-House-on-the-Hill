# Retire Old Turn Model (Stage D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `turnFlow.js`'s `advanceTurn`/`endTurn` (the functions that actually drove turn progression), while keeping the `game:endTurn` socket event as a compatibility alias that internally calls `lockPlayerPhase` — so the old turn-ownership model is genuinely retired without forcing an edit of the ~40 existing tests that use `game:endTurn` as scaffolding for unrelated features.

**Architecture:** `turnFlow.js` keeps `turnOrder`/`currentPlayerIndex`/`getCurrentTurnPlayerId` as static data (set once at game start, never advanced again) purely for `moveSummon`/`selectSummonAction`'s sake — those two functions are Handover item 8's known-broken, soon-to-be-fully-replaced summon mechanism, explicitly out of scope here. `socketHandlers.js`'s `game:endTurn` handler stops calling `endTurn()`/`advanceTurn()` and instead calls `lockPlayerPhase` directly (the same function `game:lockPhase` already calls), with a manually-preserved `SUMMON_ACTIVE` guard. Existing tests split three ways: tests whose assertions never depended on turn-switching semantics need no changes; tests that used a single `game:endTurn` call plus a "wait for the other player's view to show a new current player" idiom get rewritten to have both real players lock and assert on `currentPhase` instead; a small number of tests that rely on "start of next turn" resets (the item_038 stat-revert, the once-per-turn search gate) get rewritten around the fact that a full round is 5 phases now, not 1 immediate hand-off — completing one requires both real players to lock through `player_move` → `player_interact` → `settlement` before it wraps back to a fresh `player_move`.

**Tech Stack:** Node.js server, Jest for tests. No client changes (the client already only ever emits `game:lockPhase`, never `game:endTurn` — see the 2026-09-03 phase-UI work).

## Global Constraints

- **Terminology**: every new/changed comment or test name in this plan must say "階段" (phase) when it means one phase ending, and "回合" (round) only when it means the full 5-phase cycle completing and wrapping back to `player_move`. The old model crammed everything into one "回合," so "結束回合" used to mean "everything for this player is done" — that equivalence no longer holds, and comments must not imply it does.
- `turnOrder`/`currentPlayerIndex`/`getCurrentTurnPlayerId` are NOT deleted or modified — `gameManager.js`'s `startGame` keeps initializing them once; `getCurrentTurnPlayerId` keeps working exactly as today. They are consumed only by `moveSummon`/`selectSummonAction`, which this plan does not touch.
- `advanceTurn` and `endTurn` (the functions) are deleted from `turnFlow.js`, along with their `module.exports` entries.
- The `game:endTurn` socket event name is NOT deleted — only its internal implementation changes.
- `applyRoomEndTurnBonus` keeps being called from the `game:endTurn` handler on every successful call, unconditionally, exactly as today (it's keyed by the acting `playerId`, not by any turn/phase concept, and already has its own idempotency via `player.roomBonusesReceived` — confirmed in Task 2).
- No new error codes: the `game:endTurn` handler's `SUMMON_ACTIVE` throw is preserved verbatim; `lockPlayerPhase`'s existing `PLAYER_NOT_FOUND`/`NOT_YOUR_PHASE`/`ALREADY_LOCKED` are unchanged.
- Baseline before this plan: 22 suites / 743 tests, all passing (phase-UI + the per-round-reset regression fix are already merged).

---

### Task 1: Delete `advanceTurn`/`endTurn` from `turnFlow.js`

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Modify: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by a later task in this plan — Task 2 modifies a different file (`socketHandlers.js`) and doesn't call anything `turnFlow.js` exports for this feature.

- [ ] **Step 1: Delete the 13 tests that directly exercise `advanceTurn`/`endTurn`**

In `server/test/game/turnFlow.test.js`, delete these 13 `test(...)` blocks in full (search for each exact name):

1. `'getCurrentTurnPlayerId returns the player at the current index'` — **do NOT delete this one, it stays** (tests a function that isn't being removed). Listed here only so it isn't confused with the next one.
2. Delete: `'advanceTurn moves to the next player and wraps around at the end'`
3. Delete: `'advanceTurn throws NO_TURN_ORDER when turnOrder is missing or empty'`
4. Delete: `'advanceTurn resets the next player action points to their speed stat value'`
5. Delete: `'advanceTurn applies the next player\'s pending stat reverts and clears them'`
6. Delete: `'advanceTurn does not touch a player whose pendingStatReverts is empty'`
7. Delete: `'advanceTurn does not apply the outgoing player\'s own pendingStatReverts (only the incoming player\'s)'`
8. Delete: `'endTurn advances the turn even when the current player still has unspent actionPoints'`
9. Delete: `'endTurn throws NOT_YOUR_TURN when called by a player who is not the current turn player'`
10. Delete: `'endTurn throws SUMMON_ACTIVE when the player has an active summon'`
11. Delete: `'advanceTurn clears the outgoing player\'s summons as a safety net'`
12. Delete: `'advanceTurn resets the outgoing player\'s diceInterjectionUsedThisTurn to an empty array'`
13. Delete: `'advanceTurn resets the outgoing player\'s searchedThisTurn to false'`
14. Delete: `'advanceTurn drops the outgoing summon\'s carried item into its room instead of destroying it'`

That's 13 deletions (items 2-14 above; item 1 is a deliberate non-deletion called out to avoid confusion). The `searchedThisTurn`/`diceInterjectionUsedThisTurn` reset behavior these last two deleted tests covered already has equivalent, currently-passing coverage in `server/test/game/phaseFlow.test.js` (added in the 2026-09-03 regression fix, commit `a9ac6dc`) — deleting these leaves no coverage gap.

Also remove the now-unused `advanceTurn` and `endTurn` names from this test file's top import line (search for `require('../../src/game/turnFlow')` near the top of the file) — keep every other name in that destructured import unchanged, including `getCurrentTurnPlayerId`.

- [ ] **Step 2: Run the tests to confirm the file still passes**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: PASS. The file should now have 13 fewer tests than before this step (confirm the printed total dropped by exactly 13).

- [ ] **Step 3: Delete `advanceTurn` and `endTurn` from `server/src/game/turnFlow.js`**

Delete this entire block (currently at lines 619-658):

```javascript
function advanceTurn(gameState) {
  requireTurnOrder(gameState);
  const outgoingPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
  const outgoingPlayer = getPlayer(gameState, outgoingPlayerId);
  if (outgoingPlayer) {
    const summon = outgoingPlayer.summons;
    if (summon && summon.carryingItemId) {
      const room = getRoomAt(gameState, summon.floor, summon.x, summon.y);
      room.droppedItems.push({ id: summon.carryingItemId });
    }
    outgoingPlayer.summons = null; // safety net -- should already be null before a turn can end
    outgoingPlayer.summonUsedThisTurn = false;
    outgoingPlayer.diceInterjectionUsedThisTurn = [];
    outgoingPlayer.searchedThisTurn = false;
  }
  gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.turnOrder.length;
  const nextPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
  const nextPlayer = getPlayer(gameState, nextPlayerId);
  resetActionPoints(nextPlayer);
  // Deliberately AFTER resetActionPoints: resetActionPoints reads the stat value
  // (e.g. speed) BEFORE it gets reverted here, so a temporary buff like item_038's
  // speed boost still grants its extra action points on the very turn it wears off.
  // Reordering this would make that half of the card's effect worthless.
  for (const revert of nextPlayer.pendingStatReverts) {
    changeStat(nextPlayer, revert.stat, revert.delta, gameState.hauntStarted);
  }
  nextPlayer.pendingStatReverts = [];
  return nextPlayerId;
}

function endTurn(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (player.summons) {
    throw new Error('SUMMON_ACTIVE');
  }
  return advanceTurn(gameState);
}
```

Both the AP-reset/pendingStatReverts logic (lines' comment about "Deliberately AFTER resetActionPoints") and the `searchedThisTurn`/`diceInterjectionUsedThisTurn` resets that used to live in this block already moved to `phaseFlow.js`'s `enterPhase` in the 2026-09-03 regression fix (commit `a9ac6dc`) — nothing here needs porting anywhere. The `summons`/`summonUsedThisTurn` cleanup (dropping a carried item, clearing the summon) is deliberately NOT ported anywhere — it belongs to the old `switch_control` summon mechanism that Handover item 8 will replace wholesale.

Change the `module.exports` block at the end of the file from:

```javascript
module.exports = {
  getAvailableDirections,
  moveToRoom,
  moveSummon,
  selectAction,
  selectSummonAction,
  isTurnOver,
  getCurrentTurnPlayerId,
  advanceTurn,
  endTurn,
  canUseStairs,
  useStairs,
  resumeCollapseCheck,
  performTeleport,
  resolveTeleportDestination,
};
```

to:

```javascript
module.exports = {
  getAvailableDirections,
  moveToRoom,
  moveSummon,
  selectAction,
  selectSummonAction,
  isTurnOver,
  getCurrentTurnPlayerId,
  canUseStairs,
  useStairs,
  resumeCollapseCheck,
  performTeleport,
  resolveTeleportDestination,
};
```

- [ ] **Step 4: Run the tests to confirm the file still passes**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: PASS, same count as Step 2.

- [ ] **Step 5: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "refactor: delete advanceTurn/endTurn from turnFlow.js

These drove the old strict-turn model's progression. Nothing calls
them anymore -- Task 2 (same plan) rewires the game:endTurn socket
event to call phaseFlow's lockPlayerPhase instead. turnOrder/
currentPlayerIndex/getCurrentTurnPlayerId are kept unchanged, still
consumed by moveSummon/selectSummonAction (Handover item 8, out of
scope here). The per-round resets advanceTurn used to do (AP,
pendingStatReverts, searchedThisTurn, diceInterjectionUsedThisTurn)
already moved to phaseFlow.js's enterPhase in the 2026-09-03
regression fix; the summon cleanup it also did is deliberately not
ported anywhere, deferred to item 8's full summon-mechanism rewrite."
```

---

### Task 2: Wire `game:endTurn` to `lockPlayerPhase`, fix the tests whose assertions depended on old-model turn-switching

**Files:**
- Modify: `server/src/socketHandlers.js`
- Modify: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `lockPlayerPhase` from `server/src/game/phaseFlow.js` (already imported in `socketHandlers.js` today, used by the existing `game:lockPhase` handler — no new import needed).
- Produces: nothing consumed by a later task in this plan.

- [ ] **Step 1: Write the failing tests — rewrite the two tests whose entire premise no longer holds**

In `server/test/socketHandlers.test.js`, replace this test (currently at line 1548):

```javascript
test('game:endTurn advances the turn even when the current player still has unspent action points', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGame();

  const updatePromise = new Promise((resolve) => otherClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBeUndefined();
  expect(result.nextPlayerId).not.toBe(currentPlayerId);

  const update = await updatePromise;
  expect(update.turnOrder[update.currentPlayerIndex]).not.toBe(currentPlayerId);
  const newCurrentPlayer = update.players.find((p) => p.playerId === update.turnOrder[update.currentPlayerIndex]);
  expect(newCurrentPlayer.actionPoints).toBeGreaterThan(0); // reset by advanceTurn

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

with:

```javascript
test('game:endTurn is a legacy-named alias for game:lockPhase -- it locks the caller\'s phase and advances the round once every real player has locked', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient } = await setUpStartedGame();

  const firstResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstResult.error).toBeUndefined();
  expect(firstResult.currentPhase).toBe('player_move'); // still player_move -- the other real player hasn't locked yet

  const secondResult = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondResult.error).toBeUndefined();
  // Both real players are now locked -- the round advances, cascading through
  // the empty npc_move phase (no NPCs exist), landing on player_interact.
  expect(secondResult.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

Replace this test (currently at line 1566):

```javascript
test('game:endTurn rejects a caller who is not the current turn player', async () => {
  const { httpServer, clientA, clientB, otherClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(result.error).toBe('NOT_YOUR_TURN');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

with:

```javascript
test('game:endTurn throws ALREADY_LOCKED when the same player calls it twice in the same phase', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const first = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(first.error).toBeUndefined();
  const second = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(second.error).toBe('ALREADY_LOCKED');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

(`NOT_YOUR_TURN` no longer exists under the new model — there's no "whose turn is it" concept left. `ALREADY_LOCKED` is the new model's closest real guard on the same handler, and isn't otherwise tested against the `game:endTurn` event name specifically.)

- [ ] **Step 2: Rewrite the six tests sharing the "single caller, wait for the other client's view to show a new current player" idiom**

All six of these currently end with the same pattern: a persistent filtered `otherClient.on('game:stateUpdate', ...)` listener waiting for `data.turnOrder[data.currentPlayerIndex]` to change, then a single `currentClient.emit('game:endTurn', ...)` call, then asserting the listener resolved with a different current player. Under the new model this hangs forever (nothing changes `currentPlayerIndex` anymore, and the phase won't advance from a single lock when there are 2 real players) — replace each tail with a second `otherClient` lock call and assert on `currentPhase` instead, exactly matching Step 1's pattern.

**2a.** Replace (currently at line 1681):

```javascript
test('when a move exhausts action points, the turn does not auto-advance -- game:endTurn is required', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 2; // exactly enough to open one door, exhausting AP afterward

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // costs the flat 2 AP for opening a door
  const update = await updatePromise;

  // AP is zero, but the turn must stay with the same player until they
  // explicitly end it -- see Task 5's manual-end-turn mechanism.
  expect(update.turnOrder[update.currentPlayerIndex]).toBe(currentPlayerId);
  const me = update.players.find((p) => p.playerId === currentPlayerId);
  expect(me.actionPoints).toBe(0);

  // otherClient may still have an unconsumed copy of the stateUpdate broadcast
  // from the move above sitting in its event queue -- a plain .once() here could
  // catch that stale broadcast instead of the one from game:endTurn (same race
  // class as setUpStartedGame's game:promptResolved handling above). Use a
  // persistent, filtered listener instead so a stale event is ignored.
  const nextUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);
  const newCurrentPlayer = nextUpdate.players.find((p) => p.playerId === nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]);
  expect(newCurrentPlayer.actionPoints).toBeGreaterThan(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

with:

```javascript
test('when a move exhausts action points, the phase does not auto-advance -- locking (game:endTurn) is required', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 2; // exactly enough to open one door, exhausting AP afterward

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // costs the flat 2 AP for opening a door
  const update = await updatePromise;

  // AP is zero, but the phase must stay at player_move until both real
  // players explicitly lock it.
  expect(update.currentPhase).toBe('player_move');
  const me = update.players.find((p) => p.playerId === currentPlayerId);
  expect(me.actionPoints).toBe(0);

  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

**2b.** Replace (currently at line 2702):

```javascript
test('resolving a pending effect choice does not by itself advance the turn -- game:endTurn is still required', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;

  const respondedUpdatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });
  const respondedUpdate = await respondedUpdatePromise;
  expect(respondedUpdate.turnOrder[respondedUpdate.currentPlayerIndex]).toBe(currentPlayerId);

  // The choice is resolved now, so EFFECT_CHOICE_IN_PROGRESS no longer blocks
  // game:endTurn -- proves resolving the choice actually cleared the gate.
  // (Persistent filtered listener, not .once() -- see the race-class comment
  // on the first game:endTurn test above.)
  const nextUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

with:

```javascript
test('resolving a pending effect choice does not by itself advance the phase -- locking (game:endTurn) is still required', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;

  const respondedUpdatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });
  const respondedUpdate = await respondedUpdatePromise;
  expect(respondedUpdate.currentPhase).toBe('player_move');

  // The choice is resolved now, so EFFECT_CHOICE_IN_PROGRESS no longer blocks
  // game:endTurn -- proves resolving the choice actually cleared the gate.
  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

**2c.** Replace (currently at line 2756):

```javascript
test('a pending effect choice that times out still requires game:endTurn to advance the turn', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 50,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const timedOutUpdatePromise = new Promise((resolve) => {
    currentClient.on('game:stateUpdate', (data) => {
      const me = data.players.find((p) => p.playerId === currentPlayerId);
      if (me.stats.might.currentIndex < me.stats.might.baseIndex) resolve(data);
    });
  });
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const timedOutUpdate = await timedOutUpdatePromise;
  expect(timedOutUpdate.turnOrder[timedOutUpdate.currentPlayerIndex]).toBe(currentPlayerId);

  // Persistent filtered listener, not .once() -- see the race-class comment on
  // the first game:endTurn test above.
  const nextUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
}, 2000);
```

with:

```javascript
test('a pending effect choice that times out still requires locking (game:endTurn) to advance the phase', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'item' }],
    cards: {
      events: [],
      items: [{
        id: 'item_002',
        name: '測試選擇道具',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 50,
          defaultOptionId: 'opt_might',
        }],
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const timedOutUpdatePromise = new Promise((resolve) => {
    currentClient.on('game:stateUpdate', (data) => {
      const me = data.players.find((p) => p.playerId === currentPlayerId);
      if (me.stats.might.currentIndex < me.stats.might.baseIndex) resolve(data);
    });
  });
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const timedOutUpdate = await timedOutUpdatePromise;
  expect(timedOutUpdate.currentPhase).toBe('player_move');

  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
}, 2000);
```

**2d.** Replace (currently at line 2855):

```javascript
test('game:move into a room with an unknown drawType does not crash the room, and the turn still ends normally via game:endTurn', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'unknown_deck_type' }],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(result.error).toBeUndefined(); // moveToRoom itself succeeded

  const update = await updatePromise;
  // Despite the resolveCardDraw failure (UNKNOWN_DECK_TYPE), the room stays in
  // sync and nothing crashes -- see M2c-2 final review Important I3. The turn
  // itself no longer auto-advances (Task 5), so confirm it's still endable.
  expect(update.turnOrder[update.currentPlayerIndex]).toBe(currentPlayerId);

  // Persistent filtered listener, not .once() -- see the race-class comment on
  // the first game:endTurn test above.
  const nextUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const nextUpdate = await nextUpdatePromise;
  expect(nextUpdate.turnOrder[nextUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

with:

```javascript
test('game:move into a room with an unknown drawType does not crash the room, and the phase still locks normally via game:endTurn', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'unknown_deck_type' }],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  expect(result.error).toBeUndefined(); // moveToRoom itself succeeded

  const update = await updatePromise;
  // Despite the resolveCardDraw failure (UNKNOWN_DECK_TYPE), the room stays in
  // sync and nothing crashes -- see M2c-2 final review Important I3. The phase
  // itself no longer auto-advances, so confirm it's still lockable.
  expect(update.currentPhase).toBe('player_move');

  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

**2e.** Replace (currently at line 2895):

```javascript
test('an event-deck card requiring a choice defers the turn the same way an item-deck card does', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_002',
        name: '測試選擇事件',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  const firstUpdatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;
  const firstUpdate = await firstUpdatePromise;
  expect(firstUpdate.turnOrder[firstUpdate.currentPlayerIndex]).toBe(currentPlayerId);

  const blockedMove = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'north' }, resolve));
  expect(blockedMove.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });

  // Persistent filtered listener, not .once() -- see the race-class comment on
  // the first game:endTurn test above.
  const advancedUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const advancedUpdate = await advancedUpdatePromise;
  expect(advancedUpdate.turnOrder[advancedUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

with:

```javascript
test('an event-deck card requiring a choice defers the phase the same way an item-deck card does', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: {
      events: [{
        id: 'event_002',
        name: '測試選擇事件',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
      items: [],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  const firstUpdatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;
  const firstUpdate = await firstUpdatePromise;
  expect(firstUpdate.currentPhase).toBe('player_move');

  const blockedMove = await new Promise((resolve) => currentClient.emit('game:move', { direction: 'north' }, resolve));
  expect(blockedMove.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });

  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

**2f.** Replace (currently at line 2950):

```javascript
test('an omen-deck card requiring a choice defers the turn the same way an item-deck card does', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [],
      items: [],
      omens: [{
        id: 'omen_002',
        name: '測試選擇預兆',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  const firstUpdatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;
  const firstUpdate = await firstUpdatePromise;
  expect(firstUpdate.turnOrder[firstUpdate.currentPlayerIndex]).toBe(currentPlayerId);

  const blockedSelectAction = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item' }, resolve));
  expect(blockedSelectAction.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });

  // Persistent filtered listener, not .once() -- see the race-class comment on
  // the first game:endTurn test above.
  const advancedUpdatePromise = new Promise((resolve) => {
    otherClient.on('game:stateUpdate', (data) => {
      if (data.turnOrder[data.currentPlayerIndex] !== currentPlayerId) resolve(data);
    });
  });
  const endResult = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(endResult.error).toBeUndefined();
  const advancedUpdate = await advancedUpdatePromise;
  expect(advancedUpdate.turnOrder[advancedUpdate.currentPlayerIndex]).not.toBe(currentPlayerId);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

with:

```javascript
test('an omen-deck card requiring a choice defers the phase the same way an item-deck card does', async () => {
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'omen' }],
    cards: {
      events: [],
      items: [],
      omens: [{
        id: 'omen_002',
        name: '測試選擇預兆',
        effects: [{
          type: 'choice',
          description: '選擇要下降哪項',
          options: [
            { optionId: 'opt_might', label: '力量', effects: [{ type: 'stat_change', stat: 'might', delta: -1 }] },
            { optionId: 'opt_speed', label: '速度', effects: [{ type: 'stat_change', stat: 'speed', delta: -1 }] },
          ],
          timeoutMs: 20000,
          defaultOptionId: 'opt_might',
        }],
      }],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGameWithContent(content);

  const pendingChoicePromise = new Promise((resolve) => currentClient.once('game:effectPendingChoice', resolve));
  const firstUpdatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const pendingChoice = await pendingChoicePromise;
  const firstUpdate = await firstUpdatePromise;
  expect(firstUpdate.currentPhase).toBe('player_move');

  const blockedSelectAction = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item' }, resolve));
  expect(blockedSelectAction.error).toBe('EFFECT_CHOICE_IN_PROGRESS');

  await new Promise((resolve) => {
    currentClient.emit('game:effectPromptRespond', { promptId: pendingChoice.promptId, optionId: 'opt_speed' }, resolve);
  });

  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(firstLock.currentPhase).toBe('player_move'); // otherClient hasn't locked yet

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 3: Simplify the room-bonus non-reapplication test**

Replace (currently at line 1653):

```javascript
test('game:endTurn does not re-apply a room\'s onceOnlyPerPlayer bonus once the player has already received it', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', effects: [{ type: 'stat_change', stat: 'sanity', delta: 1, onceOnlyPerPlayer: true }] },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex + 1);

  // Cycle back around to the same player without moving them, then end turn again.
  await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex + 1); // unchanged
  expect(player.roomBonusesReceived).toEqual(['room_lobby_a']); // not duplicated

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

with:

```javascript
test('game:endTurn does not re-apply a room\'s onceOnlyPerPlayer bonus once the player has already received it', async () => {
  const content = makeContent({
    startingRooms: [
      { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
      { id: 'room_lobby_a', name: '大門廳', floor: 'ground', effects: [{ type: 'stat_change', stat: 'sanity', delta: 1, onceOnlyPerPlayer: true }] },
      { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
      { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
      { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
    ],
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);

  // applyRoomEndTurnBonus runs on every successful lock call, in any phase --
  // its own idempotency comes from player.roomBonusesReceived tracking, not
  // from any turn/phase boundary. Proving it doesn't re-apply doesn't need a
  // full round: lock player_move (bonus applies), let the other real player
  // lock too (phase advances to player_interact), then lock again there --
  // applyRoomEndTurnBonus fires a second time but must be a no-op.
  const firstLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(firstLock.error).toBeUndefined();
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex + 1);

  const secondLock = await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  expect(secondLock.error).toBeUndefined();
  expect(secondLock.currentPhase).toBe('player_interact');

  const thirdLock = await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  expect(thirdLock.error).toBeUndefined();
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex + 1); // unchanged
  expect(player.roomBonusesReceived).toEqual(['room_lobby_a']); // not duplicated

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd server && npx jest test/socketHandlers.test.js -t "game:endTurn"`
Expected: FAIL — `game:endTurn` still calls the deleted `turnFlow.js` `endTurn` function (Task 1 already removed it, so this currently throws a "not a function" style error, or if Task 1 hasn't landed yet in your working tree, the old behavior doesn't match the new assertions). Either way, these tests should not pass yet.

- [ ] **Step 5: Rewrite the `game:endTurn` handler in `server/src/socketHandlers.js`**

Replace (currently at lines 448-486):

```javascript
    socket.on('game:endTurn', (payload, callback) => {
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
        if (hasPendingEffectChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        if (hasPendingRollChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
        }
        if (hasPendingInventoryChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'INVENTORY_CHOICE_IN_PROGRESS' });
        }
        const player = getPlayer(gameState, playerId);
        const placedRoom = gameState.board[player.floor].get(coordKey(player.x, player.y));
        const roomDefinition = findRoomDefinition(content, placedRoom.roomId);
        const nextPlayerId = endTurn(gameState, playerId);
        try {
          applyRoomEndTurnBonus(io, effectResolverManager, gameState, roomCode, playerId, roomDefinition, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
        } catch (bonusErr) {
          // Same rationale as the resolveCardDraw catch below -- a bad room
          // bonus definition must not prevent the turn from having already
          // advanced, or skip the state broadcast.
          console.error('applyRoomEndTurnBonus error', bonusErr);
        }
        ack({ nextPlayerId });
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:endTurn error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });
```

with:

```javascript
    // Legacy event name, kept as a compatibility alias for game:lockPhase so
    // the ~40 existing tests that use it as scaffolding for unrelated
    // features didn't all need editing when the old turn model retired
    // (2026-09-03) -- it does NOT mean "end my turn" anymore (there is no
    // single "turn" left, only phases within a round), it means "lock my
    // current phase," exactly like game:lockPhase below.
    socket.on('game:endTurn', (payload, callback) => {
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
        if (hasPendingEffectChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'EFFECT_CHOICE_IN_PROGRESS' });
        }
        if (hasPendingRollChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'ROLL_CHOICE_IN_PROGRESS' });
        }
        if (hasPendingInventoryChoice(effectResolverManager, roomCode)) {
          return ack({ error: 'INVENTORY_CHOICE_IN_PROGRESS' });
        }
        const player = getPlayer(gameState, playerId);
        if (player.summons) {
          // This guard used to live inside turnFlow.js's endTurn() itself;
          // moved here since that function no longer exists.
          return ack({ error: 'SUMMON_ACTIVE' });
        }
        const placedRoom = gameState.board[player.floor].get(coordKey(player.x, player.y));
        const roomDefinition = findRoomDefinition(content, placedRoom.roomId);
        lockPlayerPhase(gameState, playerId);
        try {
          applyRoomEndTurnBonus(io, effectResolverManager, gameState, roomCode, playerId, roomDefinition, effectChoiceTimeouts, content, rollChoiceTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
        } catch (bonusErr) {
          // Same rationale as the resolveCardDraw catch below -- a bad room
          // bonus definition must not prevent the phase from having already
          // locked, or skip the state broadcast.
          console.error('applyRoomEndTurnBonus error', bonusErr);
        }
        ack({ currentPhase: gameState.currentPhase });
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:endTurn error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });
```

`lockPlayerPhase` is already imported at the top of this file (used by the existing `game:lockPhase` handler immediately below this one) — no new import needed.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npx jest test/socketHandlers.test.js -t "game:endTurn"`
Expected: PASS.

- [ ] **Step 7: Run the full server test suite**

Run: `cd server && npm test`
Expected: some failures remain — the 2 tests handled in Task 3 (item_038 revert, search-reset) are not yet fixed by this task. Confirm the ONLY failures are those two (search the failure output for `item_038` and `search the same room again` to confirm), and that everything else passes. If any OTHER test fails, stop and report it rather than guessing a fix — this plan's Global Constraints/investigation covered every `game:endTurn` call site, so an unexpected failure elsewhere means something was missed.

- [ ] **Step 8: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "refactor: rewire game:endTurn to lockPlayerPhase, keep the event name as an alias

The old turn-ownership check (NOT_YOUR_TURN) is genuinely gone --
game:endTurn now does exactly what game:lockPhase does, just under
its legacy name, to avoid rewriting the ~40 existing tests that use
it as scaffolding for unrelated features. SUMMON_ACTIVE is preserved
as a manual guard in the handler (used to live inside turnFlow.js's
now-deleted endTurn()). Ack shape changes from {nextPlayerId} to
{currentPhase}, matching game:lockPhase's own handler.

Rewrote the 8 tests whose assertions depended on old single-active-
player turn-switching semantics (a lone caller flipping whose turn it
is) to instead have both real players lock and assert on currentPhase,
matching the already-proven game:lockPhase test pattern. Deleted one
test whose entire premise (NOT_YOUR_TURN) no longer exists, replacing
it with an ALREADY_LOCKED test on the same event name."
```

---

### Task 3: Rewrite the two tests that depend on full-round completion

**Files:**
- Modify: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `game:endTurn` (Task 2's alias for `lockPlayerPhase`) — no production code changes in this task, tests only.
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Add a shared full-round-completion helper**

In `server/test/socketHandlers.test.js`, find where other shared test helper functions are defined near the top of the file (e.g. `setUpStartedGame`, `makeContent`) and add this new helper alongside them:

```javascript
// A round is 5 phases (player_move -> npc_move -> player_interact ->
// npc_interact -> settlement), not 1 immediate hand-off like the old turn
// model. With 2 real players and no NPCs, npc_move/npc_interact
// auto-cascade, so completing one full round takes 3 pairs of locks (6
// total game:endTurn calls). Needed only by tests that verify per-ROUND
// resets (e.g. item_038's stat revert, the once-per-round search gate) --
// those only fire when player_move is re-entered, not on every phase lock.
async function completeFullRound(currentClient, otherClient) {
  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve)); // lock player_move
  await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve)); // -> player_interact
  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve)); // lock player_interact
  await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve)); // -> settlement
  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve)); // lock settlement
  return new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve)); // -> wraps to a fresh player_move
}
```

- [ ] **Step 2: Rewrite the item_038 revert test**

Replace (currently at line 3272):

```javascript
test('game:selectAction item_038 sets might to the non-lethal floor and speed to max, reverting both at the start of the user\'s next turn', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_038',
        name: '可疑藥丸',
        effects: [
          { type: 'stat_change', stat: 'might', setToLevel: 'min', revertAtNextTurnStart: true },
          { type: 'stat_change', stat: 'speed', setToLevel: 'max', revertAtNextTurnStart: true },
        ],
        category: 'consumable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_038' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_038' }, resolve));
  await effectResolvedPromise;

  let me = getPlayer(gameState, currentPlayerId);
  expect(me.stats.might.currentIndex).toBe(1); // skullIndex 0 + 1
  expect(me.stats.speed.currentIndex).toBe(4); // track.length 5 - 1
  expect(me.inventory).toEqual([]); // consumed

  // The user ends their own turn -- now it's the other player's turn. Not reverted yet.
  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  me = getPlayer(gameState, currentPlayerId);
  expect(me.stats.might.currentIndex).toBe(1);
  expect(me.stats.speed.currentIndex).toBe(4);

  // The other player ends their turn -- it cycles back to the item_038 user. Reverted now.
  await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  me = getPlayer(gameState, currentPlayerId);
  expect(me.stats.might.currentIndex).toBe(2); // baseIndex, reverted
  expect(me.stats.speed.currentIndex).toBe(2); // baseIndex, reverted

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

with:

```javascript
test('game:selectAction item_038 sets might to the non-lethal floor and speed to max, reverting both at the start of the user\'s next round', async () => {
  const content = makeContent({
    cards: {
      events: [],
      items: [{
        id: 'item_038',
        name: '可疑藥丸',
        effects: [
          { type: 'stat_change', stat: 'might', setToLevel: 'min', revertAtNextTurnStart: true },
          { type: 'stat_change', stat: 'speed', setToLevel: 'max', revertAtNextTurnStart: true },
        ],
        category: 'consumable',
        canTargetOthers: false,
      }],
      omens: [],
    },
  });
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_038' });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_038' }, resolve));
  await effectResolvedPromise;

  let me = getPlayer(gameState, currentPlayerId);
  expect(me.stats.might.currentIndex).toBe(1); // skullIndex 0 + 1
  expect(me.stats.speed.currentIndex).toBe(4); // track.length 5 - 1
  expect(me.inventory).toEqual([]); // consumed

  // A round is 5 phases, not 1 immediate hand-off -- both real players must
  // lock through player_move, player_interact, and settlement before the
  // round wraps back to a fresh player_move, which is the only place the
  // revert fires (moved there from the old turnFlow.js advanceTurn in the
  // 2026-09-03 regression fix). Not reverted partway through.
  const finalLock = await completeFullRound(currentClient, otherClient);
  expect(finalLock.currentPhase).toBe('player_move');
  me = getPlayer(gameState, currentPlayerId);
  expect(me.stats.might.currentIndex).toBe(2); // baseIndex, reverted
  expect(me.stats.speed.currentIndex).toBe(2); // baseIndex, reverted

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 3: Rewrite the search-reset-next-turn test**

Replace (currently at line 4110):

```javascript
test('game:selectAction room_action: a player can search the same room again on their next turn, after searching it once and ending the turn', async () => {
  const content = makeSearchRoomContent(['item_001', 'item_002']);
  content.cards.items = [
    { id: 'item_001', name: '測試道具1', effects: [] },
    { id: 'item_002', name: '測試道具2', effects: [] },
  ];
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  // Turn 1: search once, get one of the two listed items.
  const firstFoundPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  const firstFound = await firstFoundPromise;

  // Same-turn second search is rejected (already covered by another test);
  // end the turn, let the other player also end theirs, and cycle back.
  await new Promise((resolve) => currentClient.emit('game:endTurn', {}, resolve));
  await new Promise((resolve) => otherClient.emit('game:endTurn', {}, resolve));
  getPlayer(gameState, currentPlayerId).actionPoints = 1; // restore AP for the second search

  // Turn 2 (same player, same room, no move needed -- they never left):
  // search again and get the other listed item.
  const secondFoundPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const secondFound = await secondFoundPromise;

  const remainingId = ['item_001', 'item_002'].find((id) => id !== firstFound.cardId);
  expect(secondFound.cardId).toBe(remainingId);
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual(
    expect.arrayContaining([{ id: 'item_001' }, { id: 'item_002' }])
  );

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

with:

```javascript
test('game:selectAction room_action: a player can search the same room again on their next round, after searching it once and completing a round', async () => {
  const content = makeSearchRoomContent(['item_001', 'item_002']);
  content.cards.items = [
    { id: 'item_001', name: '測試道具1', effects: [] },
    { id: 'item_002', name: '測試道具2', effects: [] },
  ];
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId, gameManager, roomCode } = await setUpStartedGameWithContent(content);

  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // enters room_new
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).actionPoints = 1;

  // Round 1: search once, get one of the two listed items.
  const firstFoundPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  const firstFound = await firstFoundPromise;

  // Same-round second search is rejected (already covered by another test);
  // a round is 5 phases, not 1 immediate hand-off -- both real players must
  // lock through player_move, player_interact, and settlement before the
  // round wraps back to a fresh player_move, which is the only place
  // searchedThisTurn resets (moved there from the old turnFlow.js
  // advanceTurn in the 2026-09-03 regression fix).
  const finalLock = await completeFullRound(currentClient, otherClient);
  expect(finalLock.currentPhase).toBe('player_move');
  getPlayer(gameState, currentPlayerId).actionPoints = 1; // restore AP for the second search

  // Round 2 (same player, same room, no move needed -- they never left):
  // search again and get the other listed item.
  const secondFoundPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  const result = await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'room_action' }, resolve));
  expect(result.error).toBeUndefined();
  const secondFound = await secondFoundPromise;

  const remainingId = ['item_001', 'item_002'].find((id) => id !== firstFound.cardId);
  expect(secondFound.cardId).toBe(remainingId);
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual(
    expect.arrayContaining([{ id: 'item_001' }, { id: 'item_002' }])
  );

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 4: Run the full server test suite**

Run: `cd server && npm test`
Expected: PASS, all suites green, 0 failures. Test count should be the same as the pre-Task-1 baseline minus 13 (Task 1's deletions) — starting from 743, expect **730 tests**.

- [ ] **Step 5: Commit**

```bash
git add server/test/socketHandlers.test.js
git commit -m "test: rewrite item_038 revert and search-reset tests for full-round completion

Both used to rely on 'A ends turn, B ends turn, back to A's turn' to
reach 'the start of A's next turn' -- under the phase model that
concept is 'the start of A's next ROUND', which requires both real
players to lock through all 5 phases (3 lock-pairs), not 2 single
calls. Added a shared completeFullRound test helper."
```

---

### Task 4: Dead code cleanup after the new mechanism has fully taken over

**Files:**
- Modify: `server/src/game/turnFlow.js` (if needed)
- Modify: `server/src/socketHandlers.js` (if needed)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing.

- [ ] **Step 1: Check for now-unused imports in `server/src/game/turnFlow.js`**

Run: `cd server && grep -n "changeStat" src/game/turnFlow.js`

`changeStat` was used only inside the now-deleted `advanceTurn`. If this grep shows it's no longer referenced anywhere else in the file (only the `require(...)` line itself matches), remove `changeStat` from that file's top `require('./playerEntity')` destructure. If it IS still used elsewhere in the file (e.g. by `item_038`'s `setToLevel` handling or another existing feature), leave the import as-is — do not remove something still in use.

- [ ] **Step 2: Check for now-unused imports in `server/src/socketHandlers.js`**

Run: `cd server && grep -n "\bendTurn\b" src/socketHandlers.js`

Confirm the only remaining match is the `socket.on('game:endTurn', ...)` event-name string itself (not a call to a function named `endTurn`) — Task 2 already removed the `endTurn(gameState, playerId)` call. If `endTurn` was ever destructured from this file's `require('./game/turnFlow')` import line, confirm it's already gone (Task 1 removed it from `turnFlow.js`'s exports, so requiring it would now be `undefined` — if it's still listed in the import, remove it). Same check for `advanceTurn` — confirm it was never imported into this file at all (it shouldn't have been, since only the handler called `endTurn`, not `advanceTurn` directly), and if it somehow is, remove it.

- [ ] **Step 3: Search the whole server codebase for orphaned references to the deleted functions**

Run: `cd server && grep -rn "advanceTurn\|turnFlow.endTurn\|require.*turnFlow.*endTurn" src/`

Expected: no matches (or only matches inside comments that are still accurate, e.g. a comment mentioning "the old advanceTurn" as historical context — those are fine to leave, they're documentation, not dead code). If you find an actual live code reference to either deleted function outside `turnFlow.js` itself, stop and report it rather than guessing why it's still needed — this plan's own investigation (Tasks 1-3) should have already accounted for every real caller.

- [ ] **Step 4: Search for now-orphaned error-code strings**

Run: `cd server && grep -rn "NOT_YOUR_TURN" src/ client/src/`

`NOT_YOUR_TURN` was thrown only by the now-deleted `endTurn` function. Confirm no production code still throws or checks for it. If the client has any error-message mapping for `NOT_YOUR_TURN` (e.g. a lookup table translating error codes to user-facing text), leave it in place — an unused entry in a lookup table is harmless and removing it isn't this task's concern (it's not dead *code*, just a dead *entry*); only report back if you find something that looks like actual dead code (a function, branch, or handler) built around this string.

- [ ] **Step 5: Run the full test suite one more time to confirm nothing broke from any cleanup made in Steps 1-2**

Run: `cd server && npm test`
Expected: PASS, same 730 tests as Task 3's Step 4, 0 failures.

- [ ] **Step 6: Commit (only if Steps 1-2 actually removed anything)**

If no imports needed removing, skip this commit — say so in your report instead of creating an empty commit.

```bash
git add server/src/game/turnFlow.js server/src/socketHandlers.js
git commit -m "chore: remove imports left unused after retiring advanceTurn/endTurn"
```
