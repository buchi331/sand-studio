import { Material, LIQUID_PARAMS } from './materials'
import { makeRng, type Rng } from './rng'

export interface SimulationOptions {
  width: number
  height: number
  /** Seed for the deterministic PRNG. Defaults to 1. */
  seed?: number
}

const OOB = -1

/** Frames a fresh flame burns before dying out. */
const FIRE_LIFE = 90
/** Frames steam drifts before it condenses away. */
const STEAM_LIFE = 70
/** Per-step chance a flame ignites an adjacent flammable cell. */
const FIRE_SPREAD = 0.28
/** Per-step chance a flame flickers upward into empty space. */
const FIRE_RISE = 0.25
/** Per-step chance a plant grows into an adjacent water cell. */
const PLANT_GROW = 0.04

const NEIGHBORS8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1]
]

/** Relative "heaviness" — used to decide which of two fluids/powders sinks. */
function density(m: number): number {
  switch (m) {
    case Material.Steam:
      return -1
    case Material.Empty:
      return 0
    case Material.Oil:
      return 2
    case Material.Water:
      return 3
    case Material.Sand:
      return 6
    default:
      return 1000 // wall, stone, plant, fire — effectively immovable to fluids
  }
}

function isLiquid(m: number): boolean {
  return m === Material.Water || m === Material.Oil
}

/**
 * Deterministic falling-sand cellular automaton.
 *
 * The grid is a flat `Uint8Array` of material ids. A parallel `life` array
 * holds per-cell timers (flame/steam lifetime). Cells are scanned bottom-up so
 * gravity resolves in a single pass; a `moved` flag prevents a particle from
 * being updated twice in one step.
 */
export class Simulation {
  readonly width: number
  readonly height: number
  readonly cells: Uint8Array
  private readonly life: Uint8Array
  private readonly moved: Uint8Array
  private rng: Rng
  private readonly seed: number

  constructor(opts: SimulationOptions) {
    this.width = opts.width
    this.height = opts.height
    this.seed = opts.seed ?? 1
    const size = this.width * this.height
    this.cells = new Uint8Array(size)
    this.life = new Uint8Array(size)
    this.moved = new Uint8Array(size)
    this.rng = makeRng(this.seed)
  }

  private index(x: number, y: number): number {
    return y * this.width + x
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height
  }

  /** Material at (x, y), or `Empty` for out-of-bounds reads. */
  get(x: number, y: number): number {
    if (!this.inBounds(x, y)) return Material.Empty
    return this.cells[this.index(x, y)]
  }

