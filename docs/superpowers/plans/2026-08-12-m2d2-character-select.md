# M2D2：角色選擇畫面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用正式的角色選擇畫面（角色列橫向排開＋點選開啟屬性資料卡＋沿用既有輪流制）取代目前的 `CharacterSelectPlaceholder.jsx`，全員選完後轉場進入除錯頁面（`DebugGameScreen`，M2D3 完成前的暫時終點）。

**Architecture:** 這是純前端功能，後端角色選擇邏輯（`characterSelection.js`/`characterSelectionManager.js`/既有 socket 事件）完全不動。動到的既有基礎設施：把「整個連線期間都可能收到、不該被特定畫面錯過」的廣播事件（`lobby:closed`／`game:prompt`／`game:characterSelectUpdate`／`game:started`）從畫面元件（`WaitingRoomScreen`）搬到協調層 `LobbyScreen.jsx`，避免畫面切換的那一瞬間漏接關鍵事件（M2D1 全分支審查已經點名這個問題，要求在 M2D2 加入互動畫面前處理）。

**Tech Stack:** React + Vite，純 CSS（沿用 M2D1 建立的視覺語言：`lobby-watermark-screen`/`lobby-modal-overlay`/`lobby-modal`/`lobby-button` 等既有 class），不引入新依賴。無自動化前端測試框架，驗證方式為 `npm run build` ＋瀏覽器手動操作（沿用 M2D1 的模式）。

## Global Constraints

- 不引入任何新的 npm 套件
- 不修改任何後端程式碼（`server/` 目錄完全不動）——本次是純前端功能，所有需要的資料已經透過既有的 `game:characterSelectUpdate` 廣播送達
- 目標裝置＝手機橫向螢幕；開發驗證時要把瀏覽器視窗模擬成手機橫向尺寸（例如寬 812 高 375）
- 沿用既有輸入驗證慣例（不適用於本次——前端沒有新增任何會送出不合法輸入給伺服器的路徑，`game:promptRespond` 的 `optionId` 一律是從 `characterSelectState.characters` 既有清單挑出來的合法角色 id）
- 4 項屬性顯示用字：力量（might）／速度（speed）／知識（knowledge）／意志（sanity），沿用專案既有中文譯名

---

### Task 1：協調層重構——把跨畫面廣播事件搬到 `LobbyScreen.jsx`，接回除錯頁面

**Files:**
- Modify: `client/src/LobbyScreen.jsx`
- Modify: `client/src/lobby/WaitingRoomScreen.jsx`
- Modify: `client/src/DebugGameScreen.jsx`（見下方「補充修正」，僅新增一個可選 prop，不改動既有行為）
- Create: `client/src/lobby/CharacterSelectScreen.jsx`（本任務先建立最小骨架，Task 2/3 補完內容）
- Delete: `client/src/lobby/CharacterSelectPlaceholder.jsx`（被 `CharacterSelectScreen.jsx` 取代，沒有其他地方引用它）

**補充修正（Task 1 審查發現）**：`game:started` 是一次性事件，伺服器只廣播一次。`DebugGameScreen.jsx` 自己內部也有一個 `useEffect` 監聽同一個 `game:started` 事件來決定要不要顯示遊戲畫面（`onStarted` 把 `phase` 設成 `'playing'`）——但協調層 `LobbyScreen.jsx` 的頂層監聽器會先收到這個事件（用來決定要不要把 `screen` 切到 `'playing'`、進而讓 `DebugGameScreen` 第一次掛載），等 `DebugGameScreen` 真的掛載、註冊好自己的監聽器時，這個一次性事件早就已經發生過、不會重播，`DebugGameScreen` 會永遠卡在自己預設的 `'character_select'` 內部狀態，畫面出不去。

修法：協調層額外把收到的 `game:started` payload 存起來，當作 `initialGameState` prop 傳給 `DebugGameScreen`；`DebugGameScreen` 新增這個可選 prop，用它決定初始 `phase`/`gameState`（沒有這個 prop 時行為跟現在完全一樣，向下相容）。

在 `LobbyScreen.jsx` 的 Step 1 程式碼裡，`const [prompt, setPrompt] = useState(null);` 之後多加一行：

```js
  const [gameStartedPayload, setGameStartedPayload] = useState(null);
```

把 `socket.on('game:started', () => setScreen('playing'));` 改成：

```js
    socket.on('game:started', (data) => {
      setGameStartedPayload(data);
      setScreen('playing');
    });
```

