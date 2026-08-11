import { useState, useEffect } from 'react';
import { translateError } from './errorMessages';

export default function WaitingRoomScreen({ socket, roomCode, playerId, onClosed, onLeft, onCharacterSelectStarted }) {
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    function onPlayers(data) {
      setPlayers(data.players);
    }
    function onLobbyClosed() {
      onClosed();
    }
    function onCharacterSelectUpdate() {
      onCharacterSelectStarted();
    }
    socket.on('lobby:players', onPlayers);
    socket.on('lobby:closed', onLobbyClosed);
    socket.on('game:characterSelectUpdate', onCharacterSelectUpdate);
    return () => {
      socket.off('lobby:players', onPlayers);
      socket.off('lobby:closed', onLobbyClosed);
      socket.off('game:characterSelectUpdate', onCharacterSelectUpdate);
    };
  }, [socket, onClosed, onCharacterSelectStarted]);

  const me = players.find((p) => p.playerId === playerId);
  const isHost = Boolean(me && me.isHost);

  function handleLeave() {
    socket.emit('lobby:leave', {}, (res) => {
      if (res && res.error) {
        setError(translateError(res.error));
        return;
      }
      // The host's own socket also receives the lobby:closed broadcast (it's
      // still in the io room at the moment closeLobbyRoom emits it) -- let
      // that handler drive the transition via onClosed() instead of calling
      // onLeft() here too, or the two would race to pick the next screen.
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
