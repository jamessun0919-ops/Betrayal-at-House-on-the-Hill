export default function StartScreen({ onCreateClick, onJoinClick }) {
  return (
    <div className="lobby-start-screen">
      <div className="lobby-start-buttons">
        <button className="lobby-button" onClick={onCreateClick}>建立大廳</button>
        <button className="lobby-button" onClick={onJoinClick}>進入大廳</button>
      </div>
    </div>
  );
}
