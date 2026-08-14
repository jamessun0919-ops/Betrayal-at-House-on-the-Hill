import { useState, useEffect } from 'react';
import EntranceHallView from './gameplay/EntranceHallView';
import FocusedRoomView from './gameplay/FocusedRoomView';
import OverviewMap from './gameplay/OverviewMap';
import CharacterPanel from './gameplay/CharacterPanel';

const LOBBY_ROOM_IDS = ['room_lobby_a', 'room_lobby_b', 'room_lobby_c'];

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

  return (
    <div>
      <h2>
        除錯測試頁面（房號：{roomCode}，我的 playerId：{playerId}）
      </h2>
      {actionError && <p style={{ color: 'red' }}>錯誤：{actionError}</p>}

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
    </div>
  );
}
