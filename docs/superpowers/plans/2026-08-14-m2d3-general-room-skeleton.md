# M2D3 一般房間地圖骨架＋人物面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一般房間（大門廳三格以外的所有房間）的地圖顯示骨架——聚焦模式（目前房間＋鄰居裁切預覽＋依真實門狀態產生的移動按鈕）、總覽模式（個人探索紀錄格狀地圖）、右側人物面板骨架（屬性刻度、道具清單、訊息記錄、行動按鈕）。整合進 `DebugGameScreen.jsx`，取代目前純文字的通用按鈕（大門廳三格繼續用既有的 `EntranceHallView`，不受影響）。

**Architecture:** 純前端工作，後端資料已就緒。核心是一個可重用的 `mapUtils.js`（門方向幾何常數＋前端重算門狀態的邏輯，對應伺服器 `turnFlow.js` 的 `getAvailableDirections`＋房間內容查找），加上 5 個新元件（`RoomTile`／`PlayerBadge`／`FocusedRoomView`／`OverviewMap`／`CharacterPanel`），最後整合進 `DebugGameScreen.jsx` 改成左 2/3（地圖）／右 1/3（人物面板）版面。

**Tech Stack:** React（純 JavaScript，無 TypeScript），沿用專案既有的行內樣式（`style={{...}}`）寫法，不新增 CSS 框架或 client 端測試框架。

## Global Constraints

- 大門廳三格（`room_lobby_a`/`room_lobby_b`/`room_lobby_c`）維持用既有的 `EntranceHallView`，這次的新元件只處理其他一般房間
- 房間內容（名稱／圖檔名）要同時查 `roomContent.rooms`（一般房間）跟 `roomContent.startingRooms`（起始房間，因為一般房間的鄰居可能是大門廳）
- 沒有 `filename` 的房間（`rooms.json` 裡 `filename:null` 的 15 筆），聚焦模式跟總覽模式都要能正確顯示純色塊＋房間名稱文字，不能因為圖片路徑是 `null` 而壞掉
- 前端重算「移動／開新門」門狀態的邏輯，必須包含 `blocksOpenDoor` 修正效果的檢查（見設計文件的技術決策段落），不能只看門/鄰居資料
- 不新增任何 npm 依賴
- 每個元件檔案只做自己的事，不要把好幾個元件塞進同一個檔案

---

### Task 1：`mapUtils.js`（門方向幾何常數＋前端重算門狀態＋房間內容查找）

**Files:**
- Create: `client/src/gameplay/mapUtils.js`

**Interfaces:**
- Produces：`DIRECTION_DELTA`、`OPPOSITE_SIDE`（常數）；`getAvailableDirections(player, currentRoom, boardRooms)`（回傳 `[{direction, kind:'move'|'open_door', neighborRoom?}]`）；`findRoomInfo(roomId, roomContent)`（回傳 `{id,name,filename,...}` 或 `null`）

這個檔案沒有依賴 React，純函式，可以直接用 `node` 跑一段暫時的手動驗證腳本確認邏輯正確（不需要正式測試框架）。

- [ ] **Step 1：建立檔案，寫入以下完整內容**

```js
const DIRECTION_DELTA = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

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

function findRoomInfo(roomId, roomContent) {
  if (!roomContent) return null;
  return (
    roomContent.rooms.find((r) => r.id === roomId) ||
    roomContent.startingRooms.find((r) => r.id === roomId) ||
    null
  );
}

export { DIRECTION_DELTA, OPPOSITE_SIDE, getAvailableDirections, findRoomInfo };
```

**注意**：跟設計文件描述的一個差異——`hasRoomForFloor` 的檢查（房卡是否抽完）刻意省略了，因為那需要傳入 `hasRoomForGround`/`hasRoomForUpper` 兩個額外參數，且判斷邏輯（送哪個給哪個樓層）容易寫錯。改成呼叫端（Task 6）自行在拿到結果後，對 `kind==='open_door'` 的項目額外過濾一次房卡是否抽完（`gameState.roomDeck.hasRoomForGround`/`hasRoomForUpper`，依 `player.floor` 選對應欄位）。這樣 `mapUtils.js` 保持單純不用管樓層對應。

