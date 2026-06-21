/**
 * Material definitions for the falling-sand cellular automaton.
 *
 * Ids are stable small integers so the grid can be stored in a `Uint8Array`
 * and so deterministic snapshots/seeds stay comparable across versions.
 */
export const Material = {
  Empty: 0,
  Wall: 1,
  Sand: 2,
  Water: 3,
  Oil: 4,
  Plant: 5,
  Fire: 6,
  Stone: 7,
  Steam: 8
} as const

export type MaterialId = (typeof Material)[keyof typeof Material]

/** Paint tools exposed in the UI. The eraser maps onto `Material.Empty`. */
export interface ToolDef {
  id: MaterialId
  /** Stable key used for UI state. */
  key: string
  /** Japanese label shown in the palette. */
  label: string
  /** Representative swatch colour (CSS). */
  swatch: string
}

export const TOOLS: ToolDef[] = [
  { id: Material.Sand, key: 'sand', label: '砂', swatch: '#e2c275' },
  { id: Material.Water, key: 'water', label: '水', swatch: '#3d7ad6' },
  { id: Material.Oil, key: 'oil', label: '油', swatch: '#7a5a3a' },
  { id: Material.Plant, key: 'plant', label: '植物', swatch: '#3fa34d' },
  { id: Material.Fire, key: 'fire', label: '火', swatch: '#ff7a18' },
  { id: Material.Stone, key: 'stone', label: '石', swatch: '#9aa0a6' },
  { id: Material.Wall, key: 'wall', label: '壁', swatch: '#5b6168' },
  { id: Material.Empty, key: 'eraser', label: '消しゴム', swatch: '#1a1a26' }
]

/**
 * RGB colour lookup, indexed by material id. Used by the renderer to build an
 * `ImageData` buffer. Fire/steam get slight per-cell variation in the renderer.
 */
export const COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [10, 10, 18], // Empty   — background
  [91, 97, 104], // Wall
  [226, 194, 117], // Sand
  [61, 122, 214], // Water
  [122, 90, 58], // Oil
  [63, 163, 77], // Plant
  [255, 122, 24], // Fire
  [154, 160, 166], // Stone
  [205, 213, 224] // Steam
]
