import { describe, it, expect } from 'vitest'
import { Simulation } from './simulation'
import { Material } from './materials'

function count(sim: Simulation, m: number): number {
  let n = 0
  for (let i = 0; i < sim.cells.length; i++) if (sim.cells[i] === m) n++
  return n
}

describe('Simulation grid basics', () => {
  it('starts empty', () => {
    const sim = new Simulation({ width: 4, height: 4 })
    expect(count(sim, Material.Empty)).toBe(16)
  })

  it('round-trips get/set', () => {
    const sim = new Simulation({ width: 4, height: 4 })
    sim.set(1, 2, Material.Sand)
    expect(sim.get(1, 2)).toBe(Material.Sand)
    expect(sim.get(0, 0)).toBe(Material.Empty)
  })

  it('ignores out-of-bounds get/set', () => {
    const sim = new Simulation({ width: 4, height: 4 })
    sim.set(-1, 0, Material.Sand)
    sim.set(10, 10, Material.Sand)
    expect(sim.get(-1, 0)).toBe(Material.Empty)
    expect(sim.get(10, 10)).toBe(Material.Empty)
    expect(count(sim, Material.Sand)).toBe(0)
  })

  it('clears the grid', () => {
    const sim = new Simulation({ width: 4, height: 4 })
    sim.set(1, 1, Material.Sand)
    sim.clear()
    expect(count(sim, Material.Sand)).toBe(0)
  })

  it('paints a filled disk with the given radius', () => {
    const sim = new Simulation({ width: 7, height: 7 })
    sim.paint(3, 3, Material.Sand, 0)
    expect(count(sim, Material.Sand)).toBe(1)

    sim.clear()
    sim.paint(3, 3, Material.Sand, 1)
    // radius 1 disk = centre + 4 orthogonal neighbours
    expect(count(sim, Material.Sand)).toBe(5)
  })
})

describe('Powder (sand) physics', () => {
  it('falls one row per step into empty space', () => {
    const sim = new Simulation({ width: 3, height: 5 })
    sim.set(1, 0, Material.Sand)
    sim.step()
    expect(sim.get(1, 0)).toBe(Material.Empty)
    expect(sim.get(1, 1)).toBe(Material.Sand)
  })

  it('rests on the floor', () => {
    const sim = new Simulation({ width: 3, height: 4 })
    sim.set(1, 3, Material.Sand)
    sim.step()
    expect(sim.get(1, 3)).toBe(Material.Sand)
  })

  it('conserves mass and forms a pile (angle of repose)', () => {
    const sim = new Simulation({ width: 9, height: 9 })
    // a tall single-column stack resting on the floor
    for (let y = 4; y < 9; y++) sim.set(4, y, Material.Sand)
    const before = count(sim, Material.Sand)
    for (let i = 0; i < 60; i++) sim.step()
    const after = count(sim, Material.Sand)
    expect(after).toBe(before)
    // it should have spread sideways off the single column
    const stillInColumn = (() => {
      let n = 0
      for (let y = 0; y < 9; y++) if (sim.get(4, y) === Material.Sand) n++
      return n
    })()
    expect(stillInColumn).toBeLessThan(before)
  })
})

describe('Liquid physics', () => {
  it('water conserves mass and spreads horizontally', () => {
    const sim = new Simulation({ width: 11, height: 11 })
    for (let y = 6; y < 11; y++) sim.set(5, y, Material.Water)
    const before = count(sim, Material.Water)
    for (let i = 0; i < 80; i++) sim.step()
    expect(count(sim, Material.Water)).toBe(before)
    // bottom row should now hold water in more than one column
    let bottomCols = 0
    for (let x = 0; x < 11; x++) if (sim.get(x, 10) === Material.Water) bottomCols++
    expect(bottomCols).toBeGreaterThan(1)
  })

  it('sand sinks through water (denser sinks)', () => {
    const sim = new Simulation({ width: 1, height: 6 })
    sim.set(0, 5, Material.Wall) // floor
    sim.set(0, 4, Material.Water)
    sim.set(0, 3, Material.Sand)
    for (let i = 0; i < 10; i++) sim.step()
    expect(sim.get(0, 4)).toBe(Material.Sand)
    expect(sim.get(0, 3)).toBe(Material.Water)
  })

  it('oil floats on water (lighter rises)', () => {
    const sim = new Simulation({ width: 1, height: 6 })
    sim.set(0, 5, Material.Wall) // floor
    sim.set(0, 4, Material.Oil)
    sim.set(0, 3, Material.Water)
    for (let i = 0; i < 10; i++) sim.step()
    expect(sim.get(0, 3)).toBe(Material.Oil)
    expect(sim.get(0, 4)).toBe(Material.Water)
  })

  it('water spreads wider than oil (viscosity)', () => {
    // Measure horizontal extent mid-flow: runny water reaches farther from the
    // source than viscous oil. (Both eventually settle to the same puddle once
    // they equilibrate, so we compare during the transient.)
    const extent = (mat: number) => {
      const sim = new Simulation({ width: 31, height: 21, seed: 123 })
      for (let y = 0; y < 10; y++) sim.set(15, y, mat)
      for (let i = 0; i < 20; i++) sim.step()
      let minX = 99
      let maxX = -1
      for (let x = 0; x < 31; x++) {
        for (let y = 0; y < 21; y++) {
          if (sim.get(x, y) === mat) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
          }
        }
      }
      return maxX - minX + 1
    }
    expect(extent(Material.Water)).toBeGreaterThan(extent(Material.Oil))
  })
})

