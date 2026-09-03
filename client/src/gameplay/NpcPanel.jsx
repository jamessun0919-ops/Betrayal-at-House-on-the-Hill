export default function NpcPanel({ npc, roomDroppedItems, onSelectAction }) {
  return (
    <div>
      <p>行動力：{npc.actionPoints}</p>
      <p>背包（上限 1 件）：</p>
      <ul>
        {npc.inventory.map((item) => (
          <li key={item.id}>
            {item.id}
            <button onClick={() => onSelectAction('item', { itemId: item.id, mode: 'leave' })}>遺留</button>
          </li>
        ))}
        {npc.inventory.length === 0 && <li>（空）</li>}
      </ul>
      <p>房間掉落物：</p>
      <ul>
        {roomDroppedItems.map((item) => (
          <li key={item.id}>
            {item.id}
            <button
              onClick={() => onSelectAction('item', { itemId: item.id, mode: 'pickup' })}
              disabled={npc.inventory.length >= 1}
            >
              拾取
            </button>
          </li>
        ))}
        {roomDroppedItems.length === 0 && <li>（無）</li>}
      </ul>
    </div>
  );
}
