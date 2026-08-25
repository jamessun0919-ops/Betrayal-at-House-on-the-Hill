# 遊戲訊息彈窗流程與機制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface room-entry, event/omen-trigger, and item-use outcomes as sequential popups (extending the existing `pendingCheckQueue`/`CheckModal` mechanism), and upgrade the existing dice-check result screen to show each card's own `feedbacktextDice` text (with a `ROLLDICE.mp4` animation) instead of a generic pass/fail sentence.

**Architecture:** Server adds one new boolean field (`enteredNewRoom`) to the existing `game:roomEntered` broadcast and one new lightweight broadcast (`game:itemUseResolved`) — both carry only IDs, no card text. All card/room text lookups (`description`/`text`/`feedbacktextDice`/`feedbacktextOccur`) happen **client-side** from the already-available static `cardContent`/`roomContent` reference data, since that data already contains every field verbatim (confirmed: `cardContent` is sent unfiltered from `content.cards.*`). This avoids duplicating text-matching logic in two languages and avoids any new server round-trip for display text.

**Tech Stack:** Node.js/Express/Socket.IO (server), React/Vite (client), Jest (server tests only — this project has no frontend test runner, confirmed by `client/package.json` having no `test` script and zero `*.test.jsx` files anywhere in the repo).

## Global Constraints

