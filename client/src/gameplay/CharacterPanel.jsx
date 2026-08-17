import { useState } from 'react';

const STAT_LABELS = {
  might: '力量',
  speed: '速度',
  knowledge: '知識',
  sanity: '意志',
};

// 由上到下排列的順序：力量／速度／意志／知識
const STAT_ORDER = ['might', 'speed', 'sanity', 'knowledge'];

function StatRow({ label, stat }) {
  const { track, currentIndex, baseIndex, skullIndex, overflow } = stat;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 18, fontWeight: 'bold' }}>
        當前{label}：{track[currentIndex] + (overflow || 0)}
      </span>
      <div style={{ display: 'flex', gap: 2 }}>
        {track.map((value, i) => (
          <div
            key={i}
            style={{
              width: 24,
              height: 24,
              flexShrink: 0,
              border: i === baseIndex ? '2px solid #2980b9' : '1px solid #333',
              backgroundColor: i === currentIndex ? '#f1c40f' : i <= skullIndex ? '#c0392b' : '#eee',
              color: i <= skullIndex && i !== currentIndex ? '#fff' : '#1a1a1a',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
            }}
          >
            {value}
          </div>
        ))}
      </div>
    </div>
  );
}

function findCardName(id, cardContent) {
  if (!cardContent) return id;
  const all = [...(cardContent.items || []), ...(cardContent.events || []), ...(cardContent.omens || [])];
  const found = all.find((c) => c.id === id);
  return found ? found.name : id;
}

export default function CharacterPanel({ player, messages, cardContent, onSelectAction }) {
  const [selectedItem, setSelectedItem] = useState(null); // { itemId, name } | null

  const speed = player.stats.speed;
  const maxActionPoints = speed.track[speed.currentIndex] + (speed.overflow || 0);

  function handleUseItem() {
    onSelectAction('item', { itemId: selectedItem.itemId, mode: 'use' });
    setSelectedItem(null);
  }
  function handleLeaveItem() {
    onSelectAction('item', { itemId: selectedItem.itemId, mode: 'leave' });
    setSelectedItem(null);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', fontSize: 13 }}>
      {/* 中央狀態區域（佔面板 75% 高）：左 80% 姓名/行動力＋四項能力，右 20% 道具區 */}
      <div style={{ flex: 3, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: '0 0 80%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 2, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 24, fontWeight: 'bold', textAlign: 'center' }}>
              {player.name}　行動力：{player.actionPoints} / {maxActionPoints}
            </span>
          </div>
          {STAT_ORDER.map((key) => (
            <div key={key} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <StatRow label={STAT_LABELS[key]} stat={player.stats[key]} />
            </div>
          ))}
        </div>

        {/* 道具區：點選道具名稱跳出使用/遺留選項 */}
        <div
          style={{
            flex: '0 0 20%',
            minWidth: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            borderLeft: '1px solid #ccc',
            paddingLeft: 6,
          }}
        >
          {player.inventory.length === 0 ? (
            <span style={{ color: '#888', fontSize: 12 }}>（無道具）</span>
          ) : (
            player.inventory.map((item, i) => (
              <button
                key={`${item.id}-${i}`}
                onClick={() => setSelectedItem({ itemId: item.id, name: findCardName(item.id, cardContent) })}
                style={{
                  border: '1px solid #999',
                  borderRadius: 4,
                  padding: '2px 4px',
                  fontSize: 11,
                  backgroundColor: '#f5f5f5',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                {findCardName(item.id, cardContent)}
              </button>
            ))
          )}
        </div>
      </div>

      {/* 下方訊息欄：跟整個面板同寬（不分左右），佔面板 25% 高，虛線框顯示大小
          最新訊息在最上方，超出範圍的舊訊息直接裁掉不捲動 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          border: '2px dashed #999',
          boxSizing: 'border-box',
          padding: 4,
        }}
      >
        {messages.length === 0 && (
          <p style={{ margin: '2px 0', fontSize: '0.85em', color: '#888' }}>（尚無訊息）</p>
        )}
        {[...messages].reverse().map((m, i) => (
          <p key={messages.length - i} style={{ margin: '2px 0', fontSize: '0.8em' }}>
            {m}
          </p>
        ))}
      </div>

      {selectedItem && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
          }}
          onClick={() => setSelectedItem(null)}
        >
          <div style={{ backgroundColor: '#fff', padding: 16, borderRadius: 8, minWidth: 200 }} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontWeight: 'bold', marginBottom: 8 }}>{selectedItem.name}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleUseItem}>使用</button>
              <button onClick={handleLeaveItem}>遺留</button>
              <button onClick={() => setSelectedItem(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
