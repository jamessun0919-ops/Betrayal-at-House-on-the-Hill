import { useState } from 'react';

const MAX_HEIGHT_VH = 66.67; // 2/3 of viewport height, for the tallest character

export default function CharacterSelectScreen({ socket, playerId, characterSelectState, prompt }) {
  const [openCharacterId, setOpenCharacterId] = useState(null);
  const { characters, lockedCharacterIds, assignments, currentPicker } = characterSelectState;

  const maxTall = Math.max(...characters.map((c) => c.tall));
  const myAssignment = assignments.find((a) => a.playerId === playerId);

  return (
    <div className="cs-gallery">
      <h2>角色選擇</h2>
      {myAssignment ? (
        <p className="cs-status-banner">
          已選擇：{characters.find((c) => c.id === myAssignment.characterId)?.codename}，等待其他玩家選擇中...
        </p>
      ) : (
        <p className="cs-status-banner">
          {currentPicker === playerId ? '輪到你選擇角色' : '其他玩家選擇中，請稍後'}
        </p>
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
              onClick={() => setOpenCharacterId(c.id)}
            >
              <img className="cs-portrait-img" src={`/images/${c.filename}`} alt={c.codename} />
              {isLocked && <img className="cs-locked-badge" src="/images/selected.png" alt="已被選擇" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
