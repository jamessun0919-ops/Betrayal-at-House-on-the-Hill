const DIRECTION_LABELS = { north: '北', east: '東', south: '南', west: '西' };
const STACK_ORDER = ['room_lobby_c', 'room_lobby_b', 'room_lobby_a'];

export default function EntranceHallView({ currentRoomId, doorSides, startingRooms, onMove, onUseStairs }) {
  const filenameById = Object.fromEntries(startingRooms.map((r) => [r.id, r.filename]));

  return (
    <div>
      <div>
        {STACK_ORDER.map((roomId) => (
          <img
            key={roomId}
            src={`/images/rooms/${filenameById[roomId]}`}
            alt="大門廳"
            style={{ width: '300px', display: 'block' }}
          />
        ))}
      </div>
      <h3>移動</h3>
      {doorSides.map((direction) => (
        <button key={direction} onClick={() => onMove(direction)}>
          {DIRECTION_LABELS[direction]}
        </button>
      ))}
      {currentRoomId === 'room_lobby_c' && <button onClick={onUseStairs}>上二樓</button>}
    </div>
  );
}