- [ ] **Step 2：手動驗證（暫時腳本，驗證完刪除）**

在專案根目錄暫時建立 `scratch-verify.mjs`（驗證完後刪除，不要提交進 git）：

```js
import { getAvailableDirections, findRoomInfo } from './client/src/gameplay/mapUtils.js';

// Case 1: door facing a real neighbor with a facing door -> 'move'
const player1 = { modifiers: [] };
const currentRoom1 = { x: 0, y: 0, doorSides: ['north', 'east'] };
const boardRooms1 = [
  currentRoom1,
  { x: 0, y: -1, roomId: 'room_a', doorSides: ['south'] }, // north neighbor, has facing door
];
console.log('Case 1 (expect north:move, no east entry):', JSON.stringify(getAvailableDirections(player1, currentRoom1, boardRooms1)));

// Case 2: door facing empty space -> 'open_door'
const boardRooms2 = [currentRoom1];
console.log('Case 2 (expect north:open_door, east:open_door):', JSON.stringify(getAvailableDirections(player1, currentRoom1, boardRooms2)));

// Case 3: blocksOpenDoor modifier suppresses open_door
const player3 = { modifiers: [{ effects: [{ hookType: 'blocksOpenDoor' }] }] };
console.log('Case 3 (expect empty array):', JSON.stringify(getAvailableDirections(player3, currentRoom1, boardRooms2)));

// Case 4: neighbor exists but has no facing door -> nothing shown
const boardRooms4 = [currentRoom1, { x: 0, y: -1, roomId: 'room_a', doorSides: ['north'] }];
console.log('Case 4 (expect only east:open_door):', JSON.stringify(getAvailableDirections(player1, currentRoom1, boardRooms4)));

console.log('findRoomInfo test:', findRoomInfo('room_lobby_b', { rooms: [], startingRooms: [{ id: 'room_lobby_b', name: '大門廳' }] }));
```

Run: `node scratch-verify.mjs`
Expected output matches each `console.log` line's stated expectation exactly. 確認無誤後刪除 `scratch-verify.mjs`。

- [ ] **Step 3：Commit**

```bash
git add client/src/gameplay/mapUtils.js
git commit -m "feat(m2d3): client-side door-direction derivation and room-content lookup"
```

---

### Task 2：`RoomTile` + `PlayerBadge`（共用基礎元件）

**Files:**
- Create: `client/src/gameplay/RoomTile.jsx`
- Create: `client/src/gameplay/PlayerBadge.jsx`

**Interfaces:**
- Produces：`RoomTile({filename, name, style})`；`PlayerBadge({name, colorIndex, style})`；`PLAYER_COLORS`（從 `PlayerBadge.jsx` 一併 export，供 Task 3/4/5 依玩家在 `gameState.players` 陣列裡的索引挑顏色）

- [ ] **Step 1：建立 `RoomTile.jsx`**

```jsx
export default function RoomTile({ filename, name, style }) {
  if (filename) {
    return (
      <img
        src={`/images/rooms/${filename}`}
        alt={name || ''}
        style={{ objectFit: 'cover', ...style }}
      />
    );
  }
  return (
    <div
      style={{
        backgroundColor: '#8a8a8a',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontSize: '0.85em',
        ...style,
      }}
    >
      {name || '(未知房間)'}
    </div>
  );
}
```

- [ ] **Step 2：建立 `PlayerBadge.jsx`**

```jsx
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

export default function PlayerBadge({ name, colorIndex, style }) {
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        backgroundColor: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 'bold',
        border: '2px solid #fff',
        boxShadow: '0 0 2px rgba(0,0,0,0.5)',
        ...style,
      }}
    >
      {(name || '?')[0]}
    </div>
  );
}

export { PLAYER_COLORS };
```

- [ ] **Step 3：Commit**

```bash
git add client/src/gameplay/RoomTile.jsx client/src/gameplay/PlayerBadge.jsx
git commit -m "feat(m2d3): RoomTile and PlayerBadge shared components"
```

---

