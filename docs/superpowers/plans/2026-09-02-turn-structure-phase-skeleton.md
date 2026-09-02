# Turn Structure Phase Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new, purely-additive five-phase round state machine (`player_move` → `npc_move` → `player_interact` → `npc_interact` → `settlement` → back to `player_move`) to the server's game state, with a socket event for a player to lock their own phase and advance the round when everyone has locked. No existing action-handling code is touched, and there is no client UI in this plan — verification is entirely through Jest tests.

**Architecture:** A new pure-logic module, `server/src/game/phaseFlow.js`, owns the phase-order constant and all phase-transition logic (entering a phase, resetting per-phase locks, resetting action points at the start of each entity type's own "move" phase, auto-advancing through phases with zero eligible participants, advancing when everyone locks). `server/src/game/gameManager.js`'s `startGame` calls into it once at game start; a new `game:lockPhase` socket event in `server/src/socketHandlers.js` is the only new entry point a client can call. `gameState.currentPhase` is added to the existing `serializeGameState` broadcast so it's visible to clients (for future UI work, not this plan).

**Tech Stack:** Node.js server, Jest for tests. No client changes.

## Global Constraints

- Phase order is fixed and always cycles through all five in this exact order: `player_move`, `npc_move`, `player_interact`, `npc_interact`, `settlement`, then back to `player_move` (a new round).
- Classification already decided (design doc): whether an existing action belongs in which phase is **explicitly out of scope for this plan** — no existing action handler (`game:move`, `game:selectAction`, etc.) is modified, gated, or made aware of `currentPhase` in any way. The old `turnOrder`/`currentPlayerIndex`/`getCurrentTurnPlayerId` turn model in `server/src/game/turnFlow.js` is left completely untouched and keeps working exactly as it does today — the new phase system exists alongside it, unused by gameplay, for now.
- Action points: a single shared pool per player (unchanged formula, `resetActionPoints` in `server/src/game/playerEntity.js`, unchanged). It is re-rolled fresh only when entering a "move" phase (`player_move` or `npc_move`) for that phase's participants. Entering an "interact" phase never resets it (this is how movement-phase leftover carries into the interact phase). Because the next round's `player_move` always re-rolls it fresh, interact-phase leftover is naturally never carried into a new round — no separate "zero it out" step is needed.
- A phase whose eligible participants are an empty set (this applies to `npc_move`/`npc_interact` today, since Handover item 8's NPC entities don't exist in the codebase yet — nothing in `gameState.players` will ever have `isNPC: true` until that separate, later plan is implemented) must auto-advance immediately rather than deadlock, and this must cascade through multiple consecutive empty phases in the same call.
- No client UI, no countdown timer, no NPC entity creation, no retrofitting of existing action handlers — all explicitly out of scope per the design doc.

---

### Task 1: `phaseFlow.js` core state machine + unit tests

**Files:**
- Create: `server/src/game/phaseFlow.js`
- Test: `server/test/game/phaseFlow.test.js`

**Interfaces:**
- Consumes: `getPlayer` from `server/src/game/gameState.js` (existing, unchanged: `getPlayer(gameState, playerId)` returns the player object or `undefined`), `resetActionPoints` from `server/src/game/playerEntity.js` (existing, unchanged: `resetActionPoints(player)` sets `player.actionPoints` from their speed stat).
- Produces (for Task 2): `PHASE_ORDER` (array of the 5 phase-name strings, in order), `enterPhase(gameState, phase)` (sets `gameState.currentPhase`, resets that phase's participants' `phaseLocked` to `false`, re-rolls action points if it's a move phase, and auto-cascades to the next phase if there are zero eligible participants), `lockPlayerPhase(gameState, playerId)` (locks that player for the current phase and advances the round if everyone is now locked; throws `PLAYER_NOT_FOUND`, `NOT_YOUR_PHASE`, or `ALREADY_LOCKED`).

- [ ] **Step 1: Write the failing tests**

Create `server/test/game/phaseFlow.test.js` with this exact content:

```javascript
const { createGameState, addPlayer } = require('../../src/game/gameState');
const { getStatValue } = require('../../src/game/playerEntity');
const { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase } = require('../../src/game/phaseFlow');

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 }, // value 4 at baseIndex
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

const STARTING_ROOMS = [{ id: 'room_lobby_a', name: '大門廳', floor: 'ground' }];

function makeGameStateWithPlayers(playerIds) {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_new', doors: 4, floor: 'ground' }]);
  for (const playerId of playerIds) {
    addPlayer(gameState, { playerId, name: playerId, stats: makeStats() });
  }
  return gameState;
}

test('PHASE_ORDER is the 5 phases in the fixed order', () => {
  expect(PHASE_ORDER).toEqual(['player_move', 'npc_move', 'player_interact', 'npc_interact', 'settlement']);
});

test('enterPhase sets currentPhase and does not auto-advance when a real player is present and unlocked', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  expect(gameState.currentPhase).toBe('player_move');
});

test('enterPhase resets phaseLocked to false for that phase\'s participants', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.players.get('p1').phaseLocked = true; // simulate a stale lock from a previous phase
  enterPhase(gameState, 'player_move');
  expect(gameState.players.get('p1').phaseLocked).toBe(false);
});

test('enterPhase re-rolls action points for a move phase', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  player.actionPoints = 0; // simulate a spent-down pool from a previous phase
  enterPhase(gameState, 'player_move');
  expect(player.actionPoints).toBe(getStatValue(player, 'speed')); // 4, per makeStats()
});

test('enterPhase does NOT reset action points for an interact phase (movement leftover carries over)', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  player.actionPoints = 1; // leftover after spending 3 of 4 in player_move
  enterPhase(gameState, 'player_interact');
  expect(player.actionPoints).toBe(1);
});

test('enterPhase on an empty NPC phase (no NPCs exist yet) auto-advances to the next non-empty phase, cascading through both NPC phases', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'npc_move'); // zero NPC participants -- auto-advances
  expect(gameState.currentPhase).toBe('player_interact'); // the next phase that actually has participants

  gameState.players.get('p1').phaseLocked = true;
  enterPhase(gameState, 'npc_interact'); // zero NPC participants -- auto-advances
  expect(gameState.currentPhase).toBe('settlement');
});

test('advancePhase moves to the next phase in PHASE_ORDER, wrapping settlement back to player_move', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'settlement');
  advancePhase(gameState);
  expect(gameState.currentPhase).toBe('player_move'); // wrapped around -- a new round
});

test('advancePhase wrapping back to player_move re-rolls action points fresh, discarding any interact-phase leftover', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  const player = gameState.players.get('p1');
  enterPhase(gameState, 'settlement');
  player.actionPoints = 1; // leftover the design says must NOT carry into the new round
  advancePhase(gameState);
  expect(player.actionPoints).toBe(getStatValue(player, 'speed')); // 4 -- freshly rolled, not 1
});

test('lockPlayerPhase locks the player and does not advance while another participant is still unlocked', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  enterPhase(gameState, 'player_move');
  lockPlayerPhase(gameState, 'p1');
  expect(gameState.players.get('p1').phaseLocked).toBe(true);
  expect(gameState.currentPhase).toBe('player_move'); // p2 hasn't locked yet
});

test('lockPlayerPhase advances the phase once the last participant locks, cascading past the empty npc_move phase', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  enterPhase(gameState, 'player_move');
  lockPlayerPhase(gameState, 'p1');
  lockPlayerPhase(gameState, 'p2');
  // Both real players locked -> advances to npc_move -> zero NPC participants -> cascades to player_interact.
  expect(gameState.currentPhase).toBe('player_interact');
});

test('lockPlayerPhase throws PLAYER_NOT_FOUND for an unknown playerId', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  enterPhase(gameState, 'player_move');
  expect(() => lockPlayerPhase(gameState, 'ghost')).toThrow('PLAYER_NOT_FOUND');
});

test('lockPlayerPhase throws NOT_YOUR_PHASE when called during an NPC phase', () => {
  const gameState = makeGameStateWithPlayers(['p1']);
  gameState.currentPhase = 'npc_move'; // force the state directly, bypassing enterPhase's auto-cascade, to test the guard in isolation
  expect(() => lockPlayerPhase(gameState, 'p1')).toThrow('NOT_YOUR_PHASE');
});

test('lockPlayerPhase throws ALREADY_LOCKED when the same player locks twice in the same phase', () => {
  const gameState = makeGameStateWithPlayers(['p1', 'p2']);
  enterPhase(gameState, 'player_move');
  lockPlayerPhase(gameState, 'p1');
  expect(() => lockPlayerPhase(gameState, 'p1')).toThrow('ALREADY_LOCKED');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest test/game/phaseFlow.test.js`
Expected: FAIL with `Cannot find module '../../src/game/phaseFlow'`

- [ ] **Step 3: Create `server/src/game/phaseFlow.js`**

```javascript
const { getPlayer } = require('./gameState');
const { resetActionPoints } = require('./playerEntity');

const PHASE_ORDER = ['player_move', 'npc_move', 'player_interact', 'npc_interact', 'settlement'];

function requirePlayer(gameState, playerId) {
  const player = getPlayer(gameState, playerId);
  if (!player) {
    throw new Error('PLAYER_NOT_FOUND');
  }
  return player;
}

function isNpcPhase(phase) {
  return phase === 'npc_move' || phase === 'npc_interact';
}

function isMovePhase(phase) {
  return phase === 'player_move' || phase === 'npc_move';
}

// Real players participate in player_move/player_interact/settlement; NPCs
// (Handover item 8 -- not implemented in this codebase yet, so this always
// returns an empty array for npc_move/npc_interact today) participate in
// npc_move/npc_interact. There is no independent NPC confirmation step for
// settlement -- see the 2026-09-02 design doc's "結算階段" section.
function getParticipants(gameState, phase) {
  const allPlayers = Array.from(gameState.players.values());
  if (isNpcPhase(phase)) {
    return allPlayers.filter((p) => p.isNPC);
  }
  return allPlayers.filter((p) => !p.isNPC);
}

function allParticipantsLocked(gameState, phase) {
  return getParticipants(gameState, phase).every((p) => p.phaseLocked);
}

function resetPhaseLocks(gameState, phase) {
  for (const p of getParticipants(gameState, phase)) {
    p.phaseLocked = false;
  }
}

function enterPhase(gameState, phase) {
  gameState.currentPhase = phase;
  resetPhaseLocks(gameState, phase);
  if (isMovePhase(phase)) {
    // Only a move phase re-rolls action points -- this is how each entity
    // type's "round" begins fresh, and how interact-phase leftover from the
    // previous round is discarded (the roll below overwrites it) without a
    // separate reset step.
    for (const p of getParticipants(gameState, phase)) {
      resetActionPoints(p);
    }
  }
  // A phase with zero eligible participants can never receive a lock, so it
  // must auto-advance immediately -- this cascades through consecutive empty
  // phases (e.g. npc_move directly into npc_interact) via the recursive call.
  if (allParticipantsLocked(gameState, phase)) {
    advancePhase(gameState);
  }
}

function advancePhase(gameState) {
  const currentIndex = PHASE_ORDER.indexOf(gameState.currentPhase);
  const nextPhase = PHASE_ORDER[(currentIndex + 1) % PHASE_ORDER.length];
  enterPhase(gameState, nextPhase);
}

function lockPlayerPhase(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const phase = gameState.currentPhase;
  if (isNpcPhase(phase) || player.isNPC) {
    // Real players never act during an NPC phase, and an NPC entity has no
    // socket connection of its own to call this from -- NPC-phase locking
    // (an owner locking their controlled NPC) is Handover item 8's "NPC 回合
    // 的操控權授權" piece, deliberately deferred, see the design doc.
    throw new Error('NOT_YOUR_PHASE');
  }
  if (player.phaseLocked) {
    throw new Error('ALREADY_LOCKED');
  }
  player.phaseLocked = true;
  if (allParticipantsLocked(gameState, phase)) {
    advancePhase(gameState);
  }
}

module.exports = { PHASE_ORDER, enterPhase, advancePhase, lockPlayerPhase };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest test/game/phaseFlow.test.js`
Expected: PASS, 13 tests

- [ ] **Step 5: Commit**

```bash
git add server/src/game/phaseFlow.js server/test/game/phaseFlow.test.js
git commit -m "feat: add the 5-phase round state machine core (phaseFlow.js)

Purely additive -- no existing action-handling code is touched. This
is the skeleton sub-project from the 2026-09-02 turn structure design
doc: player_move -> npc_move -> player_interact -> npc_interact ->
settlement, cycling. A phase with zero eligible participants (true of
both NPC phases today, since NPC entities don't exist in the codebase
yet) auto-advances rather than deadlocking."
```

---

### Task 2: Wire into game start, expose to clients, add `game:lockPhase`

**Files:**
- Modify: `server/src/game/gameManager.js` (`startGame`)
- Modify: `server/src/game/gameState.js` (`serializeGameState`)
- Modify: `server/src/socketHandlers.js` (new `game:lockPhase` handler)
- Test: `server/test/game/gameManager.test.js`
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `PHASE_ORDER`, `enterPhase`, `lockPlayerPhase` from Task 1's `server/src/game/phaseFlow.js` (exact names/signatures as defined there).
- Produces: nothing consumed by a later task — this plan has 2 tasks total.

- [ ] **Step 1: Read the current `startGame` and confirm the exact insertion point**

Current code in `server/src/game/gameManager.js` (the tail of `startGame`, after the player-adding loop):

```javascript
  // Turn order is independent of character-pick order — a fresh, separate
  // shuffle, per the developer's explicit ruling (see M2b design doc §3).
  gameState.turnOrder = shuffle(players.map((p) => p.playerId));
  gameState.currentPlayerIndex = 0;
  manager.games.set(roomCode, gameState);
  return gameState;
}
```

- [ ] **Step 2: Write the failing test for `startGame` initializing the phase state**

`server/test/game/gameManager.test.js` already has a `baseStartArgs(overrides = {})` helper (used by every existing test in this file, e.g. `startGame(manager, 'ROOM1', baseStartArgs())`). Add this test near the existing `startGame generates a random turn order...` test:

```javascript
test('startGame initializes the phase state machine at player_move', () => {
  const manager = createGameManager();
  const gameState = startGame(manager, 'ROOM1', baseStartArgs());
  expect(gameState.currentPhase).toBe('player_move');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd server && npx jest test/game/gameManager.test.js -t "phase state machine"`
Expected: FAIL — `gameState.currentPhase` is `undefined`

- [ ] **Step 4: Wire `enterPhase` into `startGame`**

Add the import at the top of `server/src/game/gameManager.js` (alongside the existing two `require` lines):

```javascript
const { createGameState, addPlayer } = require('./gameState');
const { addItem } = require('./playerEntity');
const { enterPhase } = require('./phaseFlow');
```

Change the tail of `startGame` to:

```javascript
  // Turn order is independent of character-pick order — a fresh, separate
  // shuffle, per the developer's explicit ruling (see M2b design doc §3).
  gameState.turnOrder = shuffle(players.map((p) => p.playerId));
  gameState.currentPlayerIndex = 0;
  enterPhase(gameState, 'player_move');
  manager.games.set(roomCode, gameState);
  return gameState;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && npx jest test/game/gameManager.test.js -t "phase state machine"`
Expected: PASS

- [ ] **Step 6: Expose `currentPhase` in `serializeGameState`**

Current code in `server/src/game/gameState.js`:

```javascript
    // Set by GameManager.startGame (Task 7) once character selection is
    // done; null before that so this function stays safe to call any time.
    turnOrder: gameState.turnOrder || null,
    currentPlayerIndex: gameState.currentPlayerIndex ?? null,
  };
}
```

Change to:

```javascript
    // Set by GameManager.startGame (Task 7) once character selection is
    // done; null before that so this function stays safe to call any time.
    turnOrder: gameState.turnOrder || null,
    currentPlayerIndex: gameState.currentPlayerIndex ?? null,
    // Set by GameManager.startGame's enterPhase(gameState, 'player_move')
    // call; null before that, same reasoning as turnOrder above.
    currentPhase: gameState.currentPhase || null,
  };
}
```

- [ ] **Step 7: Write the failing test for the `game:lockPhase` socket event**

`server/test/socketHandlers.test.js` already has a `setUpStartedGame()` helper (used by the neighboring `game:endTurn` tests, search for `'game:endTurn'` to see them) that returns exactly `{ httpServer, clientA, clientB, roomCode, aliceId, bobId, currentClient, otherClient, currentPlayerId, startedPayload, gameManager }` — a 2-real-player game already past character selection. Add these two tests near the existing `game:endTurn` tests:

```javascript
test('game:lockPhase locks the calling player and advances the round once every real player has locked', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, gameManager, roomCode } = await setUpStartedGame();

  const firstLockResult = await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  expect(firstLockResult.error).toBeUndefined();
  expect(firstLockResult.currentPhase).toBe('player_move'); // still player_move -- the other player hasn't locked yet

  const secondLockResult = await new Promise((resolve) => otherClient.emit('game:lockPhase', {}, resolve));
  expect(secondLockResult.error).toBeUndefined();
  // Both real players are now locked -- player_move advances, cascades through
  // the empty npc_move phase (no NPCs exist), and lands on player_interact.
  expect(secondLockResult.currentPhase).toBe('player_interact');

  const gameState = getGameState(gameManager, roomCode);
  expect(gameState.currentPhase).toBe('player_interact');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:lockPhase rejects a second lock from the same player with ALREADY_LOCKED', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const first = await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  expect(first.error).toBeUndefined();
  const second = await new Promise((resolve) => currentClient.emit('game:lockPhase', {}, resolve));
  expect(second.error).toBe('ALREADY_LOCKED');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

`getGameState` is already imported at the top of this test file (used by the neighboring `game:move` tests) — no new import needed.

- [ ] **Step 8: Run the tests to verify they fail**

Run: `cd server && npx jest test/socketHandlers.test.js -t "game:lockPhase"`
Expected: FAIL — no handler registered for `game:lockPhase`, requests time out or the ack never fires (adjust the run if this hangs instead of failing cleanly — Ctrl+C and confirm by reading `socketHandlers.js` that no `'game:lockPhase'` listener exists yet, then proceed to Step 9 regardless)

- [ ] **Step 9: Add the `game:lockPhase` socket handler**

Add the import at the top of `server/src/socketHandlers.js`, alongside the existing `turnFlow` import line:

```javascript
const { lockPlayerPhase } = require('./game/phaseFlow');
```

Add this new handler in `server/src/socketHandlers.js`, immediately after the existing `game:endTurn` handler's closing `});` (the one at the end of the block shown below — find it by searching for `socket.on('game:endTurn'` and its matching closing brace a few lines later):

```javascript
    socket.on('game:lockPhase', (payload, callback) => {
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
        lockPlayerPhase(gameState, playerId);
        ack({ currentPhase: gameState.currentPhase });
        io.to(roomCode).emit('game:stateUpdate', serializeGameState(gameState));
      } catch (err) {
        console.error('game:lockPhase error', err);
        ack({ error: err.message || 'BAD_REQUEST' });
      }
    });
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd server && npx jest test/socketHandlers.test.js -t "game:lockPhase"`
Expected: PASS, 2 tests

- [ ] **Step 11: Run the full server test suite**

Run: `cd server && npm test`
Expected: PASS, all tests green, no regressions in any existing turn-flow/socketHandlers test (Task 1/2's changes are purely additive — no existing test's setup calls `game:lockPhase` or reads `currentPhase`, and `startGame`'s new `enterPhase` call doesn't alter `turnOrder`/`currentPlayerIndex`/any existing player field's value).

- [ ] **Step 12: Commit**

```bash
git add server/src/game/gameManager.js server/src/game/gameState.js server/src/socketHandlers.js server/test/game/gameManager.test.js server/test/socketHandlers.test.js
git commit -m "feat: wire the phase state machine into game start, add game:lockPhase

startGame now initializes gameState.currentPhase to 'player_move' via
phaseFlow's enterPhase. currentPhase is exposed in serializeGameState.
The new game:lockPhase socket event lets a player lock their own phase
and advances the round once every real player has locked (cascading
through the still-empty NPC phases automatically). No existing action
handler is touched -- the old turnOrder/currentPlayerIndex turn model
keeps working exactly as before, unaffected."
```
