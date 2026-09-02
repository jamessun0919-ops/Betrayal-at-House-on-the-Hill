# Phase-Gate Movement Actions (Stage A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old strict-turn ownership check (`getCurrentTurnPlayerId`/`NOT_YOUR_TURN`) in `turnFlow.js`'s `moveToRoom` and `useStairs` with a new phase-based check (`requirePhase`, gating on `gameState.currentPhase === 'player_move'` and `player.phaseLocked`), and fix every existing test that assumed the old model for these two functions.

**Architecture:** A new exported function `requirePhase(gameState, playerId, expectedPhase)` in `server/src/game/phaseFlow.js` becomes the single reusable gate: throws `PLAYER_NOT_FOUND`/`NOT_YOUR_PHASE`/`ALREADY_LOCKED` (reusing the exact error codes `lockPlayerPhase` already uses — no new error codes). `turnFlow.js`'s `moveToRoom` and `useStairs` each replace their old ownership check with one call to `requirePhase(gameState, playerId, 'player_move')`. No other function in `turnFlow.js` is touched (this is Stage A of a 4-stage plan — `selectAction`/`endTurn`/`moveSummon`/`selectSummonAction` are Stage B/C/D or explicitly out of scope, see the design doc).

**Tech Stack:** Node.js server, Jest for tests. No client changes.

## Global Constraints