### Task 3：`FocusedRoomView`（聚焦模式：目前房間＋鄰居預覽＋門按鈕＋人物徽章）

**Files:**
- Create: `client/src/gameplay/FocusedRoomView.jsx`

**Interfaces:**
- Consumes：`RoomTile`（Task 2）、`PlayerBadge`/`PLAYER_COLORS`（Task 2）、`getAvailableDirections`/`findRoomInfo`（Task 1）
- Produces：`FocusedRoomView({player, currentRoom, boardRooms, roomContent, roomsInSameSpot, allPlayers, hasRoomForFloor, onMove})`（一般房間永遠不會有樓梯——`stairsTo` 只出現在 `room_lobby_c`/`room_upper_landing`，那兩間走既有的 `EntranceHallView`，不會渲染到這個元件——所以這裡不需要 `onUseStairs`）
  - `roomsInSameSpot`：跟目前房間同格的所有玩家（含自己），用來畫多個 `PlayerBadge`
  - `hasRoomForFloor`：布林，呼叫端已經依 `player.floor` 選好對應的 `gameState.roomDeck.hasRoomForGround`/`hasRoomForUpper`
  - `onMove(direction)`/`onUseStairs()`：沿用既有的 `handleMove`/`handleUseStairs`

固定尺寸：房間主圖 360x360px，鄰居預覽裁切 90px（360 的 25%）。

- [ ] **Step 1：建立檔案，寫入以下完整內容**

