# 房間門狀態變動事件卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `event_014`（前進無門）/`event_015`（後無退路）/`event_016`（地板陷落）/`event_028`（秘密通道）real mechanical support: a data-driven conditional-redraw check for the event deck, two new door-mutation effect types, and a third effect type that reuses (via a shared, extracted helper) the existing collapsed-room fall mechanic.

**Architecture:** No new UI, no new popup type — all 4 cards rely on the existing `eventNoCheck`/`eventIntro` popup flow and their own `feedbacktextOccur`/`description` text. Door mutation operates directly on the already-mutable `doorSides` array that lives on each placed room instance in `gameState.board[floor]` (a `Map`) — no new data model. The conditional-redraw check (`redrawIf`) is a small data-driven predicate (`{check, op, value}`) evaluated against live game state, paired with a new `drawFeasibleCard` deck primitive that mirrors the existing `drawFeasibleRoom` (`roomDeck.js`) pattern exactly: cycle non-matching cards to the bottom of the deck, fall back to a plain draw if nothing in a full pass matches. The basement-fall logic already exists in `turnFlow.js`'s `applyCollapseCheck` (dice-check-gated); this plan extracts its room-draw/place/link/move body into a new shared module (`collapseFall.js`) so both the existing dice-gated path and the new unconditional `fall_to_basement` effect call the same code.

**Tech Stack:** Node.js/Express/Socket.IO (server only — no client changes in this plan). Jest (server tests).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-27-room-door-state-design.md` — read it if anything below is ambiguous, it governs.
- `redrawIf` field: `{ "check": "roomDoorCount"|"playerFloor", "op": "==", "value": <number|string> }`. Only these two checks and this one operator are needed by this plan's 3 cards — do not build a general expression evaluator.
- `roomDoorCount` reads the CURRENT (live, possibly-already-mutated) room's `doorSides.length`, not the room definition's original `doors` field.
- `remove_room_doors` modes: `"entry"` (removes `player.enteredFromSide` from the current room, syncs the neighbor there — guaranteed placed) and `"unexplored_except_entry"` (removes every OTHER current-room door side whose neighbor coordinate has no placed room yet; leaves already-explored sides and the entry side untouched; never touches a neighbor).
- `add_room_door` (`target: "random_doorless_wall"`): picks a random side not currently in the current room's `doorSides`, adds it; if a room is already placed at that neighbor coordinate, also adds the facing side to the neighbor's `doorSides` if not already present (idempotent).
- `fall_to_basement`: no parameters. Always drops to `'basement'` regardless of the triggering floor (already decided; do not gate on floor). Applies **no damage** — the M3 damage-distribution system doesn't exist yet, matching the pre-existing, documented gap in `applyCollapseCheck`. Do not add any stat_change or other damage effect for this.
- These 4 cards get no new popup/UI — they rely entirely on the existing `eventNoCheck`/`eventIntro` flow and their own card text. Do not add any new socket event or client code.
- `player.enteredFromSide` is guaranteed non-null whenever any of these 4 cards' effects run (event-deck draws only happen on `open_door`, which always sets a real entered side) — no null-guard needed for it in `remove_room_doors`.
- Server tests: `cd server && npm test` (Jest). Every task must end with the full suite green, not just its own new test file.
- No frontend/client changes in this plan — do not touch anything under `client/`.

---

### Task 1: `redrawIf` conditional redraw for the event deck

**Files:**
- Modify: `server/src/game/cardDeck.js` (new `drawFeasibleCard` function + export)
- Modify: `server/src/socketHandlers.js` (`resolveCardDraw`: use `drawFeasibleCard` for `deckType === 'event'`, new local `isRedrawRejected` helper)
- Test: `server/test/game/cardDeck.test.js`, `server/test/socketHandlers.test.js`

**Interfaces:**
- Produces: `drawFeasibleCard(deck, isFeasible)` in `cardDeck.js` — same shape as `roomDeck.js`'s `drawFeasibleRoom(deck, floor, isFeasible)` minus the floor argument (card decks aren't floor-scoped). Cycles non-matching cards to the bottom across one full pass, then falls back to a plain `drawCard(deck)`. Throws `CARD_DECK_EMPTY` immediately if the deck starts empty (same as `drawCard`).
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing `drawFeasibleCard` tests**

Add to `server/test/game/cardDeck.test.js`, after the existing `drawCard throws CARD_DECK_EMPTY immediately for a deck created empty` test:

```javascript
test('drawFeasibleCard returns the first card matching isFeasible, cycling non-matches to the back', () => {
  const cards = [
    { id: 'bad_1' },
    { id: 'ok' },
    { id: 'bad_2' },
  ];
  const deck = createCardDeck(cards);
  const drawn = drawFeasibleCard(deck, (card) => card.id === 'ok');
  expect(drawn.id).toBe('ok');
  expect(getRemainingCount(deck)).toBe(2);
  expect(deck.cards.some((c) => c.id === 'bad_1')).toBe(true);
  expect(deck.cards.some((c) => c.id === 'bad_2')).toBe(true);
});

