import { type OrthographicCamera, type PerspectiveCamera, Vector3 } from 'three'
import type { View } from '../core/placement'
import type { Vec2, Vec3 } from '../core/vec'
import type { CameraController } from './cameraController'

const tmp = new Vector3()

/**
 * Projection d'un point 3D en pixels écran. En perspective, null s'il est derrière la caméra ;
 * en orthographique, rien n'est derrière (les plans de découpe entourent la scène).
 */
export function projector(camera: PerspectiveCamera | OrthographicCamera, width: number, height: number) {
  const ortho = 'isOrthographicCamera' in camera
  return (p: Vec3): Vec2 | null => {
    tmp.set(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse)
    if (!ortho && tmp.z >= -1e-6) return null
    tmp.applyMatrix4(camera.projectionMatrix)
    return [((tmp.x + 1) / 2) * width, ((1 - tmp.y) / 2) * height]
  }
}

/** Ce que la caméra voit du curseur, au format du module de placement. */
export function makeView(ctrl: CameraController, width: number, height: number, cursor: Vec2): View {
  const camera = ctrl.camera
  camera.updateMatrixWorld()
  return {
    ray: ctrl.ray(cursor),
    cursor,
    project: projector(camera, width, height),
    viewDir: camera.getWorldDirection(new Vector3()).toArray(),
  }
}
