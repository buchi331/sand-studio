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

/** Per-liquid flow tuning. Water is runny; oil is viscous. */
export interface LiquidParams {
  /** How far it searches sideways for a lower resting spot each step. */
  dispersion: number
  /** Per-step probability it is allowed to move sideways at all. */
  flowChance: number
}

export const LIQUID_PARAMS: Partial<Record<MaterialId, LiquidParams>> = {
  [Material.Water]: { dispersion: 6, flowChance: 1.0 },
  [Material.Oil]: { dispersion: 2, flowChance: 0.4 }
}

/** How a material falls through air, so each element drops with its own feel. */
export interface FallParams {
  /** Chance it actually moves down when air is below. <1 = viscous, oozes slowly (oil トロッと). */
  fallChance: number
  /** Chance it drifts diagonally instead of straight while free-falling:
   *  sand scatters loosely (さらさら), water trickles/drips (したたり), oil ≈0 (clumps). */
  scatterChance: number
}

export const FALL_PARAMS: Partial<Record<MaterialId, FallParams>> = {
  [Material.Sand]: { fallChance: 1.0, scatterChance: 0.3 },
  [Material.Water]: { fallChance: 1.0, scatterChance: 0.35 },
  [Material.Oil]: { fallChance: 0.5, scatterChance: 0.0 }
}

/** Frames a fresh flame burns before dying out. */
export const FIRE_LIFE = 90
/** Frames steam drifts before it condenses away. */
export const STEAM_LIFE = 70

/** Materials that emit light (drive the bloom pass). */
export const EMISSIVE: ReadonlySet<MaterialId> = new Set([
  Material.Fire,
  Material.Steam
])

/** Per-material brightness-variation amplitude (0..1), indexed by material id. */
export const VARIATION: ReadonlyArray<number> = [
  0, // Empty
  0.04, // Wall
  0.16, // Sand   — strong grain texture
  0.06, // Water
  0.1, // Oil
  0.12, // Plant
  0, // Fire   — colour comes from life, not variation
  0.1, // Stone
  0 // Steam  — colour comes from life
]