- Only `server/src/game/phaseFlow.js` and `server/src/game/turnFlow.js` get new production code. `selectAction`, `endTurn`, `moveSummon`, `selectSummonAction` are NOT touched by this plan — their existing `NOT_YOUR_TURN` checks stay exactly as they are today.
- `requirePhase` reuses the two error codes `lockPlayerPhase` already throws (`NOT_YOUR_PHASE`, `ALREADY_LOCKED`) plus the existing `PLAYER_NOT_FOUND` — do not introduce any new error code string.
- `requirePhase` does its own independent player lookup (mirroring how `lockPlayerPhase` already does its own lookup in the same file) rather than depending on `turnFlow.js`'s `requirePlayer` — `phaseFlow.js` must keep depending only on `gameState.js`/`playerEntity.js`, never on `turnFlow.js` (established in the 2026-09-02 phase-skeleton plan and must not regress here).
- After this plan ships, in a real multi-player game `moveToRoom`/`useStairs` become callable by ANY real, unlocked player at any time (no longer restricted to "whoever's turn it is") — this is an intentional, already-documented known effect (see the design doc's "已知影響與風險" section), not a bug to guard against in this plan.
- Known ripple effect that this plan must fix, not just tolerate: `server/test/game/turnFlow.test.js`'s shared `makeGameStateWithPlayer` helper does not set `gameState.currentPhase` at all today, so every existing test using it would start failing with `NOT_YOUR_PHASE` once `moveToRoom`/`useStairs` gate on phase. Fixing the helper (Task 2, Step 1) is required for this plan's tests to pass, and keeps roughly 40 existing, currently-passing tests in that file green.

---

### Task 1: `requirePhase` in `phaseFlow.js` + unit tests

**Files:**
- Modify: `server/src/game/phaseFlow.js`
- Test: `server/test/game/phaseFlow.test.js`

**Interfaces:**
- Consumes: `requirePlayer` (phaseFlow.js's own local, unexported helper — already exists, defined at the top of the file, do not duplicate it).
- Produces (for Task 2): `requirePhase(gameState, playerId, expectedPhase)` — throws `Error('PLAYER_NOT_FOUND')` if the player doesn't exist, `Error('NOT_YOUR_PHASE')` if the player is an NPC or `gameState.currentPhase !== expectedPhase`, `Error('ALREADY_LOCKED')` if `player.phaseLocked` is true. Returns `undefined` on success (callers do their own separate player lookup for business logic, same pattern `turnFlow.js` already uses for its own `requirePlayer`).

- [ ] **Step 1: Write the failing tests**

Add these 5 tests to the end of `server/test/game/phaseFlow.test.js` (the file currently ends after the `'lockPlayerPhase throws ALREADY_LOCKED when the same player locks twice in the same phase'` test — append after it):

```javascript
test('requirePhase does not throw when the player is in the expected phase and unlocked', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  expect(() => requirePhase(gameState, 'p1', 'player_move')).not.toThrow();
});

test('requirePhase throws PLAYER_NOT_FOUND for an unknown playerId', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  expect(() => requirePhase(gameState, 'ghost', 'player_move')).toThrow('PLAYER_NOT_FOUND');
});

test('requirePhase throws NOT_YOUR_PHASE when the current phase does not match expectedPhase', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  expect(() => requirePhase(gameState, 'p1', 'player_interact')).toThrow('NOT_YOUR_PHASE');
});

test('requirePhase throws NOT_YOUR_PHASE for an NPC player even if currentPhase matches expectedPhase', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  gameState.players.get('p1').isNPC = true;
  expect(() => requirePhase(gameState, 'p1', 'player_move')).toThrow('NOT_YOUR_PHASE');
});

test('requirePhase throws ALREADY_LOCKED when the player has already locked the current phase', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']); // 2 players so p1 locking alone doesn't auto-advance the phase
  enterPhase(gameState, 'player_move');
  lockPlayerPhase(gameState, 'p1');
  expect(() => requirePhase(gameState, 'p1', 'player_move')).toThrow('ALREADY_LOCKED');
});
```

Also update the import line at the top of the file (line 3) from:

```javascript
const { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase } = require('../../src/game/phaseFlow');
```

to:

```javascript
const { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase, requirePhase } = require('../../src/game/phaseFlow');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest test/game/phaseFlow.test.js`
Expected: FAIL — `requirePhase is not a function` (or `undefined is not a function`) on the 5 new tests; the 13 pre-existing tests in this file still pass.

- [ ] **Step 3: Add `requirePhase` to `server/src/game/phaseFlow.js`**

Add this function after `lockPlayerPhase` (before the `module.exports` line):

```javascript
// Gate for the existing action functions in turnFlow.js (moveToRoom,
// useStairs, and eventually selectAction's sub-branches) -- replaces the old
// getCurrentTurnPlayerId ownership check with a phase-based one. Reuses the
// same two error codes lockPlayerPhase already throws (NOT_YOUR_PHASE,
// ALREADY_LOCKED) rather than inventing new ones, since both mean the same
// thing to a caller: the current phase state doesn't allow this right now.
function requirePhase(gameState, playerId, expectedPhase) {
  const player = requirePlayer(gameState, playerId);
  if (player.isNPC || gameState.currentPhase !== expectedPhase) {
    throw new Error('NOT_YOUR_PHASE');
  }
  if (player.phaseLocked) {
    throw new Error('ALREADY_LOCKED');
  }
}
```

Change the `module.exports` line from:

```javascript
module.exports = { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase };
```

to:

```javascript
module.exports = { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase, requirePhase };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest test/game/phaseFlow.test.js`
Expected: PASS, 18 tests (13 pre-existing + 5 new)

- [ ] **Step 5: Commit**

```bash
git add server/src/game/phaseFlow.js server/test/game/phaseFlow.test.js
git commit -m "feat: add requirePhase gate to phaseFlow.js

Reuses the existing NOT_YOUR_PHASE/ALREADY_LOCKED error codes lockPlayerPhase
already throws. Nothing calls this yet -- Task 2 wires it into
turnFlow.js's moveToRoom/useStairs."
```

---

### Task 2: Wire `requirePhase` into `moveToRoom`/`useStairs`, fix ripple effects on existing tests

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Modify: `server/test/game/turnFlow.test.js`
- Modify: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `requirePhase(gameState, playerId, expectedPhase)` from Task 1's `server/src/game/phaseFlow.js` (exact signature/throw behavior as defined there).
- Produces: nothing consumed by a later task — this plan (Stage A) ends here. Stage B (`selectAction`) is a separate future plan.

- [ ] **Step 1: Fix the shared test helper first (before touching production code)**

In `server/test/game/turnFlow.test.js`, the `makeGameStateWithPlayer` helper (used by nearly every test in this file) does not set `gameState.currentPhase`. Once `moveToRoom`/`useStairs` gate on `currentPhase === 'player_move'`, every existing test using this helper would break. Fix it now so the rest of this task's changes don't cause a wall of unrelated failures.

Change:

```javascript
function makeGameStateWithPlayer(drawableRooms) {
  const gameState = createGameState(STARTING_ROOMS, drawableRooms || [{ id: 'room_new', doors: 4, floor: 'ground' }]);
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  // Default to a solo turn order so p1 is always the current turn player,
  // unless a test overrides this to specifically exercise turn-order logic.
  gameState.turnOrder = ['p1'];
  gameState.currentPlayerIndex = 0;
  return { gameState, player };
}
```

to:

```javascript
function makeGameStateWithPlayer(drawableRooms) {
  const gameState = createGameState(STARTING_ROOMS, drawableRooms || [{ id: 'room_new', doors: 4, floor: 'ground' }]);
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  // Default to a solo turn order so p1 is always the current turn player,
  // unless a test overrides this to specifically exercise turn-order logic.
  gameState.turnOrder = ['p1'];
  gameState.currentPlayerIndex = 0;
  // moveToRoom/useStairs now gate on the phase system (requirePhase) instead
  // of turnOrder -- default every test into player_move so existing callers
  // keep passing without each test having to set this up itself.
  gameState.currentPhase = 'player_move';
  return { gameState, player };
}
```

- [ ] **Step 2: Run the full file to confirm this alone changes nothing yet**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: PASS, same test count as before this task (this step only adds a field nothing reads yet)

- [ ] **Step 3: Write the failing tests for the new phase-gated behavior**

Replace this test (search for it, it's the one right before `test('selectAction deducts 1 action point...`):

```javascript
test('moveToRoom throws NOT_YOUR_TURN when called by a player who is not the current turn player', () => {
  const { gameState } = makeGameStateWithPlayer();
  addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0; // p1's turn
  expect(() => moveToRoom(gameState, 'p2', 'east')).toThrow('NOT_YOUR_TURN');
});
```

with:

```javascript
test('moveToRoom throws NOT_YOUR_PHASE when the current phase is not player_move', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.currentPhase = 'player_interact';
  expect(() => moveToRoom(gameState, 'p1', 'east')).toThrow('NOT_YOUR_PHASE');
});

test('moveToRoom throws ALREADY_LOCKED when the player has already locked their phase', () => {
  const { gameState } = makeGameStateWithPlayer();
  gameState.players.get('p1').phaseLocked = true;
  expect(() => moveToRoom(gameState, 'p1', 'east')).toThrow('ALREADY_LOCKED');
});

test('moveToRoom no longer restricts by turn order -- a second real player can move too, as long as the phase and lock state allow it', () => {
  const { gameState } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0; // still "p1's turn" under the old model, which moveToRoom no longer consults
  gameState.board.ground.set('-1,1', { roomId: 'room_manual', x: -1, y: 1, doorSides: ['north', 'east', 'south', 'west'] });
  const result = moveToRoom(gameState, 'p2', 'west');
  expect(result).toEqual({ kind: 'move', x: -1, y: 1, enteredNewRoom: true });
  expect(player2.x).toBe(-1);
  expect(player2.y).toBe(1);
});
```

Also replace this test (search for it, right after `test('useStairs throws STAIRS_NOT_AVAILABLE...`):

```javascript
test('useStairs throws NOT_YOUR_TURN when called by a player who is not the current turn player', () => {
  const { gameState } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player2.x = 0;
  player2.y = -1; // room_lobby_c
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0; // p1's turn
  expect(() => useStairs(gameState, 'p2')).toThrow('NOT_YOUR_TURN');
});
```

with:

```javascript
test('useStairs throws NOT_YOUR_PHASE when the current phase is not player_move', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.x = 0;
  player.y = -1; // room_lobby_c
  gameState.currentPhase = 'player_interact';
  expect(() => useStairs(gameState, 'p1')).toThrow('NOT_YOUR_PHASE');
});

test('useStairs throws ALREADY_LOCKED when the player has already locked their phase', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  player.x = 0;
  player.y = -1; // room_lobby_c
  player.phaseLocked = true;
  expect(() => useStairs(gameState, 'p1')).toThrow('ALREADY_LOCKED');
});

test('useStairs no longer restricts by turn order -- a second real player can use stairs too, as long as the phase and lock state allow it', () => {
  const { gameState } = makeGameStateWithPlayer();
  const player2 = addPlayer(gameState, { playerId: 'p2', name: 'Bob', stats: makeStats() });
  player2.x = 0;
  player2.y = -1; // room_lobby_c
  gameState.turnOrder = ['p1', 'p2'];
  gameState.currentPlayerIndex = 0; // still "p1's turn" under the old model, which useStairs no longer consults
  const result = useStairs(gameState, 'p2');
  expect(result).toEqual({ kind: 'stairs', floor: 'upper', x: 0, y: 0 });
});
```

- [ ] **Step 4: Run the tests to verify the new ones fail**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: FAIL — the 6 new tests fail (moveToRoom/useStairs still throw `NOT_YOUR_TURN`/don't throw at all, not `NOT_YOUR_PHASE`/`ALREADY_LOCKED`); all other tests in the file still pass.

- [ ] **Step 5: Wire `requirePhase` into `moveToRoom` and `useStairs`**

Add the import at the top of `server/src/game/turnFlow.js`, alongside the existing `require('./gameState')` line:

```javascript
const { getPlayer } = require('./gameState');
const { requirePhase } = require('./phaseFlow');
```

In `moveToRoom`, change:

```javascript
function moveToRoom(gameState, playerId, direction, leaveCheck = null, rollOptions = {}) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (player.actionPoints < 1) {
```

to:

```javascript
function moveToRoom(gameState, playerId, direction, leaveCheck = null, rollOptions = {}) {
  const player = requirePlayer(gameState, playerId);
  requirePhase(gameState, playerId, 'player_move');
  if (player.actionPoints < 1) {
```

In `useStairs`, change:

```javascript
function useStairs(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  if (getCurrentTurnPlayerId(gameState) !== playerId) {
    throw new Error('NOT_YOUR_TURN');
  }
  if (player.summons) {
```

to:

```javascript
function useStairs(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  requirePhase(gameState, playerId, 'player_move');
  if (player.summons) {
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: PASS, all tests in the file green (same total count as Step 2, since 2 tests were replaced by 6, net +4)

- [ ] **Step 7: Fix the one socket-level test that also asserted the old behavior**

In `server/test/socketHandlers.test.js`, replace:

```javascript
test('game:move rejects a caller who is not the current turn player', async () => {
  const { httpServer, clientA, clientB, otherClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    otherClient.emit('game:move', { direction: 'east' }, resolve);
  });
  expect(result.error).toBe('NOT_YOUR_TURN');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

with:

```javascript
test('game:move no longer restricts by turn order -- either real player can move once phase-gated instead of turn-gated', async () => {
  const { httpServer, clientA, clientB, otherClient } = await setUpStartedGame();

  const result = await new Promise((resolve) => {
    otherClient.emit('game:move', { direction: 'east' }, resolve);
  });
  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('open_door');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

This works because `setUpStartedGame()` uses the real `startGame` flow, which already calls `enterPhase(gameState, 'player_move')` (from the 2026-09-02 phase-skeleton plan) — `otherClient`'s player is a real, unlocked player, so the move now succeeds instead of being rejected.

- [ ] **Step 8: Run the full server test suite**

Run: `cd server && npm test`
Expected: PASS, all suites green. Starting from the 717-test baseline: Task 1 added 5 net new tests (13 → 18 in `phaseFlow.test.js`); this task's Step 3 replaced 2 tests with 6 in `turnFlow.test.js` (net +4) and replaced 1 test with 1 in `socketHandlers.test.js` (net +0). Total: 717 + 5 + 4 + 0 = **726 tests**, 0 regressions.

- [ ] **Step 9: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js server/test/socketHandlers.test.js
git commit -m "feat: phase-gate moveToRoom and useStairs, replacing turn-order gating

moveToRoom/useStairs now gate on gameState.currentPhase === 'player_move'
and player.phaseLocked via phaseFlow's requirePhase, instead of the old
getCurrentTurnPlayerId ownership check. selectAction/endTurn are untouched
(Stage B/C/D of the 2026-09-02 classification design doc).

Known effect (documented in the design doc): in a real multi-player game,
any real unlocked player can now move/use stairs at any time, since
gameState.currentPhase never advances without client UI (a later
sub-project) calling game:lockPhase. Solo play (today's manual test
workflow) is unaffected."
```
