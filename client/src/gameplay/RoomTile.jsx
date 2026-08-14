export default function RoomTile({ filename, name, style }) {
  if (filename) {
    return (
      <img
        src={`/images/rooms/${filename}`}
        alt={name || ''}
        style={{ objectFit: 'cover', ...style }}
      />
    );
  }
  return (
    <div
      style={{
        backgroundColor: '#8a8a8a',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontSize: '0.85em',
        ...style,
      }}
    >
      {name || '(未知房間)'}
    </div>
  );
}
