import { useCallback, useEffect, useRef, useState } from 'react'
import { Simulation } from '../sim/simulation'
import { Material } from '../sim/materials'
import { Canvas2DRenderer } from '../render/Canvas2DRenderer'
import { CanvasRecorder, shareVideo } from '../capture/recorder'
import { Palette } from './Palette'
import { Toolbar } from './Toolbar'

const GRID_W = 180
const GRID_H = 320

interface Point {
  x: number
  y: number
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<Simulation | null>(null)
  const rendererRef = useRef<Canvas2DRenderer | null>(null)
  const recorderRef = useRef<CanvasRecorder | null>(null)

  const [tool, setTool] = useState<number>(Material.Sand)
  const [brush, setBrush] = useState(3)
  const [playing, setPlaying] = useState(true)
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState('指でなぞって世界を描こう')

  // Mirror reactive state into refs so the rAF loop / pointer handlers always
  // read the latest values without re-subscribing every render.
  const toolRef = useRef(tool)
  const brushRef = useRef(brush)
  const playingRef = useRef(playing)
  useEffect(() => {
    toolRef.current = tool
  }, [tool])
  useEffect(() => {
    brushRef.current = brush
  }, [brush])
  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  // One-time setup: simulation, renderer and the animation loop.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const seed = (Date.now() >>> 0) || 1
    const sim = new Simulation({ width: GRID_W, height: GRID_H, seed })
    const renderer = new Canvas2DRenderer()
    renderer.init(canvas, GRID_W, GRID_H)
    simRef.current = sim
    rendererRef.current = renderer
    recorderRef.current = new CanvasRecorder()

    let raf = 0
    const loop = () => {
      if (playingRef.current) sim.step()
      renderer.render(sim)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      renderer.dispose()
    }
  }, [])

  const paintAt = useCallback(
    (clientX: number, clientY: number, prev: Point | null): Point | null => {
      const canvas = canvasRef.current
      const sim = simRef.current
      if (!canvas || !sim) return null
      const rect = canvas.getBoundingClientRect()
      const gx = Math.floor(((clientX - rect.left) / rect.width) * GRID_W)
      const gy = Math.floor(((clientY - rect.top) / rect.height) * GRID_H)
      const m = toolRef.current
      const r = brushRef.current

      if (prev) {
        // Interpolate so fast drags leave a continuous stroke, not dots.
        const dx = gx - prev.x
        const dy = gy - prev.y
        const steps = Math.max(Math.abs(dx), Math.abs(dy), 1)
        for (let i = 0; i <= steps; i++) {
          sim.paint(
            Math.round(prev.x + (dx * i) / steps),
            Math.round(prev.y + (dy * i) / steps),
            m,
            r
          )
        }
      } else {
        sim.paint(gx, gy, m, r)
      }
      return { x: gx, y: gy }
    },
    []
  )

  // Pointer painting.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let drawing = false
    let last: Point | null = null

    const down = (e: PointerEvent) => {
      drawing = true
      last = paintAt(e.clientX, e.clientY, null)
      canvas.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
    const move = (e: PointerEvent) => {
      if (!drawing) return
      last = paintAt(e.clientX, e.clientY, last)
      e.preventDefault()
    }
    const end = (e: PointerEvent) => {
      drawing = false
      last = null
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        // pointer may already be released — ignore
      }
    }

    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', end)
      canvas.removeEventListener('pointercancel', end)
    }
  }, [paintAt])

  const handleClear = () => {
    simRef.current?.clear()
    setStatus('まっさらにしました')
  }

  const handleToggleRecord = async () => {
    const recorder = recorderRef.current
    const canvas = canvasRef.current
    if (!recorder || !canvas) return

    if (!recording) {
      try {
        recorder.start(canvas, 30)
        setRecording(true)
        setStatus('● 録画中…もう一度押すと共有')
      } catch {
        setStatus('この端末では録画に対応していません')
      }
      return
    }

    setRecording(false)
    setStatus('共有を準備中…')
    try {
      const result = await recorder.stop()
      const outcome = await shareVideo(result)
      setStatus(outcome === 'shared' ? '共有しました！' : 'ダウンロードしました')
    } catch {
      setStatus('録画の保存に失敗しました')
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">落ち砂サンドボックス</h1>
        <span className="app__status" aria-live="polite">
          {status}
        </span>
      </header>

      <div className="stage">
        <canvas
          ref={canvasRef}
          className="stage__canvas"
          width={GRID_W}
          height={GRID_H}
        />
      </div>

      <Palette tool={tool} onSelect={setTool} />
      <Toolbar
        playing={playing}
        recording={recording}
        brush={brush}
        onTogglePlay={() => setPlaying((p) => !p)}
        onClear={handleClear}
        onBrush={setBrush}
        onToggleRecord={handleToggleRecord}
      />
    </div>
  )
}
