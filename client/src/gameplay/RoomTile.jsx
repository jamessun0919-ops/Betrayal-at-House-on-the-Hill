export default function RoomTile({ filename, name, rotation = 0, style }) {
  if (filename) {
    // rotate() 必須是最內層（最先套用）的 transform function，讓呼叫端（例如
    // FocusedRoomView 的縮放/拖動）傳入的 transform 包在外層，套用在已經旋轉好的
    // 圖片上 -- 這樣拖動手感永遠是螢幕座標方向，不受房間旋轉角度影響。
    // 沒有畫面美術圖的下方 fallback（純色塊＋房間名稱文字）不套用旋轉，旋轉文字
    // 沒有意義，只有實際有門框圖案的圖片才需要對齊。
    const { transform: incomingTransform, ...restStyle } = style || {};
    const transform = [incomingTransform, `rotate(${rotation}deg)`].filter(Boolean).join(' ');
    return (
      <img
        src={`/images/rooms/${filename}`}
        alt={name || ''}
        style={{ objectFit: 'cover', ...restStyle, transform }}
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