test('drawFeasibleCard falls back to a plain draw when no remaining card satisfies isFeasible', () => {
  const deck = createCardDeck(makeCards(3));
  const drawn = drawFeasibleCard(deck, () => false); // nothing is ever feasible
  expect(['card_0', 'card_1', 'card_2']).toContain(drawn.id);
  expect(getRemainingCount(deck)).toBe(2);
});

test('drawFeasibleCard throws CARD_DECK_EMPTY when the deck starts empty', () => {
  const deck = createCardDeck([]);
  expect(() => drawFeasibleCard(deck, () => true)).toThrow('CARD_DECK_EMPTY');
});
```

Update the import line at the top of the file:

```javascript
const { createCardDeck, hasCards, drawCard, drawFeasibleCard, getRemainingCount } = require('../../src/game/cardDeck');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest cardDeck -t "drawFeasibleCard"`
Expected: FAIL (`drawFeasibleCard is not a function`).

- [ ] **Step 3: Implement `drawFeasibleCard`**

In `server/src/game/cardDeck.js`, add this function after `drawCard` (before `getRemainingCount`):

```javascript
// Mirrors roomDeck.js's drawFeasibleRoom -- cycles non-matching cards to the
// bottom across one full pass, then falls back to a plain drawCard() so the
// draw can never deadlock even if every remaining card fails isFeasible.
function drawFeasibleCard(deck, isFeasible) {
  if (!hasCards(deck)) {
    throw new Error('CARD_DECK_EMPTY');
  }
  const attempts = deck.cards.length;
  for (let i = 0; i < attempts; i++) {
    const card = deck.cards.shift();
    if (isFeasible(card)) {
      return card;
    }
    deck.cards.push(card); // put back at bottom, try the next card
  }
  return drawCard(deck);
}
```

Update the export at the bottom of the file:

```javascript
module.exports = { createCardDeck, hasCards, drawCard, drawFeasibleCard, getRemainingCount };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest cardDeck`
Expected: PASS, full file green (10 tests: 7 existing + 3 new).

- [ ] **Step 5: Wire `redrawIf` into `resolveCardDraw`**

In `server/src/socketHandlers.js`, update the cardDeck import near the top:

```javascript
const { hasCards, drawCard, drawFeasibleCard } = require('./game/cardDeck');
```

Add this new function directly above `function resolveCardDraw(` (search for `function resolveCardDraw`):

```javascript
// Evaluates a card's optional redrawIf clause against live game state.
// Returns true when the condition MATCHES -- meaning the card should be
// rejected and redrawn (event_015/016/028's "抽出此卡時檢查...重抽事件卡").
// Only the two checks these 3 cards actually need are supported; add more
// only when a new card needs one.
function isRedrawRejected(redrawIf, gameState, playerId) {
  if (!redrawIf) {
    return false;
  }
  const player = getPlayer(gameState, playerId);
  let actual;
  if (redrawIf.check === 'roomDoorCount') {
    const room = gameState.board[player.floor].get(coordKey(player.x, player.y));
    actual = room.doorSides.length;
  } else if (redrawIf.check === 'playerFloor') {
    actual = player.floor;
  } else {
    throw new Error('UNKNOWN_REDRAW_CHECK');
  }
  if (redrawIf.op === '==') {
    return actual === redrawIf.value;
  }
  throw new Error('UNKNOWN_REDRAW_OP');
}
```

Then inside `resolveCardDraw`, replace:

```javascript
  const deck = gameState[deckField];
  if (!hasCards(deck)) {
    return { pending: false };
  }
  const card = drawCard(deck);
```

with:

```javascript
  const deck = gameState[deckField];
  if (!hasCards(deck)) {
    return { pending: false };
  }
  const card = deckType === 'event'
    ? drawFeasibleCard(deck, (c) => !isRedrawRejected(c.redrawIf, gameState, playerId))
    : drawCard(deck);
```

- [ ] **Step 6: Write the socket-level integration tests**

Add to `server/test/socketHandlers.test.js`, near the other `game:cardDrawn` tests (search for `test('game:cardDrawn reports hasCheck:false`):

```javascript
test('an event card with redrawIf roomDoorCount==4 is skipped when the room actually has 4 doors, drawing the next card instead', async () => {
  const REDRAW_CARD = { id: 'event_x', name: '重抽測試', text: '測試', redrawIf: { check: 'roomDoorCount', op: '==', value: 4 }, effects: [], needsCustomLogic: false };
  const NORMAL_CARD = { id: 'event_y', name: '一般事件', text: '測試', effects: [], needsCustomLogic: false };
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 4, floor: 'ground', drawType: 'event' }],
    cards: { events: [REDRAW_CARD, NORMAL_CARD], items: [], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, roomCode, gameManager } = await setUpStartedGameWithContent(content);

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const cardDrawn = await cardDrawnPromise;

  expect(cardDrawn.cardId).toBe('event_y'); // event_x was rejected (room really has 4 doors)
  const gameState = getGameState(gameManager, roomCode);
  expect(gameState.eventDeck.cards.some((c) => c.id === 'event_x')).toBe(true); // cycled to the bottom, not lost

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('an event card with redrawIf roomDoorCount==4 is drawn normally when the room does not have 4 doors', async () => {
  const REDRAW_CARD = { id: 'event_x', name: '重抽測試', text: '測試', redrawIf: { check: 'roomDoorCount', op: '==', value: 4 }, effects: [], needsCustomLogic: false };
  const content = makeContent({
    rooms: [{ id: 'room_new', doors: 2, floor: 'ground', drawType: 'event' }],
    cards: { events: [REDRAW_CARD], items: [], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient } = await setUpStartedGameWithContent(content);

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'east' }, resolve));
  const cardDrawn = await cardDrawnPromise;

  expect(cardDrawn.cardId).toBe('event_x'); // room has 2 doors, condition doesn't match -- drawn immediately

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('an event card with redrawIf playerFloor=="basement" is skipped when the player is actually in the basement', async () => {
  const REDRAW_CARD = { id: 'event_x', name: '重抽測試（地下室）', text: '測試', redrawIf: { check: 'playerFloor', op: '==', value: 'basement' }, effects: [], needsCustomLogic: false };
  const NORMAL_CARD = { id: 'event_y', name: '一般事件', text: '測試', effects: [], needsCustomLogic: false };
  const content = makeContent({
    rooms: [{ id: 'room_basement_new', doors: 4, floor: 'basement', drawType: 'event' }],
    cards: { events: [REDRAW_CARD, NORMAL_CARD], items: [], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  // Manually place the player in a basement room with one unexplored door --
  // there's no normal (non-collapse) way to reach basement in this test's
  // scope, so this mirrors how turnFlow.test.js manually seeds board state.
  player.floor = 'basement';
  player.x = 20;
  player.y = 20;
  gameState.board.basement.set(coordKey(20, 20), { roomId: 'room_manual_basement', x: 20, y: 20, doorSides: ['north'], droppedItems: [], item: null });

  const cardDrawnPromise = new Promise((resolve) => currentClient.once('game:cardDrawn', resolve));
  await new Promise((resolve) => currentClient.emit('game:move', { direction: 'north' }, resolve));
  const cardDrawn = await cardDrawnPromise;

  expect(cardDrawn.cardId).toBe('event_y'); // event_x rejected -- player really is in the basement

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

Check the top of `server/test/socketHandlers.test.js` for `getPlayer`/`coordKey`/`getGameState` imports — they're already imported (used by many other tests in this file), reuse them, don't add new import lines.

- [ ] **Step 7: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green.

- [ ] **Step 8: Commit**

```bash
git add server/src/game/cardDeck.js server/src/socketHandlers.js server/test/game/cardDeck.test.js server/test/socketHandlers.test.js
git commit -m "feat: add redrawIf conditional redraw for the event deck"
```

---

### Task 2: `remove_room_doors` / `add_room_door` effect types

**Files:**
- Modify: `server/src/game/effectResolver.js` (2 new handlers + HANDLERS registration + import additions)
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Produces: effect `{ type: "remove_room_doors", mode: "entry" | "unexplored_except_entry" }` and effect `{ type: "add_room_door", target: "random_doorless_wall" }`. Both operate on `gameState.board[player.floor]` room instances via the existing `getRoomForPlayer(gameState, player)` helper already defined in this file.
- Consumes: nothing from Task 1 (fully independent; only shares the target data files touched in Task 4).

- [ ] **Step 1: Write the failing tests**

Add to `server/test/game/effectResolver.test.js`, right after the last `remove_imprint` test (search for `resolveEffects remove_imprint ignores non-imprint cards`):

```javascript
test('resolveEffects remove_room_doors mode:"entry" removes the entry-direction door and syncs the neighbor', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.floor = 'ground';
  player.x = 20;
  player.y = 20;
  player.enteredFromSide = 'north';
  gameState.board.ground.set('20,20', { roomId: 'room_current', x: 20, y: 20, doorSides: ['north', 'east'], droppedItems: [], item: null });
  gameState.board.ground.set('20,19', { roomId: 'room_neighbor', x: 20, y: 19, doorSides: ['south', 'west'], droppedItems: [], item: null }); // north of (20,20)
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'remove_room_doors', mode: 'entry' },
  ]);
  expect(gameState.board.ground.get('20,20').doorSides).toEqual(['east']);
  expect(gameState.board.ground.get('20,19').doorSides).toEqual(['west']);
});

