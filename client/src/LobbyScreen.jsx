import { useState, useEffect, useRef } from 'react';
import { createSocket } from './socket';
import StartScreen from './lobby/StartScreen';
import NicknameModal from './lobby/NicknameModal';
import LobbyListScreen from './lobby/LobbyListScreen';
import WaitingRoomScreen from './lobby/WaitingRoomScreen';
import CharacterSelectPlaceholder from './lobby/CharacterSelectPlaceholder';
import './lobby/lobby.css';

const ERROR_MESSAGES = {
  ROOM_NOT_FOUND: '找不到這個房號，請確認後再試一次',
  INVALID_NAME: '暱稱不可為空白，且長度不可超過 20 個字',
  ALREADY_IN_ROOM: '您已經在房間內了',
  ROOM_IN_PROGRESS: '這個大廳已經開始遊戲了，無法加入',
  NOT_IN_ROOM: '您目前不在任何房間內',
  TOO_FEW_PLAYERS: '至少需要 2 位玩家才能開始',
};

function translateError(code) {
  return ERROR_MESSAGES[code] || '發生未知錯誤，請稍後再試';
}

export default function LobbyScreen() {
  const socketRef = useRef(null);
  const [screen, setScreen] = useState('start');
  const [nicknameFlow, setNicknameFlow] = useState(null); // 'create' | 'join'
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [nicknameError, setNicknameError] = useState('');
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('disconnect', () => setDisconnected(true));
    return () => socket.close();
  }, []);

  function resetToStart() {
    setScreen('start');
    setRoomCode(null);
    setPlayerId(null);
    setNicknameError('');
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
          onClosed={resetToStart}
          onLeft={() => setScreen('lobbyList')}
          onCharacterSelectStarted={() => setScreen('placeholder')}
        />
      )}

      {screen === 'placeholder' && <CharacterSelectPlaceholder />}
    </div>
  );
}
