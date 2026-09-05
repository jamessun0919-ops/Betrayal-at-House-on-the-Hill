import { useState } from 'react';

const DEFAULT_PHASE_TIMEOUT_SECONDS = 30;
const MIN_PHASE_TIMEOUT_SECONDS = 20;
const MAX_PHASE_TIMEOUT_SECONDS = 90;

export default function NicknameModal({ onConfirm, onCancel, error, mode }) {
  const [name, setName] = useState('');
  const [phaseTimeoutSeconds, setPhaseTimeoutSeconds] = useState(DEFAULT_PHASE_TIMEOUT_SECONDS);

  function handleConfirm() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed, mode === 'create' ? phaseTimeoutSeconds : undefined);
  }

  return (
    <div className="lobby-modal-overlay">
      <div className="lobby-modal">
        <h2>輸入暱稱</h2>
        <input
          className="lobby-modal-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="你的暱稱"
          maxLength={20}
          autoFocus
        />
        {mode === 'create' && (
          <div className="lobby-modal-field">
            <label htmlFor="phase-timeout-input">每階段秒數（{MIN_PHASE_TIMEOUT_SECONDS}~{MAX_PHASE_TIMEOUT_SECONDS}）</label>
            <input
              id="phase-timeout-input"
              className="lobby-modal-input"
              type="number"
              min={MIN_PHASE_TIMEOUT_SECONDS}
              max={MAX_PHASE_TIMEOUT_SECONDS}
              value={phaseTimeoutSeconds}
              onChange={(e) => setPhaseTimeoutSeconds(Number(e.target.value))}
            />
          </div>
        )}
        {error && <p className="lobby-error">{error}</p>}
        <div className="lobby-modal-buttons">
          <button className="lobby-button" onClick={onCancel}>取消</button>
          <button className="lobby-button" onClick={handleConfirm} disabled={!name.trim()}>確認</button>
        </div>
      </div>
    </div>
  );
}