```jsx
import RoomTile from './RoomTile';
import PlayerBadge, { PLAYER_COLORS } from './PlayerBadge';
import { getAvailableDirections, findRoomInfo } from './mapUtils';

const TILE_SIZE = 360;
const PEEK_SIZE = 90;
const DIRECTION_LABELS = { north: '北', east: '東', south: '南', west: '西' };

function peekStyle(direction) {
  const base = { position: 'absolute' };
  if (direction === 'north') {
    return {
      ...base,
      top: -PEEK_SIZE,
      left: 0,
      width: TILE_SIZE,
      height: PEEK_SIZE,
      backgroundSize: `${TILE_SIZE}px ${TILE_SIZE}px`,
      backgroundPosition: 'bottom',
      maskImage: 'linear-gradient(to top, black, transparent)',
      WebkitMaskImage: 'linear-gradient(to top, black, transparent)',
    };
  }
  if (direction === 'south') {
    return {
      ...base,
      bottom: -PEEK_SIZE,
      left: 0,
      width: TILE_SIZE,
      height: PEEK_SIZE,
      backgroundSize: `${TILE_SIZE}px ${TILE_SIZE}px`,
      backgroundPosition: 'top',
      maskImage: 'linear-gradient(to bottom, black, transparent)',
      WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
    };
  }
  if (direction === 'east') {
    return {
      ...base,
      top: 0,
      right: -PEEK_SIZE,
      width: PEEK_SIZE,
      height: TILE_SIZE,
      backgroundSize: `${TILE_SIZE}px ${TILE_SIZE}px`,
      backgroundPosition: 'left',
      maskImage: 'linear-gradient(to right, black, transparent)',
      WebkitMaskImage: 'linear-gradient(to right, black, transparent)',
    };
  }
  // west
  return {
    ...base,
    top: 0,
    left: -PEEK_SIZE,
    width: PEEK_SIZE,
    height: TILE_SIZE,
    backgroundSize: `${TILE_SIZE}px ${TILE_SIZE}px`,
    backgroundPosition: 'right',
    maskImage: 'linear-gradient(to left, black, transparent)',
    WebkitMaskImage: 'linear-gradient(to left, black, transparent)',
  };
}

function NeighborPeek({ direction, neighborRoom, roomContent }) {
  const info = findRoomInfo(neighborRoom.roomId, roomContent);
  const style = peekStyle(direction);
  if (info && info.filename) {
    return <div style={{ ...style, backgroundImage: `url(/images/rooms/${info.filename})` }} />;
  }
  // No art yet for this neighbor -- plain faded block, no image/mask needed.
  return <div style={{ ...style, backgroundImage: 'none', backgroundColor: '#8a8a8a', opacity: 0.4 }} />;
}

export default function FocusedRoomView({
  player,
  currentRoom,
  boardRooms,
  roomContent,
  roomsInSameSpot,
  allPlayers,
  hasRoomForFloor,
  onMove,
}) {
  const currentInfo = findRoomInfo(currentRoom.roomId, roomContent);
  const directions = getAvailableDirections(player, currentRoom, boardRooms).filter(
    (d) => d.kind === 'move' || hasRoomForFloor
  );

  return (
    <div style={{ position: 'relative', width: TILE_SIZE, height: TILE_SIZE, margin: `${PEEK_SIZE + 40}px` }}>
      {directions
        .filter((d) => d.kind === 'move')
        .map((d) => (
          <NeighborPeek key={d.direction} direction={d.direction} neighborRoom={d.neighborRoom} roomContent={roomContent} />
        ))}
      <RoomTile
        filename={currentInfo?.filename}
        name={currentInfo?.name}
        style={{ position: 'relative', width: TILE_SIZE, height: TILE_SIZE }}
      />
      {roomsInSameSpot.map((p, i) => {
        const colorIndex = allPlayers.findIndex((ap) => ap.playerId === p.playerId);
        return (
          <PlayerBadge
            key={p.playerId}
            name={p.name}
            colorIndex={colorIndex === -1 ? i : colorIndex}
            style={{ position: 'absolute', top: 8 + i * 28, left: 8 }}
          />
        );
      })}
      <div style={{ position: 'absolute', top: TILE_SIZE + 8, left: 0 }}>
        {directions.map((d) => (
          <button
            key={d.direction}
            onClick={() => onMove(d.direction)}
            style={{
              marginRight: 8,
              border: d.kind === 'move' ? '2px solid #2ecc71' : '2px dashed #888',
              backgroundColor: d.kind === 'move' ? '#eafaf1' : '#f0f0f0',
            }}
          >
            {DIRECTION_LABELS[d.direction]}
            {d.kind === 'open_door' ? '？' : ''}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2：Commit**

```bash
git add client/src/gameplay/FocusedRoomView.jsx
git commit -m "feat(m2d3): FocusedRoomView with door-state buttons and neighbor peeks"
```

---

### Task 4：`OverviewMap`（總覽模式：個人探索紀錄格狀地圖）

**Files:**
- Create: `client/src/gameplay/OverviewMap.jsx`

**Interfaces:**
- Consumes：`findRoomInfo`（Task 1）
- Produces：`OverviewMap({visitedRooms, floor, onFloorChange, boardRooms, roomContent, playerX, playerY})`
  - `visitedRooms`：`player.visitedRooms`（`{floor,x,y}[]`）
  - `boardRooms`：對應樓層的 `gameState.board.ground`/`.upper`（用來把座標換成 `roomId`）
  - `playerX`/`playerY`：目前玩家在**這個 `floor`** 上的座標（如果玩家目前樓層不是正在看的 `floor`，這兩個值不會用到，呼叫端可傳 `null`）

- [ ] **Step 1：建立檔案，寫入以下完整內容**

```jsx
import { findRoomInfo } from './mapUtils';

const CELL_SIZE = 48;

