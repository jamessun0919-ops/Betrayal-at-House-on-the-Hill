import { useState, useEffect, useRef } from 'react';
import FocusedRoomView from './gameplay/FocusedRoomView';
import OverviewMap from './gameplay/OverviewMap';
import CharacterPanel from './gameplay/CharacterPanel';
import NpcPanel from './gameplay/NpcPanel';
import CheckModal from './gameplay/CheckModal';
import SimplePopup from './gameplay/SimplePopup';
import { getAvailableDirections, findRoomInfo, findCardInfo, findCardName, getRoomActions, STAT_LABELS } from './gameplay/mapUtils';
import './gameplay/playingLayout.css';

function findPlayerName(playerId, players) {
  const player = (players || []).find((p) => p.playerId === playerId);
  return player ? player.name : playerId;
}

function resolveSimplePopupTitle(entry, roomContent, cardContent) {
  if (entry.kind === 'roomIntro') {
    const room = findRoomInfo(entry.sourceId, roomContent);
    return room ? room.name : entry.sourceId;
  }
  const card = findCardInfo(entry.sourceId, cardContent);
  return card ? card.name : entry.sourceId;
}

function resolveSimplePopupBody(entry, roomContent, cardContent) {
  if (entry.kind === 'roomIntro') {
    const room = findRoomInfo(entry.sourceId, roomContent);
    return room ? room.description : '';
  }
  const card = findCardInfo(entry.sourceId, cardContent);
  if (entry.kind === 'eventIntro') {
    return card ? card.description : '';
  }
  if (entry.kind === 'eventNoCheck' || entry.kind === 'itemUseResolved') {
    // overrideText carries server-computed dynamic text (e.g. item_036's
    // revealText) -- most cards don't set it, falling through to the static
    // feedbacktextOccur lookup as before.
    return entry.overrideText || (card && card.feedbacktextOccur) || '待補充';
  }
  // 'itemDrawNoCheck' -- existing pre-change popup content, unchanged
  return card ? (card.text || card.description || '') : '';
}

// Fills the blank peek-size x peek-size square at one of the viewport's 4
// corners -- the room tile (70%) plus the 4 edge peek bands (15% each) never
// cover the corners of the total-square, so these sit in otherwise-empty
// space regardless of which map mode (focused room vs overview) is
// currently rendered inside the viewport. Font size is derived from
// --peek-size (width/height); font size is a fixed 24px per the developer's
// direction (2-line labels via wrapLabel still keep the block compact).
function cornerButtonStyle(corner) {
  const base = {
    position: 'absolute',
    zIndex: 10,
    width: 'var(--peek-size)',
    height: 'var(--peek-size)',
    boxSizing: 'border-box',
    fontSize: 20,
    lineHeight: 1,
    padding: 2,
    border: '2px solid #555',
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  };
  const vSide = corner.includes('top') ? { top: 0 } : { bottom: 0 };
  const hSide = corner.includes('left') ? { left: 0 } : { right: 0 };
  return { ...base, ...vSide, ...hSide };
}

