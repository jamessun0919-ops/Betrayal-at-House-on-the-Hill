import { useState, useEffect, useCallback } from 'react';
import { translateError } from './errorMessages';

export default function LobbyListScreen({ socket, name, onJoined, onBack }) {
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchRooms = useCallback(() => {
    setLoading(true);
    socket.emit('lobby:list', {}, (res) => {
      setLoading(false);
      if (res && res.error) {
        setError(translateError(res.error));
        return;
      }
      setError('');
      setRooms(res.rooms || []);
    });
  }, [socket]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  function handleJoin(roomCode) {
    socket.emit('lobby:join', { roomCode, playerName: name }, (res) => {
      if (res && res.error) {
        setError(translateError(res.error));
        return;
      }
      onJoined(res.roomCode, res.playerId);
    });
  }

  return (
    <div className="lobby-watermark-screen">
      <div className="lobby-center-panel">
        <h2>大廳列表</h2>
        {error && <p className="lobby-error">{error}</p>}
        <button className="lobby-button" onClick={fetchRooms} disabled={loading}>重新整理</button>
        {rooms.length === 0 && !loading && <p>目前沒有開放中的大廳</p>}
        <ul className="lobby-room-list">
          {rooms.map((r) => (
            <li key={r.roomCode}>
              <button className="lobby-room-item" onClick={() => handleJoin(r.roomCode)}>
                {r.hostName} 的大廳（{r.playerCount}/{r.maxPlayers}）
              </button>
            </li>
          ))}
        </ul>
        <button className="lobby-button" onClick={onBack}>返回</button>
      </div>
    </div>
  );
}