test('resolveEffects remove_room_doors mode:"unexplored_except_entry" strips unexplored doors but keeps the entry side and already-explored sides', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.floor = 'ground';
  player.x = 20;
  player.y = 20;
  player.enteredFromSide = 'north';
  gameState.board.ground.set('20,20', { roomId: 'room_current', x: 20, y: 20, doorSides: ['north', 'east', 'south', 'west'], droppedItems: [], item: null });
  gameState.board.ground.set('20,21', { roomId: 'room_explored_south', x: 20, y: 21, doorSides: ['north'], droppedItems: [], item: null }); // south of (20,20), already explored
  // east (21,20) and west (19,20) have no placed neighbor -- unexplored, removed
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'remove_room_doors', mode: 'unexplored_except_entry' },
  ]);
  expect(gameState.board.ground.get('20,20').doorSides.slice().sort()).toEqual(['north', 'south']);
});

test('resolveEffects add_room_door adds a door on the only doorless side and syncs an already-placed neighbor there', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.floor = 'ground';
  player.x = 20;
  player.y = 20;
  gameState.board.ground.set('20,20', { roomId: 'room_current', x: 20, y: 20, doorSides: ['north', 'east', 'south'], droppedItems: [], item: null }); // only west is doorless
  gameState.board.ground.set('19,20', { roomId: 'room_west_neighbor', x: 19, y: 20, doorSides: [], droppedItems: [], item: null }); // west of (20,20)
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'add_room_door', target: 'random_doorless_wall' },
  ]);
  expect(gameState.board.ground.get('20,20').doorSides).toContain('west');
  expect(gameState.board.ground.get('19,20').doorSides).toContain('east');
});