// Breaks a label into chunkSize-character lines (e.g. "總覽地圖" at chunkSize
// 2 -> "總覽" / "地圖") so multi-character labels read as a compact square
// block instead of a single wide line. A label no longer than chunkSize is
// returned unchanged (single line).
function wrapLabel(text, chunkSize) {
  if (text.length <= chunkSize) return text;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize));
  return chunks.map((chunk, i) => (
    <span key={i}>
      {chunk}
      {i < chunks.length - 1 && <br />}
    </span>
  ));
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
  // Same pattern again -- npcContent (NPC icon filenames) is static
  // reference data sent once on game:started, not part of game:stateUpdate's
  // payload.
  const [npcContent] = useState(initialGameState?.npcContent || null);
  const [actingAsNpcId, setActingAsNpcId] = useState(null);
  const [lastPromptResolved, setLastPromptResolved] = useState(null);
  const [actionError, setActionError] = useState('');
  const [messages, setMessages] = useState([]);
  const [mapMode, setMapMode] = useState('focused'); // 'focused' | 'overview'
  const [overviewFloor, setOverviewFloor] = useState('ground');
  const [pendingEffectChoice, setPendingEffectChoice] = useState(null);
  const [pendingRollChoice, setPendingRollChoice] = useState(null);
  const [pendingInventoryChoice, setPendingInventoryChoice] = useState(null);
  const [showRoomActionMenu, setShowRoomActionMenu] = useState(false);
  const [pendingCheckQueue, setPendingCheckQueue] = useState([]);
  // Monotonic id generator for pendingCheckQueue items -- CheckModal keys off
  // pendingCheckQueue[0].queueId (not the queue's length) so appending a new
  // item to the tail while the front item is still showing doesn't remount
  // and reset the in-progress check's phase.
  const nextCheckQueueId = useRef(0);

  useEffect(() => {
    function onPrompt(data) {
      setPrompt(data);
    }
    function onPromptResolved(data) {
      setLastPromptResolved(data);
      setMessages((prev) => [...prev, `提問結果：${JSON.stringify(data)}`]);
      setPrompt(null);
      setPendingRollChoice(null);
      setPendingInventoryChoice(null);
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
      if (data.deckType === 'omen') {
        // Omen (imprint) card descriptions already narrate the outcome ("你的手臂上
        // 出現了...印記") unlike event cards, whose description is pure scene-setting --
        // omens never get a second eventNoCheck/feedbacktextOccur popup, only the intro.
        if (data.playerId === playerId) {
          setPendingCheckQueue((prev) => [
            ...prev,
            { noCheck: true, kind: 'eventIntro', sourceId: data.cardId, queueId: nextCheckQueueId.current++ },
          ]);
        }
      } else if (data.deckType === 'event') {
        if (data.playerId === playerId) {
          setPendingCheckQueue((prev) => [
            ...prev,
            { noCheck: true, kind: 'eventIntro', sourceId: data.cardId, queueId: nextCheckQueueId.current++ },
          ]);
          const drawnCard = findCardInfo(data.cardId, cardContent);
          if (!data.hasCheck && !(drawnCard && drawnCard.activatedOnUse)) {
            setPendingCheckQueue((prev) => [
              ...prev,
              { noCheck: true, kind: 'eventNoCheck', sourceId: data.cardId, queueId: nextCheckQueueId.current++ },
            ]);
          }
        }
      } else if (!data.hasCheck) {
        setPendingCheckQueue((prev) => [
          ...prev,
          { noCheck: true, kind: 'itemDrawNoCheck', sourceId: data.cardId, queueId: nextCheckQueueId.current++ },
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
      if (data.enteredNewRoom && data.playerId === playerId && room && room.description) {
        setPendingCheckQueue((prev) => [
          ...prev,
          { noCheck: true, kind: 'roomIntro', sourceId: data.roomId, queueId: nextCheckQueueId.current++ },
        ]);
      }
    }
    function onSearchEmpty(data) {
      const playerName = findPlayerName(data.playerId, gameState?.players);
      setMessages((prev) => [...prev, `${playerName} 搜索了房間，但沒有找到任何東西`]);
    }
    function onItemUseResolved(data) {
      if (data.playerId !== playerId) return;
      setPendingCheckQueue((prev) => [
        ...prev,
        { noCheck: true, kind: 'itemUseResolved', sourceId: data.itemId, overrideText: data.revealText || data.randomEffectText, queueId: nextCheckQueueId.current++ },
      ]);
    }
    function onEffectPendingChoice(data) {
      if (data.playerId !== playerId) return;
      setPendingEffectChoice(data);
    }
    function onEffectResolved(data) {
      setMessages((prev) => [...prev, `效果已解析完成：${JSON.stringify(data)}`]);
      setPendingEffectChoice(null);
    }
    function onDiceChoicePending(data) {
      if (data.playerId !== playerId) return;
      setPendingRollChoice(data);
    }
    function onInventoryChoicePending(data) {
      if (data.playerId !== playerId) return;
      setPendingInventoryChoice(data);
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
    socket.on('game:inventoryChoicePending', onInventoryChoicePending);
    socket.on('game:checkResolved', onCheckResolved);
    socket.on('game:roomEntered', onRoomEntered);
    socket.on('game:searchEmpty', onSearchEmpty);
    socket.on('game:itemUseResolved', onItemUseResolved);

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
      socket.off('game:inventoryChoicePending', onInventoryChoicePending);
      socket.off('game:checkResolved', onCheckResolved);
      socket.off('game:roomEntered', onRoomEntered);
      socket.off('game:searchEmpty', onSearchEmpty);
      socket.off('game:itemUseResolved', onItemUseResolved);
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
    socket.emit('game:move', { direction, ...(actingAsNpcId ? { actingAsNpcId } : {}) }, (res) => {
      if (res && res.error) {
        console.error('[game:move]', res.error);
        setActionError(res.error);
      }
    });
  }

  function handleSelectAction(actionType, options = {}) {
    socket.emit('game:selectAction', { actionType, ...options, ...(actingAsNpcId ? { actingAsNpcId } : {}) }, (res) => {
      if (res && res.error) {
        console.error('[game:selectAction]', res.error);
        setActionError(res.error);
      }
    });
  }

  function handleChooseRoomAction(actionIndex) {
    setShowRoomActionMenu(false);
    handleSelectAction('room_action', { actionIndex });
  }

  function handleLockPhase() {
    socket.emit('game:lockPhase', { ...(actingAsNpcId ? { actingAsNpcId } : {}) }, (res) => {
      if (res && res.error) {
        console.error('[game:lockPhase]', res.error);
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

  function handleRollChoiceRespond(optionId) {
    if (!pendingRollChoice) return;
    socket.emit('game:diceChoiceRespond', { promptId: pendingRollChoice.promptId, optionId }, (res) => {
      if (res && res.error) {
        console.error('[game:diceChoiceRespond]', res.error);
        setActionError(res.error);
      }
    });
  }

  function handleInventoryChoiceRespond(itemId) {
    if (!pendingInventoryChoice) return;
    socket.emit('game:inventoryChoiceRespond', { promptId: pendingInventoryChoice.promptId, optionId: itemId }, (res) => {
      if (res && res.error) {
        console.error('[game:inventoryChoiceRespond]', res.error);
        setActionError(res.error);
      }
    });
  }

  // Precomputed once for the playing-phase render -- both the action panel
  // and the viewport room view need these.
  let me, myNpcs, activeEntity, currentRoom, hasRoomForFloor, directions, roommates, roomActions;
  if (gameState) {
    me = gameState.players.find((p) => p.playerId === playerId);
    myNpcs = gameState.players.filter((p) => p.isNPC && p.controlledBy === playerId);
    activeEntity = actingAsNpcId ? gameState.players.find((p) => p.playerId === actingAsNpcId) : me;
    currentRoom = gameState.board[activeEntity.floor].find((r) => r.x === activeEntity.x && r.y === activeEntity.y);
    hasRoomForFloor =
      activeEntity.floor === 'ground'
        ? gameState.roomDeck.hasRoomForGround
        : activeEntity.floor === 'upper'
          ? gameState.roomDeck.hasRoomForUpper
          : gameState.roomDeck.hasRoomForBasement;
    directions = getAvailableDirections(activeEntity, currentRoom, gameState.board[activeEntity.floor]).filter(
      (d) => d.kind === 'move' || (!actingAsNpcId && hasRoomForFloor)
    );
    // Same-room players (excluding self) -- CharacterPanel's item "給予"
    // option needs this to offer a target to give to. Always about `me`'s
    // own room, unaffected by which entity is currently being controlled.
    roommates = gameState.players.filter(
      (p) => p.playerId !== playerId && p.floor === me.floor && p.x === me.x && p.y === me.y
    );
    roomActions = actingAsNpcId
      ? []
      : (roomContent ? getRoomActions(findRoomInfo(currentRoom.roomId, roomContent), currentRoom) : []);
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
          <div className="playing-layout__viewport">
            <div style={{ position: 'relative', width: 'var(--total-square)', height: 'var(--total-square)' }}>
              {(() => {
                if (mapMode === 'overview') {
                  const boardRooms = gameState.board[overviewFloor];
                  return (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto' }}>
                      <OverviewMap
                        visitedRooms={me.visitedRooms}
                        floor={overviewFloor}
                        onFloorChange={setOverviewFloor}
                        boardRooms={boardRooms}
                        board={gameState.board}
                        roomContent={roomContent}
                        playerX={me.floor === overviewFloor ? me.x : null}
                        playerY={me.floor === overviewFloor ? me.y : null}
                      />
                    </div>
                  );
                }

                const roomsInSameSpot = gameState.players.filter(
                  (p) => p.floor === activeEntity.floor && p.x === activeEntity.x && p.y === activeEntity.y
                );

                return (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FocusedRoomView
                      currentRoom={currentRoom}
                      boardRooms={gameState.board[activeEntity.floor]}
                      roomContent={roomContent}
                      roomsInSameSpot={roomsInSameSpot}
                      allPlayers={gameState.players}
                      characterContent={characterContent}
                      npcContent={npcContent}
                      directions={directions}
                      onMove={handleMove}
                    />
                  </div>
                );
              })()}
              {/* 四個角落浮動按鈕：不管目前是聚焦房間還是總覽地圖都要顯示 */}
              {!actingAsNpcId && (
                <button
                  style={cornerButtonStyle('top-left')}
                  onClick={() => (roomActions.length > 1 ? setShowRoomActionMenu(true) : handleSelectAction('room_action'))}
                >
                  {wrapLabel('房間行動', 2)}
                </button>
              )}
              <button style={cornerButtonStyle('top-right')} onClick={() => setMapMode(mapMode === 'focused' ? 'overview' : 'focused')}>
                {wrapLabel(mapMode === 'focused' ? '筆記資訊' : '目前房間', 2)}
              </button>
              {!actingAsNpcId && (
                <button style={cornerButtonStyle('bottom-left')} onClick={() => handleSelectAction('attack')}>
                  {wrapLabel('襲擊目標', 2)}
                </button>
              )}
              <button style={cornerButtonStyle('bottom-right')} onClick={handleLockPhase}>
                {wrapLabel(actingAsNpcId ? 'NPC階段結束' : '階段結束', 2)}
              </button>
            </div>
          </div>
          <div className="playing-layout__panel">
            {myNpcs.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <button onClick={() => setActingAsNpcId(null)} disabled={!actingAsNpcId}>操控：自己</button>
                {myNpcs.map((npc) => (
                  <button key={npc.playerId} onClick={() => setActingAsNpcId(npc.playerId)} disabled={actingAsNpcId === npc.playerId}>
                    操控：{npc.npcID}
                  </button>
                ))}
              </div>
            )}
            {actingAsNpcId ? (
              <NpcPanel
                npc={activeEntity}
                roomDroppedItems={currentRoom.droppedItems || []}
                onSelectAction={handleSelectAction}
              />
            ) : (
              <CharacterPanel
                player={me}
                messages={messages}
                cardContent={cardContent}
                characterContent={characterContent}
                onSelectAction={handleSelectAction}
                roommates={roommates}
              />
            )}
          </div>
          {showRoomActionMenu && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 60,
              }}
              onClick={() => setShowRoomActionMenu(false)}
            >
              <div style={{ backgroundColor: '#fff', padding: 16, borderRadius: 8, minWidth: 200 }} onClick={(e) => e.stopPropagation()}>
                <p style={{ fontWeight: 'bold', marginBottom: 8 }}>選擇行動</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {roomActions.map((action, i) => (
                    <button key={i} onClick={() => handleChooseRoomAction(i)}>
                      {action.label}
                    </button>
                  ))}
                  <button onClick={() => setShowRoomActionMenu(false)}>取消</button>
                </div>
              </div>
            </div>
          )}
          {(pendingEffectChoice || pendingRollChoice || pendingInventoryChoice) && (
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
                    {pendingRollChoice.options.map((o) => {
                      const cardInfo = findCardInfo(o.itemId, cardContent);
                      return (
                        <li key={o.itemId}>
                          <strong>{o.name}</strong>
                          {cardInfo && cardInfo.diceInterjectionText && <p>{cardInfo.diceInterjectionText}</p>}
                          <button onClick={() => handleRollChoiceRespond(o.itemId)}>使用</button>
                        </li>
                      );
                    })}
                  </ul>
                  <button onClick={() => handleRollChoiceRespond('__skip__')}>不使用道具</button>
                </div>
              )}
              {pendingInventoryChoice && (
                <div>
                  <p>攜帶的道具已經超過上限（力量值），請選擇要遺留哪一件：</p>
                  <ul>
                    {pendingInventoryChoice.itemIds.map((itemId) => (
                      <li key={itemId}>
                        {findCardName(itemId, cardContent)}
                        <button onClick={() => handleInventoryChoiceRespond(itemId)}>遺留這件</button>
                      </li>
                    ))}
                  </ul>
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
            <SimplePopup
              title={resolveSimplePopupTitle(pendingCheckQueue[0], roomContent, cardContent)}
              body={resolveSimplePopupBody(pendingCheckQueue[0], roomContent, cardContent)}
              onDone={() => setPendingCheckQueue((prev) => prev.slice(1))}
            />
          )}
          {gameState.currentPhase === 'settlement' && (
            <SimplePopup
              title="結算階段"
              body="本回合尚無需要結算的效果。"
              onDone={handleLockPhase}
            />
          )}
        </div>
      )}
    </div>
  );
}
