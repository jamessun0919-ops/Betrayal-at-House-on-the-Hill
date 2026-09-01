# Character Icon Positioning (3+ Players Grid Centering) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When 3 or more players occupy the same room in `FocusedRoomView`, their badges switch from door-anchored positioning to a fixed 2×3 grid, centered in the room and ordered by `characterId`; 1-2 occupants keep the existing door-anchored behavior unchanged.

**Architecture:** Single new pure function (`gridBadgeStyle`) alongside the existing `badgeStyle` in `client/src/gameplay/FocusedRoomView.jsx`, plus a one-line branch in the existing render loop that picks between the two based on `roomsInSameSpot.length`. No server changes, no new props, no new state — `enteredFromSide` and `characterId` are already available on every player object this component receives.

**Tech Stack:** React (client-only), no build/test tooling changes.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-09-01-character-icon-positioning-design.md` — read it for full background/rationale; this plan's code must match it exactly.
- Grid trigger threshold: `roomsInSameSpot.length >= 3` (not `> 3`).
- Grid slot order: sort by `characterId` ascending (`localeCompare`), fill slots 1..N in order, no gaps, no per-character fixed slot assignment.
- Room occupancy is capped at 6 (game's total character roster size), so the 2×3 grid (6 slots) never overflows — do not add overflow handling.
- 1-2 occupant rendering must be byte-for-byte unchanged from current behavior (same `badgeStyle` call, same array order, same everything) — this plan only adds a new path for the ≥3 case, it does not touch the existing ≤2 path's logic.
- No transition/animation between door-anchored and grid layouts — this is out of scope per the design doc.

---

### Task 1: Add `gridBadgeStyle` and branch the render loop

**Files:**
- Modify: `client/src/gameplay/FocusedRoomView.jsx:74-137` (add new function near `badgeStyle`), `client/src/gameplay/FocusedRoomView.jsx:295-306` (render loop branch)

**Interfaces:**
- Consumes: nothing from elsewhere in this codebase beyond what `FocusedRoomView` already receives as props (`roomsInSameSpot`, `allPlayers`, `characterContent`) — this is the only task in this plan.
- Produces: `gridBadgeStyle(slotIndex)` — takes a zero-based slot index (0-5), returns a style object with the same shape as `badgeStyle`'s return value (`{position, top/left/right/bottom, transform, width, height}`), for consumption directly by the `style` prop of `PlayerBadge`.

- [ ] **Step 1: Add the grid layout constants and `gridBadgeStyle` function**

Current code at `client/src/gameplay/FocusedRoomView.jsx:74-137`:

```javascript
const BADGE_EDGE_MARGIN = 8;
const BADGE_STAGGER_PERCENT = 8;

// Positions a player's badge at the edge of the room tile they entered
// through (enteredFromSide is the OPPOSITE of the move direction -- moving
// north means you walked in through the room's south wall). null means
// spawned here or arrived via stairs, so the badge sits centered. Percentage
// + transform based so it works at any tile size.
// Diameter's radius (half of the 75%-of-door-frame diameter below) -- the
// edge-anchored positions below add this on top of BADGE_EDGE_MARGIN, so the
// badge sits one radius further into the room from where it used to touch
// the edge (per the developer's visual adjustment).
const BADGE_RADIUS = 'calc(var(--peek-size) * 0.375)';
const BADGE_INSET = `calc(${BADGE_EDGE_MARGIN}px + ${BADGE_RADIUS})`;

function badgeStyle(enteredFromSide, index, total) {
  const stagger = (index - (total - 1) / 2) * BADGE_STAGGER_PERCENT;
  // Diameter is 75% of the door frame's width, i.e. the neighbor-peek band
  // thickness (--peek-size) -- the same strip the room art's door opening
  // renders into, scaled down per the developer's visual adjustment.
  const size = { width: 'calc(var(--peek-size) * 0.75)', height: 'calc(var(--peek-size) * 0.75)' };
  switch (enteredFromSide) {
    case 'north':
      return {
        position: 'absolute',
        top: BADGE_INSET,
        left: `calc(50% + ${stagger}%)`,
        transform: 'translateX(-50%)',
        ...size,
      };
    case 'south':
      return {
        position: 'absolute',
        bottom: BADGE_INSET,
        left: `calc(50% + ${stagger}%)`,
        transform: 'translateX(-50%)',
        ...size,
      };
    case 'east':
      return {
        position: 'absolute',
        right: BADGE_INSET,
        top: `calc(50% + ${stagger}%)`,
        transform: 'translateY(-50%)',
        ...size,
      };
    case 'west':
      return {
        position: 'absolute',
        left: BADGE_INSET,
        top: `calc(50% + ${stagger}%)`,
        transform: 'translateY(-50%)',
        ...size,
      };
    default:
      return {
        position: 'absolute',
        top: '50%',
        left: `calc(50% + ${stagger}%)`,
        transform: 'translate(-50%, -50%)',
        ...size,
      };
  }
}
```

Insert this new block immediately after the closing `}` of `badgeStyle` (i.e. right after current line 137, before the blank line that precedes `function NeighborPeek`):

```javascript

