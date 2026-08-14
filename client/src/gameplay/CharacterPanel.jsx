const STAT_LABELS = [
  ['might', '力量'],
  ['speed', '速度'],
  ['knowledge', '知識'],
  ['sanity', '意志'],
];

function StatBar({ label, stat }) {
  const { track, currentIndex, baseIndex, skullIndex, overflow } = stat;
  return (
    <div style={{ marginBottom: 6 }}>
      <div>
        {label}：{track[currentIndex] + (overflow || 0)}
      </div>
      <div style={{ display: 'flex' }}>
        {track.map((_, i) => (
          <div
            key={i}
            style={{
              width: 16,
              height: 16,
              border: i === baseIndex ? '2px solid #2980b9' : '1px solid #333',
              backgroundColor: i === currentIndex ? '#f1c40f' : i <= skullIndex ? '#c0392b' : '#eee',
              boxSizing: 'border-box',
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function CharacterPanel({ player, messages, onSelectAction, onUseStairs, onEndTurn }) {
  return (
    <div>
      <h3>屬性</h3>
      {STAT_LABELS.map(([key, label]) => (
        <StatBar key={key} label={label} stat={player.stats[key]} />
      ))}

      <h3>道具</h3>
      <ul>
        {player.inventory.length === 0 && <li>（無）</li>}
        {player.inventory.map((item, i) => (
          <li key={`${item.id}-${i}`}>{item.id}</li>
        ))}
      </ul>

      <h3>行動</h3>
      <button onClick={() => onSelectAction('item')}>道具</button>
      <button onClick={() => onSelectAction('attack')}>襲擊</button>
      <button onClick={() => onSelectAction('room_action')}>操作</button>
      <button onClick={onUseStairs}>樓梯（免費）</button>
      <button onClick={onEndTurn}>結束回合</button>

      <h3>訊息</h3>
      <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #ccc', padding: 4 }}>
        {messages.length === 0 && <p>（尚無訊息）</p>}
        {messages.map((m, i) => (
          <p key={i} style={{ margin: '2px 0', fontSize: '0.85em' }}>
            {m}
          </p>
        ))}
      </div>
    </div>
  );
}
