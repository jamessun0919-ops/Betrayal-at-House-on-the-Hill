# item_028 萬能鑰匙（開門行動力折扣）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player holding `item_028`（萬能鑰匙）pays 1 action point to open a door instead of the normal 2, and the discount applies/reverts live based on current inventory — no attach/detach lifecycle, no card data changes.

**Architecture:** `server/src/game/turnFlow.js` already hardcodes `OPEN_DOOR_AP_COST` at its two use sites (`getAvailableDirections`'s affordability check, `moveToRoom`'s actual deduction). Add a `getOpenDoorCost(player)` helper that checks `player.inventory` for `item_028` directly (no `persistent_modifier`/`modifiers`-array involvement — that system is for attach/detach lifecycles this effect doesn't need), and call it from both sites instead of the raw constant.

**Tech Stack:** Node.js (server only — no client changes, no card data changes in this plan). Jest (server tests).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-28-master-key-door-cost-design.md` — read it if anything below is ambiguous, it governs.
- `item_028`'s discount is a LIVE query against `player.inventory` at the moment of the affordability check / deduction — never attach a modifier, never cache a "has key" flag. Giving away, leaving, or otherwise losing `item_028` must revert the cost to 2 on the very next check with zero extra code (this falls out automatically from querying inventory fresh each call — do not add any cleanup/removal logic).
- `data/cards/item-cards.json`'s `item_028` entry is NOT touched by this plan — `effects` stays `[]`, `needsCustomLogic` stays `false`, both already correct.
- No `persistent_modifier`/`modifiers`-array code is touched — this is a deliberately separate, simpler mechanism from `blocksOpenDoor`.
- Both `OPEN_DOOR_AP_COST` use sites (`getAvailableDirections` and `moveToRoom`) must use the SAME computed cost for a given player at a given moment — an inconsistency between "is this option offered" and "how much does it actually cost" would be a bug.
- Server tests: `cd server && npm test` (Jest). Must end with the full suite green, not just the new tests.
- No frontend/client changes in this plan.

---

### Task 1: `getOpenDoorCost` helper + wire into both `OPEN_DOOR_AP_COST` use sites

**Files:**
- Modify: `server/src/game/turnFlow.js`
- Test: `server/test/game/turnFlow.test.js`

**Interfaces:**
- Produces: `getOpenDoorCost(player)` — a plain, synchronous function (no `gameState`/DB lookups needed, just checks `player.inventory`). Returns `1` if the player holds `item_028`, else `2`.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/game/turnFlow.test.js`, right after the existing `moveToRoom allows opening a door with exactly 2 action points, leaving 0 afterward` test (search for that exact string):

```javascript

test('getAvailableDirections and moveToRoom use a 1 action point cost for a player holding item_028 (萬能鑰匙)', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, floor: 'ground' }]);
  player.inventory.push({ id: 'item_028' });
  const startingAP = player.actionPoints; // 4, from the default makeStats() speed value
  const available = getAvailableDirections(gameState, 'p1');
  expect(available.find((a) => a.direction === 'east')).toEqual({ direction: 'east', kind: 'open_door' });
  const result = moveToRoom(gameState, 'p1', 'east');
  expect(result.kind).toBe('open_door');
  expect(player.actionPoints).toBe(startingAP - 1);
});

test('a player holding item_028 with only 1 action point can still open a door, ending at 0', () => {
  const { gameState, player } = makeGameStateWithPlayer([{ id: 'room_new', doors: 4, floor: 'ground' }]);
  player.inventory.push({ id: 'item_028' });
  player.actionPoints = 1;
  const available = getAvailableDirections(gameState, 'p1');
  expect(available.find((a) => a.direction === 'east')).toEqual({ direction: 'east', kind: 'open_door' });
  const result = moveToRoom(gameState, 'p1', 'east');
  expect(result.kind).toBe('open_door');
  expect(player.actionPoints).toBe(0);
});

test('door-open cost reverts to 2 action points immediately after item_028 leaves the inventory (no residual discount)', () => {
  const { gameState, player } = makeGameStateWithPlayer();
  gameState.board.ground.set('-1,1', { roomId: 'room_manual', x: -1, y: 1, doorSides: ['north', 'east', 'south', 'west'] });
  player.inventory.push({ id: 'item_028' });
  player.actionPoints = 1;
  const withKey = getAvailableDirections(gameState, 'p1');
  expect(withKey.filter((a) => a.kind === 'open_door').length).toBeGreaterThan(0); // affordable at 1 AP with the discount
  player.inventory = [];
  const withoutKey = getAvailableDirections(gameState, 'p1');
  expect(withoutKey.filter((a) => a.kind === 'open_door')).toEqual([]); // no longer affordable at 1 AP, full price applies immediately
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest turnFlow -t "item_028"`
Expected: FAIL (`getAvailableDirections`/`moveToRoom` still always charge the flat `OPEN_DOOR_AP_COST` of 2, so the first two tests' AP-remaining assertions are wrong and the third test's "affordable at 1 AP with the key" assertion fails).

- [ ] **Step 3: Add `getOpenDoorCost` and wire it in**

In `server/src/game/turnFlow.js`, add this constant and function right after the existing `OPEN_DOOR_AP_COST` constant (search for `const OPEN_DOOR_AP_COST = 2;`):

Before:
```javascript
const OPEN_DOOR_AP_COST = 2;

const BALLROOM_ID = 'room_ballroom';
```
After:
```javascript
const OPEN_DOOR_AP_COST = 2;
const OPEN_DOOR_AP_COST_WITH_MASTER_KEY = 1;
const MASTER_KEY_ITEM_ID = 'item_028';

function getOpenDoorCost(player) {
  const holdsMasterKey = player.inventory.some((item) => item.id === MASTER_KEY_ITEM_ID);
  return holdsMasterKey ? OPEN_DOOR_AP_COST_WITH_MASTER_KEY : OPEN_DOOR_AP_COST;
}

const BALLROOM_ID = 'room_ballroom';
```

Then update `getAvailableDirections` (search for `const canAffordOpenDoor = player.actionPoints >= OPEN_DOOR_AP_COST;`):

Before:
```javascript
  const canAffordOpenDoor = player.actionPoints >= OPEN_DOOR_AP_COST;
```
After:
```javascript
  const canAffordOpenDoor = player.actionPoints >= getOpenDoorCost(player);
```

Then update `moveToRoom` (search for `player.actionPoints -= OPEN_DOOR_AP_COST;` — it appears exactly once in this function):

Before:
```javascript
  player.actionPoints -= OPEN_DOOR_AP_COST;
```
After:
```javascript
  player.actionPoints -= getOpenDoorCost(player);
```

(Leave the `OPEN_DOOR_AP_COST` constant itself, and every other reference to it — e.g. in comments — untouched; it's still the base cost `getOpenDoorCost` falls back to.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest turnFlow -t "item_028"`
Expected: PASS, all 3 new tests.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green (this also re-confirms every pre-existing door-open/AP-cost test — none of which give the player `item_028` — still charges the full 2 AP exactly as before, proving the change is backward compatible).

- [ ] **Step 6: Commit**

```bash
git add server/src/game/turnFlow.js server/test/game/turnFlow.test.js
git commit -m "feat: item_028 (萬能鑰匙) discounts door-opening to 1 action point while held"
```

---

## Final Verification

- [ ] `cd server && npm test` — full suite green
- [ ] No `client/` or `data/` files touched (this plan is server-logic-only)