把 JSX 裡的 `{screen === 'playing' && (<DebugGameScreen socket={socketRef.current} roomCode={roomCode} playerId={playerId} />)}` 改成：

```jsx
      {screen === 'playing' && (
        <DebugGameScreen
          socket={socketRef.current}
          roomCode={roomCode}
          playerId={playerId}
          initialGameState={gameStartedPayload}
        />
      )}
```

修改 `client/src/DebugGameScreen.jsx`：函式簽章 `export default function DebugGameScreen({ socket, roomCode, playerId })` 改成 `export default function DebugGameScreen({ socket, roomCode, playerId, initialGameState })`；`const [phase, setPhase] = useState('character_select');` 改成 `const [phase, setPhase] = useState(initialGameState ? 'playing' : 'character_select');`；`const [gameState, setGameState] = useState(null);` 改成 `const [gameState, setGameState] = useState(initialGameState || null);`。其餘 `DebugGameScreen.jsx` 內容（含它自己既有的 `game:started` 監聽器）完全不動——那個監聽器在這個事件已經被協調層消耗過的情況下自然不會再被觸發，是良性的死程式碼，不用移除。

**Interfaces:**
- Consumes：既有 `game:prompt`／`game:promptResolved`／`game:characterSelectUpdate`／`game:started`／`lobby:closed` 廣播（payload 形狀不變）
- Produces：`LobbyScreen` 新增畫面狀態 `'characterSelect'`（取代 `'placeholder'`）與 `'playing'`；`<CharacterSelectScreen socket playerId characterSelectState prompt />`；`<WaitingRoomScreen socket roomCode playerId onLeft />`（拿掉 `onClosed`／`onCharacterSelectStarted` 這兩個 prop，改由協調層直接處理）

- [ ] **Step 1：改寫 `client/src/LobbyScreen.jsx`**

整份內容改成：

```jsx
import { useState, useEffect, useRef } from 'react';
import { createSocket } from './socket';
import StartScreen from './lobby/StartScreen';
import NicknameModal from './lobby/NicknameModal';
import LobbyListScreen from './lobby/LobbyListScreen';
import WaitingRoomScreen from './lobby/WaitingRoomScreen';
import CharacterSelectScreen from './lobby/CharacterSelectScreen';
import DebugGameScreen from './DebugGameScreen';
import { translateError } from './lobby/errorMessages';
import './lobby/lobby.css';

export default function LobbyScreen() {
  const socketRef = useRef(null);
  const [screen, setScreen] = useState('start');
  const [nicknameFlow, setNicknameFlow] = useState(null); // 'create' | 'join'
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [nicknameError, setNicknameError] = useState('');
  const [disconnected, setDisconnected] = useState(false);
  const [characterSelectState, setCharacterSelectState] = useState(null);
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('disconnect', () => setDisconnected(true));
    socket.on('lobby:closed', () => resetToStart());
    socket.on('game:prompt', (data) => setPrompt(data));
    socket.on('game:promptResolved', () => setPrompt(null));
    socket.on('game:characterSelectUpdate', (data) => {
      setCharacterSelectState(data);
      // Only advance the screen the first time this fires per game -- later
      // updates (someone else picking) just refresh the data in place.
      setScreen((prev) => (prev === 'waitingRoom' ? 'characterSelect' : prev));
    });
    socket.on('game:started', () => setScreen('playing'));
    return () => socket.close();
  }, []);

  function resetToStart() {
    setScreen('start');
    setRoomCode(null);
    setPlayerId(null);
    setNicknameError('');
    setCharacterSelectState(null);
    setPrompt(null);
  }

  function handleCreateClick() {
    setNicknameFlow('create');
    setNicknameError('');
    setScreen('nickname');
  }

  function handleJoinClick() {
    setNicknameFlow('join');
    setNicknameError('');
    setScreen('nickname');
  }

  function handleNicknameConfirm(enteredName) {
    setName(enteredName);
    if (nicknameFlow === 'create') {
      socketRef.current.emit('lobby:create', { playerName: enteredName }, (res) => {
        if (res && res.error) {
          setNicknameError(translateError(res.error));
          return;
        }
        setRoomCode(res.roomCode);
        setPlayerId(res.playerId);
        setScreen('waitingRoom');
      });
      return;
    }
    // nicknameFlow === 'join'
    setScreen('lobbyList');
  }

  function handleJoined(joinedRoomCode, joinedPlayerId) {
    setRoomCode(joinedRoomCode);
    setPlayerId(joinedPlayerId);
    setScreen('waitingRoom');
  }

  if (disconnected) {
    return (
      <div className="lobby-viewport">
        <div className="lobby-watermark-screen">
          <div className="lobby-center-panel">
            <p className="lobby-error">連線已中斷，請重新整理頁面</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby-viewport">
      {screen === 'start' && <StartScreen onCreateClick={handleCreateClick} onJoinClick={handleJoinClick} />}

      {screen === 'nickname' && (
        <>
          <StartScreen onCreateClick={handleCreateClick} onJoinClick={handleJoinClick} />
          <NicknameModal
            onConfirm={handleNicknameConfirm}
            onCancel={resetToStart}
            error={nicknameError}
          />
        </>
      )}

      {screen === 'lobbyList' && (
        <LobbyListScreen
          socket={socketRef.current}
          name={name}
          onJoined={handleJoined}
          onBack={resetToStart}
        />
      )}

      {screen === 'waitingRoom' && (
        <WaitingRoomScreen
          socket={socketRef.current}
          roomCode={roomCode}
          playerId={playerId}
          onLeft={() => setScreen('lobbyList')}
        />
      )}

      {screen === 'characterSelect' && characterSelectState && (
        <CharacterSelectScreen
          socket={socketRef.current}
          playerId={playerId}
          characterSelectState={characterSelectState}
          prompt={prompt}
        />
      )}

      {screen === 'playing' && (
        <DebugGameScreen socket={socketRef.current} roomCode={roomCode} playerId={playerId} />
      )}
    </div>
  );
}
```

