import { useState } from 'react';

export default function NicknameModal({ onConfirm, onCancel, error }) {
  const [name, setName] = useState('');

  function handleConfirm() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
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
        {error && <p className="lobby-error">{error}</p>}
        <div className="lobby-modal-buttons">
          <button className="lobby-button" onClick={onCancel}>取消</button>
          <button className="lobby-button" onClick={handleConfirm} disabled={!name.trim()}>確認</button>
        </div>
      </div>
    </div>
  );
}
