# 開門扣行動力規則調整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change "opening a door into a new room" from zeroing the player's action points to deducting a flat 2 AP, and only offer the open-door option when the player has at least 2 AP.

**Architecture:** Add a single `OPEN_DOOR_AP_COST = 2` constant to `server/src/game/turnFlow.js`, use it both to gate `getAvailableDirections` (so an unexplored door isn't offered as a clickable option below 2 AP) and to replace the `player.actionPoints = 0` line in `moveToRoom`'s door-opening branch with a flat deduction. Mirror the same gate in the client's read-only copy of `getAvailableDirections` (`client/src/gameplay/mapUtils.js`), which exists purely to decide which buttons to render — the server call remains the authority that actually validates and applies the cost.

**Tech Stack:** Node.js (server, Jest tests), plain ES module JS (client `mapUtils.js`, no framework/test runner attached to it).

## Global Constraints

- Opening a new room's door costs a flat **2 action points** (not a zero-out).
- A door leading to unexplored territory is only offered as an available `open_door` option when the player has **≥ 2** action points; below that, it is omitted (same as a solid wall).
- Moving to an already-placed neighboring room still costs **1** action point — unchanged.
- Opening a door never leaves action points negative (guaranteed by the ≥2 gate above) — no clamp/negative-AP handling needed.
- No forced end-of-turn after opening a door. Any AP left after the flat -2 deduction remains usable for further actions, same as any other action point spend.
- `freeRoomAction` (e.g. stairs), `leaveCheck` (e.g. 塔橋/雜亂的房間), the collapsed-room speed check, and the ballroom/gallery pair placement are all confirmed independent of this change — do not modify their logic, only note where their existing tests happen to also exercise a door-open and may need an assertion adjusted.

---

## Task 1: Server rule change — `turnFlow.js` + its unit tests

**Files:**
- Modify: `server/src/game/turnFlow.js:11-26` (add constant), `server/src/game/turnFlow.js:40-61` (`getAvailableDirections`), `server/src/game/turnFlow.js:159` (`moveToRoom`)
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Consumes: existing `getAvailableDirections(gameState, playerId)` (returns `[{direction, kind}]`) and `moveToRoom(gameState, playerId, direction, leaveCheck, rollOptions)` (returns `{kind: 'open_door', x, y, roomId, pendingCardDraw, ...}`) — signatures unchanged.
- Produces: same two functions, same signatures and return shapes. Only the *contents* of `getAvailableDirections`'s results (whether `open_door` appears) and the AP side-effect of `moveToRoom` change. Task 2 (socketHandlers tests) and Task 3 (client mirror) depend on this behavior being in place.

- [ ] **Step 1: Add the `OPEN_DOOR_AP_COST` constant**

In `server/src/game/turnFlow.js`, find this block near the top of the file:

```js
const COLLAPSED_ROOM_ID = 'room_collapsed_room';
const COLLAPSE_CHECK_STAT = 'speed';
const COLLAPSE_CHECK_MIN = 5;
```

Add a new constant directly after it:

```js
const COLLAPSED_ROOM_ID = 'room_collapsed_room';
const COLLAPSE_CHECK_STAT = 'speed';
const COLLAPSE_CHECK_MIN = 5;

const OPEN_DOOR_AP_COST = 2;
```

- [ ] **Step 2: Write the failing tests for `getAvailableDirections`'s new AP gate**

In `server/test/game/turnFlow.test.js`, add this test directly after the existing test `'getAvailableDirections omits open_door for a player with a blocksOpenDoor modifier, but still lists moves to already-explored neighbors'` (currently ends at line 84):

```js
test('getAvailableDirections omits open_door when the player has only 1 action point, but still lists moves to already-explored neighbors', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('-1,1', { roomId: 'room_manual', x: -1, y: 1, doorSides: ['north', 'east', 'south', 'west'] });
  player.actionPoints = 1;
  const available = getAvailableDirections(gameState, 'p1');
  expect(available.filter((a) => a.kind === 'open_door')).toEqual([]);
  expect(available.find((a) => a.direction === 'west')).toEqual({ direction: 'west', kind: 'move' });
});
```

- [ ] **Step 3: Run the new test to verify it fails**

Run: `cd server && npx jest test/game/turnFlow.test.js -t "omits open_door when the player has only 1 action point"`
Expected: FAIL — the current code has no AP check, so `open_door` for `east` is still present in the result.

- [ ] **Step 4: Update `getAvailableDirections` to gate on `OPEN_DOOR_AP_COST`**

Replace the current function body (lines 40-61):

```js
function getAvailableDirections(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const grid = gameState.board[player.floor];
  const room = grid.get(coordKey(player.x, player.y));
  const results = [];
  const doorSides = Array.isArray(room.doorSides) ? room.doorSides : [];
  const blockedFromOpeningDoors = hasModifierEffect(player, 'blocksOpenDoor');
  for (const direction of SIDES) {
    if (!doorSides.includes(direction)) continue;
    const delta = DIRECTION_DELTA[direction];
    const neighborCoord = { x: player.x + delta.dx, y: player.y + delta.dy };
    const neighborRoom = grid.get(coordKey(neighborCoord.x, neighborCoord.y));
    if (neighborRoom) {
      if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, direction)) {
        results.push({ direction, kind: 'move' });
      }
    } else if (!blockedFromOpeningDoors && hasRoomForFloor(gameState.roomDeck, player.floor)) {
      results.push({ direction, kind: 'open_door' });
    }
  }
  return results;
}
```

With:

```js
function getAvailableDirections(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const grid = gameState.board[player.floor];
  const room = grid.get(coordKey(player.x, player.y));
  const results = [];
  const doorSides = Array.isArray(room.doorSides) ? room.doorSides : [];
  const blockedFromOpeningDoors = hasModifierEffect(player, 'blocksOpenDoor');
  const canAffordOpenDoor = player.actionPoints >= OPEN_DOOR_AP_COST;
  for (const direction of SIDES) {
    if (!doorSides.includes(direction)) continue;
    const delta = DIRECTION_DELTA[direction];
    const neighborCoord = { x: player.x + delta.dx, y: player.y + delta.dy };
    const neighborRoom = grid.get(coordKey(neighborCoord.x, neighborCoord.y));
    if (neighborRoom) {
      if (canMoveBetween(gameState.board, player.floor, { x: player.x, y: player.y }, direction)) {
        results.push({ direction, kind: 'move' });
      }
    } else if (!blockedFromOpeningDoors && canAffordOpenDoor && hasRoomForFloor(gameState.roomDeck, player.floor)) {
      results.push({ direction, kind: 'open_door' });
    }
  }
  return results;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && npx jest test/game/turnFlow.test.js -t "omits open_door when the player has only 1 action point"`
Expected: PASS

- [ ] **Step 6: Write the failing tests for `moveToRoom`'s new AP cost**

Replace the existing test (currently lines 102-111):

```js
test('moveToRoom opens a door: draws a room, places it, moves the player, and zeroes action points', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, drawType: 'item', floor: 'ground' }]);
  const result = moveToRoom(gameState, 'p1', 'east');
  expect(result.kind).toBe('open_door');
  expect(result.roomId).toBe('room_new');
  expect(result.pendingCardDraw).toEqual({ deck: 'item' });
  expect(player.x).toBe(1);
  expect(player.y).toBe(1);
  expect(player.actionPoints).toBe(0);
});
```

With:

```js
test('moveToRoom opens a door: draws a room, places it, moves the player, and deducts a flat 2 action points', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, drawType: 'item', floor: 'ground' }]);
  const startingAP = player.actionPoints; // 4, from the default makeStats() speed value
  const result = moveToRoom(gameState, 'p1', 'east');
  expect(result.kind).toBe('open_door');
  expect(result.roomId).toBe('room_new');
  expect(result.pendingCardDraw).toEqual({ deck: 'item' });
  expect(player.x).toBe(1);
  expect(player.y).toBe(1);
  expect(player.actionPoints).toBe(startingAP - 2);
});

test('moveToRoom allows opening a door with exactly 2 action points, leaving 0 afterward', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, floor: 'ground' }]);
  player.actionPoints = 2;
  const result = moveToRoom(gameState, 'p1', 'east');
  expect(result.kind).toBe('open_door');
  expect(player.actionPoints).toBe(0);
});

test('moveToRoom throws INVALID_MOVE_DIRECTION when attempting to open a door with only 1 action point', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, floor: 'ground' }]);
  player.actionPoints = 1;
  expect(() => moveToRoom(gameState, 'p1', 'east')).toThrow('INVALID_MOVE_DIRECTION');
});
```

- [ ] **Step 7: Run the new tests and check their status**

Run: `cd server && npx jest test/game/turnFlow.test.js -t "deducts a flat 2 action points"`
Expected: FAIL — actual `player.actionPoints` is `0`, not `startingAP - 2`. This is the one genuinely TDD-driving test for this step; it only turns green after Step 8 below.

Run: `cd server && npx jest test/game/turnFlow.test.js -t "allows opening a door with exactly 2 action points"`
Expected: PASS already — with the old `= 0` code, starting from AP=2 still lands on AP=0 by coincidence. This test doesn't discriminate old vs. new behavior on its own; it's a regression lock for the exact-2 boundary case, kept passing through Step 8.

Run: `cd server && npx jest test/game/turnFlow.test.js -t "throws INVALID_MOVE_DIRECTION when attempting to open a door with only 1 action point"`
Expected: PASS already — this test depends only on the `getAvailableDirections` gate added in Step 4, not on the AP-cost change in Step 8.

- [ ] **Step 8: Update `moveToRoom`'s door-opening branch**

In `server/src/game/turnFlow.js`, find this line (currently line 159):

```js
  player.actionPoints = 0;
```

Replace it with:

```js
  player.actionPoints -= OPEN_DOOR_AP_COST;
```

- [ ] **Step 9: Run the full file to check for regressions**

Run: `cd server && npx jest test/game/turnFlow.test.js`
Expected: FAIL on 2 tests that assumed the old zero-out behavior: `'moveToRoom throws NOT_ENOUGH_ACTION_POINTS before checking direction validity'` (now sees AP=2 after the door-open instead of 0, so it throws `INVALID_MOVE_DIRECTION` instead of the expected `NOT_ENOUGH_ACTION_POINTS`) and `'moveToRoom with a leaveCheck also gates opening a new door...'` (now sees AP=1 after the door-open instead of the hardcoded `0`). A third test, `'moveToRoom throws INVALID_MOVE_DIRECTION for a direction not currently available'`, still passes (its `resetActionPoints` call overwrites the door-open's AP result either way) but has a stale comment worth fixing for accuracy.

- [ ] **Step 10: Fix the 2 failing tests and 1 stale comment**

**10a.** Find this test (currently lines 119-129):

```js
test('moveToRoom throws INVALID_MOVE_DIRECTION for a direction not currently available', () => {
  const gameState2 = createGameState(STARTING_ROOMS, [{ id: 'room_only', doors: 4, floor: 'ground' }]);
  const player2 = addPlayer(gameState2, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  gameState2.turnOrder = ['p1'];
  gameState2.currentPlayerIndex = 0;
  moveToRoom(gameState2, 'p1', 'east'); // exhausts the deck, player now at (1,1), AP=0
  resetActionPoints(player2); // simulate starting a new turn
  // North of (1,1) is unexplored and the deck is empty, so it's neither a
  // valid move (no room there) nor a valid door-open (no cards left).
  expect(() => moveToRoom(gameState2, 'p1', 'north')).toThrow('INVALID_MOVE_DIRECTION');
});
```

The `resetActionPoints(player2)` call on the next line overwrites whatever AP the door-open left behind, so this test's outcome is unaffected by the AP-cost change — only the inline comment is now stale. Update just the comment:

```js
  moveToRoom(gameState2, 'p1', 'east'); // exhausts the deck, player now at (1,1), AP=2 (4 - the flat door-open cost of 2)
```

**10b.** Find this test (currently lines 138-145):

```js
test('moveToRoom throws NOT_ENOUGH_ACTION_POINTS before checking direction validity', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_only', doors: 4, floor: 'ground' }]);
  // Move east to exhaust the deck and set AP to 0
  moveToRoom(gameState, 'p1', 'east');
  // AP is now 0, and we're at (1,1). North is unexplored and deck is empty (invalid direction).
  // The check for NOT_ENOUGH_ACTION_POINTS should fire before INVALID_MOVE_DIRECTION.
  expect(() => moveToRoom(gameState, 'p1', 'north')).toThrow('NOT_ENOUGH_ACTION_POINTS');
});
```

Replace it with (opening the door no longer leaves AP at 0 by itself, so this test now sets it explicitly to preserve its original intent — verifying that `NOT_ENOUGH_ACTION_POINTS` is checked before `INVALID_MOVE_DIRECTION`):

```js
test('moveToRoom throws NOT_ENOUGH_ACTION_POINTS before checking direction validity', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_only', doors: 4, floor: 'ground' }]);
  moveToRoom(gameState, 'p1', 'east'); // exhausts the deck, player now at (1,1)
  player.actionPoints = 0; // simulate a fully spent turn regardless of the door-open cost
  // North is unexplored and the deck is empty (invalid direction).
  // The check for NOT_ENOUGH_ACTION_POINTS should fire before INVALID_MOVE_DIRECTION.
  expect(() => moveToRoom(gameState, 'p1', 'north')).toThrow('NOT_ENOUGH_ACTION_POINTS');
});
```

**10c.** Find this test (currently lines 221-241):

```js
test('moveToRoom with a leaveCheck also gates opening a new door: failure does not draw or zero action points beyond the normal 1', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, drawType: 'item', floor: 'ground' }]);
  const startingAP = player.actionPoints;
  const failRng = () => 0;
  const failResult = moveToRoom(gameState, 'p1', 'east', { stat: 'might', min: 3 }, { rng: failRng });
  expect(failResult).toEqual({
    kind: 'leaveCheckFailed',
    rolled: 0,
    required: 3,
    leaveCheckResult: { stat: 'might', roomId: 'room_lobby_a', rolled: 0, required: 3, passed: false },
  });
  expect(player.x).toBe(0); // unmoved -- no room was drawn or placed
  expect(player.y).toBe(1);
  expect(player.actionPoints).toBe(startingAP - 1); // not zeroed -- opening never happened

  const passRng = () => 0.99;
  const passResult = moveToRoom(gameState, 'p1', 'east', { stat: 'might', min: 3 }, { rng: passRng });
  expect(passResult.kind).toBe('open_door');
  expect(player.x).toBe(1);
  expect(player.actionPoints).toBe(0); // successful door-open still zeroes AP as normal
});
```

Replace it with:

```js
test('moveToRoom with a leaveCheck also gates opening a new door: failure does not draw or deduct action points beyond the normal 1', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, drawType: 'item', floor: 'ground' }]);
  const startingAP = player.actionPoints;
  const failRng = () => 0;
  const failResult = moveToRoom(gameState, 'p1', 'east', { stat: 'might', min: 3 }, { rng: failRng });
  expect(failResult).toEqual({
    kind: 'leaveCheckFailed',
    rolled: 0,
    required: 3,
    leaveCheckResult: { stat: 'might', roomId: 'room_lobby_a', rolled: 0, required: 3, passed: false },
  });
  expect(player.x).toBe(0); // unmoved -- no room was drawn or placed
  expect(player.y).toBe(1);
  expect(player.actionPoints).toBe(startingAP - 1); // not deducted further -- opening never happened

  const passRng = () => 0.99;
  const passResult = moveToRoom(gameState, 'p1', 'east', { stat: 'might', min: 3 }, { rng: passRng });
  expect(passResult.kind).toBe('open_door');
  expect(player.x).toBe(1);
  expect(player.actionPoints).toBe(startingAP - 3); // successful door-open deducts a flat 2 on top of the earlier 1
});
```

- [ ] **Step 11: Run the full server test suite to verify everything passes**

Run: `cd server && npx jest`
Expected: PASS, all suites green.

- [ ] **Step 12: Commit**

```bash
cd server
git add src/game/turnFlow.js test/game/turnFlow.test.js
git commit -m "feat: change open-door AP cost from zero-out to a flat 2, gated on AP>=2"
```

---

## Task 2: Update `socketHandlers.test.js` integration tests

**Files:**
- Test: `server/test/socketHandlers.test.js` (no source changes — `socketHandlers.js` calls `moveToRoom`/`getAvailableDirections` as-is and needs no changes of its own for this feature)

**Interfaces:**
- Consumes: Task 1's `getAvailableDirections`/`moveToRoom` behavior (flat -2 AP cost, ≥2 AP gate) via the existing `game:move` socket handler — no new interface, this task only updates assertions that hardcoded the old zero-out behavior.

- [ ] **Step 1: Update the door-open broadcast test**

Find this test (currently lines 713-731):

```js
test('game:move to open a door places a room, zeroes AP, and broadcasts game:stateUpdate', async () => {
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGame();

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => {
    currentClient.emit('game:move', { direction: 'east' }, resolve);
  });
  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('open_door');

  const update = await updatePromise;
  const movedPlayer = update.players.find((p) => p.x === 1 && p.y === 1);
  expect(movedPlayer).toBeTruthy();
  expect(movedPlayer.actionPoints).toBe(0);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

Replace it with:

```js
test('game:move to open a door places a room, deducts a flat 2 AP, and broadcasts game:stateUpdate', async () => {
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGame();
  const gameState = getGameState(gameManager, roomCode);
  const startingAP = getPlayer(gameState, currentPlayerId).actionPoints;

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  const result = await new Promise((resolve) => {
    currentClient.emit('game:move', { direction: 'east' }, resolve);
  });
  expect(result.error).toBeUndefined();
  expect(result.kind).toBe('open_door');

  const update = await updatePromise;
  const movedPlayer = update.players.find((p) => p.x === 1 && p.y === 1);
  expect(movedPlayer).toBeTruthy();
  expect(movedPlayer.actionPoints).toBe(startingAP - 2);

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

(`getGameState` and `getPlayer` are already imported at the top of this file — used by multiple other tests, e.g. the collapsed-room tests around line 864.)

- [ ] **Step 2: Update the two `game:diceChoiceRespond` leaveCheck-interjection tests**

Find this test (currently lines 1264-1293), locate the line `const player = getPlayer(gameState, currentPlayerId);` near its start and the assertion near its end:

```js
test('game:diceChoiceRespond with an item optionId resolves a pending leaveCheck: applies cost and completes the move on a pass', async () => {
  const content = makeLeaveCheckInterjectionContent();
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_006' });
  // ... (unchanged middle of test) ...
  expect(player.stats.sanity.currentIndex).toBe(player.stats.sanity.baseIndex - 1); // cost applied
  expect(player.diceInterjectionUsedThisTurn).toEqual(['item_006']);
  // might(3) + bonusDice(2) = 5 dice, each face 2 -> sum 10, passes min 3 -> opens the door east
  expect(player.x).toBe(1);
  expect(player.actionPoints).toBe(0); // open_door zeroes AP, same as a normal door-open
```

Add a `startingAP` capture right after `player.inventory.push({ id: 'item_006' });`, and change the final assertion:

```js
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_006' });
  const startingAP = player.actionPoints;
```

```js
  expect(player.x).toBe(1);
  expect(player.actionPoints).toBe(startingAP - 2); // open_door deducts a flat 2 AP, same as a normal door-open
```

Find the next test, `'game:diceChoiceRespond with optionId:"__skip__" resolves a pending leaveCheck with no bonus applied'` (currently lines 1295-1322), and apply the identical pair of edits: add `const startingAP = player.actionPoints;` right after `player.inventory.push({ id: 'item_006' });`, and change:

```js
  expect(player.x).toBe(1);
  expect(player.actionPoints).toBe(0);
```

to:

```js
  expect(player.x).toBe(1);
  expect(player.actionPoints).toBe(startingAP - 2);
```

- [ ] **Step 3: Update the manual-end-turn test to force a deterministic zero-AP scenario**

Find this test (currently lines 1534-1567):

```js
test('when a move exhausts action points, the turn does not auto-advance -- game:endTurn is required', async () => {
  const { httpServer, clientA, clientB, currentClient, otherClient, currentPlayerId } = await setUpStartedGame();

  const updatePromise = new Promise((resolve) => currentClient.once('game:stateUpdate', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve)); // zeroes AP
  const update = await updatePromise;

  // AP is zero, but the turn must stay with the same player until they
  // explicitly end it -- see Task 5's manual-end-turn mechanism.
  expect(update.turnOrder[update.currentPlayerIndex]).toBe(currentPlayerId);
  const me = update.players.find((p) => p.playerId === currentPlayerId);
  expect(me.actionPoints).toBe(0);
```

This test's real purpose (per its title) is verifying the turn does not auto-advance when AP hits zero — it isn't really about the door-open cost itself. Since a random character's starting speed is no longer guaranteed to leave exactly 0 AP after a single door-open (only speed===2 would), force the precondition explicitly instead of relying on it as a side effect:

```js
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
```

Leave the rest of the test (from `// otherClient may still have...` onward) unchanged.

- [ ] **Step 4: Run the full server test suite to verify everything passes**

Run: `cd server && npx jest`
Expected: PASS, all suites green.

- [ ] **Step 5: Commit**

```bash
cd server
git add test/socketHandlers.test.js
git commit -m "test: update socket integration tests for the flat -2 open-door AP cost"
```

---

## Task 3: Client mirror — `mapUtils.js`

**Files:**
- Modify: `client/src/gameplay/mapUtils.js:1-42`

**Interfaces:**
- Consumes: nothing new — same `getAvailableDirections(player, currentRoom, boardRooms)` signature, where `player` already carries `.actionPoints` (confirmed: `client/src/gameplay/CharacterPanel.jsx` already reads `player.actionPoints` from the same player objects this function receives).
- Produces: same return shape `[{direction, kind, neighborRoom?}]` — only whether a given direction's `open_door` entry appears changes.

- [ ] **Step 1: Add the matching `OPEN_DOOR_AP_COST` constant and gate**

In `client/src/gameplay/mapUtils.js`, find:

```js
const OPPOSITE_SIDE = { north: 'south', south: 'north', east: 'west', west: 'east' };

// Mirrors server/src/game/turnFlow.js's getAvailableDirections. Keep this in
// sync if the server logic ever changes -- the server remains authoritative
// (game:move still validates for real), this is only for deciding which
// buttons to show.
function hasBlocksOpenDoorModifier(player) {
  return (player.modifiers || []).some((m) =>
    (m.effects || []).some((e) => e.hookType === 'blocksOpenDoor')
  );
}

function getAvailableDirections(player, currentRoom, boardRooms) {
  const blockedFromOpeningDoors = hasBlocksOpenDoorModifier(player);
  const doorSides = Array.isArray(currentRoom.doorSides) ? currentRoom.doorSides : [];
  const results = [];
  for (const direction of Object.keys(DIRECTION_DELTA)) {
    if (!doorSides.includes(direction)) continue;
    const delta = DIRECTION_DELTA[direction];
    const neighborX = currentRoom.x + delta.dx;
    const neighborY = currentRoom.y + delta.dy;
    const neighborRoom = boardRooms.find((r) => r.x === neighborX && r.y === neighborY);
    if (neighborRoom) {
      const facingSide = OPPOSITE_SIDE[direction];
      if (Array.isArray(neighborRoom.doorSides) && neighborRoom.doorSides.includes(facingSide)) {
        results.push({ direction, kind: 'move', neighborRoom });
      }
    } else if (!blockedFromOpeningDoors) {
      results.push({ direction, kind: 'open_door' });
    }
  }
  return results;
}
```

Replace it with:

```js
const OPPOSITE_SIDE = { north: 'south', south: 'north', east: 'west', west: 'east' };

// Mirrors server/src/game/turnFlow.js's getAvailableDirections. Keep this in
// sync if the server logic ever changes -- the server remains authoritative
// (game:move still validates for real), this is only for deciding which
// buttons to show.
const OPEN_DOOR_AP_COST = 2;

function hasBlocksOpenDoorModifier(player) {
  return (player.modifiers || []).some((m) =>
    (m.effects || []).some((e) => e.hookType === 'blocksOpenDoor')
  );
}

function getAvailableDirections(player, currentRoom, boardRooms) {
  const blockedFromOpeningDoors = hasBlocksOpenDoorModifier(player);
  const canAffordOpenDoor = player.actionPoints >= OPEN_DOOR_AP_COST;
  const doorSides = Array.isArray(currentRoom.doorSides) ? currentRoom.doorSides : [];
  const results = [];
  for (const direction of Object.keys(DIRECTION_DELTA)) {
    if (!doorSides.includes(direction)) continue;
    const delta = DIRECTION_DELTA[direction];
    const neighborX = currentRoom.x + delta.dx;
    const neighborY = currentRoom.y + delta.dy;
    const neighborRoom = boardRooms.find((r) => r.x === neighborX && r.y === neighborY);
    if (neighborRoom) {
      const facingSide = OPPOSITE_SIDE[direction];
      if (Array.isArray(neighborRoom.doorSides) && neighborRoom.doorSides.includes(facingSide)) {
        results.push({ direction, kind: 'move', neighborRoom });
      }
    } else if (!blockedFromOpeningDoors && canAffordOpenDoor) {
      results.push({ direction, kind: 'open_door' });
    }
  }
  return results;
}
```

- [ ] **Step 2: Verify with a throwaway script (client has no test runner configured — do not add one for this)**

Create a temporary file `client/scratch-verify-open-door-gate.mjs`:

```js
import { getAvailableDirections } from './src/gameplay/mapUtils.js';

const currentRoom = { x: 0, y: 0, doorSides: ['east'] };
const boardRooms = [];

const oneAP = getAvailableDirections({ actionPoints: 1, modifiers: [] }, currentRoom, boardRooms);
console.assert(oneAP.filter((d) => d.kind === 'open_door').length === 0, 'FAIL: AP=1 should not offer open_door');

const twoAP = getAvailableDirections({ actionPoints: 2, modifiers: [] }, currentRoom, boardRooms);
console.assert(twoAP.some((d) => d.direction === 'east' && d.kind === 'open_door'), 'FAIL: AP=2 should offer open_door');

console.log('mapUtils open-door AP gate: all assertions passed');
```

Run: `node client/scratch-verify-open-door-gate.mjs`
Expected output: `mapUtils open-door AP gate: all assertions passed` (with no `FAIL:` lines above it — `console.assert` only prints on failure).

Then delete the scratch file — it is not part of the commit:

```bash
rm client/scratch-verify-open-door-gate.mjs
```

- [ ] **Step 3: Manual smoke check in the browser**

Start the dev server (`client` + `server`, per the project's existing `npm run dev` / launch setup) and open a game to the playing screen. Confirm doors still render and behave normally with plenty of AP available (open one door, confirm the room places and the corner "解鎖" button styling is unaffected) — this step is a regression smoke check for the rendering path, not a re-verification of the AP-gating logic itself (already covered deterministically by Step 2). Reaching exactly 1 AP in a live game requires actually spending it down through play, which is out of scope to script here.

- [ ] **Step 4: Commit**

```bash
git add client/src/gameplay/mapUtils.js
git commit -m "feat: mirror the flat -2 open-door AP cost gate in the client direction helper"
```
