import { describe, it, expect } from 'vitest'
import { makeRng } from './rng'

describe('makeRng', () => {
  it('produces a deterministic sequence for the same seed', () => {
    const a = makeRng(12345)
    const b = makeRng(12345)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const a = makeRng(1)
    const b = makeRng(2)
    expect(a()).not.toBe(b())
  })

  it('returns values in the [0, 1) range', () => {
    const rng = makeRng(99)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
