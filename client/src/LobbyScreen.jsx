import { useState, useEffect, useRef } from 'react';
import { createSocket } from './socket';

const ERROR_MESSAGES = {
  ROOM_NOT_FOUND: '找不到這個房號，請確認後再試一次',
  INVALID_NAME: '暱稱不可為空白，且長度不可超過 20 個字',
  ALREADY_IN_ROOM: '您已經在房間內了',
};

function translateError(code) {
  return ERROR_MESSAGES[code] || '發生未知錯誤，請稍後再試';
}

export default function LobbyScreen() {
  const socketRef = useRef(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('lobby:players', ({ players }) => setPlayers(players));
    socket.on('disconnect', () => setDisconnected(true));
    return () => socket.close();
  }, []);

  function handleCreate() {
    socketRef.current.emit('lobby:create', { playerName: name }, (res) => {
      if (res.error) {
        setError(translateError(res.error));
        return;
      }
      setRoomCode(res.roomCode);
      setError('');
    });
  }

  function handleJoin() {
    socketRef.current.emit('lobby:join', { roomCode: joinCode, playerName: name }, (res) => {
      if (res.error) {
        setError(translateError(res.error));
        return;
      }
      setRoomCode(res.roomCode);
      setError('');
    });
  }

  if (roomCode) {
    return (
      <div>
        {disconnected && (
          <p style={{ color: 'red' }}>連線已中斷，請重新整理頁面</p>
        )}
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
      {disconnected && (
        <p style={{ color: 'red' }}>連線已中斷，請重新整理頁面</p>
      )}
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