- [ ] **Step 2：簡化 `client/src/lobby/WaitingRoomScreen.jsx`**

整份內容改成：

```jsx
import { useState, useEffect } from 'react';
import { translateError } from './errorMessages';

export default function WaitingRoomScreen({ socket, roomCode, playerId, onLeft }) {
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    function onPlayers(data) {
      setPlayers(data.players);
    }
    socket.on('lobby:players', onPlayers);
    return () => {
      socket.off('lobby:players', onPlayers);
    };
  }, [socket]);

  const me = players.find((p) => p.playerId === playerId);
  const isHost = Boolean(me && me.isHost);

  function handleLeave() {
    socket.emit('lobby:leave', {}, (res) => {
      if (res && res.error) {
        setError(translateError(res.error));
        return;
      }
      // The host's own socket also receives the lobby:closed broadcast (it's
      // still in the io room at the moment closeLobbyRoom emits it) -- the
      // orchestrator's own lobby:closed listener drives the host's own
      // transition, so don't also call onLeft() here or the two would race.
      if (!isHost) {
        onLeft();
      }
    });
  }

  function handleReady() {
    socket.emit('game:startCharacterSelect', {}, (res) => {
      if (res && res.error) setError(translateError(res.error));
    });
  }

  return (
    <div className="lobby-watermark-screen">
      <div className="lobby-center-panel">
        <h2>房號：{roomCode}</h2>
        {error && <p className="lobby-error">{error}</p>}
        <ul className="lobby-player-list">
          {players.map((p) => (
            <li key={p.playerId}>
              {p.name}
              {p.isHost && <span className="lobby-host-badge">（房主）</span>}
            </li>
          ))}
        </ul>
        <div className="lobby-waiting-buttons">
          <button className="lobby-button" onClick={handleLeave}>退出大廳</button>
          {isHost && (
            <button className="lobby-button" onClick={handleReady} disabled={players.length < 2}>
              準備完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

（跟 M2D1 版本的差異只有：拿掉 `lobby:closed`／`game:characterSelectUpdate` 這兩個監聽器與對應的 `onClosed`／`onCharacterSelectStarted` prop，`lobby:players` 監聽與其餘邏輯完全不變）

- [ ] **Step 3：建立 `client/src/lobby/CharacterSelectScreen.jsx` 骨架**

```jsx
export default function CharacterSelectScreen({ socket, playerId, characterSelectState, prompt }) {
  const { currentPicker } = characterSelectState;
  return (
    <div className="lobby-watermark-screen">
      <div className="lobby-center-panel">
        <h2>角色選擇</h2>
        <p>目前輪到：{currentPicker}</p>
      </div>
    </div>
  );
}
```

（這是 Task 2/3 會逐步補完內容的起點，先確保協調層的資料能正確傳到這裡）

- [ ] **Step 4：刪除不再使用的檔案**

```bash
git rm client/src/lobby/CharacterSelectPlaceholder.jsx
```

- [ ] **Step 5：手動驗證**

Run（在 `client/` 目錄下）: `npm run build`
Expected: 成功，沒有語法錯誤或找不到模組的錯誤

啟動前後端 dev server，用兩個瀏覽器分頁（模擬手機橫向）走一次：開頭頁面→建立大廳（分頁 A）→加入大廳（分頁 B）→房主按「準備完成」→**確認兩個分頁都轉場到新的角色選擇骨架畫面，且「目前輪到」顯示的是分頁 A 或 B 其中一位玩家的 playerId**（證明 `characterSelectState`/`prompt` 資料正確從協調層傳下來）。

- [ ] **Step 6：Commit**

```bash
git add client/src/LobbyScreen.jsx client/src/lobby/WaitingRoomScreen.jsx client/src/lobby/CharacterSelectScreen.jsx
git commit -m "feat(m2d2): lift cross-screen broadcast listeners to the orchestrator, reconnect DebugGameScreen, add character select skeleton"
```

---

### Task 2：角色列（橫向排列＋依身高等比例縮放＋點選開卡）

**Files:**
- Create: `client/public/images/`（複製 7 個新素材：6 張角色肖像＋`selected.png`）
- Modify: `client/src/lobby/lobby.css`
- Modify: `client/src/lobby/CharacterSelectScreen.jsx`

**Interfaces:**
- Consumes：`characterSelectState.characters`（含 `tall`/`filename`/`codename` 等既有欄位）、`characterSelectState.lockedCharacterIds`
- Produces：`CharacterSelectScreen` 內部新增 `openCharacterId` state（點選角色後設定，Task 3 會消費這個 state 渲染資料卡）

- [ ] **Step 1：複製角色素材**

```bash
mkdir -p client/public/images
cp img/HighScholl.png client/public/images/HighScholl.png
cp img/Lumberjack.png client/public/images/Lumberjack.png
cp img/girl.png client/public/images/girl.png
cp img/nurse.png client/public/images/nurse.png
cp img/oldman.png client/public/images/oldman.png
cp img/police.png client/public/images/police.png
cp img/selected.png client/public/images/selected.png
```

（檔名刻意跟 `characters.json` 的 `filename` 欄位完全一致，前端用 `` `/images/${character.filename}` `` 直接組出圖片路徑，不用額外做檔名對照表）

- [ ] **Step 2：`lobby.css` 新增角色選擇畫面樣式**

在檔案最後面新增：

```css
.cs-gallery {
  width: 100%;
  min-height: 100vh;
  box-sizing: border-box;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background-image: linear-gradient(rgba(10, 10, 10, 0.82), rgba(10, 10, 10, 0.82)), url('/images/gate.png');
  background-size: cover;
  background-position: center;
}