test('resolveEffects add_room_door only touches the current room when no neighbor is placed at the chosen side', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.floor = 'ground';
  player.x = 20;
  player.y = 20;
  gameState.board.ground.set('20,20', { roomId: 'room_current', x: 20, y: 20, doorSides: ['north', 'east', 'south'], droppedItems: [], item: null }); // only west is doorless, nothing placed at (19,20)
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'add_room_door', target: 'random_doorless_wall' },
  ]);
  expect(gameState.board.ground.get('20,20').doorSides.slice().sort()).toEqual(['east', 'north', 'south', 'west']);
  expect(gameState.board.ground.has('19,20')).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest effectResolver -t "remove_room_doors|add_room_door"`
Expected: FAIL (`UNSUPPORTED_EFFECT_TYPE` for both).

- [ ] **Step 3: Implement the handlers**

At the top of `server/src/game/effectResolver.js`, replace the `boardGenerator` import line:

```javascript
const { coordKey } = require('./boardGenerator');
```

with:

```javascript
const { coordKey, DIRECTION_DELTA } = require('./boardGenerator');
const { SIDES, OPPOSITE_SIDE } = require('./doorLayout');
```

(Add the `doorLayout` line right after the `boardGenerator` line; leave every other import in the file untouched.)

Add these two functions right after `handleRemoveImprint` (search for the closing `}` of `handleRemoveImprint`, right before the `// Moves the player to wherever a specific room` comment):

