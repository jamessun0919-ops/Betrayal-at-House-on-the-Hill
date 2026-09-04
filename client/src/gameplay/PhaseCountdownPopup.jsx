import { useState, useEffect, useRef } from 'react';

const STORAGE_KEY = 'phaseCountdownPopupPosition';
const DEFAULT_POSITION = { x: 16, y: 80 };

function loadStoredPosition() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_POSITION;
    const parsed = JSON.parse(raw);
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
    return DEFAULT_POSITION;
  } catch (err) {
    return DEFAULT_POSITION;
  }
}

function savePosition(position) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch (err) {
    // localStorage unavailable (private browsing, quota, etc.) -- position
    // just won't persist across reloads, not a functional failure.
  }
}

const PHASE_LABELS = {
  player_move: '移動階段',
  npc_move: 'NPC移動階段',
  player_interact: '互動階段',
  npc_interact: 'NPC互動階段',
  settlement: '結算階段',
};

export default function PhaseCountdownPopup({ phase, deadline, locked }) {
  const [position, setPosition] = useState(loadStoredPosition);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const dragRef = useRef(null); // { startClientX, startClientY, startPosition } while dragging

  useEffect(() => {
    if (!deadline) return undefined;
    const tick = () => {
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [deadline]);

  function handlePointerDown(e) {
    dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startPosition: position };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e) {
    if (!dragRef.current) return;
    const { startClientX, startClientY, startPosition } = dragRef.current;
    const next = {
      x: startPosition.x + (e.clientX - startClientX),
      y: startPosition.y + (e.clientY - startClientY),
    };
    setPosition(next);
  }

  function handlePointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    savePosition(position);
  }

  if (!phase || !deadline) return null;

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 90,
        cursor: 'move',
        userSelect: 'none',
        border: '2px solid #555',
        backgroundColor: '#f0f0f0',
        borderRadius: 4,
        padding: '6px 10px',
        fontSize: 14,
        minWidth: 100,
        textAlign: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      }}
    >
      <div>{PHASE_LABELS[phase] || phase}</div>
      <div style={{ fontSize: 20, fontWeight: 'bold' }}>{locked ? '等待其他玩家' : `${secondsLeft}s`}</div>
    </div>
  );
}
