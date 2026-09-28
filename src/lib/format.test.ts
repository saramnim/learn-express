import { describe, expect, it } from 'vitest'
import { seoulLocalToIso, toDateTimeLocal } from './format'

describe('Seoul release scheduling', () => {
  it('round-trips a Seoul-local release time', () => {
    const iso = seoulLocalToIso('2026-09-29T09:00')
    expect(iso).toBe('2026-09-29T00:00:00.000Z')
    expect(toDateTimeLocal(iso)).toBe('2026-09-29T09:00')
  })
})