```javascript
function handleRemoveRoomDoors(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  const room = getRoomForPlayer(gameState, player);
  const enteredFromSide = player.enteredFromSide;
  if (effect.mode === 'entry') {
    room.doorSides = room.doorSides.filter((side) => side !== enteredFromSide);
    const delta = DIRECTION_DELTA[enteredFromSide];
    const neighbor = gameState.board[player.floor].get(coordKey(player.x + delta.dx, player.y + delta.dy));
    if (neighbor) {
      const facingSide = OPPOSITE_SIDE[enteredFromSide];
      neighbor.doorSides = neighbor.doorSides.filter((side) => side !== facingSide);
    }
  } else if (effect.mode === 'unexplored_except_entry') {
    room.doorSides = room.doorSides.filter((side) => {
      if (side === enteredFromSide) {
        return true;
      }
      const delta = DIRECTION_DELTA[side];
      const hasNeighbor = gameState.board[player.floor].has(coordKey(player.x + delta.dx, player.y + delta.dy));
      return hasNeighbor; // keep already-explored sides, drop unexplored ones
    });
  } else {
    throw new Error('UNKNOWN_REMOVE_ROOM_DOORS_MODE');
  }
  return { pending: false };
}

function handleAddRoomDoor(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const room = getRoomForPlayer(gameState, player);
  const candidateSides = SIDES.filter((side) => !room.doorSides.includes(side));
  const chosenSide = candidateSides[Math.floor(Math.random() * candidateSides.length)];
  room.doorSides.push(chosenSide);
  const delta = DIRECTION_DELTA[chosenSide];
  const neighbor = gameState.board[player.floor].get(coordKey(player.x + delta.dx, player.y + delta.dy));
  if (neighbor) {
    const facingSide = OPPOSITE_SIDE[chosenSide];
    if (!neighbor.doorSides.includes(facingSide)) {
      neighbor.doorSides.push(facingSide);
    }
  }
  return { pending: false };
}
```

In the `HANDLERS` map, add these two lines right after the existing `remove_imprint:` line:

```javascript
  remove_room_doors: (gameState, promptState, playerId, effect) => handleRemoveRoomDoors(gameState, playerId, effect),
  add_room_door: (gameState, promptState, playerId, effect) => handleAddRoomDoor(gameState, playerId),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest effectResolver -t "remove_room_doors|add_room_door"`
Expected: PASS, all 4 new tests.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green.

- [ ] **Step 6: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat: add remove_room_doors and add_room_door effect types"
```

---

### Task 3: `fall_to_basement` effect type + shared `dropToBasement` extraction

**Files:**
- Create: `server/src/game/collapseFall.js`
- Modify: `server/src/game/turnFlow.js` (`applyCollapseCheck` refactor, import changes)
- Modify: `server/src/game/effectResolver.js` (new `fall_to_basement` handler + import)
- Test: `server/test/game/collapseFall.test.js` (new), `server/test/game/effectResolver.test.js`

**Interfaces:**
- Produces: `dropToBasement(gameState, player, currentRoom)` in `collapseFall.js` — draws a basement room via `drawRoom(gameState.roomDeck, 'basement')`, places it at `currentRoom`'s exact `(x, y)` with a random guaranteed entry side, records `currentRoom.collapseLink = { x, y }`, moves the player there via `movePlayerTo`, and returns `{ basementRoomId, x, y }`. No damage applied (see Global Constraints).
- Consumes: nothing from Task 1. Builds on Task 2's edits to `effectResolver.js` (inserts after `handleAddRoomDoor` and after the `doorLayout` import Task 2 added) — do this task after Task 2, not in parallel with it.

- [ ] **Step 1: Write the failing `dropToBasement` unit tests**

Create `server/test/game/collapseFall.test.js`:

```javascript
const { dropToBasement } = require('../../src/game/collapseFall');
const { createGameState, addPlayer } = require('../../src/game/gameState');

const STARTING_ROOMS = [
  { id: 'room_lobby_a', name: '大門廳', floor: 'ground' },
  { id: 'room_lobby_b', name: '大門廳', floor: 'ground' },
  { id: 'room_lobby_c', name: '大門廳', floor: 'ground', stairsTo: 'room_upper_landing' },
  { id: 'room_upper_landing', name: '二樓平台', floor: 'upper' },
  { id: 'room_basement_landing', name: '地下平台', floor: 'basement' },
];

function makeStats() {
  return {
    might: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
    speed: { track: [2, 3, 4, 5, 6], baseIndex: 2, skullIndex: 0 },
    knowledge: { track: [1, 2, 3, 4, 5], baseIndex: 1, skullIndex: 0 },
    sanity: { track: [1, 2, 3, 4, 5], baseIndex: 2, skullIndex: 0 },
  };
}

test('dropToBasement places a new basement room at the same (x,y), links it, and moves the player there', () => {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_basement_new', doors: 4, floor: 'basement' }]);
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  const currentRoom = { roomId: 'room_current', x: 5, y: 5, doorSides: ['north'], droppedItems: [], item: null };
  gameState.board.ground.set('5,5', currentRoom);
  player.floor = 'ground';
  player.x = 5;
  player.y = 5;

  const result = dropToBasement(gameState, player, currentRoom);

  expect(player.floor).toBe('basement');
  expect(player.x).toBe(5);
  expect(player.y).toBe(5);
  expect(currentRoom.collapseLink).toEqual({ x: 5, y: 5 });
  expect(gameState.board.basement.get('5,5').roomId).toBe('room_basement_new');
  expect(result).toEqual({ basementRoomId: 'room_basement_new', x: 5, y: 5 });
});

