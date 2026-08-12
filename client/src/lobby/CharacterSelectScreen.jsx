import { useState } from 'react';
import { translateError } from './errorMessages';

const MAX_HEIGHT_VH = 66.67; // 2/3 of viewport height, for the tallest character

const STAT_LABELS = [
  ['might', '力量'],
  ['speed', '速度'],
  ['knowledge', '知識'],
  ['sanity', '意志'],
];

function CharacterStatCard({ character, canConfirm, onFlip, onExit, onConfirm, error }) {
  return (
    <div className="lobby-modal-overlay">
      <div className="lobby-modal cs-stat-card">
        <h3>{character.codename}</h3>
        <p>{character.occupation}</p>
        <ul className="cs-stat-list">
          {STAT_LABELS.map(([key, label]) => (
            <li key={key}>
              {label}：{character.stats[key].track[character.stats[key].baseIndex]}
            </li>
          ))}
        </ul>
        <p>初始攜帶物品：{character.itemname || '無'}</p>
        {error && <p className="lobby-error">{error}</p>}
        {!canConfirm && <p className="lobby-error">其他玩家選擇中，請稍後</p>}
        <div className="cs-card-buttons">
          <button className="lobby-button" onClick={() => onFlip(-1)}>左翻</button>
          <button className="lobby-button" onClick={() => onFlip(1)}>右翻</button>
          <button className="lobby-button" onClick={onExit}>退出</button>
          <button className="lobby-button" onClick={onConfirm} disabled={!canConfirm}>確定選擇</button>
        </div>
      </div>
    </div>
  );
}

export default function CharacterSelectScreen({ socket, playerId, characterSelectState, prompt }) {
  const [openCharacterId, setOpenCharacterId] = useState(null);
  const [error, setError] = useState('');
  const { characters, lockedCharacterIds, assignments, currentPicker } = characterSelectState;

  const maxTall = Math.max(...characters.map((c) => c.tall));
  const myAssignment = assignments.find((a) => a.playerId === playerId);
  const openCharacter = characters.find((c) => c.id === openCharacterId);
  const isMyTurn = currentPicker === playerId;

  function handleFlip(direction) {
    const idx = characters.findIndex((c) => c.id === openCharacterId);
    const nextIdx = (idx + direction + characters.length) % characters.length;
    setError('');
    setOpenCharacterId(characters[nextIdx].id);
  }

  function handleConfirm() {
    if (!prompt) return;
    socket.emit('game:promptRespond', { promptId: prompt.promptId, optionId: openCharacterId }, (res) => {
      if (res && res.error) {
        setError(translateError(res.error));
        return;
      }
      setOpenCharacterId(null);
    });
  }

  return (
    <div className="cs-gallery">
      <h2>角色選擇</h2>
      {myAssignment ? (
        <p className="cs-status-banner">
          已選擇：{characters.find((c) => c.id === myAssignment.characterId)?.codename}，等待其他玩家選擇中...
        </p>
      ) : (
        <p className="cs-status-banner">{isMyTurn ? '輪到你選擇角色' : '其他玩家選擇中，請稍後'}</p>
      )}
      <div className="cs-row">
        {characters.map((c) => {
          const heightVh = (c.tall / maxTall) * MAX_HEIGHT_VH;
          const isLocked = lockedCharacterIds.includes(c.id);
          return (
            <button
              key={c.id}
              className="cs-portrait-button"
              style={{ height: `${heightVh}vh` }}
              onClick={() => {
                setError('');
                setOpenCharacterId(c.id);
              }}
            >
              <img className="cs-portrait-img" src={`/images/${c.filename}`} alt={c.codename} />
              {isLocked && <img className="cs-locked-badge" src="/images/selected.png" alt="已被選擇" />}
            </button>
          );
        })}
      </div>
      {openCharacter && (
        <CharacterStatCard
          character={openCharacter}
          canConfirm={isMyTurn && !lockedCharacterIds.includes(openCharacterId)}
          onFlip={handleFlip}
          onExit={() => setOpenCharacterId(null)}
          onConfirm={handleConfirm}
          error={error}
        />
      )}
    </div>
  );
}
