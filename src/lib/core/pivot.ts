// Point de rotation de l'orbite (clic droit glissé). Module pur, testé avec vitest.
//
// Règle :
//   1. scène vide                     → l'origine
//   2. nœud ou segment sous le curseur → ce point
//   3. sinon                          → le point du rayon curseur le plus proche du centre de la géométrie,
//                                        ramené dans sa boîte englobante
// Le pivot reste ainsi toujours dans le volume de la géométrie, tout en suivant le curseur.

import { type Ray, type Vec3, add, dot, scale, sub } from './vec'

export interface Bounds {
  min: Vec3
  max: Vec3
}

export function boundsOf(points: Iterable<Vec3>): Bounds | null {
  let b: { min: [number, number, number]; max: [number, number, number] } | null = null
  for (const p of points) {
    if (!b) b = { min: [...p], max: [...p] }
    for (let i = 0; i < 3; i++) {
      b.min[i] = Math.min(b.min[i], p[i])
      b.max[i] = Math.max(b.max[i], p[i])
    }
  }
  return b
}

const clampToBounds = (p: Vec3, b: Bounds): Vec3 => [
  Math.min(b.max[0], Math.max(b.min[0], p[0])),
  Math.min(b.max[1], Math.max(b.min[1], p[1])),
  Math.min(b.max[2], Math.max(b.min[2], p[2])),
]

/**
 * @param ray    rayon sous le curseur (direction normalisée)
 * @param bounds boîte englobante des nœuds, null si la scène est vide
 * @param hit    point de la géométrie sous le curseur, s'il y en a un
 */
export function orbitPivot(ray: Ray, bounds: Bounds | null, hit: Vec3 | null): Vec3 {
  if (!bounds) return [0, 0, 0]
  if (hit) return hit
  const center = scale(add(bounds.min, bounds.max), 0.5)
  const t = Math.max(0, dot(sub(center, ray.origin), ray.dir))
  return clampToBounds(add(ray.origin, scale(ray.dir, t)), bounds)
}
