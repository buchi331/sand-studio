interface ToolbarProps {
  playing: boolean
  recording: boolean
  brush: number
  onTogglePlay: () => void
  onClear: () => void
  onBrush: (value: number) => void
  onToggleRecord: () => void
}

/** Transport + brush controls below the palette. */
export function Toolbar({
  playing,
  recording,
  brush,
  onTogglePlay,
  onClear,
  onBrush,
  onToggleRecord
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <button type="button" className="toolbar__btn" onClick={onTogglePlay}>
        {playing ? '⏸' : '▶'}
        <span className="toolbar__btn-label">{playing ? '停止' : '再生'}</span>
      </button>

      <button type="button" className="toolbar__btn" onClick={onClear}>
        🗑<span className="toolbar__btn-label">消去</span>
      </button>

      <label className="toolbar__brush">
        <span className="toolbar__btn-label">筆 {brush}</span>
        <input
          type="range"
          min={0}
          max={10}
          value={brush}
          onChange={(e) => onBrush(Number(e.target.value))}
          aria-label="ブラシの太さ"
        />
      </label>

      <button
        type="button"
        className={`toolbar__btn toolbar__record${recording ? ' is-recording' : ''}`}
        onClick={onToggleRecord}
      >
        {recording ? '⏹' : '⏺'}
        <span className="toolbar__btn-label">{recording ? '停止&共有' : '録画'}</span>
      </button>
    </div>
  )
}