.cs-status-banner {
  text-align: center;
  color: #ffd27a;
  font-size: 1.1rem;
  margin: 0;
}

.cs-row {
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 1rem;
  overflow-x: auto;
  padding: 0 0.5rem;
}

.cs-portrait-button {
  flex: 0 0 auto;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  position: relative;
  transition: transform 0.15s ease, filter 0.15s ease;
}

.cs-portrait-button:hover,
.cs-portrait-button:active {
  transform: translateY(-0.5rem) scale(1.05);
  filter: brightness(1.3);
}

.cs-portrait-button img {
  height: 100%;
  width: auto;
  display: block;
  border-radius: 0.5rem;
}

.cs-locked-badge {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
```

- [ ] **Step 3：實作角色列**

把 `client/src/lobby/CharacterSelectScreen.jsx` 改成：

```jsx
import { useState } from 'react';

const MAX_HEIGHT_VH = 66.67; // 2/3 of viewport height, for the tallest character

export default function CharacterSelectScreen({ socket, playerId, characterSelectState, prompt }) {
  const [openCharacterId, setOpenCharacterId] = useState(null);
  const { characters, lockedCharacterIds, assignments, currentPicker } = characterSelectState;

  const maxTall = Math.max(...characters.map((c) => c.tall));
  const myAssignment = assignments.find((a) => a.playerId === playerId);

  return (
    <div className="cs-gallery">
      <h2>角色選擇</h2>
      {myAssignment ? (
        <p className="cs-status-banner">
          已選擇：{characters.find((c) => c.id === myAssignment.characterId)?.codename}，等待其他玩家選擇中...
        </p>
      ) : (
        <p className="cs-status-banner">
          {currentPicker === playerId ? '輪到你選擇角色' : '其他玩家選擇中，請稍後'}
        </p>
      )}
      <div className="cs-row">
        {characters.map((c) => {
          const heightVh = (c.tall / maxTall) * MAX_HEIGHT_VH;
          const isLocked = lockedCharacterIds.includes(c.id);
          return (
            <button
              key={c.id}
              className="cs-portrait-button"
              style={{ height: `${heightVh}vh` }}
              onClick={() => setOpenCharacterId(c.id)}
            >
              <img src={`/images/${c.filename}`} alt={c.codename} />
              {isLocked && <img className="cs-locked-badge" src="/images/selected.png" alt="已被選擇" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4：手動驗證**

Run（在 `client/` 目錄下）: `npm run build`
Expected: 成功

啟動前後端 dev server，模擬手機橫向尺寸（例如 812×375），走到角色選擇畫面，確認：
- 6 個角色肖像橫向排列，最高的角色（伐木工）圖片高度明顯佔螢幕約 2/3，其餘角色依身高比例略矮
- 若螢幕寬度不夠放下 6 個，可以橫向滑動看到其餘角色
- 點擊/點選任一角色圖片時，圖片有浮出（上移+放大）＋加亮效果
- 用另一個分頁模擬別的玩家先選定一個角色後，這個分頁上該角色圖片疊加「已被選擇」標記（`selected.png`）

- [ ] **Step 5：Commit**

```bash
git add client/public/images/ client/src/lobby/lobby.css client/src/lobby/CharacterSelectScreen.jsx
git commit -m "feat(m2d2): character gallery row sized by tall attribute, click-to-open state"
```

---

### Task 3：屬性資料卡（彈出視窗＋左右翻頁＋確定選擇）

**Files:**
- Modify: `client/src/lobby/lobby.css`
- Modify: `client/src/lobby/CharacterSelectScreen.jsx`

**Interfaces:**
- Consumes：`prompt.promptId`（送出 `game:promptRespond` 用）
- Produces：無新的對外介面（`CharacterSelectScreen` 是協調層的葉節點）

- [ ] **Step 1：`lobby.css` 新增資料卡樣式**

在檔案最後面新增：

```css
.cs-stat-card {
  gap: 1rem;
}

.cs-stat-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.cs-card-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}
```

- [ ] **Step 2：實作資料卡並接上確定選擇**

把 `client/src/lobby/CharacterSelectScreen.jsx` 改成：

```jsx
import { useState } from 'react';
import { translateError } from './errorMessages';

const MAX_HEIGHT_VH = 66.67; // 2/3 of viewport height, for the tallest character

const STAT_LABELS = [
  ['might', '力量'],
  ['speed', '速度'],
  ['knowledge', '知識'],
  ['sanity', '意志'],
];

function CharacterStatCard({ character, canConfirm, onFlip, onExit, onConfirm, error }) {
  return (
    <div className="lobby-modal-overlay">
      <div className="lobby-modal cs-stat-card">
        <h3>{character.codename}</h3>
        <p>{character.occupation}</p>
        <ul className="cs-stat-list">
          {STAT_LABELS.map(([key, label]) => (
            <li key={key}>
              {label}：{character.stats[key].track[character.stats[key].baseIndex]}
            </li>
          ))}
        </ul>
        <p>初始攜帶物品：{character.itemname || '無'}</p>
        {error && <p className="lobby-error">{error}</p>}
        {!canConfirm && <p className="lobby-error">其他玩家選擇中，請稍後</p>}
        <div className="cs-card-buttons">
          <button className="lobby-button" onClick={() => onFlip(-1)}>左翻</button>
          <button className="lobby-button" onClick={() => onFlip(1)}>右翻</button>
          <button className="lobby-button" onClick={onExit}>退出</button>
          <button className="lobby-button" onClick={onConfirm} disabled={!canConfirm}>確定選擇</button>
        </div>
      </div>
    </div>
  );
}

export default function CharacterSelectScreen({ socket, playerId, characterSelectState, prompt }) {
  const [openCharacterId, setOpenCharacterId] = useState(null);
  const [error, setError] = useState('');
  const { characters, lockedCharacterIds, assignments, currentPicker } = characterSelectState;

  const maxTall = Math.max(...characters.map((c) => c.tall));
  const myAssignment = assignments.find((a) => a.playerId === playerId);
  const openCharacter = characters.find((c) => c.id === openCharacterId);
  const isMyTurn = currentPicker === playerId;

  function handleFlip(direction) {
    const idx = characters.findIndex((c) => c.id === openCharacterId);
    const nextIdx = (idx + direction + characters.length) % characters.length;
    setError('');
    setOpenCharacterId(characters[nextIdx].id);
  }

  function handleConfirm() {
    if (!prompt) return;
    socket.emit('game:promptRespond', { promptId: prompt.promptId, optionId: openCharacterId }, (res) => {
      if (res && res.error) {
        setError(translateError(res.error));
        return;
      }
      setOpenCharacterId(null);
    });
  }

  return (
    <div className="cs-gallery">
      <h2>角色選擇</h2>
      {myAssignment ? (
        <p className="cs-status-banner">
          已選擇：{characters.find((c) => c.id === myAssignment.characterId)?.codename}，等待其他玩家選擇中...
        </p>
      ) : (
        <p className="cs-status-banner">{isMyTurn ? '輪到你選擇角色' : '其他玩家選擇中，請稍後'}</p>
      )}
      <div className="cs-row">
        {characters.map((c) => {
          const heightVh = (c.tall / maxTall) * MAX_HEIGHT_VH;
          const isLocked = lockedCharacterIds.includes(c.id);
          return (
            <button
              key={c.id}
              className="cs-portrait-button"
              style={{ height: `${heightVh}vh` }}
              onClick={() => {
                setError('');
                setOpenCharacterId(c.id);
              }}
            >
              <img src={`/images/${c.filename}`} alt={c.codename} />
              {isLocked && <img className="cs-locked-badge" src="/images/selected.png" alt="已被選擇" />}
            </button>
          );
        })}
      </div>
      {openCharacter && (
        <CharacterStatCard
          character={openCharacter}
          canConfirm={isMyTurn && !lockedCharacterIds.includes(openCharacterId)}
          onFlip={handleFlip}
          onExit={() => setOpenCharacterId(null)}
          onConfirm={handleConfirm}
          error={error}
        />
      )}
    </div>
  );
}
```

（`ERROR_MESSAGES`/`translateError` 需要補上 `CHARACTER_SELECT_NOT_YOUR_TURN`／`UNKNOWN_CHARACTER`／`CHARACTER_ALREADY_TAKEN` 三個既有伺服器錯誤碼的中文訊息——見 Step 3）

- [ ] **Step 3：`errorMessages.js` 補上角色選擇相關錯誤碼**

修改 `client/src/lobby/errorMessages.js`，在 `ERROR_MESSAGES` 物件裡新增：

```js
  CHARACTER_SELECT_NOT_YOUR_TURN: '還沒輪到你選擇',
  UNKNOWN_CHARACTER: '找不到這個角色',
  CHARACTER_ALREADY_TAKEN: '這個角色已經被選走了',
```

- [ ] **Step 4：手動驗證（完整流程）**

Run（在 `client/` 目錄下）: `npm run build`
Expected: 成功

啟動前後端 dev server，用兩個瀏覽器分頁模擬手機橫向尺寸，走完整流程：
1. 分頁 A 建房，分頁 B 加入，房主按「準備完成」，兩分頁都進入角色選擇畫面
2. 確認只有輪到的那一位分頁，點開任一角色資料卡後「確定選擇」按鈕是亮的；另一分頁點開資料卡，按鈕不亮、顯示「其他玩家選擇中，請稍後」
3. 輪到的分頁點開一張角色卡，測試左翻／右翻能切換到不同角色的資料卡，退出能關閉資料卡回到角色列
4. 輪到的分頁點擊「確定選擇」，確認：卡片關閉、該分頁畫面出現「已選擇：OOO，等待其他玩家選擇中...」；另一分頁**不用手動整理**就即時看到該角色圖片疊加「已被選擇」標記，且「確定選擇」按鈕變亮（輪到自己了）
5. 第二位玩家重複步驟 2-4 選定角色
6. 確認全部玩家選完後，兩個分頁都自動轉場進入除錯頁面（`DebugGameScreen`），且除錯頁面顯示的遊戲狀態裡兩位玩家都有對應的屬性數值與初始道具（起始道具機制已在前一階段完成）

- [ ] **Step 5：Commit**

```bash
git add client/src/lobby/lobby.css client/src/lobby/CharacterSelectScreen.jsx client/src/lobby/errorMessages.js
git commit -m "feat(m2d2): character stat card modal with flip/exit/confirm, full character select flow"
```
