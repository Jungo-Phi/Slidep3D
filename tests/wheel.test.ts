import { describe, expect, it } from 'vitest'
import { WheelClassifier } from '../src/lib/core/wheel'

const ev = (deltaX: number, deltaY: number, timeStamp: number, extra: { deltaMode?: number; ctrlKey?: boolean } = {}) => ({
  deltaX,
  deltaY,
  timeStamp,
  deltaMode: extra.deltaMode ?? 0,
  ctrlKey: extra.ctrlKey ?? false,
})

describe('molette ou pavé tactile', () => {
  it('un cran de molette zoome', () => {
    expect(new WheelClassifier().classify(ev(0, 100, 0))).toBe('zoom')
    expect(new WheelClassifier().classify(ev(0, -125, 0))).toBe('zoom')
    expect(new WheelClassifier().classify(ev(0, 3, 0, { deltaMode: 1 }))).toBe('zoom')
  })

  it('un défilement fin ou horizontal déplace la vue', () => {
    expect(new WheelClassifier().classify(ev(0, 4.5, 0))).toBe('pan')
    expect(new WheelClassifier().classify(ev(12, 60, 0))).toBe('pan')
  })

  it('le pincement zoome toujours', () => {
    const c = new WheelClassifier()
    expect(c.classify(ev(0, 2, 0))).toBe('pan')
    expect(c.classify(ev(0, 2, 10, { ctrlKey: true }))).toBe('zoom')
  })

  it('l’inertie d’un geste au pavé tactile reste un déplacement', () => {
    const c = new WheelClassifier()
    expect(c.classify(ev(0, 8, 0))).toBe('pan')
    expect(c.classify(ev(0, 90, 16))).toBe('pan')
    expect(c.classify(ev(0, 100, 1000))).toBe('zoom')
  })
})
