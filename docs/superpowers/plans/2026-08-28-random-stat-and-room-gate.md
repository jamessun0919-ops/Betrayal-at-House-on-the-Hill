# 隨機屬性提升 + 房間條件效果 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `item_027`（魔力樂譜）and `event_036`（能量轉換）real mechanical support: a room-conditional effect wrapper (`room_gate`), a random-stat-pick effect (`random_stat_change`), and an extension to the existing `remove_imprint` effect so its consequences can be conditional on an imprint actually being removed.

**Architecture:** Three additions to `server/src/game/effectResolver.js`, all following the codebase's existing "wrapper effect" pattern (`dice_check`/`choice`/`toggle_active` all optionally resolve a nested `effects` array via the same `resolveEffects` recursion): `room_gate` checks the player's current room id against an allow-list before resolving nested effects; `random_stat_change` picks one of the 4 stats uniformly at random and applies a delta; `remove_imprint` gains an optional `effects` field that only resolves when an imprint was actually removed. No new data model, no new UI — `item_027` reuses the existing dice-check item-use flow (including the existing `appliedCount`-gated item-consumption logic, so "check failed" or "wrong room" naturally leaves the item unconsumed with zero new code for that part).

**Tech Stack:** Node.js/Express/Socket.IO (server only — no client changes in this plan). Jest (server tests).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-28-random-stat-and-room-gate-design.md` — read it if anything below is ambiguous, it governs.
- `random_stat_change`: `{ "type": "random_stat_change", "delta": <number> }`. Picks uniformly among `might`/`speed`/`knowledge`/`sanity` (reuse the existing `STATS` constant exported from `playerEntity.js` — do not hardcode a new array) and applies `changeStat` with the given delta to the chosen stat only.
- `room_gate`: `{ "type": "room_gate", "roomIds": [...], "effects": [...] }`. Compares the player's CURRENT room's `roomId` (via the existing `getRoomForPlayer` helper already in `effectResolver.js`) against `roomIds`. Match → resolve `effects` via `resolveEffects`. No match → no-op, return `{ pending: false, appliedCount: 0 }` (this is what makes the existing item-use consumption logic correctly leave the item unconsumed — no new consumption code needed).
- `remove_imprint` extension: add an optional `effects` field. Only resolve it when an imprint was actually found and removed (i.e., inside the branch that currently does `removeItem(player, chosenId)` and the reversal loop) — NOT when `imprintIds.length === 0` (that branch must keep returning `{ pending: false, appliedCount: 0 }` exactly as today, with the nested `effects` never touched). This requires threading `promptState` into `handleRemoveImprint`, which the `HANDLERS` map entry already receives but currently discards.
- `item_027`: `category` stays `"consumable"`. Mechanism is authoritative from `room_organ`/`room_piano`'s own room text, NOT the item's pre-existing wording — knowledge dice check (die-sum ≥ 6 passes), fixed `speed +1` on success, no effect at all on failure or when used outside those two rooms. The item is consumed only when the roll passes (this falls out of the existing `appliedCount`-gated consumption in `socketHandlers.js:1050` — do not add any explicit `lose_item` effect).
- `event_036`: `remove_imprint`'s nested `effects` is `[{ "type": "random_stat_change", "delta": 1 }]`. No imprint held → nothing happens at all (no stat change). `needsCustomLogic` becomes `false`.
- Do NOT touch `room_organ`/`room_piano`'s own `effects`/`needsCustomLogic` fields in `data/rooms/rooms.json` — the mechanism lives entirely on the item side; the rooms need no changes.
- Server tests: `cd server && npm test` (Jest). Every task must end with the full suite green, not just its own new test file.
- No frontend/client changes in this plan — do not touch anything under `client/`.
- `data/cards/*.json` are large hand-maintained files also edited directly by the developer between sessions. Use precise text-level `Edit` (exact old_string/new_string) — never parse-and-rewrite the whole file. Before editing, re-read the target block to confirm it still matches the plan's "Before" text; if it doesn't, stop and report the actual current content rather than guessing.

---

### Task 1: `room_gate`, `random_stat_change` effect types + `remove_imprint` nested-effects extension

**Files:**
- Modify: `server/src/game/effectResolver.js` (2 new handlers, 1 modified handler, import + HANDLERS map changes)
- Test: `server/test/game/effectResolver.test.js`

**Interfaces:**
- Produces: effect `{ type: "room_gate", roomIds: [...], effects: [...] }`, effect `{ type: "random_stat_change", delta: <number> }`, and the extended `{ type: "remove_imprint", effects?: [...] }` (the `effects` field is optional; omitting it preserves the exact pre-existing behavior — this is a backward-compatible extension, not a breaking change).
- Consumes: nothing from elsewhere in this plan (Task 2 depends on this task, not the reverse).

- [ ] **Step 1: Write the failing tests**

Add to `server/test/game/effectResolver.test.js`, at the very end of the file (after the existing `resolveEffects fall_to_basement drops the player into a new basement room at the same (x,y)` test):

```javascript

test('resolveEffects random_stat_change picks might when Math.random selects index 0', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'random_stat_change', delta: 1 },
  ]);
  rngSpy.mockRestore();
  expect(player.stats.might.currentIndex).toBe(3); // baseIndex 2 + 1
  expect(player.stats.speed.currentIndex).toBe(2);
  expect(player.stats.knowledge.currentIndex).toBe(1);
  expect(player.stats.sanity.currentIndex).toBe(2);
});

test('resolveEffects random_stat_change picks sanity when Math.random selects the last index', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'random_stat_change', delta: 1 },
  ]);
  rngSpy.mockRestore();
  expect(player.stats.sanity.currentIndex).toBe(3); // baseIndex 2 + 1
  expect(player.stats.might.currentIndex).toBe(2);
  expect(player.stats.speed.currentIndex).toBe(2);
  expect(player.stats.knowledge.currentIndex).toBe(1);
});

test('resolveEffects room_gate resolves nested effects when the player is in a matching room', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.floor = 'ground';
  player.x = 30;
  player.y = 30;
  gameState.board.ground.set('30,30', { roomId: 'room_organ', x: 30, y: 30, doorSides: ['north'], droppedItems: [], item: null });
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'room_gate', roomIds: ['room_organ', 'room_piano'], effects: [
      { type: 'stat_change', stat: 'speed', delta: 1 },
    ] },
  ]);
  expect(player.stats.speed.currentIndex).toBe(3); // baseIndex 2 + 1
});

test('resolveEffects room_gate no-ops (appliedCount:0) when the player is not in a matching room', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.floor = 'ground';
  player.x = 30;
  player.y = 30;
  gameState.board.ground.set('30,30', { roomId: 'room_lobby_a', x: 30, y: 30, doorSides: ['north'], droppedItems: [], item: null });
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'room_gate', roomIds: ['room_organ', 'room_piano'], effects: [
      { type: 'stat_change', stat: 'speed', delta: 1 },
    ] },
  ]);
  expect(result).toEqual({ pending: false, appliedCount: 0 });
  expect(player.stats.speed.currentIndex).toBe(2); // unchanged
});

test('resolveEffects remove_imprint with nested effects resolves them only when an imprint was actually removed', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'omen_002' });
  player.stats.knowledge.currentIndex += 2; // simulate having already gained the imprint's own +2
  const rngSpy = jest.spyOn(Math, 'random')
    .mockReturnValueOnce(0.5) // remove_imprint's imprint-index pick (only 1 held -> value irrelevant)
    .mockReturnValueOnce(0); // random_stat_change picks might (index 0)
  resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'remove_imprint', effects: [{ type: 'random_stat_change', delta: 1 }] },
  ], { omenCatalog: [{ id: 'omen_002', category: 'imprint', effects: [{ type: 'stat_change', stat: 'knowledge', delta: 2 }] }] });
  rngSpy.mockRestore();
  expect(player.inventory).toEqual([]);
  expect(player.stats.knowledge.currentIndex).toBe(1); // baseIndex, reverted by remove_imprint's own reversal
  expect(player.stats.might.currentIndex).toBe(3); // baseIndex 2 + 1, from the nested random_stat_change
});

test('resolveEffects remove_imprint with nested effects does not resolve them when the player holds no imprints', () => {
  const gameState = makeGameStateWithPlayer();
  const player = gameState.players.get('p1');
  player.inventory.push({ id: 'item_003' });
  const result = resolveEffects(gameState, createPromptState(), 'p1', [
    { type: 'remove_imprint', effects: [{ type: 'random_stat_change', delta: 1 }] },
  ], { itemCatalog: [{ id: 'item_003', category: 'consumable' }] });
  expect(result).toEqual({ pending: false, appliedCount: 0 });
  expect(player.inventory).toEqual([{ id: 'item_003' }]);
  expect(player.stats.might.currentIndex).toBe(2); // unchanged -- nested effect never ran
  expect(player.stats.speed.currentIndex).toBe(2);
  expect(player.stats.knowledge.currentIndex).toBe(1);
  expect(player.stats.sanity.currentIndex).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest effectResolver -t "random_stat_change|room_gate|remove_imprint with nested effects"`
Expected: FAIL (`random_stat_change`/`room_gate` are `UNSUPPORTED_EFFECT_TYPE`; the two `remove_imprint` nested-effects tests fail because the nested `effects` field is currently ignored — the first one's `might.currentIndex` assertion fails since nothing runs the nested effect yet).

- [ ] **Step 3: Update the `playerEntity` import**

In `server/src/game/effectResolver.js`, update the top import line:

Before:
```javascript
const { getPlayer } = require('./gameState');
const { changeStat, addItem, removeItem, getStatValue, movePlayerTo } = require('./playerEntity');
```
After:
```javascript
const { getPlayer } = require('./gameState');
const { changeStat, addItem, removeItem, getStatValue, movePlayerTo, STATS } = require('./playerEntity');
```

(Every other import line stays untouched.)

- [ ] **Step 4: Add `handleRandomStatChange`**

Add this function right after `handleStatChange` (search for the `function handleStatChange` block; insert right after its closing `}`, before `function handleActionPoints`):

```javascript
function handleRandomStatChange(gameState, playerId, effect) {
  const player = requirePlayer(gameState, playerId);
  const stat = STATS[Math.floor(Math.random() * STATS.length)];
  changeStat(player, stat, effect.delta, gameState.hauntStarted);
  return { pending: false };
}
```

- [ ] **Step 5: Add `handleRoomGate`**

Add this function right after `handleToggleActive` (search for the `function handleToggleActive` block; insert right after its closing `}`, before `function handleSwitchControl`):

```javascript
function handleRoomGate(gameState, promptState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const room = getRoomForPlayer(gameState, player);
  if (!effect.roomIds.includes(room.roomId)) {
    return { pending: false, appliedCount: 0 };
  }
  return resolveEffects(gameState, promptState, playerId, effect.effects, context);
}
```

- [ ] **Step 6: Extend `handleRemoveImprint` with optional nested effects**

Find `function handleRemoveImprint` and replace it entirely:

Before:
```javascript
function handleRemoveImprint(gameState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const catalog = [...((context && context.itemCatalog) || []), ...((context && context.omenCatalog) || [])];
  const imprintIds = player.inventory
    .map((item) => item.id)
    .filter((id) => {
      const cardDef = catalog.find((c) => c.id === id);
      return cardDef && cardDef.category === 'imprint';
    });
  if (imprintIds.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const chosenId = imprintIds[Math.floor(Math.random() * imprintIds.length)];
  const cardDef = catalog.find((c) => c.id === chosenId);
  removeItem(player, chosenId);
  for (const cardEffect of cardDef.effects || []) {
    if (cardEffect.type === 'stat_change' && !cardEffect.restoreToBase) {
      changeStat(player, cardEffect.stat, -cardEffect.delta, gameState.hauntStarted);
    }
  }
  return { pending: false };
}
```
After:
```javascript
function handleRemoveImprint(gameState, promptState, playerId, effect, context) {
  const player = requirePlayer(gameState, playerId);
  const catalog = [...((context && context.itemCatalog) || []), ...((context && context.omenCatalog) || [])];
  const imprintIds = player.inventory
    .map((item) => item.id)
    .filter((id) => {
      const cardDef = catalog.find((c) => c.id === id);
      return cardDef && cardDef.category === 'imprint';
    });
  if (imprintIds.length === 0) {
    return { pending: false, appliedCount: 0 };
  }
  const chosenId = imprintIds[Math.floor(Math.random() * imprintIds.length)];
  const cardDef = catalog.find((c) => c.id === chosenId);
  removeItem(player, chosenId);
  for (const cardEffect of cardDef.effects || []) {
    if (cardEffect.type === 'stat_change' && !cardEffect.restoreToBase) {
      changeStat(player, cardEffect.stat, -cardEffect.delta, gameState.hauntStarted);
    }
  }
  if (Array.isArray(effect.effects) && effect.effects.length > 0) {
    return resolveEffects(gameState, promptState, playerId, effect.effects, context);
  }
  return { pending: false };
}
```

(Only the function signature's second parameter and the new `if` block before the final `return` changed — the imprint-selection and reversal logic in the middle is untouched.)

- [ ] **Step 7: Update the `HANDLERS` map**

Find the `HANDLERS` map (search for `const HANDLERS = Object.assign`). Update the existing `remove_imprint` line and add two new lines right after it:

Before:
```javascript
  remove_imprint: (gameState, promptState, playerId, effect, context) => handleRemoveImprint(gameState, playerId, effect, context),
```
After:
```javascript
  remove_imprint: (gameState, promptState, playerId, effect, context) => handleRemoveImprint(gameState, promptState, playerId, effect, context),
  random_stat_change: (gameState, promptState, playerId, effect) => handleRandomStatChange(gameState, playerId, effect),
  room_gate: (gameState, promptState, playerId, effect, context) => handleRoomGate(gameState, promptState, playerId, effect, context),
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd server && npx jest effectResolver`
Expected: PASS, full file green (this also re-confirms every pre-existing `remove_imprint` test — the ones without an `effects` field — still passes unchanged, proving the extension is backward compatible).

- [ ] **Step 9: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green.

- [ ] **Step 10: Commit**

```bash
git add server/src/game/effectResolver.js server/test/game/effectResolver.test.js
git commit -m "feat: add room_gate and random_stat_change effect types, extend remove_imprint with optional nested effects"
```

---

### Task 2: Card data — wire up `item_027` and `event_036`

**Files:**
- Modify: `data/cards/item-cards.json` (`item_027`)
- Modify: `data/cards/event-cards.json` (`event_036`)
- Test: `server/test/socketHandlers.test.js`

**Interfaces:**
- Consumes: `room_gate`/`random_stat_change`/extended `remove_imprint` from Task 1. Do this task after Task 1.

- [ ] **Step 1: Re-read the current `item_027` block and confirm it matches**

Before editing, run `grep -n '"id": "item_027"' -A 10 data/cards/item-cards.json` and confirm the current content matches the "Before" block below exactly. This file is actively edited by the developer between sessions — if it doesn't match, stop and report the actual current content rather than guessing.

- [ ] **Step 2: Edit `item_027`**

In `data/cards/item-cards.json`:

Before:
```json
    "id": "item_027",
    "name": "魔力樂譜",
    "description": "一份完整的樂譜，在月光下散發出微微的光芒，似乎有某種魔力，也許應該找個地方試著彈奏",
    "feedbacktextOccur":"你演奏了這份樂譜，這是首配合彌撒進行的頌恩聖歌．你因此充滿了力量（能力隨機上升一級別）",
    "text": "於特定房間行動需要的道具。在room_organ或room_piano使用，增加隨機一點能力。在非特定的房間無事發生",
    "effects": [],
    "category": "consumable",
    "canTargetOthers": false,
    "needsCustomLogic": false
  },
```
After:
```json
    "id": "item_027",
    "name": "魔力樂譜",
    "description": "一份完整的樂譜，在月光下散發出微微的光芒，似乎有某種魔力，也許應該找個地方試著彈奏",
    "text": "於特定房間行動需要的道具。在room_organ或room_piano使用，通過知識考驗（骰數６以上），提升速度一個級別。未通過考驗或在非特定房間使用，皆無事發生，道具保留。",
    "feedbacktextDice": {"6+":"你演奏了這份樂譜，這是首配合彌撒進行的頌恩聖歌。你因此充滿了力量（速度提升一個級別）","0-5":"你嘗試演奏，但彈得荒腔走板，什麼也沒發生"},
    "effects": [{
      "type": "room_gate",
      "roomIds": ["room_organ", "room_piano"],
      "effects": [{
        "type": "dice_check",
        "stat": "knowledge",
        "tiers": [
          { "min": 6, "max": 8, "effects": [{ "type": "stat_change", "stat": "speed", "delta": 1 }] },
          { "min": 0, "max": 5, "effects": [] }
        ]
      }]
    }],
    "category": "consumable",
    "canTargetOthers": false,
    "needsCustomLogic": false
  },
```

- [ ] **Step 3: Re-read and edit `event_036`**

Run `grep -n '"id": "event_036"' -A 7 data/cards/event-cards.json` and confirm it matches the "Before" block below.

In `data/cards/event-cards.json`:

Before:
```json
    "id": "event_036",
    "name": "能量轉換",
    "description": "你在房間裡發現一台神秘儀器，旁邊的說明書詳細說明了如何進行能量的轉換，可以將這間古堡內的神祕能量，做為強化身體素質的燃料",
    "text": "如果角色身上有銘印，隨機消滅一個銘印，並提升一個隨機能力的級別。",
    "feedbacktextOccur": "你手臂上的一個詭異印記消失，你感覺一股能量改造了你的身體。",
    "effects": [{ "type": "remove_imprint" }],
    "needsCustomLogic": true
  }
```
After:
```json
    "id": "event_036",
    "name": "能量轉換",
    "description": "你在房間裡發現一台神秘儀器，旁邊的說明書詳細說明了如何進行能量的轉換，可以將這間古堡內的神祕能量，做為強化身體素質的燃料",
    "text": "如果角色身上有銘印，隨機消滅一個銘印，並提升一個隨機能力的級別。",
    "feedbacktextOccur": "你手臂上的一個詭異印記消失，你感覺一股能量改造了你的身體。",
    "effects": [{ "type": "remove_imprint", "effects": [{ "type": "random_stat_change", "delta": 1 }] }],
    "needsCustomLogic": false
  }
```

(Note this is the last card in the array, so its closing brace has no trailing comma — leave it exactly as shown, no comma added.)

- [ ] **Step 4: Validate JSON syntax**

Run: `cd "C:\Users\User\Desktop\Betrayal at House on the Hill" && node -e "JSON.parse(require('fs').readFileSync('data/cards/item-cards.json','utf8')); JSON.parse(require('fs').readFileSync('data/cards/event-cards.json','utf8')); console.log('all valid')"`
Expected: `all valid`

- [ ] **Step 5: Write the failing socket-level tests for `item_027`**

Add to `server/test/socketHandlers.test.js`, near the existing `item_009` dice-check test (search for `test('game:selectAction item: a consumable item that fails its check is not removed`):

```javascript
const ITEM_027_MUSIC_SCORE = {
  id: 'item_027',
  name: '魔力樂譜',
  effects: [{
    type: 'room_gate',
    roomIds: ['room_organ', 'room_piano'],
    effects: [{
      type: 'dice_check',
      stat: 'knowledge',
      tiers: [
        { min: 6, max: 8, effects: [{ type: 'stat_change', stat: 'speed', delta: 1 }] },
        { min: 0, max: 5, effects: [] },
      ],
    }],
  }],
  category: 'consumable',
  canTargetOthers: false,
};

test('game:selectAction item_027 in room_organ with a passing knowledge check: speed +1, item consumed', async () => {
  const content = makeContent({
    cards: { events: [], items: [ITEM_027_MUSIC_SCORE], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_027' });
  player.floor = 'ground';
  player.x = 40;
  player.y = 40;
  player.stats.knowledge.currentIndex = 3; // 4 dice at baseIndex+2 track value -- guarantees a sum >= 6 with the mock below
  gameState.board.ground.set('40,40', { roomId: 'room_organ', x: 40, y: 40, doorSides: ['north'], droppedItems: [], item: null });

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // every die -> highest face, guaranteed pass
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_027' }, resolve));
  await effectResolvedPromise;
  rngSpy.mockRestore();

  expect(getPlayer(gameState, currentPlayerId).stats.speed.currentIndex).toBe(3); // baseIndex 2 + 1
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([]); // consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_027 in room_organ with a failing knowledge check: no stat change, item kept', async () => {
  const content = makeContent({
    cards: { events: [], items: [ITEM_027_MUSIC_SCORE], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_027' });
  player.floor = 'ground';
  player.x = 40;
  player.y = 40;
  gameState.board.ground.set('40,40', { roomId: 'room_organ', x: 40, y: 40, doorSides: ['north'], droppedItems: [], item: null });

  const rngSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // every die -> lowest face, guaranteed fail
  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_027' }, resolve));
  await effectResolvedPromise;
  rngSpy.mockRestore();

  expect(getPlayer(gameState, currentPlayerId).stats.speed.currentIndex).toBe(2); // unchanged (baseIndex)
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_027' }]); // not consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});

test('game:selectAction item_027 outside room_organ/room_piano: no effect, item kept', async () => {
  const content = makeContent({
    cards: { events: [], items: [ITEM_027_MUSIC_SCORE], omens: [] },
  });
  const { httpServer, clientA, clientB, currentClient, currentPlayerId, roomCode, gameManager } = await setUpStartedGameWithContent(content);
  const gameState = getGameState(gameManager, roomCode);
  const player = getPlayer(gameState, currentPlayerId);
  player.inventory.push({ id: 'item_027' });
  player.floor = 'ground';
  player.x = 40;
  player.y = 40;
  gameState.board.ground.set('40,40', { roomId: 'room_lobby_a', x: 40, y: 40, doorSides: ['north'], droppedItems: [], item: null });

  const effectResolvedPromise = new Promise((resolve) => currentClient.once('game:effectResolved', resolve));
  await new Promise((resolve) => currentClient.emit('game:selectAction', { actionType: 'item', itemId: 'item_027' }, resolve));
  await effectResolvedPromise;

  expect(getPlayer(gameState, currentPlayerId).stats.speed.currentIndex).toBe(2); // unchanged
  expect(getPlayer(gameState, currentPlayerId).inventory).toEqual([{ id: 'item_027' }]); // not consumed

  clientA.close();
  clientB.close();
  httpServer.close();
});
```

All three tests await `game:effectResolved` — confirmed by reading `handleEffectResolveResult` (`socketHandlers.js:1081`): it emits `game:effectResolved` unconditionally whenever the effect chain isn't left pending, regardless of whether a `dice_check` ran (Tests 1/2) or `room_gate` no-op'd before ever reaching one (Test 3). `game:itemUseResolved` only fires when `!effectResult.diceCheckResult` (`socketHandlers.js:356`) — true for Test 3 but false for Tests 1/2 (their `dice_check` result carries `diceCheckResult` up through `room_gate`'s pass-through return) — so it is not a reliable single event to await across all three cases; `game:effectResolved` is.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && npx jest socketHandlers -t "item_027"`
Expected: PASS, all 3 new tests.

- [ ] **Step 7: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS, full suite green.

- [ ] **Step 8: Commit**

```bash
git add data/cards/item-cards.json data/cards/event-cards.json server/test/socketHandlers.test.js
git commit -m "feat: wire room_gate/dice_check into item_027, remove_imprint nested effects into event_036"
```

---

## Final Verification

- [ ] `cd server && npm test` — full suite green
- [ ] `node -e "JSON.parse(require('fs').readFileSync('data/cards/item-cards.json','utf8')); JSON.parse(require('fs').readFileSync('data/cards/event-cards.json','utf8'))"` — valid JSON
- [ ] No `client/` files touched (this plan is server-only)
