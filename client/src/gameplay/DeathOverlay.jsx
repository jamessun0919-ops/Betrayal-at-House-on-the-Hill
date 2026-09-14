const overlayStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: '#000',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Above every other in-game popup (highest existing zIndex is 80) -- death
  // must fully obscure the game screen, not just sit on top of it.
  zIndex: 100,
};

const boxStyle = {
  width: 320,
  maxWidth: '90%',
  color: '#f5f5f0',
  textAlign: 'center',
  boxSizing: 'border-box',
};

export default function DeathOverlay({ onConfirm }) {
  return (
    <div style={overlayStyle}>
      <div style={boxStyle}>
        <p style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 12 }}>角色死亡</p>
        <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 20 }}>
          你的角色已經力竭死亡，本回合結束後將會離開遊戲。
        </p>
        <button style={{ width: '100%', fontSize: 18, padding: 12 }} onClick={onConfirm}>
          確認
        </button>
      </div>
    </div>
  );
}