test('dropToBasement throws ROOM_DECK_EMPTY when no basement room remains in the deck', () => {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_ground_only', doors: 4, floor: 'ground' }]);
  const player = addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  const currentRoom = { roomId: 'room_current', x: 5, y: 5, doorSides: ['north'], droppedItems: [], item: null };
  gameState.board.ground.set('5,5', currentRoom);
  expect(() => dropToBasement(gameState, player, currentRoom)).toThrow('ROOM_DECK_EMPTY');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest collapseFall`
Expected: FAIL (`Cannot find module '../../src/game/collapseFall'`).

- [ ] **Step 3: Implement `collapseFall.js`**

Create `server/src/game/collapseFall.js`:

```javascript
const { placeRoomAt } = require('./boardGenerator');
const { drawRoom } = require('./roomDeck');
const { movePlayerTo } = require('./playerEntity');
const { SIDES } = require('./doorLayout');

// Shared by the dice-check-gated collapsed-room fall (turnFlow.js's
// applyCollapseCheck) and the unconditional fall_to_basement effect
// (effectResolver.js, event_016) -- both drop a player through the floor
// into a freshly drawn basement room at the same (x, y). No physical
// damage is applied here (M3 damage-distribution system doesn't exist yet
// -- this is a known, deliberate gap, not an oversight).
function dropToBasement(gameState, player, currentRoom) {
  const guaranteedSide = SIDES[Math.floor(Math.random() * SIDES.length)];
  const basementRoomDefinition = drawRoom(gameState.roomDeck, 'basement');
  const basementRoom = placeRoomAt(
    gameState.board,
    'basement',
    currentRoom.x,
    currentRoom.y,
    basementRoomDefinition,
    guaranteedSide
  );
  currentRoom.collapseLink = { x: basementRoom.x, y: basementRoom.y };
  movePlayerTo(player, 'basement', basementRoom.x, basementRoom.y, null);
  return { basementRoomId: basementRoom.roomId, x: basementRoom.x, y: basementRoom.y };
}

module.exports = { dropToBasement };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest collapseFall`
Expected: PASS, both tests.

- [ ] **Step 5: Refactor `applyCollapseCheck` to use `dropToBasement`**

In `server/src/game/turnFlow.js`, update the `roomDeck` import (line 3):

Before:
```javascript
const { drawRoom, drawFeasibleRoom, hasRoomForFloor, removeRoomById } = require('./roomDeck');
```
After:
```javascript
const { drawFeasibleRoom, hasRoomForFloor, removeRoomById } = require('./roomDeck');
```

(`drawRoom` is only used inside `applyCollapseCheck`, which this step moves into `collapseFall.js` — removing it here avoids an unused import.)

Add this import right after it:
```javascript
const { dropToBasement } = require('./collapseFall');
```

Then replace `applyCollapseCheck`'s body (search for `function applyCollapseCheck`):

Before:
```javascript
function applyCollapseCheck(gameState, player, placedRoom, rolled) {
  if (rolled >= COLLAPSE_CHECK_MIN) {
    return { fell: false, rolled, stat: COLLAPSE_CHECK_STAT, required: COLLAPSE_CHECK_MIN, roomId: placedRoom.roomId };
  }
  const guaranteedSide = SIDES[Math.floor(Math.random() * SIDES.length)];
  const basementRoomDefinition = drawRoom(gameState.roomDeck, 'basement');
  const basementRoom = placeRoomAt(
    gameState.board,
    'basement',
    placedRoom.x,
    placedRoom.y,
    basementRoomDefinition,
    guaranteedSide
  );
  // Recorded on the collapsed room's own board instance (not the static
  // room definition) so later players standing here can find where "down"
  // leads without re-rolling -- see the room_action jump-down mechanic.
  placedRoom.collapseLink = { x: basementRoom.x, y: basementRoom.y };
  movePlayerTo(player, 'basement', basementRoom.x, basementRoom.y, null);
  return {
    fell: true,
    rolled,
    stat: COLLAPSE_CHECK_STAT,
    required: COLLAPSE_CHECK_MIN,
    roomId: placedRoom.roomId,
    basementRoomId: basementRoom.roomId,
    x: basementRoom.x,
    y: basementRoom.y,
  };
}
```
After:
```javascript
function applyCollapseCheck(gameState, player, placedRoom, rolled) {
  if (rolled >= COLLAPSE_CHECK_MIN) {
    return { fell: false, rolled, stat: COLLAPSE_CHECK_STAT, required: COLLAPSE_CHECK_MIN, roomId: placedRoom.roomId };
  }
  // dropToBasement also records placedRoom.collapseLink (on the collapsed
  // room's own board instance, not the static room definition) so later
  // players standing here can find where "down" leads without re-rolling --
  // see the room_action jump-down mechanic.
  const { basementRoomId, x, y } = dropToBasement(gameState, player, placedRoom);
  return {
    fell: true,
    rolled,
    stat: COLLAPSE_CHECK_STAT,
    required: COLLAPSE_CHECK_MIN,
    roomId: placedRoom.roomId,
    basementRoomId,
    x,
    y,
  };
}
```

(Leave the comment block immediately above this function, about M3 damage not being applied, exactly as-is — it's still accurate.)

- [ ] **Step 6: Run the turnFlow suite to confirm the refactor didn't change behavior**

Run: `cd server && npx jest turnFlow`
Expected: PASS, including every pre-existing collapse-check test (search the file for `applyCollapseCheck`/`collapseCheckPending`/`room_collapsed_room` to see which ones exercise this path — none of their assertions should need to change).

- [ ] **Step 7: Add the `fall_to_basement` effect handler**

In `server/src/game/effectResolver.js`, add this import right after the `doorLayout` import added in Task 2:

```javascript
const { dropToBasement } = require('./collapseFall');
```

Add this function right after `handleAddRoomDoor` (added in Task 2, which lands before this task):

```javascript
function handleFallToBasement(gameState, playerId) {
  const player = requirePlayer(gameState, playerId);
  const currentRoom = getRoomForPlayer(gameState, player);
  dropToBasement(gameState, player, currentRoom);
  return { pending: false };
}
```

In the `HANDLERS` map, add:

```javascript
  fall_to_basement: (gameState, promptState, playerId) => handleFallToBasement(gameState, playerId),
```

- [ ] **Step 8: Write the failing `fall_to_basement` effect test**

Add to `server/test/game/effectResolver.test.js`. This test needs its own `gameState` (not the file's `makeGameStateWithPlayer()`, whose default drawable-room pool has no `floor` field and so can never satisfy a basement draw) — add `createGameState` to the existing `gameState` import at the top of the file if it isn't already imported (check first: `const { createGameState, addPlayer } = require('../../src/game/gameState');` should already be there from the file's own `makeGameStateWithPlayer` helper).

```javascript
test('resolveEffects fall_to_basement drops the player into a new basement room at the same (x,y)', () => {
  const gameState = createGameState(STARTING_ROOMS, [{ id: 'room_basement_new', doors: 4, floor: 'basement' }]);
  addPlayer(gameState, { playerId: 'p1', name: 'Alice', stats: makeStats() });
  const player = gameState.players.get('p1');
  const currentRoom = { roomId: 'room_current', x: 8, y: 8, doorSides: ['north'], droppedItems: [], item: null };
  gameState.board.ground.set('8,8', currentRoom);
  player.floor = 'ground';
  player.x = 8;
  player.y = 8;
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'fall_to_basement' },
  ]);
  expect(player.floor).toBe('basement');
  expect(gameState.board.basement.get('8,8').roomId).toBe('room_basement_new');
  expect(currentRoom.collapseLink).toEqual({ x: 8, y: 8 });
});
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd server && npx jest effectResolver -t "fall_to_basement"`
Expected: PASS.

- [ ] **Step 10: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green.

- [ ] **Step 11: Commit**

```bash
git add server/src/game/collapseFall.js server/src/game/turnFlow.js server/src/game/effectResolver.js server/test/game/collapseFall.test.js server/test/game/effectResolver.test.js
git commit -m "feat: add fall_to_basement effect type, extract shared dropToBasement helper"
```

---

### Task 4: Card data — wire up event_014/015/016/028

**Files:**
- Modify: `data/cards/event-cards.json` (`event_014`, `event_015`, `event_016`, `event_028`)

**Interfaces:**
- Consumes: `redrawIf` handling from Task 1, `remove_room_doors`/`add_room_door` from Task 2, `fall_to_basement` from Task 3. Do this task last.

**Use the `Edit` tool with exact `old_string`/`new_string` matches for every JSON edit below — never rewrite this file by parsing and re-serializing it; that reformats the whole file and makes the diff unreviewable.** Before editing, re-read the target blocks with `grep -n '"event_01[4568]"' -A 8 data/cards/event-cards.json` — this file is actively edited by the developer in parallel sessions, so don't trust a stale in-context copy; if the current text doesn't match the "Before" blocks below, stop and report the mismatch rather than guessing.

- [ ] **Step 1: `event_014`**

Before:
```json
    "text": "當前房間除了進入方向已開啟的房門之外，其他未探索的房間變成牆，美術圖不變，不可再被探索",
    "effects": [],
    "needsCustomLogic": false
  },
  {
    "id": "event_015",
```
After:
```json
    "text": "當前房間除了進入方向已開啟的房門之外，其他未探索的房間變成牆，美術圖不變，不可再被探索",
    "effects": [{ "type": "remove_room_doors", "mode": "unexplored_except_entry" }],
    "needsCustomLogic": false
  },
  {
    "id": "event_015",
```

- [ ] **Step 2: `event_015`**

Before:
```json
    "text": "抽出此卡時檢查，如果當前房間為單一門房型，重抽事件卡。本卡效果：當前房間進入方向已開啟的那個房門，變成牆的狀態不可被探索，美術圖不變，該門相鄰的房間狀態也同步改變，其他房間門狀態不變。",
    "effects": [],
    "needsCustomLogic": true
  },