describe('Reactions', () => {
  it('fire spreads to adjacent plant', () => {
    const sim = new Simulation({ width: 5, height: 5, seed: 7 })
    sim.set(2, 2, Material.Plant)
    sim.set(2, 3, Material.Fire)
    let ignited = false
    for (let i = 0; i < 300 && !ignited; i++) {
      sim.step()
      if (sim.get(2, 2) !== Material.Plant) ignited = true
    }
    expect(ignited).toBe(true)
  })

  it('fire spreads to adjacent oil', () => {
    const sim = new Simulation({ width: 5, height: 5, seed: 7 })
    sim.set(2, 1, Material.Oil)
    sim.set(2, 2, Material.Fire)
    let ignited = false
    for (let i = 0; i < 300 && !ignited; i++) {
      sim.step()
      if (sim.get(2, 1) === Material.Fire || sim.get(2, 1) === Material.Empty) {
        ignited = true
      }
    }
    expect(ignited).toBe(true)
  })

  it('water extinguishes fire and produces steam', () => {
    const sim = new Simulation({ width: 1, height: 4, seed: 3 })
    sim.set(0, 3, Material.Wall)
    sim.set(0, 2, Material.Fire)
    sim.set(0, 1, Material.Water)
    sim.step()
    expect(count(sim, Material.Fire)).toBe(0)
    expect(count(sim, Material.Steam)).toBeGreaterThanOrEqual(1)
  })

  it('fire eventually burns out', () => {
    const sim = new Simulation({ width: 3, height: 3, seed: 5 })
    sim.set(1, 1, Material.Fire)
    for (let i = 0; i < 1000; i++) sim.step()
    expect(count(sim, Material.Fire)).toBe(0)
  })

  it('plant grows into adjacent water', () => {
    const sim = new Simulation({ width: 1, height: 3, seed: 11 })
    sim.set(0, 2, Material.Plant)
    sim.set(0, 1, Material.Water)
    let grown = false
    for (let i = 0; i < 500 && !grown; i++) {
      sim.step()
      if (sim.get(0, 1) === Material.Plant) grown = true
    }
    expect(grown).toBe(true)
  })
})

describe('Static materials', () => {
  it('wall does not move', () => {
    const sim = new Simulation({ width: 3, height: 5 })
    sim.set(1, 0, Material.Wall)
    for (let i = 0; i < 10; i++) sim.step()
    expect(sim.get(1, 0)).toBe(Material.Wall)
  })

  it('stone does not move', () => {
    const sim = new Simulation({ width: 3, height: 5 })
    sim.set(1, 0, Material.Stone)
    for (let i = 0; i < 10; i++) sim.step()
    expect(sim.get(1, 0)).toBe(Material.Stone)
  })
})

describe('Determinism', () => {
  it('same seed + same inputs produce identical state', () => {
    const build = () => {
      const sim = new Simulation({ width: 16, height: 24, seed: 42 })
      sim.paint(8, 2, Material.Sand, 3)
      sim.paint(4, 2, Material.Water, 2)
      sim.paint(12, 6, Material.Oil, 2)
      sim.set(8, 20, Material.Fire)
      sim.paint(2, 20, Material.Plant, 1)
      return sim
    }
    const a = build()
    const b = build()
    for (let i = 0; i < 120; i++) {
      a.step()
      b.step()
    }
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells))
  })
})
