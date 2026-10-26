import { describe, expect, it } from 'vitest'
import { boundsOf, orbitPivot } from '../src/lib/core/pivot'
import { normalize } from '../src/lib/core/vec'

const ray = (origin: [number, number, number], dir: [number, number, number]) => ({ origin, dir: normalize(dir) })

describe('point de rotation', () => {
  it('scène vide : origine, quel que soit le curseur', () => {
    expect(orbitPivot(ray([5000, -5000, 5000], [-1, 1, -0.2]), null, null)).toEqual([0, 0, 0])
  })

  it('nœud ou segment sous le curseur : ce point', () => {
    const b = boundsOf([[0, 0, 0], [1000, 1000, 1000]])
    expect(orbitPivot(ray([5000, 0, 0], [-1, 0, 0]), b, [200, 300, 400])).toEqual([200, 300, 400])
  })

  it('rayon traversant la boîte : point du rayon le plus proche du centre', () => {
    const b = boundsOf([[0, 0, 0], [1000, 1000, 1000]])
    const p = orbitPivot(ray([5000, 200, 300], [-1, 0, 0]), b, null)
    expect(p).toEqual([500, 200, 300])
  })

  it('rayon hors de la boîte : ramené dans le volume', () => {
    const b = boundsOf([[0, 0, 0], [1000, 1000, 1000]])
    const p = orbitPivot(ray([5000, 3000, 500], [-1, 0, 0]), b, null)
    expect(p).toEqual([500, 1000, 500])
  })

  it('géométrie plane : le pivot reste dans son plan', () => {
    const b = boundsOf([[0, 0, 0], [2000, 1000, 0]])
    const p = orbitPivot(ray([3000, -3000, 3000], [-1, 1, -1]), b, null)
    expect(p[2]).toBe(0)
  })
})
