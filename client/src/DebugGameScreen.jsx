import { useState, useEffect } from 'react';
import FocusedRoomView from './gameplay/FocusedRoomView';
import OverviewMap from './gameplay/OverviewMap';
import CharacterPanel from './gameplay/CharacterPanel';
import { getAvailableDirections } from './gameplay/mapUtils';

const DIRECTION_LABELS = { north: '北', east: '東', south: '南', west: '西' };

export default function DebugGameScreen({ socket, roomCode, playerId, initialGameState }) {
  const [phase, setPhase] = useState(initialGameState ? 'playing' : 'character_select');
  const [prompt, setPrompt] = useState(null);
  const [characterSelectState, setCharacterSelectState] = useState(null);
  const [gameState, setGameState] = useState(initialGameState || null);
  // roomContent is static reference data sent once on game:started -- it is
  // NOT part of game:stateUpdate's payload, so it must live in its own state
  // instead of gameState's, or it would be lost the moment any action broadcasts
  // the next game:stateUpdate.
  const [roomContent] = useState(initialGameState?.roomContent || null);
  // Same pattern as roomContent -- cardContent (item/event/omen names) is
  // static reference data sent once on game:started, not part of
  // game:stateUpdate's payload.
  const [cardContent] = useState(initialGameState?.cardContent || null);
  const [lastPromptResolved, setLastPromptResolved] = useState(null);
  const [actionError, setActionError] = useState('');
  const [messages, setMessages] = useState([]);
  const [mapMode, setMapMode] = useState('focused'); // 'focused' | 'overview'
  const [overviewFloor, setOverviewFloor] = useState('ground');
  const [pendingEffectChoice, setPendingEffectChoice] = useState(null);
  const [pendingRollChoice, setPendingRollChoice] = useState(null);
  const [overrideInput, setOverrideInput] = useState('0');

  useEffect(() => {
    function onPrompt(data) {
      setPrompt(data);
    }
    function onPromptResolved(data) {
      setLastPromptResolved(data);
      setMessages((prev) => [...prev, `提問結果：${JSON.stringify(data)}`]);
      setPrompt(null);
      setPendingRollChoice(null);
    }
    function onCharacterSelectUpdate(data) {
      setCharacterSelectState(data);
    }
    function onStarted(data) {
      setPhase('playing');
      setGameState(data);
    }
    function onStateUpdate(data) {
      setGameState(data);
    }
    function onPendingAction(data) {
      setMessages((prev) => [...prev, `待處理動作：${JSON.stringify(data)}`]);
    }
    function onCardDrawn(data) {
      setMessages((prev) => [...prev, `抽到的卡：${JSON.stringify(data)}`]);
    }
    function onEffectPendingChoice(data) {
      setPendingEffectChoice(data);
    }
    function onEffectResolved(data) {
      setMessages((prev) => [...prev, `效果已解析完成：${JSON.stringify(data)}`]);
      setPendingEffectChoice(null);
    }
    function onDiceChoicePending(data) {
      setPendingRollChoice(data);
    }

    socket.on('game:prompt', onPrompt);
    socket.on('game:promptResolved', onPromptResolved);
    socket.on('game:characterSelectUpdate', onCharacterSelectUpdate);
    socket.on('game:started', onStarted);
    socket.on('game:stateUpdate', onStateUpdate);
    socket.on('game:pendingAction', onPendingAction);
    socket.on('game:cardDrawn', onCardDrawn);
    socket.on('game:effectPendingChoice', onEffectPendingChoice);
    socket.on('game:effectResolved', onEffectResolved);
    socket.on('game:diceChoicePending', onDiceChoicePending);

    return () => {
      socket.off('game:prompt', onPrompt);
      socket.off('game:promptResolved', onPromptResolved);
      socket.off('game:characterSelectUpdate', onCharacterSelectUpdate);
      socket.off('game:started', onStarted);
      socket.off('game:stateUpdate', onStateUpdate);
      socket.off('game:pendingAction', onPendingAction);
      socket.off('game:cardDrawn', onCardDrawn);
      socket.off('game:effectPendingChoice', onEffectPendingChoice);
      socket.off('game:effectResolved', onEffectResolved);
      socket.off('game:diceChoicePending', onDiceChoicePending);
    };
  }, [socket]);

  function handleStartCharacterSelect() {
    socket.emit('game:startCharacterSelect', {}, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  function handlePickCharacter(characterId) {
    if (!prompt) return;
    socket.emit('game:promptRespond', { promptId: prompt.promptId, optionId: characterId }, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  function handleMove(direction) {
    socket.emit('game:move', { direction }, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  function handleSelectAction(actionType) {
    socket.emit('game:selectAction', { actionType }, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  function handleUseStairs() {
    socket.emit('game:useStairs', {}, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  function handleEndTurn() {
    socket.emit('game:endTurn', {}, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  function handleEffectChoiceRespond(optionId) {
    if (!pendingEffectChoice) return;
    socket.emit('game:effectPromptRespond', { promptId: pendingEffectChoice.promptId, optionId }, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  function handleRollChoiceRespond(optionId, overrideValue) {
    if (!pendingRollChoice) return;
    socket.emit('game:diceChoiceRespond', { promptId: pendingRollChoice.promptId, optionId, overrideValue }, (res) => {
      if (res && res.error) setActionError(res.error);
    });
  }

  // Precomputed once for the playing-phase render -- both the left button
  // column and the center room view need these.
  let me, currentRoom, hasRoomForFloor, directions;
  if (gameState) {
    me = gameState.players.find((p) => p.playerId === playerId);
    currentRoom = gameState.board[me.floor].find((r) => r.x === me.x && r.y === me.y);
    hasRoomForFloor = me.floor === 'ground' ? gameState.roomDeck.hasRoomForGround : gameState.roomDeck.hasRoomForUpper;
    directions = getAvailableDirections(me, currentRoom, gameState.board[me.floor]).filter(
      (d) => d.kind === 'move' || hasRoomForFloor
    );
  }

  const header = (
    <>
      <h2>
        除錯測試頁面（房號：{roomCode}，我的 playerId：{playerId}）
      </h2>
      {actionError && <p style={{ color: 'red' }}>錯誤：{actionError}</p>}
    </>
  );

  return (
    <div style={{ color: '#1a1a1a' }}>
      {/* In the playing phase the header moves into the left column instead
          (see below) -- final target is mobile, where the viewport square
          needs to claim as much of the screen height as possible, so nothing
          reserves space above it. */}
      {phase !== 'playing' && header}

      {phase === 'character_select' && (
        <div>
          <button onClick={handleStartCharacterSelect}>開始選角色</button>
          {characterSelectState && (
            <div>
              <p>目前輪到：{characterSelectState.currentPicker}</p>
              <ul>
                {characterSelectState.characters.map((c) => (
                  <li key={c.id}>
                    {c.id} - {c.codename || '(未命名)'}
                    {characterSelectState.lockedCharacterIds.includes(c.id) ? '（已鎖定）' : ''}
                    {prompt &&
                      prompt.targetPlayerId === playerId &&
                      !characterSelectState.lockedCharacterIds.includes(c.id) && (
                        <button onClick={() => handlePickCharacter(c.id)}>選這個</button>
                      )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {prompt && (
            <p>
              提問中：{prompt.description}（目標：{prompt.targetPlayerId}，倒數至{' '}
              {new Date(prompt.deadline).toLocaleTimeString()}）
            </p>
          )}
          {lastPromptResolved && <p>上一個提問結果：{JSON.stringify(lastPromptResolved)}</p>}
        </div>
      )}

      {phase === 'playing' && (
        <div>
        <div
          style={{
            display: 'flex',
            // --total-square = 目前房間的最大預估視野（房間本身＋上下左右
            // 各 15% 的鄰居預覽空間），高度貼齊螢幕可用垂直空間 -- 標題跟
            // 錯誤訊息都搬進了左欄，這裡只留一點點緩衝（16px）避免貼死。
            // 中間欄位寬度直接等於這個值，左右欄位平分剩下的橫向空間
            // （flex:1）。--tile-size / --peek-size 依開發者指定比例反推：
            // 房間邊長 = 視野邊長 × 0.7，每側鄰居預覽寬度 = 視野邊長 × 0.15。
            '--total-square': 'calc(100vh - 16px)',
            '--tile-size': 'calc(var(--total-square) * 0.7)',
            '--peek-size': 'calc(var(--total-square) * 0.15)',
          }}
        >
          {/* TEMP: 除錯用邊框，用來核對左中右三欄的實際範圍，確認後可移除 */}
          <div style={{ flex: 1, minWidth: 0, border: '2px dashed red', boxSizing: 'border-box' }}>
            {/* Padding lives on this inner wrapper, not the flex item itself --
                padding on a flex-basis:0% item still acts as a shrink floor in
                some browsers even with minWidth:0, which broke the even
                left/right split. */}
            <div style={{ padding: 8 }}>
              {header}
              <div>
                {directions.map((d) => (
                  <button
                    key={d.direction}
                    onClick={() => handleMove(d.direction)}
                    style={{
                      marginRight: 8,
                      marginBottom: 8,
                      border: d.kind === 'move' ? '2px solid #2ecc71' : '2px dashed #888',
                      backgroundColor: d.kind === 'move' ? '#eafaf1' : '#f0f0f0',
                    }}
                  >
                    {DIRECTION_LABELS[d.direction]}
                    {d.kind === 'open_door' ? '？' : ''}
                  </button>
                ))}
              </div>
              <button onClick={() => setMapMode(mapMode === 'focused' ? 'overview' : 'focused')}>
                {mapMode === 'focused' ? '切換到總覽地圖' : '切換回目前房間'}
              </button>
            </div>
          </div>
          <div
            style={{
              width: 'var(--total-square)',
              flexShrink: 0,
              display: 'flex',
              justifyContent: 'center',
              border: '2px dashed green',
              boxSizing: 'border-box',
            }}
          >
            {(() => {
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
                />
              );
            })()}
          </div>
          <div style={{ flex: 1, minWidth: 0, border: '2px dashed blue', boxSizing: 'border-box' }}>
            <CharacterPanel
              player={me}
              messages={messages}
              cardContent={cardContent}
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
    </div>
  );
}
