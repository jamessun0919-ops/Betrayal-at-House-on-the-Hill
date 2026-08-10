import { useState, useEffect } from 'react';

export default function DebugGameScreen({ socket, roomCode, playerId }) {
  const [phase, setPhase] = useState('character_select');
  const [prompt, setPrompt] = useState(null);
  const [characterSelectState, setCharacterSelectState] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [lastPromptResolved, setLastPromptResolved] = useState(null);
  const [lastPendingAction, setLastPendingAction] = useState(null);
  const [actionError, setActionError] = useState('');
  const [lastCardDrawn, setLastCardDrawn] = useState(null);
  const [pendingEffectChoice, setPendingEffectChoice] = useState(null);
  const [lastEffectResolved, setLastEffectResolved] = useState(null);

  useEffect(() => {
    function onPrompt(data) {
      setPrompt(data);
    }
    function onPromptResolved(data) {
      setLastPromptResolved(data);
      setPrompt(null);
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
      setLastPendingAction(data);
    }
    function onCardDrawn(data) {
      setLastCardDrawn(data);
    }
    function onEffectPendingChoice(data) {
      setPendingEffectChoice(data);
    }
    function onEffectResolved(data) {
      setLastEffectResolved(data);
      setPendingEffectChoice(null);
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
          <h3>移動</h3>
          <button onClick={() => handleMove('north')}>北</button>
          <button onClick={() => handleMove('east')}>東</button>
          <button onClick={() => handleMove('south')}>南</button>
          <button onClick={() => handleMove('west')}>西</button>
          <h3>動作</h3>
          <button onClick={() => handleSelectAction('item')}>道具</button>
          <button onClick={() => handleSelectAction('attack')}>襲擊</button>
          <button onClick={() => handleSelectAction('room_action')}>操作</button>
          <button onClick={handleUseStairs}>樓梯（免費）</button>
          <button onClick={handleEndTurn}>結束回合</button>
          <h3>最新遊戲狀態</h3>
          <pre>{JSON.stringify(gameState, null, 2)}</pre>
          {lastPendingAction && <p>待處理動作：{JSON.stringify(lastPendingAction)}</p>}
          {lastCardDrawn && <p>抽到的卡：{JSON.stringify(lastCardDrawn)}</p>}
          {lastEffectResolved && <p>效果已解析完成：{JSON.stringify(lastEffectResolved)}</p>}
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
        </div>
      )}
    </div>
  );
}
