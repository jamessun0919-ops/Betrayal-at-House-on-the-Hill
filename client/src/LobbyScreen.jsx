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