```
After:
```json
    "text": "抽出此卡時檢查，如果當前房間為單一門房型，重抽事件卡。本卡效果：當前房間進入方向已開啟的那個房門，變成牆的狀態不可被探索，美術圖不變，該門相鄰的房間狀態也同步改變，其他房間門狀態不變。",
    "redrawIf": { "check": "roomDoorCount", "op": "==", "value": 1 },
    "effects": [{ "type": "remove_room_doors", "mode": "entry" }],
    "needsCustomLogic": false
  },
```

- [ ] **Step 3: `event_016`**

Before:
```json
    "text": "抽出此卡時檢查，如果當前房間為地下室，重抽事件卡。落下至地下室相同座標的房間，機制同崩塌的房間。此事件卡效果可發生在二樓，此時角色進入到地下室的對應房間。",
    "feedbacktextOccur": "你掉落到了下一層的房間，落地時受了一點傷",
    "effects": [],
    "needsCustomLogic": false
  },
```
After:
```json
    "text": "抽出此卡時檢查，如果當前房間為地下室，重抽事件卡。落下至地下室相同座標的房間，機制同崩塌的房間。此事件卡效果可發生在二樓，此時角色進入到地下室的對應房間。",
    "redrawIf": { "check": "playerFloor", "op": "==", "value": "basement" },
    "feedbacktextOccur": "你掉落到了下一層的房間，落地時受了一點傷",
    "effects": [{ "type": "fall_to_basement" }],
    "needsCustomLogic": false
  },
