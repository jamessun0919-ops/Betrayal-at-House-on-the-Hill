const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

export default function PlayerBadge({ name, colorIndex, style }) {
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        backgroundColor: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 'bold',
        border: '2px solid #fff',
        boxShadow: '0 0 2px rgba(0,0,0,0.5)',
        ...style,
      }}
    >
      {(name || '?')[0]}
    </div>
  );
}

export { PLAYER_COLORS };
