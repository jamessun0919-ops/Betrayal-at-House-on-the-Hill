import { useState } from 'react';
import { STAT_LABELS, findCardInfo } from './mapUtils';

// 由上到下排列的順序：力量／速度／意志／知識
const STAT_ORDER = ['might', 'speed', 'sanity', 'knowledge'];

// 標籤與格子區的版面比例（label／gap／格子區寬度）統一用同一組百分比常數，
// 讓行動條跟四項能力條套用完全相同的間距與對齊，不會再各自不一致。這一列
// 本身要有明確寬度（width:'100%'，撐滿 CharacterPanel 右側「行動＋四能力」欄）
// 百分比才有穩定的計算基準；格子區寬度是相對這一列的百分比，格子本身用
// flex:1 平分格子區寬度並靠 aspectRatio 維持正方形，這樣才能跟著螢幕寬度縮放，
// 不用像素寫死。
const ROW_LABEL_GAP = '4%';
const ROW_TRACK_WIDTH = '78%';
const ROW_CELL_GAP = '1%';

function StatRow({ label, stat }) {
  const { track, currentIndex, baseIndex, skullIndex, overflow } = stat;
  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: ROW_LABEL_GAP, flexWrap: 'nowrap' }}>
      <span style={{ fontSize: 18, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ width: ROW_TRACK_WIDTH, display: 'flex', gap: ROW_CELL_GAP }}>
        {track.map((value, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              aspectRatio: '1',
              border: i === baseIndex ? '2px solid #2980b9' : '1px solid #333',
              backgroundColor: i === currentIndex ? '#f1c40f' : (i <= skullIndex && i !== 0) ? '#c0392b' : '#eee',
              color: i <= skullIndex && i !== 0 && i !== currentIndex ? '#fff' : '#1a1a1a',
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

// 固定 8 格，代表遊戲全域的行動力上限（跟角色自己的當前上限 maxActionPoints 是兩回事）：
// 前 actionPoints 格＝深綠框淺綠底（目前擁有）；actionPoints ~ maxActionPoints 格＝深綠框白底
// （角色上限內、但目前已用掉的部分）；超過角色自己 maxActionPoints 的格＝虛線框白底（角色永遠碰不到）。
// 格子區寬度／格子間距跟 StatRow 共用同一組常數，維持版面一致。
function ActionPointBoxes({ actionPoints, maxActionPoints }) {
  return (
    <div style={{ width: ROW_TRACK_WIDTH, display: 'flex', gap: ROW_CELL_GAP }}>
      {Array.from({ length: 8 }).map((_, i) => {
        let border;
        if (i < actionPoints) {
          border = '2px solid #1e7d32';
        } else if (i < maxActionPoints) {
          border = '2px solid #1e7d32';
        } else {
          border = '2px dashed #999';
        }
        const backgroundColor = i < actionPoints ? '#a8e6a1' : '#fff';
        return <div key={i} style={{ flex: 1, aspectRatio: '1', boxSizing: 'border-box', border, backgroundColor }} />;
      })}
    </div>
  );
}

function findCardName(id, cardContent) {
  const card = findCardInfo(id, cardContent);
  return card ? card.name : id;
}

function isOmenCard(id, cardContent) {
  return Boolean(cardContent?.omens?.some((c) => c.id === id));
}

function findCharacterPortrait(characterId, characterContent) {
  if (!characterContent || !characterId) return null;
  const character = characterContent.find((c) => c.id === characterId);
  return character?.filename ? `/images/${character.filename}` : null;
}

// 4 顆一排、按鍵間與左右邊界皆間隔 2%（跟著容器寬度縮放）：
// 邊界 2*2% + 間距 3*2% = 10%，剩下 90% 分 4 顆，每顆 22.5%（比原本 21.875% 多留一點文字空間）
const ITEM_SLOT_GAP = '2%';
const ITEM_SLOT_WIDTH = '22.5%';

export default function CharacterPanel({ player, cardContent, characterContent, onSelectAction, roommates }) {
  const [selectedItem, setSelectedItem] = useState(null); // { itemId, name, isMaterial } | null
  const [showGiveTargets, setShowGiveTargets] = useState(false);

  const speed = player.stats.speed;
  const maxActionPoints = speed.track[speed.currentIndex] + (speed.overflow || 0);
  const portraitSrc = findCharacterPortrait(player.characterId, characterContent);

  function closeItemMenu() {
    setSelectedItem(null);
    setShowGiveTargets(false);
  }
  function handleUseItem() {
    onSelectAction('item', { itemId: selectedItem.itemId, mode: 'use' });
    closeItemMenu();
  }
  function handleLeaveItem() {
    onSelectAction('item', { itemId: selectedItem.itemId, mode: 'leave' });
    closeItemMenu();
  }
  function handleGiveItem(targetPlayerId) {
    onSelectAction('item', { itemId: selectedItem.itemId, mode: 'give', targetPlayerId });
    closeItemMenu();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', fontSize: 13, gap: '2.5%' }}>
      {/* 狀態區（在上）：左側角色形象框（寬度是這一列的 28%，高度跟著右側 5 行的疊加高度自動撐開，
          預設 align-items:stretch），右側行動／四項能力皆靠右對齊、距邊框固定比例，緊湊排列 */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'row', gap: '2.5%', paddingTop: '1.5%' }}>
        <div style={{ flex: '0 0 28%', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {portraitSrc ? (
            <img
              src={portraitSrc}
              alt={player.name}
              style={{ width: '100%', flex: 1, minHeight: 0, objectFit: 'cover', objectPosition: 'top', borderRadius: 4, boxSizing: 'border-box' }}
            />
          ) : (
            <div style={{ width: '100%', flex: 1, minHeight: 0, borderRadius: 4, boxSizing: 'border-box' }} />
          )}
          <span style={{ fontSize: 14, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', flexShrink: 0 }}>
            {player.name}
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3.75%', paddingRight: '3.75%', boxSizing: 'border-box' }}>
          <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: ROW_LABEL_GAP }}>
            <span style={{ fontSize: 18, fontWeight: 'bold', whiteSpace: 'nowrap' }}>行動</span>
            <ActionPointBoxes actionPoints={player.actionPoints} maxActionPoints={maxActionPoints} />
          </div>
          {STAT_ORDER.map((key) => (
            <StatRow key={key} label={STAT_LABELS[key]} stat={player.stats[key]} />
          ))}
        </div>
      </div>

      {/* 道具區（在下）：取代原本訊息欄的位置（訊息欄暫時不顯示）。第一/二排是道具（8 格），第三排是預兆（4 格，粉紅底），
          格數不足時用佔位格補滿維持 4 顆一排的固定格線；超過格數（尚無攜帶上限機制）就自然往下多排一行 */}
      {(() => {
        const itemEntries = player.inventory.filter((it) => !isOmenCard(it.id, cardContent));
        const omenEntries = player.inventory.filter((it) => isOmenCard(it.id, cardContent));
        const paddedItems = itemEntries.length >= 8 ? itemEntries : [...itemEntries, ...Array(8 - itemEntries.length).fill(null)];
        const paddedOmens = omenEntries.length >= 4 ? omenEntries : [...omenEntries, ...Array(4 - omenEntries.length).fill(null)];
        const slots = [
          ...paddedItems.map((item) => ({ item, background: '#f5f5f5' })),
          ...paddedOmens.map((item) => ({ item, background: '#f7c6d9' })),
        ];
        return (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignContent: 'flex-start',
              gap: ITEM_SLOT_GAP,
              paddingTop: '1.5%',
              paddingLeft: ITEM_SLOT_GAP,
              paddingRight: ITEM_SLOT_GAP,
              boxSizing: 'border-box',
            }}
          >
            {slots.map(({ item, background }, i) =>
              item ? (
                <button
                  key={`${item.id}-${i}`}
                  onClick={() => setSelectedItem({ itemId: item.id, name: findCardName(item.id, cardContent), isMaterial: Boolean(findCardInfo(item.id, cardContent)?.isMaterial) })}
                  style={{
                    width: ITEM_SLOT_WIDTH,
                    flexShrink: 0,
                    boxSizing: 'border-box',
                    border: '1px solid #999',
                    borderRadius: 4,
                    padding: '2px 2px',
                    fontSize: 18,
                    backgroundColor: background,
                    textAlign: 'center',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {findCardName(item.id, cardContent)}
                </button>
              ) : (
                <div
                  key={`placeholder-${i}`}
                  style={{ width: ITEM_SLOT_WIDTH, aspectRatio: '3', flexShrink: 0, boxSizing: 'border-box', border: '1px dashed #ccc', borderRadius: 4 }}
                />
              )
            )}
          </div>
        );
      })()}

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
          onClick={closeItemMenu}
        >
          <div style={{ backgroundColor: '#fff', padding: 16, borderRadius: 8, minWidth: 200 }} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontWeight: 'bold', marginBottom: 8 }}>{selectedItem.name}</p>
            {showGiveTargets ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(roommates || []).map((p) => (
                  <button key={p.playerId} onClick={() => handleGiveItem(p.playerId)}>
                    {p.name}
                  </button>
                ))}
                <button onClick={() => setShowGiveTargets(false)}>返回</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                {!selectedItem.isMaterial && <button onClick={handleUseItem}>使用</button>}
                {roommates && roommates.length > 0 && (
                  <button onClick={() => setShowGiveTargets(true)}>給予</button>
                )}
                <button onClick={handleLeaveItem}>遺留</button>
                <button onClick={closeItemMenu}>取消</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
