import { useState } from 'react';
import { findRoomInfo, findCardInfo } from './mapUtils';

const STAT_LABELS = { might: '力量', speed: '速度', knowledge: '知識', sanity: '意志' };

const TITLE_BY_KIND = {
  leaveCheck: '離開房間考驗',
  collapseCheck: '進入房間考驗',
  cardCheck: '進入房間 · 抽卡考驗',
};

// 骰子動畫佔位（開發者之後會自行設計替換），純粹是延遲揭曉結果的固定時長。
const ANIMATION_MS = 2500;

function resolveSource(check, roomContent, cardContent) {
  if (check.sourceKind === 'room') {
    const room = findRoomInfo(check.sourceId, roomContent);
    return { name: room ? room.name : check.sourceId, text: room ? room.text : '' };
  }
  const card = findCardInfo(check.sourceId, cardContent);
  return { name: card ? card.name : check.sourceId, text: card ? (card.text || card.description || '') : '' };
}

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

export default function CheckModal({ check, roomContent, cardContent, onDone }) {
  const [phase, setPhase] = useState('before'); // 'before' | 'animating' | 'result'
  const source = resolveSource(check, roomContent, cardContent);
  const statLabel = STAT_LABELS[check.stat] || check.stat;

  function handleRoll() {
    setPhase('animating');
    setTimeout(() => setPhase('result'), ANIMATION_MS);
  }

  if (phase === 'animating') {
    return (
      <div style={overlayStyle}>
        <div style={boxStyle}>
          <p style={{ fontSize: 20, textAlign: 'center', margin: 0 }}>擲骰中...</p>
        </div>
      </div>
    );
  }

  if (phase === 'result') {
    return (
      <div style={overlayStyle}>
        <div style={boxStyle}>
          <p style={{ fontSize: 14, letterSpacing: 2, color: check.passed ? '#8ad48a' : '#e08a8a', marginBottom: 6 }}>
            考驗結果
          </p>
          <p style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>{source.name}</p>
          <p style={{ fontSize: 22, fontWeight: 'bold', color: check.passed ? '#8ad48a' : '#e08a8a', marginBottom: 10 }}>
            {check.passed ? '成功！' : '失敗...'}
          </p>
          <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>
            {statLabel}考驗擲出 {check.rolled} 點
            {check.threshold != null ? `（需要 ${check.threshold} 以上）` : ''}
          </p>
          <button style={{ width: '100%', fontSize: 18, padding: 12 }} onClick={onDone}>
            確認
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={boxStyle}>
        <p style={{ fontSize: 14, letterSpacing: 2, color: '#e08a8a', marginBottom: 6 }}>
          {TITLE_BY_KIND[check.checkKind] || '考驗'}
        </p>
        <p style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>{source.name}</p>
        <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>{source.text}</p>
        <div style={{ backgroundColor: '#1c1c1c', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 15 }}>
          <div>考驗屬性：{statLabel}</div>
          {check.threshold != null && <div>需要：{check.threshold} 以上</div>}
        </div>
        <button style={{ width: '100%', fontSize: 18, padding: 12 }} onClick={handleRoll}>
          擲骰
        </button>
      </div>
    </div>
  );
}
