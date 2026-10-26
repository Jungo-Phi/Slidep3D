// Caméra perspective minimale pour les tests, Z vers le haut, sans Three.js.
import type { View } from '../src/lib/core/placement'
import { type Vec2, type Vec3, add, cross, dot, normalize, scale, sub } from '../src/lib/core/vec'

export interface TestCamera {
  eye: Vec3
  target: Vec3
  fovDeg?: number
  width?: number
  height?: number
}

export function makeCamera(cam: TestCamera) {
  const width = cam.width ?? 1000
  const height = cam.height ?? 800
  const f = Math.tan(((cam.fovDeg ?? 45) * Math.PI) / 360)
  const fwd = normalize(sub(cam.target, cam.eye))
  let right = cross(fwd, [0, 0, 1])
  if (Math.hypot(...right) < 1e-9) right = [1, 0, 0]
  right = normalize(right)
  const up = cross(right, fwd)
  const aspect = width / height

  const project = (p: Vec3): Vec2 | null => {
    const d = sub(p, cam.eye)
    const z = dot(d, fwd)
    if (z <= 1e-6) return null
    const x = dot(d, right) / (z * f * aspect)
    const y = dot(d, up) / (z * f)
    return [((x + 1) / 2) * width, ((1 - y) / 2) * height]
  }

  const view = (cursor: Vec2): View => {
    const x = (cursor[0] / width) * 2 - 1
    const y = 1 - (cursor[1] / height) * 2
    const dir = normalize(add(fwd, add(scale(right, x * f * aspect), scale(up, y * f))))
    return { ray: { origin: cam.eye, dir }, cursor, project, viewDir: fwd }
  }

  /** Vue avec le curseur placé exactement sur la projection d'un point 3D (plus un décalage en px). */
  const viewAt = (p: Vec3, offset: Vec2 = [0, 0]): View => {
    const s = project(p)
    if (!s) throw new Error('point derrière la caméra')
    return view([s[0] + offset[0], s[1] + offset[1]])
  }

  return { project, view, viewAt }
}