```

- [ ] **Step 4: `event_028`**

Before:
```json
    "text": "抽出此卡時檢查，如果當前房間為四門的房型，重抽事件卡。在其中一個隨機無門的牆面上，生成一個可通行的門。如果該位置有對應的鄰房並且無門，則兩個房間都生成新的門相通",
    "effects": [],
    "needsCustomLogic": false
  },
```
After:
```json
    "text": "抽出此卡時檢查，如果當前房間為四門的房型，重抽事件卡。在其中一個隨機無門的牆面上，生成一個可通行的門。如果該位置有對應的鄰房並且無門，則兩個房間都生成新的門相通",
    "redrawIf": { "check": "roomDoorCount", "op": "==", "value": 4 },
    "effects": [{ "type": "add_room_door", "target": "random_doorless_wall" }],
    "needsCustomLogic": false
  },
```

- [ ] **Step 5: Validate JSON syntax**

Run: `cd "C:\Users\User\Desktop\Betrayal at House on the Hill" && node -e "JSON.parse(require('fs').readFileSync('data/cards/event-cards.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green. (This confirms nothing in the server reads `data/cards/event-cards.json` at test time in a way that would choke on the new `redrawIf` field — the server's own test fixtures construct their own card content independently, per the existing `makeContent`/`STARTING_ROOMS` pattern used throughout this plan's tests.)

- [ ] **Step 7: Commit**

```bash
git add data/cards/event-cards.json
git commit -m "feat: wire redrawIf and door-mutation effects into event_014/015/016/028"
```

---

## Final Verification

- [ ] `cd server && npm test` — full suite green
- [ ] `node -e "JSON.parse(require('fs').readFileSync('data/cards/event-cards.json','utf8'))"` — valid JSON
- [ ] No `client/` files touched (this plan is server-only)
