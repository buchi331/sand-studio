import { TOOLS } from '../sim/materials'

interface PaletteProps {
  tool: number
  onSelect: (id: number) => void
}

/** Material/tool picker — the primary input surface. */
export function Palette({ tool, onSelect }: PaletteProps) {
  return (
    <div className="palette" role="toolbar" aria-label="物質パレット">
      {TOOLS.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`palette__item${tool === t.id ? ' is-active' : ''}`}
          onClick={() => onSelect(t.id)}
          aria-pressed={tool === t.id}
        >
          <span className="palette__swatch" style={{ background: t.swatch }} />
          <span className="palette__label">{t.label}</span>
        </button>
      ))}
    </div>
  )
}