- Scope is sections 1 (room/event popups) and 2 (item-use popups) of `docs/superpowers/specs/2026-08-25-game-message-popup-design.md` only. Sections 3/4 (attack/counter-attack) are explicitly out of scope — no code for them in this plan.
- Missing `feedbacktextDice`/`feedbacktextOccur` on a card must display the literal fallback string `待補充`.
- Room-based checks (`leaveCheck`/`collapseCheck`) never get `feedbacktextDice` text (rooms don't have this field) — their result screen stays exactly as it is today.
- Server tests: `cd server && npm test` (Jest). Every server task must end with the full suite green, not just the new test file.
- Frontend tasks have no automated test suite: verify with `cd client && npm run build` (must succeed with no errors) plus a manual browser check via the dev server (`npm run dev` in `client/`, paired with `npm start` in `server/`). Do not write `*.test.jsx` files — none exist in this project and none should be introduced by this plan.
- `developersketch/ROLLDICE.mp4` is the developer's personal staging folder (never committed by the agent). Copying it into `client/public/videos/roll-dice.mp4` is a one-time file copy, not a git-tracked "generate" step — `client/public/` is a normal tracked directory, so the copied video WILL be committed as part of this plan's frontend task, which is expected and matches how other static assets in `client/public/` are already tracked.
- Do not touch `data/cards/event-cards.json` while implementing this plan — it currently has the developer's own uncommitted edits (unrelated to this feature); leave it untouched and unstaged.

---

### Task 1: `playerEntity.js` — `movePlayerTo` reports first-visit

**Files:**
- Modify: `server/src/game/playerEntity.js:117-128`
- Test: `server/test/game/playerEntity.test.js`

**Interfaces:**
- Produces: `movePlayerTo(player, floor, x, y, enteredFromSide)` now **returns `true`** when `(floor,x,y)` was not already in `player.visitedRooms` before this call (i.e. this is the player's first visit to that room), **`false`** otherwise. Return value used by Task 2.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/game/playerEntity.test.js`, right after the existing `test('movePlayerTo does not add a duplicate entry when returning to an already-visited room', ...)` block (currently ending at line 186):

```javascript
test('movePlayerTo returns true when moving into a room not yet in visitedRooms', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  const result = movePlayerTo(player, 'ground', 1, 0);
  expect(result).toBe(true);
});

test('movePlayerTo returns false when moving back into an already-visited room', () => {
  const player = createPlayer({ playerId: 'p1', name: 'Alice', floor: 'ground', x: 0, y: 0, stats: makeStats(), actionPoints: 0 });
  movePlayerTo(player, 'ground', 1, 0);
  const result = movePlayerTo(player, 'ground', 0, 0);
  expect(result).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest playerEntity -t "movePlayerTo returns"`
Expected: FAIL (`movePlayerTo` currently returns `undefined`, not `true`/`false`).

- [ ] **Step 3: Implement**

In `server/src/game/playerEntity.js`, replace lines 117-128:

```javascript
function movePlayerTo(player, floor, x, y, enteredFromSide = null) {
  player.floor = floor;
  player.x = x;
  player.y = y;
  player.enteredFromSide = enteredFromSide;
  const alreadyVisited = player.visitedRooms.some(
    (r) => r.floor === floor && r.x === x && r.y === y
  );
  if (!alreadyVisited) {
    player.visitedRooms.push({ floor, x, y });
  }
  return !alreadyVisited;
}
```

(Only the added `return !alreadyVisited;` line at the end is new — nothing else in the function body changes.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest playerEntity`
Expected: PASS, all tests in the file including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add server/src/game/playerEntity.js server/test/game/playerEntity.test.js
git commit -m "feat: movePlayerTo reports whether this was the player's first visit"
```

---

### Task 2: Thread `enteredNewRoom` through to `game:roomEntered`

**Files:**
- Modify: `server/src/game/turnFlow.js:131-134` (move branch), `server/src/game/turnFlow.js:209-227` (2 open_door returns), `server/src/game/turnFlow.js:338-343` (`performTeleport`)
- Modify: `server/src/game/effectResolver.js:57-70` (`handleMoveToRoom`), `server/src/game/effectResolver.js:282-314` (`resolveEffects`)
- Modify: `server/src/socketHandlers.js:311` (teleport emit), `server/src/socketHandlers.js:352` (move_to_room-effect emit), `server/src/socketHandlers.js:793` (move/open_door emit), `server/src/socketHandlers.js:1143-1151` (`resumeCollapseCheckRollChoice`'s hand-built result)
- Test: `server/test/game/turnFlow.test.js` (update 4 existing assertions), `server/test/socketHandlers.test.js` (extend 3 existing tests)

**Interfaces:**
- Consumes: `movePlayerTo`'s return value from Task 1.
- Produces: every `game:roomEntered` broadcast now includes `enteredNewRoom: boolean` — `true` when this is the receiving player's first time in that room, `false` on a revisit. Consumed by Task 5 (client).

**Why this needs 4 separate touch-points, not just "the move function":** `game:roomEntered` is emitted from 3 different places in `socketHandlers.js` (plain move/open_door, teleport, and a `move_to_room` card effect like the entrance-hall stairs), and one of those (the collapse-fall-through resumption) builds its result object by hand instead of calling `moveToRoom`. Open-door rooms are *always* a first visit by construction (a freshly-placed board tile can't already be in `visitedRooms`), so those get `enteredNewRoom: true` hardcoded rather than threaded — there's nothing to compute.

- [ ] **Step 1: `turnFlow.js` — move branch (line 131-134)**

Replace:
```javascript
  if (choice.kind === 'move') {
    movePlayerTo(player, player.floor, targetCoord.x, targetCoord.y, OPPOSITE_SIDE[direction]);
    player.actionPoints -= 1;
    return { kind: 'move', x: targetCoord.x, y: targetCoord.y, ...(leaveCheckResult ? { leaveCheckResult } : {}) };
  }
```
with:
```javascript
  if (choice.kind === 'move') {
    const enteredNewRoom = movePlayerTo(player, player.floor, targetCoord.x, targetCoord.y, OPPOSITE_SIDE[direction]);
    player.actionPoints -= 1;
    return { kind: 'move', x: targetCoord.x, y: targetCoord.y, enteredNewRoom, ...(leaveCheckResult ? { leaveCheckResult } : {}) };
  }
```

- [ ] **Step 2: `turnFlow.js` — the 2 `open_door` returns (lines 209-227)**

Replace:
```javascript
    return {
      kind: 'open_door',
      x: placedRoom.x,
      y: placedRoom.y,
      roomId: placedRoom.roomId,
      pendingCardDraw,
      collapseResult,
      ...(leaveCheckResult ? { leaveCheckResult } : {}),
    };
  }

  return {
    kind: 'open_door',
    x: placedRoom.x,
    y: placedRoom.y,
    roomId: placedRoom.roomId,
    pendingCardDraw,
    ...(leaveCheckResult ? { leaveCheckResult } : {}),
  };
}
```
with:
```javascript
    return {
      kind: 'open_door',
      x: placedRoom.x,
      y: placedRoom.y,
      roomId: placedRoom.roomId,
      pendingCardDraw,
      collapseResult,
      enteredNewRoom: true,
      ...(leaveCheckResult ? { leaveCheckResult } : {}),
    };
  }

  return {
    kind: 'open_door',
    x: placedRoom.x,
    y: placedRoom.y,
    roomId: placedRoom.roomId,
    pendingCardDraw,
    enteredNewRoom: true,
    ...(leaveCheckResult ? { leaveCheckResult } : {}),
  };
}
```
(The `collapseCheckPending` return above these two, at lines 195-204, is untouched — it's a pending state, no room-entered broadcast happens until it resolves.)

- [ ] **Step 3: `turnFlow.js` — `performTeleport` (lines 338-343)**

Replace:
```javascript
function performTeleport(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const destination = resolveTeleportDestination(gameState, playerId);
  movePlayerTo(player, destination.floor, destination.x, destination.y, null);
  return destination;
}
```
with:
```javascript
function performTeleport(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const destination = resolveTeleportDestination(gameState, playerId);
  const enteredNewRoom = movePlayerTo(player, destination.floor, destination.x, destination.y, null);
  return { ...destination, enteredNewRoom };
}
```

- [ ] **Step 4: `effectResolver.js` — `handleMoveToRoom` (lines 57-70)**

Replace:
```javascript
function handleMoveToRoom(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  for (const floor of Object.keys(gameState.board)) {
    const grid = gameState.board[floor];
    if (!(grid instanceof Map)) continue;
    for (const room of grid.values()) {
      if (room.roomId === effect.targetRoomId) {
        movePlayerTo(player, floor, room.x, room.y);
        return { pending: false };
      }
    }
  }
  throw new Error('TARGET_ROOM_NOT_FOUND');
}
```
with:
```javascript
function handleMoveToRoom(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  for (const floor of Object.keys(gameState.board)) {
    const grid = gameState.board[floor];
    if (!(grid instanceof Map)) continue;
    for (const room of grid.values()) {
      if (room.roomId === effect.targetRoomId) {
        const enteredNewRoom = movePlayerTo(player, floor, room.x, room.y);
        return { pending: false, enteredNewRoom };
      }
    }
  }
  throw new Error('TARGET_ROOM_NOT_FOUND');
}
```

- [ ] **Step 5: `effectResolver.js` — `resolveEffects` merge (lines 282-314)**

Replace:
```javascript
function resolveEffects(gameState, promptState, playerId, effects, context = {}) {
  if (!Array.isArray(effects)) {
    throw new Error('INVALID_EFFECTS_LIST');
  }
  requirePlayer(gameState, playerId);
  let appliedCount = 0;
  let drawnCards = [];
  let diceCheckResult = null;
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
  }
  const output = { pending: false, appliedCount };
  if (drawnCards.length > 0) {
    output.drawnCards = drawnCards;
  }
  if (diceCheckResult) {
    output.diceCheckResult = diceCheckResult;
  }
  return output;
```
with:
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
```
(Only the 3 added blocks — `let enteredNewRoom = null;`, the `if (result && result.enteredNewRoom...)` check inside the loop, and the `if (enteredNewRoom !== null)` block before `return output` — are new. The function signature, the `return result;` early-exit line, and everything else stay exactly as they are.)

- [ ] **Step 6: `socketHandlers.js` — the 3 `game:roomEntered` emit sites plus the hand-built collapse-resume result**

At line 311 (teleport branch), replace:
```javascript
            io.to(roomCode).emit('game:roomEntered', { playerId, roomId: enteredRoom.roomId });
```
with:
```javascript
            io.to(roomCode).emit('game:roomEntered', { playerId, roomId: enteredRoom.roomId, enteredNewRoom: destination.enteredNewRoom });
```

At line 352 (move_to_room effect branch), replace:
```javascript
              io.to(roomCode).emit('game:roomEntered', { playerId: targetForEffects, roomId: moveToRoomEffect.targetRoomId });
```
with:
```javascript
              io.to(roomCode).emit('game:roomEntered', { playerId: targetForEffects, roomId: moveToRoomEffect.targetRoomId, enteredNewRoom: effectResult.enteredNewRoom });
```

At line 793 (plain move/open_door branch), replace:
```javascript
    io.to(roomCode).emit('game:roomEntered', { playerId, roomId: enteredRoom.roomId });
```
with:
```javascript
    io.to(roomCode).emit('game:roomEntered', { playerId, roomId: enteredRoom.roomId, enteredNewRoom: result.enteredNewRoom });
```

At lines 1143-1151 (`resumeCollapseCheckRollChoice`'s hand-built result — this is always a first visit, the room was just freshly placed by the collapse), replace:
```javascript
  const result = {
    kind: 'open_door',
    x: room.x,
    y: room.y,
    roomId: room.roomId,
    pendingCardDraw: resumeContext.pendingCardDraw,
    collapseResult,
    ...(resumeContext.leaveCheckResult ? { leaveCheckResult: resumeContext.leaveCheckResult } : {}),
  };
```
with:
```javascript
  const result = {
    kind: 'open_door',
    x: room.x,
    y: room.y,
    roomId: room.roomId,
    pendingCardDraw: resumeContext.pendingCardDraw,
    collapseResult,
    enteredNewRoom: true,
    ...(resumeContext.leaveCheckResult ? { leaveCheckResult: resumeContext.leaveCheckResult } : {}),
  };
```

- [ ] **Step 7: Update the 4 existing `turnFlow.test.js` assertions broken by the new `enteredNewRoom` field**

These use strict `toEqual` on the full result object, so the new field must be added to each expected object. All 4 move into `(-1,1)` for a player whose `visitedRooms` doesn't yet include it — so `enteredNewRoom: true` in every case.

At line 108-109:
```javascript
  const result = moveToRoom(gameState, 'p1', 'west');
  expect(result).toEqual({ kind: 'move', x: -1, y: 1, enteredNewRoom: true });
```

At lines 180-186:
```javascript
  const result = moveToRoom(gameState, 'p1', 'west', { stat: 'might', min: 3 }, { rng });
  expect(result).toEqual({
    kind: 'move',
    x: -1,
    y: 1,
    enteredNewRoom: true,
    leaveCheckResult: { stat: 'might', roomId: 'room_lobby_a', rolled: 6, required: 3, passed: true },
  });
```

At lines 209-215:
```javascript
  const retryResult = moveToRoom(gameState, 'p1', 'west', { stat: 'might', min: 3 }, { rng: passRng });
  expect(retryResult).toEqual({
    kind: 'move',
    x: -1,
    y: 1,
    enteredNewRoom: true,
    leaveCheckResult: { stat: 'might', roomId: 'room_lobby_a', rolled: 6, required: 3, passed: true },
  });
```

At lines 319-325:
```javascript
  const result = moveToRoom(gameState, 'p1', 'west', { stat: 'might', min: 3 }, { resolvedRoll: 6, itemCatalog });
  expect(result).toEqual({
    kind: 'move',
    x: -1,
    y: 1,
    enteredNewRoom: true,
    leaveCheckResult: { stat: 'might', roomId: 'room_lobby_a', rolled: 6, required: 3, passed: true },
  });
```

- [ ] **Step 8: Run the full server suite to check for other breakage**

Run: `cd server && npm test`
Expected: All 4 updated tests pass; check the failure list (if any) for any other `toEqual` on a `moveToRoom`/`performTeleport`/`handleMoveToRoom` result you haven't seen — if one turns up, add `enteredNewRoom` to its expected object the same way. Do not proceed to Step 9 until the suite is fully green.

- [ ] **Step 9: Add new tests for `enteredNewRoom`'s correctness**

Add to `server/test/game/turnFlow.test.js`, after the block updated in Step 7's first edit (the `moveToRoom` basic-move test around line 104-113):

```javascript
test('moveToRoom sets enteredNewRoom to false when moving back into an already-visited room', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('-1,1', { roomId: 'room_manual', x: -1, y: 1, doorSides: ['north', 'east', 'south', 'west'] });
  moveToRoom(gameState, 'p1', 'west'); // first visit -> (-1,1) now in visitedRooms
  player.actionPoints = 4;
  const result = moveToRoom(gameState, 'p1', 'east'); // back to (0,1), the starting room
  expect(result.enteredNewRoom).toBe(false);
});
```

Add to `server/test/socketHandlers.test.js`, right after the existing assertions in each of these 3 tests (do not remove the existing `.playerId`/`.roomId` assertions, just add one line after each):

After line 744 (`expect(roomEntered.roomId).toBe('room_new');`, inside `'game:move into a plain (no leaveCheck) neighbor broadcasts game:roomEntered with the entered room id'`):
```javascript
  expect(roomEntered.enteredNewRoom).toBe(true); // room_new was just placed by the door-open
```

After line 1059 (`expect(roomEntered.roomId).toBe('room_basement_a');`, inside the teleport/跳下 test) — this player already fell into `room_basement_a` once earlier in this same test (the drained `firstRoomEnteredPromise`), then teleports into it again via the collapse-link jump, so this is a revisit:
```javascript
  expect(roomEntered.enteredNewRoom).toBe(false); // this player already fell into room_basement_a earlier in this test
```

After line 1236 (`expect(roomEntered.roomId).toBe('room_upper_landing');`, inside the move_to_room/stairs test):
```javascript
  expect(roomEntered.enteredNewRoom).toBe(true); // first time this player reaches room_upper_landing in this test
```

- [ ] **Step 10: Run the full suite again**

Run: `cd server && npm test`
Expected: PASS, full suite green.

- [ ] **Step 11: Commit**

```bash
git add server/src/game/turnFlow.js server/src/game/effectResolver.js server/src/socketHandlers.js server/test/game/turnFlow.test.js server/test/socketHandlers.test.js
git commit -m "feat: broadcast enteredNewRoom on game:roomEntered for first-visit popups"
```

---

### Task 3: `game:itemUseResolved` broadcast

**Files:**
- Modify: `server/src/socketHandlers.js:350` (insert new block right after)
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `actionType`, `mode`, `itemId`, `targetForEffects`, `effectResult` — all already in scope at the insertion point (`server/src/selectAction` handler, inside the `if (sourceEffects) {...}` block).
- Produces: `game:itemUseResolved` broadcast, payload `{ playerId, itemId }`, emitted only when an item/omen "use" action resolves immediately with no pending state and no dice check. No card text in the payload — Task 6 (client) looks up `feedbacktextOccur` itself from `cardContent`.

**Why not inside `handleEffectResolveResult`:** that function is shared by item-use, room_action/craft, and card-draw auto-resolution. Checking "is this action's `sourceId` an item/omen" inside it would also fire for an event/omen that just got *drawn* and auto-resolved (a different case, already handled by Task 5's `eventNoCheck` path) — risking a duplicate popup. Emitting from the `game:selectAction` handler itself, which already knows unambiguously `actionType === 'item'`, avoids that collision entirely.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/socketHandlers.test.js`, near the existing item-effect tests (the block around line 2296-2338 that defines `item_003` with a `dice_check` is a good neighbor — add these as new `test(...)` blocks after it):

```javascript
test('game:selectAction item use with no dice_check broadcasts game:itemUseResolved', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        { id: 'item_050', name: '無考驗道具', effects: [{ type: 'stat_change', stat: 'might', delta: 1 }], category: 'general' },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_050' });

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_050' }, resolve));
  const resolved = await resolvedPromise;

  expect(resolved.playerId).toBe(currentPlayerId);
  expect(resolved.itemId).toBe('item_050');

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item use with a dice_check does NOT broadcast game:itemUseResolved', async () => {
  const content = makeContent({
    cards: {
      events: [], omens: [],
      items: [
        {
          id: 'item_051',
          name: '有考驗道具',
          effects: [{
            type: 'dice_check',
            diceCount: 2,
            tiers: [{ min: 0, max: 8, effects: [{ type: 'stat_change', stat: 'might', delta: 1 }] }],
          }],
          category: 'general',
        },
      ],
    },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  getPlayer(gameState, currentPlayerId).inventory.push({ id: 'item_051' });

  const resolvedPromise = new Promise((resolve) => currentClient.once('game:itemUseResolved', resolve));
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timeout'), 300));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_051' }, resolve));
  const outcome = await Promise.race([resolvedPromise, timeoutPromise]);

  expect(outcome).toBe('timeout');

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest socketHandlers -t "game:itemUseResolved"`
Expected: The first test FAILs (times out waiting for an event that's never emitted). The second test currently PASSes already (nothing emits the event yet) — that's fine, it stays passing after Step 3 too; it's there to guard against a future regression.

- [ ] **Step 3: Implement**

In `server/src/socketHandlers.js`, at lines 349-353, replace:
```javascript
            const effectResult = resolveEffects(gameState, resolverEntry.promptState, targetForEffects, sourceEffects, { now: Date.now(), itemCatalog: content.cards.items });
            const outcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, targetForEffects, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied, content, rollChoiceTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
            if (moveToRoomEffect && !effectResult.pending) {
              io.to(roomCode).emit('game:roomEntered', { playerId: targetForEffects, roomId: moveToRoomEffect.targetRoomId, enteredNewRoom: effectResult.enteredNewRoom });
            }
```
with:
```javascript
            const effectResult = resolveEffects(gameState, resolverEntry.promptState, targetForEffects, sourceEffects, { now: Date.now(), itemCatalog: content.cards.items });
            const outcome = handleEffectResolveResult(io, effectResolverManager, gameState, roomCode, targetForEffects, sourceId, effectResult, effectChoiceTimeouts, consumeItemIfApplied, content, rollChoiceTimeouts, rollChoiceTimeoutMs, inventoryChoiceTimeoutMs);
            if (actionType === 'item' && (!mode || mode === 'use') && !effectResult.pending && !effectResult.diceCheckResult) {
              io.to(roomCode).emit('game:itemUseResolved', { playerId: targetForEffects, itemId });
            }
            if (moveToRoomEffect && !effectResult.pending) {
              io.to(roomCode).emit('game:roomEntered', { playerId: targetForEffects, roomId: moveToRoomEffect.targetRoomId, enteredNewRoom: effectResult.enteredNewRoom });
            }
```

(Note: this edit lands on top of Task 2's Step 6 edit to the same `moveToRoomEffect` line — apply Task 2 first, then this insertion goes immediately above that already-modified line.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest socketHandlers -t "game:itemUseResolved"`
Expected: Both tests PASS.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green (confirms this didn't affect the `game:pendingAction`/`game:effectPendingChoice` paths, which return before reaching this new block).

- [ ] **Step 6: Commit**

```bash
git add server/src/socketHandlers.js server/test/socketHandlers.test.js
git commit -m "feat: broadcast game:itemUseResolved for no-dice-check item/omen use"
```

---

### Task 4: `CheckModal.jsx` — video animation + `feedbacktextDice` result text

**Files:**
- Modify: `client/src/gameplay/CheckModal.jsx` (full rewrite of the file, ~110 lines)
- Create: `client/public/videos/roll-dice.mp4` (copied from `developersketch/ROLLDICE.mp4`)

**Interfaces:**
- Consumes: `check.sourceKind`, `check.sourceId`, `check.rolled`, `check.checkKind`, `check.passed`, `check.threshold`, `check.stat` (all already present on every `pendingCheckQueue` item of `noCheck: false` kind — no new fields needed from the server, Task 2/3 didn't add anything CheckModal needs).
- Produces: same component signature `CheckModal({ check, roomContent, cardContent, onDone })` — no prop changes, safe to swap in place.

- [ ] **Step 1: Copy the video asset**

```bash
mkdir -p "client/public/videos"
cp "developersketch/ROLLDICE.mp4" "client/public/videos/roll-dice.mp4"
```

- [ ] **Step 2: Rewrite `client/src/gameplay/CheckModal.jsx`**

Replace the entire file with:

```jsx
import { useState } from 'react';
import { findRoomInfo, findCardInfo, STAT_LABELS } from './mapUtils';

const TITLE_BY_KIND = {
  leaveCheck: '離開房間考驗',
  collapseCheck: '進入房間考驗',
  cardCheck: '進入房間 · 抽卡考驗',
};

function resolveSource(check, roomContent, cardContent) {
  if (check.sourceKind === 'room') {
    const room = findRoomInfo(check.sourceId, roomContent);
    return { name: room ? room.name : check.sourceId, text: room ? room.text : '' };
  }
  const card = findCardInfo(check.sourceId, cardContent);
  return { name: card ? card.name : check.sourceId, text: card ? (card.text || card.description || '') : '' };
}

// feedbacktextDice keys are one of: "N+" (>=N), "A-B" (inclusive range), "N"
// (exact value) -- see data/cards/README.md and the 2026-08-25 popup design doc.
function matchDiceFeedbackText(rolled, feedbacktextDice) {
  if (!feedbacktextDice) return '待補充';
  for (const [key, text] of Object.entries(feedbacktextDice)) {
    if (key.endsWith('+')) {
      if (rolled >= Number(key.slice(0, -1))) return text;
    } else if (key.includes('-')) {
      const [min, max] = key.split('-').map(Number);
      if (rolled >= min && rolled <= max) return text;
    } else if (rolled === Number(key)) {
      return text;
    }
  }
  return '待補充';
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 70,
};

const boxStyle = {
  width: 320,
  maxWidth: '90%',
  backgroundColor: '#111',
  color: '#f5f5f0',
  borderRadius: 12,
  padding: 20,
  boxSizing: 'border-box',
};

export default function CheckModal({ check, roomContent, cardContent, onDone }) {
  const [phase, setPhase] = useState('before'); // 'before' | 'animating' | 'result'
  const source = resolveSource(check, roomContent, cardContent);
  const statLabel = STAT_LABELS[check.stat] || '';

  function handleRoll() {
    setPhase('animating');
  }

  if (phase === 'animating') {
    return (
      <div style={overlayStyle}>
        <div style={boxStyle}>
          <video
            src="/videos/roll-dice.mp4"
            autoPlay
            onEnded={() => setPhase('result')}
            style={{ width: '100%', display: 'block', marginBottom: 12 }}
          />
          <button style={{ width: '100%', fontSize: 16, padding: 10 }} onClick={() => setPhase('result')}>
            跳過
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'result') {
    const card = check.sourceKind !== 'room' ? findCardInfo(check.sourceId, cardContent) : null;
    const feedbackText = card ? matchDiceFeedbackText(check.rolled, card.feedbacktextDice) : null;
    return (
      <div style={overlayStyle}>
        <div style={boxStyle}>
          <p style={{ fontSize: 14, letterSpacing: 2, color: check.passed ? '#8ad48a' : '#e08a8a', marginBottom: 6 }}>
            考驗結果
          </p>
          <p style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>{source.name}</p>
          <p style={{ fontSize: 22, fontWeight: 'bold', color: check.passed ? '#8ad48a' : '#e08a8a', marginBottom: 10 }}>
            {check.passed ? '成功！' : '失敗...'}
          </p>
          {feedbackText ? (
            <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>{feedbackText}</p>
          ) : (
            <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>
              {statLabel}考驗擲出 {check.rolled} 點
              {check.threshold != null ? `（需要 ${check.threshold} 以上）` : ''}
            </p>
          )}
          <button style={{ width: '100%', fontSize: 18, padding: 12 }} onClick={onDone}>
            確認
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={boxStyle}>
        <p style={{ fontSize: 14, letterSpacing: 2, color: '#e08a8a', marginBottom: 6 }}>
          {TITLE_BY_KIND[check.checkKind] || '考驗'}
        </p>
        <p style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>{source.name}</p>
        <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>{source.text}</p>
        <div style={{ backgroundColor: '#1c1c1c', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 15 }}>
          {statLabel && <div>考驗屬性：{statLabel}</div>}
          {check.threshold != null && <div>需要：{check.threshold} 以上</div>}
        </div>
        <button style={{ width: '100%', fontSize: 18, padding: 12 }} onClick={handleRoll}>
          擲骰
        </button>
      </div>
    </div>
  );
}
```

(Changes from the current file: `ANIMATION_MS`/`setTimeout` removed; `handleRoll` now just flips to `'animating'`; the `'animating'` phase renders a `<video>` with `onEnded` plus a 跳過 button instead of static text; the `'result'` phase computes `feedbackText` via the new `matchDiceFeedbackText` helper and swaps the body paragraph.)

- [ ] **Step 3: Verify — build**

Run: `cd client && npm run build`
Expected: builds with no errors.

- [ ] **Step 4: Verify — manual browser check**

Start both servers (`cd server && npm start`, `cd client && npm run dev`), open the game in a browser, trigger any existing dice-check flow (e.g. open a door into a leaveCheck room, or use/draw a card with a `dice_check`). Confirm: the `'animating'` phase now plays the video instead of "擲骰中..." text, the 跳過 button skips straight to results, and for a card-sourced check (`sourceKind !== 'room'`) the result screen shows the card's `feedbacktextDice` text (or `待補充` if the card has none) instead of the generic "OO考驗擲出N點" sentence — while a room-sourced check (`leaveCheck`/`collapseCheck`) still shows the old generic sentence unchanged.

- [ ] **Step 5: Commit**

```bash
git add client/src/gameplay/CheckModal.jsx client/public/videos/roll-dice.mp4
git commit -m "feat: check modal plays dice-roll video and shows card feedbacktextDice"
```

---

### Task 5: `DebugGameScreen.jsx` — queue wiring for room/event/item-use popups

**Files:**
- Modify: `client/src/DebugGameScreen.jsx` (handlers in the `useEffect` at lines 95-201; new helper functions near the top of the file)

**Interfaces:**
- Consumes: `game:roomEntered`'s new `enteredNewRoom` field (Task 2), `game:itemUseResolved` (Task 3).
- Produces: `pendingCheckQueue` items of shape `{ noCheck: true, kind: 'roomIntro'|'eventIntro'|'eventNoCheck'|'itemDrawNoCheck'|'itemUseResolved', sourceId, queueId }` — consumed by Task 6's rendering.

**Behavior for item-deck card draws is intentionally unchanged**: the design doc's `eventIntro`/`eventNoCheck` popups apply only to `deckType === 'event'`/`'omen'` draws. Item-deck draws (`deckType === 'item'`, e.g. from search) keep exactly their current single-popup behavior (`kind: 'itemDrawNoCheck'`, same title/body as today) — this plan only adds a `kind` label to that existing push so Task 6's renderer can dispatch on it; the popup's content and trigger condition (`!data.hasCheck`) do not change.

- [ ] **Step 1: Replace `onCardDrawn` (current lines 119-135)**

Replace:
```javascript
    function onCardDrawn(data) {
      if (!data.hasCheck) {
        setPendingCheckQueue((prev) => [
          ...prev,
          { noCheck: true, playerId: data.playerId, sourceKind: data.deckType, sourceId: data.cardId, queueId: nextCheckQueueId.current++ },
        ]);
      }
      const card = findCardInfo(data.cardId, cardContent);
      const cardName = card ? card.name : data.cardId;
      const playerName = findPlayerName(data.playerId, gameState?.players);
      const templateByDeck = {
        event: `${playerName}：發生了 ${cardName}`,
        item: `${playerName} 在房間裡找到了 ${cardName}`,
        omen: `${playerName}看到了一個怪異的現象（${cardName}）`,
      };
      setMessages((prev) => [...prev, templateByDeck[data.deckType] || `${playerName} 抽到了 ${cardName}`]);
    }
```
with:
```javascript
    function onCardDrawn(data) {
      if (data.deckType === 'event' || data.deckType === 'omen') {
        setPendingCheckQueue((prev) => [
          ...prev,
          { noCheck: true, kind: 'eventIntro', sourceId: data.cardId, queueId: nextCheckQueueId.current++ },
        ]);
        if (!data.hasCheck) {
          setPendingCheckQueue((prev) => [
            ...prev,
            { noCheck: true, kind: 'eventNoCheck', sourceId: data.cardId, queueId: nextCheckQueueId.current++ },
          ]);
        }
      } else if (!data.hasCheck) {
        setPendingCheckQueue((prev) => [
          ...prev,
          { noCheck: true, kind: 'itemDrawNoCheck', sourceId: data.cardId, queueId: nextCheckQueueId.current++ },
        ]);
      }
      const card = findCardInfo(data.cardId, cardContent);
      const cardName = card ? card.name : data.cardId;
      const playerName = findPlayerName(data.playerId, gameState?.players);
      const templateByDeck = {
        event: `${playerName}：發生了 ${cardName}`,
        item: `${playerName} 在房間裡找到了 ${cardName}`,
        omen: `${playerName}看到了一個怪異的現象（${cardName}）`,
      };
      setMessages((prev) => [...prev, templateByDeck[data.deckType] || `${playerName} 抽到了 ${cardName}`]);
    }
```

- [ ] **Step 2: Extend `onRoomEntered` (current lines 146-150)**

Replace:
```javascript
    function onRoomEntered(data) {
      const room = findRoomInfo(data.roomId, roomContent);
      const playerName = findPlayerName(data.playerId, gameState?.players);
      setMessages((prev) => [...prev, `${playerName} 進入了「${room ? room.name : data.roomId}」`]);
    }
```
with:
```javascript
    function onRoomEntered(data) {
      const room = findRoomInfo(data.roomId, roomContent);
      const playerName = findPlayerName(data.playerId, gameState?.players);
      setMessages((prev) => [...prev, `${playerName} 進入了「${room ? room.name : data.roomId}」`]);
      if (data.enteredNewRoom && data.playerId === playerId) {
        setPendingCheckQueue((prev) => [
          ...prev,
          { noCheck: true, kind: 'roomIntro', sourceId: data.roomId, queueId: nextCheckQueueId.current++ },
        ]);
      }
    }
```

- [ ] **Step 3: Add `onItemUseResolved` handler**

In the same `useEffect`, add this new function right after `onSearchEmpty` (current lines 151-154):
```javascript
    function onItemUseResolved(data) {
      if (data.playerId !== playerId) return;
      setPendingCheckQueue((prev) => [
        ...prev,
        { noCheck: true, kind: 'itemUseResolved', sourceId: data.itemId, queueId: nextCheckQueueId.current++ },
      ]);
    }
```

- [ ] **Step 4: Register/unregister the new socket listener**

In the same `useEffect`, add to the registration block (after `socket.on('game:searchEmpty', onSearchEmpty);`, current line 183):
```javascript
    socket.on('game:itemUseResolved', onItemUseResolved);
```
And add to the cleanup block (after `socket.off('game:searchEmpty', onSearchEmpty);`, current line 199):
```javascript
      socket.off('game:itemUseResolved', onItemUseResolved);
```

- [ ] **Step 5: Verify — build**

Run: `cd client && npm run build`
Expected: builds with no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/DebugGameScreen.jsx
git commit -m "feat: wire roomIntro/eventIntro/eventNoCheck/itemUseResolved into the popup queue"
```

(Manual browser verification for this task happens together with Task 6, since the queue items this task produces have no renderer until Task 6 lands.)

---

### Task 6: `SimplePopup.jsx` — shared popup component + queue rendering

**Files:**
- Create: `client/src/gameplay/SimplePopup.jsx`
- Modify: `client/src/DebugGameScreen.jsx` (import; new `resolveSimplePopupTitle`/`resolveSimplePopupBody` helpers; replace the inline popup JSX at lines 531-562)

**Interfaces:**
- Consumes: `pendingCheckQueue[0]` items of shape `{ noCheck: true, kind, sourceId, queueId }` (produced by Task 5), `roomContent`, `cardContent`.
- Produces: `SimplePopup({ title, body, onDone })` — presentational only, no internal state.

- [ ] **Step 1: Create `client/src/gameplay/SimplePopup.jsx`**

```jsx
const overlayStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 70,
};

const boxStyle = {
  width: 320,
  maxWidth: '90%',
  backgroundColor: '#111',
  color: '#f5f5f0',
  borderRadius: 12,
  padding: 20,
  boxSizing: 'border-box',
};

export default function SimplePopup({ title, body, onDone }) {
  return (
    <div style={overlayStyle}>
      <div style={boxStyle}>
        <p style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>{title}</p>
        <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>{body}</p>
        <button style={{ width: '100%', fontSize: 18, padding: 12 }} onClick={onDone}>
          確認
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the import to `DebugGameScreen.jsx`**

At the top of the file, after the existing `import CheckModal from './gameplay/CheckModal';` (line 5), add:
```javascript
import SimplePopup from './gameplay/SimplePopup';
```

- [ ] **Step 3: Add the title/body resolver helpers**

Add these two functions right after `findPlayerName` (current lines 9-12), before `cornerButtonStyle`:
```javascript
function resolveSimplePopupTitle(entry, roomContent, cardContent) {
  if (entry.kind === 'roomIntro') {
    const room = findRoomInfo(entry.sourceId, roomContent);
    return room ? room.name : entry.sourceId;
  }
  const card = findCardInfo(entry.sourceId, cardContent);
  return card ? card.name : entry.sourceId;
}

function resolveSimplePopupBody(entry, roomContent, cardContent) {
  if (entry.kind === 'roomIntro') {
    const room = findRoomInfo(entry.sourceId, roomContent);
    return room ? room.description : '';
  }
  const card = findCardInfo(entry.sourceId, cardContent);
  if (entry.kind === 'eventIntro') {
    return card ? card.description : '';
  }
  if (entry.kind === 'eventNoCheck' || entry.kind === 'itemUseResolved') {
    return (card && card.feedbacktextOccur) || '待補充';
  }
  // 'itemDrawNoCheck' -- existing pre-change popup content, unchanged
  return card ? (card.text || card.description || '') : '';
}
```

- [ ] **Step 4: Replace the inline popup JSX (current lines 531-562)**

Replace:
```jsx
          {pendingCheckQueue.length > 0 && pendingCheckQueue[0].noCheck && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 70,
              }}
            >
              <div style={{ width: 320, maxWidth: '90%', backgroundColor: '#111', color: '#f5f5f0', borderRadius: 12, padding: 20, boxSizing: 'border-box' }}>
                {(() => {
                  const noCheckEntry = pendingCheckQueue[0];
                  const card = findCardInfo(noCheckEntry.sourceId, cardContent);
                  return (
                    <>
                      <p style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>{card ? card.name : noCheckEntry.sourceId}</p>
                      <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>{card ? (card.text || card.description || '') : ''}</p>
                    </>
                  );
                })()}
                <button
                  style={{ width: '100%', fontSize: 18, padding: 12 }}
                  onClick={() => setPendingCheckQueue((prev) => prev.slice(1))}
                >
                  確認
                </button>
              </div>
            </div>
          )}
```
with:
```jsx
          {pendingCheckQueue.length > 0 && pendingCheckQueue[0].noCheck && (
            <SimplePopup
              title={resolveSimplePopupTitle(pendingCheckQueue[0], roomContent, cardContent)}
              body={resolveSimplePopupBody(pendingCheckQueue[0], roomContent, cardContent)}
              onDone={() => setPendingCheckQueue((prev) => prev.slice(1))}
            />
          )}
```

- [ ] **Step 5: Verify — build**

Run: `cd client && npm run build`
Expected: builds with no errors.

- [ ] **Step 6: Verify — manual browser check**

Start both servers, open the game, and walk through each new popup kind:
- Move into a room your player has never entered before → `roomIntro` popup shows the room's name/description, then dismiss confirms.
- Trigger an event or omen draw with no `dice_check` (or one that does have a check — either way confirm `eventIntro` shows the card's `description` first) → for the no-check case, confirm `eventNoCheck` follows showing `feedbacktextOccur` (or `待補充` if the card has none — expected for all omens today, since they don't have this field populated yet).
- Re-enter a room you've already visited → confirm no `roomIntro` popup appears.
- Use an item with no `dice_check` effect → confirm an `itemUseResolved` popup shows that item's `feedbacktextOccur` (or `待補充`).
- Search a room and find an item card → confirm the existing item-draw popup still shows exactly as before (card name + text/description, unchanged).
- Confirm no console errors throughout.

- [ ] **Step 7: Commit**

```bash
git add client/src/gameplay/SimplePopup.jsx client/src/DebugGameScreen.jsx
git commit -m "feat: render roomIntro/eventIntro/eventNoCheck/itemUseResolved via SimplePopup"
```

---

### Task 7: `CharacterPanel.jsx` — show item description in the use menu (2-A)

**Files:**
- Modify: `client/src/gameplay/CharacterPanel.jsx:201` (add `description` to `selectedItem` state), `client/src/gameplay/CharacterPanel.jsx:245` (render it)

**Interfaces:**
- No external interface change — `selectedItem` is local component state.

- [ ] **Step 1: Add `description` to the `selectedItem` state shape**

At line 201, replace:
```javascript
                  onClick={() => setSelectedItem({ itemId: item.id, name: findCardName(item.id, cardContent), isMaterial: Boolean(findCardInfo(item.id, cardContent)?.isMaterial), category: findCardCategory(item.id, cardContent), isOmen: isOmenCard(item.id, cardContent) })}
```
with:
```javascript
                  onClick={() => setSelectedItem({ itemId: item.id, name: findCardName(item.id, cardContent), description: findCardInfo(item.id, cardContent)?.description || '', isMaterial: Boolean(findCardInfo(item.id, cardContent)?.isMaterial), category: findCardCategory(item.id, cardContent), isOmen: isOmenCard(item.id, cardContent) })}
```

- [ ] **Step 2: Render the description below the item name**

At line 245, replace:
```jsx
            <p style={{ fontWeight: 'bold', marginBottom: 8 }}>{selectedItem.name}</p>
```
with:
```jsx
            <p style={{ fontWeight: 'bold', marginBottom: 4 }}>{selectedItem.name}</p>
            <p style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>{selectedItem.description}</p>
```

- [ ] **Step 3: Verify — build**

Run: `cd client && npm run build`
Expected: builds with no errors.

- [ ] **Step 4: Verify — manual browser check**

Open the game, click any item in inventory, confirm the popup now shows the item's description text under its name, and that all existing menu buttons (使用/手持/配戴/取下/給予/遺留) still appear correctly per category exactly as before.

- [ ] **Step 5: Commit**

```bash
git add client/src/gameplay/CharacterPanel.jsx
git commit -m "feat: show item description in the item-use menu"
```

---

## Final Verification

- [ ] `cd server && npm test` — full suite green
- [ ] `cd client && npm run build` — clean build
- [ ] One full manual playthrough covering: first room entry, event draw (with and without dice check), omen draw, item search-draw, item use (with and without dice check), item wield/wear/give/leave (regression check — Task 7's only change there is adding a description line), and a room leaveCheck/collapseCheck (regression check — confirm the video plays and the generic result text is unchanged for room-sourced checks)
- [ ] No console errors during the playthrough
