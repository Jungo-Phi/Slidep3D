// Petite bibliothèque de vecteurs immuables, sans dépendance à Three.js,
// pour garder le module de placement pur et testable.

export type Vec3 = readonly [number, number, number]
export type Vec2 = readonly [number, number]

export const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z]
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b))
export const normalize = (a: Vec3): Vec3 => {
  const l = len(a)
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0]
}
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t))
export const eq = (a: Vec3, b: Vec3, eps = 1e-6): boolean => dist(a, b) <= eps

export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const len2 = (a: Vec2): number => Math.hypot(a[0], a[1])
export const dist2 = (a: Vec2, b: Vec2): number => len2(sub2(a, b))
export const dot2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1]

/** Distance écran d'un point p au segment [a, b], et paramètre t du point le plus proche. */
export function pointSegment2(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const ab = sub2(b, a)
  const l2 = dot2(ab, ab)
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot2(sub2(p, a), ab) / l2)) : 0
  return { d: dist2(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]), t }
}

export type Axis = 'x' | 'y' | 'z'
export const AXES: readonly Axis[] = ['x', 'y', 'z']
export const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }
export const AXIS_DIR: Record<Axis, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }

export interface Ray {
  origin: Vec3
  /** Direction normalisée. */
  dir: Vec3
}

export interface Line {
  origin: Vec3
  /** Direction normalisée. */
  dir: Vec3
}

/**
 * Point de la droite `line` le plus proche de la droite du rayon.
 * Renvoie null si les deux droites sont (presque) parallèles.
 * `s` est l'abscisse du point sur la droite, `rayT` celle sur le rayon.
 */
export function closestOnLineToRay(line: Line, ray: Ray): { point: Vec3; s: number; rayT: number } | null {
  const w0 = sub(line.origin, ray.origin)
  const a = dot(line.dir, line.dir)
  const b = dot(line.dir, ray.dir)
  const c = dot(ray.dir, ray.dir)
  const d = dot(line.dir, w0)
  const e = dot(ray.dir, w0)
  const den = a * c - b * b
  if (den < 1e-9) return null
  const s = (b * e - c * d) / den
  const rayT = (a * e - b * d) / den
  return { point: add(line.origin, scale(line.dir, s)), s, rayT }
}

export interface Plane {
  /** Normale normalisée. */
  normal: Vec3
  point: Vec3
}

/** Intersection rayon / plan. Null si parallèle ou derrière la caméra. */
export function intersectRayPlane(ray: Ray, plane: Plane): { point: Vec3; t: number } | null {
  const den = dot(ray.dir, plane.normal)
  if (Math.abs(den) < 1e-9) return null
  const t = dot(sub(plane.point, ray.origin), plane.normal) / den
  if (t <= 0) return null
  return { point: add(ray.origin, scale(ray.dir, t)), t }
}

/** Projection orthogonale d'un point sur une droite. */
export function projectOnLine(p: Vec3, line: Line): { point: Vec3; s: number } {
  const s = dot(sub(p, line.origin), line.dir)
  return { point: add(line.origin, scale(line.dir, s)), s }
}

export const roundTo = (x: number, step: number): number => Math.round(x / step) * step

/** Arrondi qui évite les -0 et les 1e-13 parasites dans l'affichage et le JSON. */
export const clean = (x: number): number => {
  const r = Math.round(x * 1e6) / 1e6
  return r === 0 ? 0 : r
}
export const cleanVec = (p: Vec3): Vec3 => [clean(p[0]), clean(p[1]), clean(p[2])]