export default function OverviewMap({ visitedRooms, floor, onFloorChange, boardRooms, roomContent, playerX, playerY }) {
  const onThisFloor = visitedRooms.filter((v) => v.floor === floor);

  return (
    <div>
      <div>
        <button onClick={() => onFloorChange('ground')} disabled={floor === 'ground'}>
          地面層
        </button>
        <button onClick={() => onFloorChange('upper')} disabled={floor === 'upper'}>
          樓上
        </button>
      </div>
      {onThisFloor.length === 0 ? (
        <p>這個樓層還沒探索過</p>
      ) : (
        (() => {
          const xs = onThisFloor.map((v) => v.x);
          const ys = onThisFloor.map((v) => v.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const cols = maxX - minX + 1;
          const rows = maxY - minY + 1;
          return (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, ${CELL_SIZE}px)`,
                gridTemplateRows: `repeat(${rows}, ${CELL_SIZE}px)`,
                gap: 2,
              }}
            >
              {onThisFloor.map((v) => {
                const boardRoom = boardRooms.find((r) => r.x === v.x && r.y === v.y);
                const info = boardRoom ? findRoomInfo(boardRoom.roomId, roomContent) : null;
                const isPlayerHere = v.x === playerX && v.y === playerY;
                return (
                  <div
                    key={`${v.x},${v.y}`}
                    style={{
                      gridColumn: v.x - minX + 1,
                      gridRow: v.y - minY + 1,
                      backgroundColor: '#8a8a8a',
                      color: '#fff',
                      fontSize: '0.65em',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      overflow: 'hidden',
                      border: isPlayerHere ? '2px solid #f1c40f' : '1px solid #555',
                    }}
                  >
                    {info?.name || '?'}
                  </div>
                );
              })}
            </div>
          );
        })()
      )}
    </div>
  );
}
```

- [ ] **Step 2：Commit**

```bash
git add client/src/gameplay/OverviewMap.jsx
git commit -m "feat(m2d3): OverviewMap showing the player's personal exploration grid"
```

---

### Task 5：`CharacterPanel`（右側人物面板：屬性刻度、道具清單、訊息記錄、行動按鈕）

**Files:**
- Create: `client/src/gameplay/CharacterPanel.jsx`

**Interfaces:**
- Produces：`CharacterPanel({player, messages, onSelectAction, onUseStairs, onEndTurn})`
  - `player`：`gameState.players` 裡屬於自己的那筆（含 `stats`/`inventory`）
  - `messages`：字串陣列（Task 6 負責累積），最新的在最後面

- [ ] **Step 1：建立檔案，寫入以下完整內容**

```jsx
const STAT_LABELS = [
  ['might', '力量'],
  ['speed', '速度'],
  ['knowledge', '知識'],
  ['sanity', '意志'],
];

function StatBar({ label, stat }) {
  const { track, currentIndex, baseIndex, skullIndex, overflow } = stat;
  return (
    <div style={{ marginBottom: 6 }}>
      <div>
        {label}：{track[currentIndex] + (overflow || 0)}
      </div>
      <div style={{ display: 'flex' }}>
        {track.map((_, i) => (
          <div
            key={i}
            style={{
              width: 16,
              height: 16,
              border: i === baseIndex ? '2px solid #2980b9' : '1px solid #333',
              backgroundColor: i === currentIndex ? '#f1c40f' : i <= skullIndex ? '#c0392b' : '#eee',
              boxSizing: 'border-box',
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function CharacterPanel({ player, messages, onSelectAction, onUseStairs, onEndTurn }) {
  return (
    <div>
      <h3>屬性</h3>
      {STAT_LABELS.map(([key, label]) => (
        <StatBar key={key} label={label} stat={player.stats[key]} />
      ))}

      <h3>道具</h3>
      <ul>
        {player.inventory.length === 0 && <li>（無）</li>}
        {player.inventory.map((item, i) => (
          <li key={`${item.id}-${i}`}>{item.id}</li>
        ))}
      </ul>

      <h3>行動</h3>
      <button onClick={() => onSelectAction('item')}>道具</button>
      <button onClick={() => onSelectAction('attack')}>襲擊</button>
      <button onClick={() => onSelectAction('room_action')}>操作</button>
      <button onClick={onUseStairs}>樓梯（免費）</button>
      <button onClick={onEndTurn}>結束回合</button>

      <h3>訊息</h3>
      <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #ccc', padding: 4 }}>
        {messages.length === 0 && <p>（尚無訊息）</p>}
        {messages.map((m, i) => (
          <p key={i} style={{ margin: '2px 0', fontSize: '0.85em' }}>
            {m}
          </p>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2：Commit**

```bash
git add client/src/gameplay/CharacterPanel.jsx
git commit -m "feat(m2d3): CharacterPanel with stat bars, inventory, actions, and message log"
```

---

### Task 6：整合進 `DebugGameScreen.jsx`

**Files:**
- Modify: `client/src/DebugGameScreen.jsx`

**Interfaces:**
- Consumes：`FocusedRoomView`（Task 3）、`OverviewMap`（Task 4）、`CharacterPanel`（Task 5）、`findRoomInfo`（Task 1）

這個任務把新元件接進 `phase === 'playing'` 的渲染，取代原本大門廳以外的通用北/東/南/西按鈕、道具/襲擊/操作/樓梯/結束回合按鈕、以及零散的「最新一筆」事件顯示（`lastPendingAction`/`lastCardDrawn`/`lastEffectResolved`/`lastPromptResolved`），改成累積到 `messages` 陣列交給 `CharacterPanel` 統一顯示。**大門廳三格（`room_lobby_a/b/c`）的既有 `EntranceHallView` 分支完全不動。**

- [ ] **Step 1：加入 import 與新增/移除的 state**

在檔案開頭的 import 區塊，`EntranceHallView` 的 import 之後加入：

```js
import FocusedRoomView from './gameplay/FocusedRoomView';
import OverviewMap from './gameplay/OverviewMap';
import CharacterPanel from './gameplay/CharacterPanel';
import { findRoomInfo } from './gameplay/mapUtils';
```

把這幾行既有 state：

```js
  const [lastPromptResolved, setLastPromptResolved] = useState(null);
  const [lastPendingAction, setLastPendingAction] = useState(null);
  const [actionError, setActionError] = useState('');
  const [lastCardDrawn, setLastCardDrawn] = useState(null);
```

改成：

```js
  const [actionError, setActionError] = useState('');
  const [messages, setMessages] = useState([]);
  const [mapMode, setMapMode] = useState('focused'); // 'focused' | 'overview'
  const [overviewFloor, setOverviewFloor] = useState('ground');
```

這行整個刪掉（`lastEffectResolved` 原本的唯一顯示用途，這次改成累積進 `messages`，見 Step 2，state 變數本身不再需要）：

```js
  const [lastEffectResolved, setLastEffectResolved] = useState(null);
```

- [ ] **Step 2：把個別事件監聽器改成累積訊息**

`useEffect` 裡的以下函式：

```js
    function onPromptResolved(data) {
      setLastPromptResolved(data);
      setPrompt(null);
      setPendingRollChoice(null);
    }
```

改成：

```js
    function onPromptResolved(data) {
      setMessages((prev) => [...prev, `提問結果：${JSON.stringify(data)}`]);
      setPrompt(null);
      setPendingRollChoice(null);
    }
```

```js
    function onPendingAction(data) {
      setLastPendingAction(data);
    }
```

改成：

```js
    function onPendingAction(data) {
      setMessages((prev) => [...prev, `待處理動作：${JSON.stringify(data)}`]);
    }
```

```js
    function onCardDrawn(data) {
      setLastCardDrawn(data);
    }
```

改成：

```js
    function onCardDrawn(data) {
      setMessages((prev) => [...prev, `抽到的卡：${JSON.stringify(data)}`]);
    }
```

```js
    function onEffectResolved(data) {
      setLastEffectResolved(data);
      setPendingEffectChoice(null);
    }
```

改成：

```js
    function onEffectResolved(data) {
      setMessages((prev) => [...prev, `效果已解析完成：${JSON.stringify(data)}`]);
      setPendingEffectChoice(null);
    }
```

- [ ] **Step 3：替換 `phase === 'playing'` 的渲染內容**

**不要動最外層的 `{actionError && <p style={{ color: 'red' }}>錯誤：{actionError}</p>}`**（`phase==='character_select'` 判斷之前那一行）——它在 `phase==='playing'` 時依然會正常顯示，不用在新區塊裡重複一份。

把整個 `{phase === 'playing' && (...)}` 區塊，改成：

```jsx
      {phase === 'playing' && (
        <div>
        <div style={{ display: 'flex' }}>
          <div style={{ flex: 2 }}>
            {(() => {
              const me = gameState.players.find((p) => p.playerId === playerId);
              const currentRoom = gameState.board[me.floor].find((r) => r.x === me.x && r.y === me.y);

              if (LOBBY_ROOM_IDS.includes(currentRoom.roomId)) {
                return (
                  <EntranceHallView
                    currentRoomId={currentRoom.roomId}
                    doorSides={currentRoom.doorSides}
                    startingRooms={roomContent.startingRooms}
                    onMove={handleMove}
                    onUseStairs={handleUseStairs}
                  />
                );
              }

              if (mapMode === 'overview') {
                const boardRooms = gameState.board[overviewFloor];
                return (
                  <OverviewMap
                    visitedRooms={me.visitedRooms}
                    floor={overviewFloor}
                    onFloorChange={setOverviewFloor}
                    boardRooms={boardRooms}
                    roomContent={roomContent}
                    playerX={me.floor === overviewFloor ? me.x : null}
                    playerY={me.floor === overviewFloor ? me.y : null}
                  />
                );
              }

              const hasRoomForFloor =
                me.floor === 'ground' ? gameState.roomDeck.hasRoomForGround : gameState.roomDeck.hasRoomForUpper;
              const roomsInSameSpot = gameState.players.filter(
                (p) => p.floor === me.floor && p.x === me.x && p.y === me.y
              );

              return (
                <FocusedRoomView
                  player={me}
                  currentRoom={currentRoom}
                  boardRooms={gameState.board[me.floor]}
                  roomContent={roomContent}
                  roomsInSameSpot={roomsInSameSpot}
                  allPlayers={gameState.players}
                  hasRoomForFloor={hasRoomForFloor}
                  onMove={handleMove}
                />
              );
            })()}
            <button onClick={() => setMapMode(mapMode === 'focused' ? 'overview' : 'focused')}>
              {mapMode === 'focused' ? '切換到總覽地圖' : '切換回目前房間'}
            </button>
          </div>
          <div style={{ flex: 1 }}>
            <CharacterPanel
              player={gameState.players.find((p) => p.playerId === playerId)}
              messages={messages}
              onSelectAction={handleSelectAction}
              onUseStairs={handleUseStairs}
              onEndTurn={handleEndTurn}
            />
          </div>
        </div>
          {pendingEffectChoice && (
            <div>
              <p>效果選擇中：{pendingEffectChoice.description}</p>
              <ul>
                {pendingEffectChoice.options.map((o) => (
                  <li key={o.optionId}>
                    {o.label || o.optionId}
                    <button onClick={() => handleEffectChoiceRespond(o.optionId)}>選這個</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pendingRollChoice && (
            <div>
              <p>擲骰道具介入：要不要使用道具？</p>
              <ul>
                {pendingRollChoice.options.map((o) => (
                  <li key={o.itemId}>
                    {o.name}
                    {o.diceInterjection.override ? (
                      <>
                        <input
                          type="number"
                          min="0"
                          max="8"
                          value={overrideInput}
                          onChange={(e) => setOverrideInput(e.target.value)}
                        />
                        <button onClick={() => handleRollChoiceRespond(o.itemId, Number(overrideInput))}>使用</button>
                      </>
                    ) : (
                      <button onClick={() => handleRollChoiceRespond(o.itemId, undefined)}>使用</button>
                    )}
                  </li>
                ))}
              </ul>
              <button onClick={() => handleRollChoiceRespond('__skip__', undefined)}>不使用道具</button>
            </div>
          )}
          <h3>最新遊戲狀態（除錯用，保留）</h3>
          <pre>{JSON.stringify(gameState, null, 2)}</pre>
        </div>
      )}
```

（`phase === 'playing'` 的 JSX 用了一個外層 `<div>` 包住兩層結構：裡面第一層 `<div style={{display:'flex'}}>` 放地圖區＋人物面板的左右兩欄，第二層（外層 `<div>` 的直接子元素）依序放 `pendingEffectChoice`／`pendingRollChoice`／除錯用 JSON，這三個區塊不應該被拉進 flex 排版裡，維持正常區塊排列在兩欄下方。）

**這個替換拿掉的東西**：原本的「移動」北/東/南/西固定按鈕、「動作」道具/襲擊/操作/樓梯/結束回合按鈕（搬進 `CharacterPanel`）、`{lastPendingAction && ...}`／`{lastCardDrawn && ...}`／`{lastEffectResolved && ...}` 這三個零散顯示（連同對應的 state 變數，Step 1/2 已一併移除，改成累積進 `messages`，由 `CharacterPanel` 統一呈現）。`{lastPromptResolved && ...}` 只在 `phase==='character_select'` 分支使用，不受影響，維持不動。

- [ ] **Step 4：複製一般房間美術圖到 `client/public/images/rooms/`**

`img/rooms/` 目前有 16 張一般房間圖（`rooms.json` 裡 `filename` 非 null 的那 16 筆），但 `client/public/images/rooms/` 只有大門廳/二樓平台那 4 張（前一階段複製的）。其中 `room_gardens` 的來源檔名帶了中文前綴（`庭院 room_gardens.webp`），複製時要改成正確檔名 `room_gardens.webp`（跟 `rooms.json` 裡 `filename` 欄位的值一致）。

```bash
cd "client/public/images/rooms"
cp "../../../../img/rooms/room_atrium.webp" .
cp "../../../../img/rooms/room_balcony.webp" .
cp "../../../../img/rooms/room_bathroom_ground.webp" .
cp "../../../../img/rooms/room_bathroom_upper.webp" .
cp "../../../../img/rooms/room_conservatory.webp" .
cp "../../../../img/rooms/room_game_room.webp" .
cp "../../../../img/rooms/room_gymnasium.webp" .
cp "../../../../img/rooms/room_kitchen.webp" .
cp "../../../../img/rooms/room_larder.webp" .
cp "../../../../img/rooms/room_library.webp" .
cp "../../../../img/rooms/room_master_bedroom.webp" .
cp "../../../../img/rooms/room_patio.webp" .
cp "../../../../img/rooms/room_research_lab.webp" .
cp "../../../../img/rooms/room_vault.webp" .
cp "../../../../img/rooms/room_vine_conservatory.webp" .
cp "../../../../img/rooms/庭院 room_gardens.webp" "room_gardens.webp"
```

確認共 20 個檔案（4 張大門廳/樓梯 + 16 張一般房間）：

```bash
ls client/public/images/rooms/ | wc -l
```

Expected: `20`

```bash
git add client/public/images/rooms/
git commit -m "chore(m2d3): copy generated room art into client public assets"
```

- [ ] **Step 5：Build 確認語法正確**

Run: `cd client && npx vite build`
Expected: 成功產出 `dist/`，無編譯錯誤

- [ ] **Step 6：完整手動瀏覽器驗證**

啟動 `server`/`client` 測試伺服器，跑完整流程：建房→雙人加入→選角→進入遊戲。驗證：
- 大門廳三格（`room_lobby_a/b/c`）畫面完全不受影響，維持原樣
- 移動到一般房間後（例如往東西開新門，抽到非大門廳房間），畫面改成左 2/3（`FocusedRoomView`）／右 1/3（`CharacterPanel`）版面
- 有美術圖的房間顯示真實圖片，沒有的顯示色塊＋房間名稱
- 門按鈕依真實 `doorSides` 出現，已探索方向跟開新門方向樣式不同
- 點擊「切換到總覽地圖」能看到已探索房間的格狀地圖，目前所在格有標示
- 右側面板：屬性刻度圖正確反映 `currentIndex`/`baseIndex`，道具/行動按鈕正常運作，訊息區能看到累積的事件記錄
- `pendingEffectChoice`/`pendingRollChoice` 互動 UI（效果選擇、擲骰道具介入）維持正常運作

如果發現任何問題，記錄下來，不要自行反覆猜測修改——照專案慣例先列出可能原因再確認方向。

- [ ] **Step 7：Commit**

```bash
git add client/src/DebugGameScreen.jsx
git commit -m "feat(m2d3): wire the general-room map skeleton and character panel into DebugGameScreen"
```

---

## 完成後驗證

- `cd server && npx jest --forceExit` 全數通過（這次沒有動後端，應該維持 426/426）
- `cd client && npx vite build` 成功
- Task 6 Step 5 的完整手動瀏覽器驗證全部通過