  /** Material id of an in-bounds cell, or `OOB` sentinel when off-grid. */
  private cellAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return OOB
    return this.cells[this.index(x, y)]
  }

  /** Set a single cell, initialising its life timer for stateful materials. */
  set(x: number, y: number, m: number): void {
    if (!this.inBounds(x, y)) return
    this.writeCell(this.index(x, y), m)
  }

  private writeCell(idx: number, m: number): void {
    this.cells[idx] = m
    this.life[idx] =
      m === Material.Fire ? FIRE_LIFE : m === Material.Steam ? STEAM_LIFE : 0
  }

  /** Paint a filled disk of material centred on (cx, cy). */
  paint(cx: number, cy: number, m: number, radius: number): void {
    const r = Math.max(0, radius)
    const r2 = r * r
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r2) this.set(cx + dx, cy + dy, m)
      }
    }
  }

  clear(): void {
    this.cells.fill(Material.Empty)
    this.life.fill(0)
    this.moved.fill(0)
  }

  /** Reset everything and restore the original deterministic seed. */
  reset(): void {
    this.clear()
    this.rng = makeRng(this.seed)
  }

  private swap(a: number, b: number): void {
    const tc = this.cells[a]
    this.cells[a] = this.cells[b]
    this.cells[b] = tc
    const tl = this.life[a]
    this.life[a] = this.life[b]
    this.life[b] = tl
    this.moved[a] = 1
    this.moved[b] = 1
  }

  /** Advance the world by one frame. */
  step(): void {
    this.moved.fill(0)
    for (let y = this.height - 1; y >= 0; y--) {
      // Randomise horizontal scan direction per row to avoid drift bias.
      const leftToRight = this.rng() < 0.5
      for (let i = 0; i < this.width; i++) {
        const x = leftToRight ? i : this.width - 1 - i
        const idx = this.index(x, y)
        if (this.moved[idx]) continue
        switch (this.cells[idx]) {
          case Material.Sand:
            this.updatePowder(x, y, idx)
            break
          case Material.Water:
          case Material.Oil:
            this.updateLiquid(x, y, idx)
            break
          case Material.Fire:
            this.updateFire(x, y, idx)
            break
          case Material.Plant:
            this.updatePlant(x, y)
            break
          case Material.Steam:
            this.updateSteam(x, y, idx)
            break
          default:
            break // Empty, Wall, Stone: inert
        }
      }
    }
  }

  /** Can `mover` move into the cell currently holding `target`? */
  private canSink(mover: number, target: number): boolean {
    if (target === Material.Empty) return true
    if (isLiquid(target) && density(mover) > density(target)) return true
    return false
  }

  private updatePowder(x: number, y: number, idx: number): void {
    const m = this.cells[idx]
    const below = this.cellAt(x, y + 1)
    if (below !== OOB && this.canSink(m, below)) {
      this.swap(idx, this.index(x, y + 1))
      return
    }
    const dir = this.rng() < 0.5 ? -1 : 1
    for (const dx of [dir, -dir]) {
      const diag = this.cellAt(x + dx, y + 1)
      if (diag !== OOB && this.canSink(m, diag)) {
        this.swap(idx, this.index(x + dx, y + 1))
        return
      }
    }
  }

  private updateLiquid(x: number, y: number, idx: number): void {
    const m = this.cells[idx]
    const below = this.cellAt(x, y + 1)
    if (below !== OOB && this.canSink(m, below)) {
      this.swap(idx, this.index(x, y + 1))
      return
    }
    const dir = this.rng() < 0.5 ? -1 : 1
    for (const dx of [dir, -dir]) {
      const diag = this.cellAt(x + dx, y + 1)
      if (diag !== OOB && this.canSink(m, diag)) {
        this.swap(idx, this.index(x + dx, y + 1))
        return
      }
    }
    // Sideways flow, modulated by per-liquid viscosity.
    const params = LIQUID_PARAMS[m as keyof typeof LIQUID_PARAMS]
    const dispersion = params ? params.dispersion : 4
    if (params && this.rng() >= params.flowChance) return // too viscous this step
    const hdir = this.rng() < 0.5 ? -1 : 1
    if (this.flowSideways(x, y, idx, hdir, dispersion)) return
    this.flowSideways(x, y, idx, -hdir, dispersion)
  }

  private flowSideways(
    x: number,
    y: number,
    idx: number,
    dir: number,
    dispersion: number
  ): boolean {
    let target = -1
    for (let s = 1; s <= dispersion; s++) {
      const nx = x + dir * s
      if (this.cellAt(nx, y) !== Material.Empty) break
      target = nx
    }
    if (target < 0) return false
    this.swap(idx, this.index(target, y))
    return true
  }

  private updateFire(x: number, y: number, idx: number): void {
    // Water in contact extinguishes the flame and flashes to steam.
    for (const [dx, dy] of NEIGHBORS8) {
      if (this.cellAt(x + dx, y + dy) === Material.Water) {
        this.writeCell(idx, Material.Empty)
        this.writeCell(this.index(x + dx, y + dy), Material.Steam)
        this.moved[idx] = 1
        this.moved[this.index(x + dx, y + dy)] = 1
        return
      }
    }
    // Ignite adjacent fuel (plant / oil).
    for (const [dx, dy] of NEIGHBORS8) {
      const nm = this.cellAt(x + dx, y + dy)
      if ((nm === Material.Plant || nm === Material.Oil) && this.rng() < FIRE_SPREAD) {
        const ni = this.index(x + dx, y + dy)
        this.writeCell(ni, Material.Fire)
        this.moved[ni] = 1
      }
    }
    // Burn down.
    this.life[idx] -= 1
    if (this.life[idx] <= 0) {
      this.writeCell(idx, Material.Empty)
      this.moved[idx] = 1
      return
    }
    // Flicker upward.
    if (this.cellAt(x, y - 1) === Material.Empty && this.rng() < FIRE_RISE) {
      this.swap(idx, this.index(x, y - 1))
    }
  }

  private updatePlant(x: number, y: number): void {
    for (const [dx, dy] of NEIGHBORS8) {
      const ni = this.cellAt(x + dx, y + dy)
      if (ni === Material.Water && this.rng() < PLANT_GROW) {
        const idx = this.index(x + dx, y + dy)
        this.writeCell(idx, Material.Plant)
        this.moved[idx] = 1
      }
    }
  }

  private updateSteam(x: number, y: number, idx: number): void {
    this.life[idx] -= 1
    if (this.life[idx] <= 0) {
      this.writeCell(idx, Material.Empty)
      this.moved[idx] = 1
      return
    }
    if (this.cellAt(x, y - 1) === Material.Empty) {
      this.swap(idx, this.index(x, y - 1))
      return
    }
    const dir = this.rng() < 0.5 ? -1 : 1
    for (const dx of [dir, -dir]) {
      if (this.cellAt(x + dx, y - 1) === Material.Empty) {
        this.swap(idx, this.index(x + dx, y - 1))
        return
      }
    }
    for (const dx of [dir, -dir]) {
      if (this.cellAt(x + dx, y) === Material.Empty) {
        this.swap(idx, this.index(x + dx, y))
        return
      }
    }
  }
}
