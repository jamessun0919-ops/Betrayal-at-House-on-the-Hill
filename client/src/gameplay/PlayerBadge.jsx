const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

export default function PlayerBadge({ name, colorIndex, iconSrc, style }) {
  const baseStyle = {
    width: 24,
    height: 24,
    borderRadius: '50%',
    border: '2px solid #fff',
    boxShadow: '0 0 2px rgba(0,0,0,0.5)',
    ...style,
  };

  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt={name || '?'}
        title={name || '?'}
        style={{ ...baseStyle, objectFit: 'cover', backgroundColor: '#fff' }}
      />
    );
  }

  // Fallback (e.g. character data not loaded yet) -- colored circle with the
  // player's initial, same as before icons existed.
  return (
    <div
      style={{
        ...baseStyle,
        backgroundColor: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 'bold',
      }}
    >
      {(name || '?')[0]}
    </div>
  );
}

export { PLAYER_COLORS };
