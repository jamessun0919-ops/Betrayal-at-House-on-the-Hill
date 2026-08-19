import { useState, useEffect, useRef } from 'react';
import FocusedRoomView from './gameplay/FocusedRoomView';
import OverviewMap from './gameplay/OverviewMap';
import CharacterPanel from './gameplay/CharacterPanel';
import CheckModal from './gameplay/CheckModal';
import { getAvailableDirections, findRoomInfo, findCardInfo, STAT_LABELS } from './gameplay/mapUtils';
import './gameplay/playingLayout.css';

function findPlayerName(playerId, players) {
  const player = (players || []).find((p) => p.playerId === playerId);
  return player ? player.name : playerId;
}

// Centers a corner button inside the blank peek-size x peek-size square at
// one of the viewport's 4 corners -- the room tile (70%) plus the 4 edge
// peek bands (15% each) never cover the corners of the total-square, so
// these sit in otherwise-empty space regardless of which map mode (focused
// room vs overview) is currently rendered inside the viewport.
function cornerButtonStyle(corner) {
  const base = { position: 'absolute', zIndex: 10, fontSize: 12, padding: '2px 6px', borderRadius: 4 };
  const vOffset = corner.includes('top')
    ? { top: 'calc(var(--peek-size) / 2)', transformY: '-50%' }
    : { bottom: 'calc(var(--peek-size) / 2)', transformY: '50%' };
  const hOffset = corner.includes('left')
    ? { left: 'calc(var(--peek-size) / 2)', transformX: '-50%' }
    : { right: 'calc(var(--peek-size) / 2)', transformX: '50%' };
  const { transformY, ...vRest } = vOffset;
  const { transformX, ...hRest } = hOffset;
  return { ...base, ...vRest, ...hRest, transform: `translate(${transformX}, ${transformY})` };
}

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
  // Same pattern again -- characterContent (portrait/icon filenames) is
  // static reference data sent once on game:started, not part of
  // game:stateUpdate's payload.
  const [characterContent] = useState(initialGameState?.characterContent || null);
  const [lastPromptResolved, setLastPromptResolved] = useState(null);
  const [actionError, setActionError] = useState('');
  const [messages, setMessages] = useState([]);
  const [mapMode, setMapMode] = useState('focused'); // 'focused' | 'overview'
  const [overviewFloor, setOverviewFloor] = useState('ground');
  const [pendingEffectChoice, setPendingEffectChoice] = useState(null);
  const [pendingRollChoice, setPendingRollChoice] = useState(null);
  const [pendingCheckQueue, setPendingCheckQueue] = useState([]);
  // Monotonic id generator for pendingCheckQueue items -- CheckModal keys off
  // pendingCheckQueue[0].queueId (not the queue's length) so appending a new
  // item to the tail while the front item is still showing doesn't remount
  // and reset the in-progress check's phase.
  const nextCheckQueueId = useRef(0);
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
    function onCheckResolved(data) {
      const playerName = findPlayerName(data.playerId, gameState?.players);
      const statLabel = STAT_LABELS[data.stat] || '';
      // Message text is precomputed here but only appended to the message log
      // once the player dismisses this check's CheckModal (see the onDone
      // handler below) -- writing it immediately would spoil the result
      // through the modal's semi-transparent backdrop before the roll.
      const logMessage = `${playerName}：${statLabel}考驗${data.passed ? '成功' : '失敗'}（擲出 ${data.rolled} 點）`;
      setPendingCheckQueue((prev) => [...prev, { noCheck: false, ...data, logMessage, queueId: nextCheckQueueId.current++ }]);
    }
    function onRoomEntered(data) {
      const room = findRoomInfo(data.roomId, roomContent);
      const playerName = findPlayerName(data.playerId, gameState?.players);
      setMessages((prev) => [...prev, `${playerName} 進入了「${room ? room.name : data.roomId}」`]);
    }
    function onSearchEmpty(data) {
      const playerName = findPlayerName(data.playerId, gameState?.players);
      setMessages((prev) => [...prev, `${playerName} 搜索了房間，但沒有找到任何東西`]);
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
    socket.on('game:checkResolved', onCheckResolved);
    socket.on('game:roomEntered', onRoomEntered);
    socket.on('game:searchEmpty', onSearchEmpty);

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
      socket.off('game:checkResolved', onCheckResolved);
      socket.off('game:roomEntered', onRoomEntered);
      socket.off('game:searchEmpty', onSearchEmpty);
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
      if (res && res.error) {
        console.error('[game:move]', res.error);
        setActionError(res.error);
      }
    });
  }

  function handleSelectAction(actionType, options = {}) {
    socket.emit('game:selectAction', { actionType, ...options }, (res) => {
      if (res && res.error) {
        console.error('[game:selectAction]', res.error);
        setActionError(res.error);
      }
    });
  }

  function handleEndTurn() {
    socket.emit('game:endTurn', {}, (res) => {
      if (res && res.error) {
        console.error('[game:endTurn]', res.error);
        setActionError(res.error);
      }
    });
  }

  function handleEffectChoiceRespond(optionId) {
    if (!pendingEffectChoice) return;
    socket.emit('game:effectPromptRespond', { promptId: pendingEffectChoice.promptId, optionId }, (res) => {
      if (res && res.error) {
        console.error('[game:effectPromptRespond]', res.error);
        setActionError(res.error);
      }
    });
  }

  function handleRollChoiceRespond(optionId, overrideValue) {
    if (!pendingRollChoice) return;
    socket.emit('game:diceChoiceRespond', { promptId: pendingRollChoice.promptId, optionId, overrideValue }, (res) => {
      if (res && res.error) {
        console.error('[game:diceChoiceRespond]', res.error);
        setActionError(res.error);
      }
    });
  }

  // Precomputed once for the playing-phase render -- both the action panel
  // and the viewport room view need these.
  let me, currentRoom, hasRoomForFloor, directions, roommates;
  if (gameState) {
    me = gameState.players.find((p) => p.playerId === playerId);
    currentRoom = gameState.board[me.floor].find((r) => r.x === me.x && r.y === me.y);
    hasRoomForFloor =
      me.floor === 'ground'
        ? gameState.roomDeck.hasRoomForGround
        : me.floor === 'upper'
          ? gameState.roomDeck.hasRoomForUpper
          : gameState.roomDeck.hasRoomForBasement;
    directions = getAvailableDirections(me, currentRoom, gameState.board[me.floor]).filter(
      (d) => d.kind === 'move' || hasRoomForFloor
    );
    // Same-room players (excluding self) -- CharacterPanel's item "給予"
    // option needs this to offer a target to give to.
    roommates = gameState.players.filter(
      (p) => p.playerId !== playerId && p.floor === me.floor && p.x === me.x && p.y === me.y
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
        <div className="playing-layout">
          {/* TEMP: 除錯用邊框，用來核對版面各區塊的實際範圍，確認後可移除 */}
          <div className="playing-layout__viewport" style={{ border: '2px dashed green', boxSizing: 'border-box' }}>
            <div style={{ position: 'relative', width: 'var(--total-square)', height: 'var(--total-square)' }}>
              {(() => {
                if (mapMode === 'overview') {
                  const boardRooms = gameState.board[overviewFloor];
                  return (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <OverviewMap
                        visitedRooms={me.visitedRooms}
                        floor={overviewFloor}
                        onFloorChange={setOverviewFloor}
                        boardRooms={boardRooms}
                        roomContent={roomContent}
                        playerX={me.floor === overviewFloor ? me.x : null}
                        playerY={me.floor === overviewFloor ? me.y : null}
                      />
                    </div>
                  );
                }

                const roomsInSameSpot = gameState.players.filter(
                  (p) => p.floor === me.floor && p.x === me.x && p.y === me.y
                );

                return (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FocusedRoomView
                      currentRoom={currentRoom}
                      boardRooms={gameState.board[me.floor]}
                      roomContent={roomContent}
                      roomsInSameSpot={roomsInSameSpot}
                      allPlayers={gameState.players}
                      characterContent={characterContent}
                      directions={directions}
                      onMove={handleMove}
                    />
                  </div>
                );
              })()}
              {/* 四個角落浮動按鈕：不管目前是聚焦房間還是總覽地圖都要顯示 */}
              <button style={cornerButtonStyle('top-left')} onClick={() => handleSelectAction('room_action')}>
                行動
              </button>
              <button style={cornerButtonStyle('top-right')} onClick={() => setMapMode(mapMode === 'focused' ? 'overview' : 'focused')}>
                {mapMode === 'focused' ? '總覽地圖' : '目前房間'}
              </button>
              <button style={cornerButtonStyle('bottom-left')} onClick={() => handleSelectAction('attack')}>
                襲擊
              </button>
              <button style={cornerButtonStyle('bottom-right')} onClick={handleEndTurn}>
                回合結束
              </button>
            </div>
          </div>
          <div className="playing-layout__panel" style={{ border: '2px dashed blue', boxSizing: 'border-box' }}>
            <CharacterPanel
              player={me}
              messages={messages}
              cardContent={cardContent}
              onSelectAction={handleSelectAction}
              roommates={roommates}
            />
          </div>
          {(pendingEffectChoice || pendingRollChoice) && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                // Must render above CheckModal's zIndex 70 -- this interjection
                // prompt has a real 20s server-side deadline, while CheckModal
                // is purely a cosmetic reveal-delay with no deadline of its own.
                zIndex: 80,
              }}
            >
              <div style={{ backgroundColor: '#fff', padding: 16, maxWidth: '90%', maxHeight: '80%', overflow: 'auto', borderRadius: 8 }}>
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
                            <button onClick={() => handleRollChoiceRespond(o.itemId, Number(overrideInput))}>
                              使用
                            </button>
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
              </div>
            </div>
          )}
          {pendingCheckQueue.length > 0 && !pendingCheckQueue[0].noCheck && (
            <CheckModal
              key={pendingCheckQueue[0].queueId}
              check={pendingCheckQueue[0]}
              roomContent={roomContent}
              cardContent={cardContent}
              onDone={() => {
                setMessages((prev) => [...prev, pendingCheckQueue[0].logMessage]);
                setPendingCheckQueue((prev) => prev.slice(1));
              }}
            />
          )}
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
        </div>
      )}
    </div>
  );
}
