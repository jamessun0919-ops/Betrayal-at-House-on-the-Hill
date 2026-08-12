export default function CharacterSelectScreen({ socket, playerId, characterSelectState, prompt }) {
  const { currentPicker } = characterSelectState;
  return (
    <div className="lobby-watermark-screen">
      <div className="lobby-center-panel">
        <h2>角色選擇</h2>
        <p>目前輪到：{currentPicker}</p>
      </div>
    </div>
  );
}