// When a room has 3+ occupants, every individual enteredFromSide is ignored
// in favor of a fixed 2x3 grid, centered in the room (top-left to
// bottom-right, filled in characterId order -- see the 2026-09-01 design
// doc). Room occupancy is capped at 6 (the game's total character roster
// size), so these 6 slots never overflow.
const GRID_COLUMNS_PERCENT = [20, 50, 80];
const GRID_ROWS_PERCENT = [30, 70];

function gridBadgeStyle(slotIndex) {
  const col = slotIndex % 3;
  const row = Math.floor(slotIndex / 3);
  const size = { width: 'calc(var(--peek-size) * 0.75)', height: 'calc(var(--peek-size) * 0.75)' };
  return {
    position: 'absolute',
    left: `${GRID_COLUMNS_PERCENT[col]}%`,
    top: `${GRID_ROWS_PERCENT[row]}%`,
    transform: 'translate(-50%, -50%)',
    ...size,
  };
}
```

- [ ] **Step 2: Branch the render loop**

Current code at `client/src/gameplay/FocusedRoomView.jsx:295-306`:

```jsx
      {roomsInSameSpot.map((p, i) => {
        const colorIndex = allPlayers.findIndex((ap) => ap.playerId === p.playerId);
        return (
          <PlayerBadge
            key={p.playerId}
            name={p.name}
            colorIndex={colorIndex === -1 ? i : colorIndex}
            iconSrc={findCharacterIcon(p.characterId, characterContent)}
            style={badgeStyle(p.enteredFromSide, i, roomsInSameSpot.length)}
          />
        );
      })}
```

Replace with:

```jsx
      {(roomsInSameSpot.length >= 3
        ? [...roomsInSameSpot].sort((a, b) => (a.characterId || '').localeCompare(b.characterId || ''))
        : roomsInSameSpot
      ).map((p, i) => {
        const colorIndex = allPlayers.findIndex((ap) => ap.playerId === p.playerId);
        return (
          <PlayerBadge
            key={p.playerId}
            name={p.name}
            colorIndex={colorIndex === -1 ? i : colorIndex}
            iconSrc={findCharacterIcon(p.characterId, characterContent)}
            style={roomsInSameSpot.length >= 3 ? gridBadgeStyle(i) : badgeStyle(p.enteredFromSide, i, roomsInSameSpot.length)}
          />
        );
      })}
```

When `roomsInSameSpot.length >= 3`, the array is sorted by `characterId` before mapping, so the map's index `i` doubles as the sorted rank and the grid slot index — no separate lookup is needed. When `<3`, the array and every call are untouched from the original code (same order, same `badgeStyle` call), so 1-2 occupant behavior is provably unchanged.

- [ ] **Step 3: Manual verification checklist**

There is no client-side automated test suite in this project (established project pattern) — this step is the actual verification for this task.

1. Restart both dev servers fresh (per this project's rule: never rely on hot-reload alone after a code change — close and restart): stop any running `server`/`client` preview servers, then start `server` (`.claude/launch.json` entry `server`, port 3001) and `client` (entry `client`, port 5173).
2. Open enough browser tabs to get 3+ players into the same room at once. The most reliable way to reach 3+ in one room without depending on movement RNG: create a lobby, join with 3+ tabs, pick 3+ different characters, start the game — all players spawn in the same starting room (`大門廳`), which already gives a 3+ occupancy scenario with every player's `enteredFromSide` set to `null`.
3. Confirm on every tab: all 3+ badges are arranged in the fixed 2×3 grid (2 rows, 3 columns) rather than the old single-row centered stagger, and the left-to-right, top-to-bottom order matches ascending `characterId` (cross-check against each tab's own character to confirm the ordering, since `characterId` isn't directly shown in the debug UI — note which character picked first/second/etc. during character select, since character selection order this project uses is deterministic turn order, not necessarily `characterId` order, so don't assume they're the same).
4. If reachable without excessive extra setup, also verify: exactly 1 player alone in a room still anchors at their own door (or center, if arrived via stairs) exactly as before; exactly 2 players who both moved through the same door still show side-by-side at that door; exactly 2 players who arrived via different doors (or one via door, one via stairs) still each position independently per their own `enteredFromSide`. These three cases are provably unchanged by Step 2's diff (the `<3` branch is byte-for-byte the original code), so a quick spot-check is sufficient — this isn't new logic that needs exhaustive coverage.
5. If a 4th, 5th, or 6th player is reachable in the same test session (e.g. by having more tabs join before character select finishes), confirm the grid fills additional slots left-to-right, top-to-bottom, still in `characterId` order, with no gaps before the last occupied slot.
6. Check the browser console and server terminal for errors throughout.

- [ ] **Step 4: Commit**

```bash
git add client/src/gameplay/FocusedRoomView.jsx
git commit -m "feat: center 3+ same-room player badges on a fixed 2x3 grid

Single occupant and 2-occupant (same-door or different-door) badge
positioning is unchanged. At 3+ occupants, every individual
enteredFromSide is ignored in favor of a fixed grid, filled in
characterId order -- matches the 2026-09-01 design doc."
```
