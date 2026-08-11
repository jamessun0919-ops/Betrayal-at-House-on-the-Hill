import { useState, useEffect, useRef } from 'react';
import { createSocket } from './socket';
import StartScreen from './lobby/StartScreen';
import NicknameModal from './lobby/NicknameModal';
import LobbyListScreen from './lobby/LobbyListScreen';
import WaitingRoomScreen from './lobby/WaitingRoomScreen';
import CharacterSelectPlaceholder from './lobby/CharacterSelectPlaceholder';
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
