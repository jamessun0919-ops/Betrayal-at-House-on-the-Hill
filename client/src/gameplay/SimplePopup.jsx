const overlayStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 70,
};

const boxStyle = {
  width: 320,
  maxWidth: '90%',
  backgroundColor: '#111',
  color: '#f5f5f0',
  borderRadius: 12,
  padding: 20,
  boxSizing: 'border-box',
};

export default function SimplePopup({ title, body, onDone }) {
  return (
    <div style={overlayStyle}>
      <div style={boxStyle}>
        <p style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>{title}</p>
        <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>{body}</p>
        <button style={{ width: '100%', fontSize: 18, padding: 12 }} onClick={onDone}>
          確認
        </button>
      </div>
    </div>
  );
}
