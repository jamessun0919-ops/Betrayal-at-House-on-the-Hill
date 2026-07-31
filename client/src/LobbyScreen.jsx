import { useState, useEffect, useRef } from 'react';
import { createSocket } from './socket';

export default function LobbyScreen() {
  const socketRef = useRef(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('lobby:players', ({ players }) => setPlayers(players));
    return () => socket.close();
  }, []);

  function handleCreate() {
    socketRef.current.emit('lobby:create', { playerName: name }, (res) => {
      setRoomCode(res.roomCode);
      setError('');
    });
  }

  function handleJoin() {
    socketRef.current.emit('lobby:join', { roomCode: joinCode, playerName: name }, (res) => {
      if (res.error) {
        setError(res.error);
        return;
      }
      setRoomCode(joinCode);
      setError('');
    });
  }

  if (roomCode) {
    return (
      <div>
        <h2>房號：{roomCode}</h2>
        <h3>目前連線玩家：</h3>
        <ul>
          {players.map((p) => (
            <li key={p.playerId}>{p.name}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <label>
        暱稱：
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div>
        <button onClick={handleCreate} disabled={!name}>建立房間</button>
      </div>
      <div>
        <input
          placeholder="房號"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
        />
        <button onClick={handleJoin} disabled={!name || !joinCode}>加入房間</button>
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
