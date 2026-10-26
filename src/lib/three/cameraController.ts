// Caméra style Onshape, Z vers le haut :
//   clic droit glissé  → orbite autour du pivot (voir core/pivot)
//   molette appuyée    → déplacement
//   molette            → zoom vers le curseur
//   pavé tactile       → défilement à deux doigts = déplacement, pincement = zoom
//
// Deux projections, perspective et orthographique, partagent la même pose (position, orientation,
// distance de référence). En orthographique, la hauteur visible est celle de la perspective à la
// distance de référence : basculer de l'une à l'autre garde le cadrage.

import { Matrix4, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { type Bounds, orbitPivot } from '../core/pivot'
import type { Ray, Vec2, Vec3 } from '../core/vec'
import { WheelClassifier } from '../core/wheel'

export type Projection = 'perspective' | 'orthographic'

/** Vue « Maison » : isométrique, depuis +X, −Y, +Z. */
export const HOME_DIR: Vec3 = [-1, 1, -1]

export interface CameraHooks {
  /** Point de la géométrie (nœud, segment) sous le curseur, s'il y en a un. */
  hit(cursor: Vec2): Vec3 | null
  /** Boîte englobante des nœuds, null si la scène est vide. */
  bounds(): Bounds | null
  onChange(): void
}

const Z = new Vector3(0, 0, 1)
const ORBIT_RAD_PER_PX = 0.008
const FOV = 40
/** Recul de l'origine des rayons en orthographique : tout ce qui est visible est devant elle. */
const ORTHO_BACK = 1e6

export class CameraController {
  readonly perspective = new PerspectiveCamera(FOV, 1, 5, 1e6)
  readonly orthographic = new OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5)
  projection: Projection = 'orthographic'
  /** Distance de référence : profondeur du point visé au centre de l'écran. */
  focusDist = 6000
  /** Pivot de l'orbite en cours, null sinon. */
  orbitCenter: Vec3 | null = null
  private mode: { kind: 'orbit' | 'pan'; pivot: Vector3; last: Vec2; pointerId: number } | null = null
  private wheel = new WheelClassifier()
  private anim: number | null = null

  constructor(
    private readonly dom: HTMLElement,
    private readonly hooks: CameraHooks,
  ) {
    this.perspective.up.set(0, 0, 1)
    this.orthographic.up.set(0, 0, 1)
    this.pose(HOME_DIR, new Vector3(0, 0, 0), 6000)
  }

  /** Caméra active. La perspective sert de support à la pose dans les deux modes. */
  get camera(): PerspectiveCamera | OrthographicCamera {
    return this.projection === 'perspective' ? this.perspective : this.orthographic
  }

  private get rig(): PerspectiveCamera {
    return this.perspective
  }

  get busy(): boolean {
    return this.mode !== null
  }

  setProjection(p: Projection): void {
    if (p === this.projection) return
    this.projection = p
    this.changed()
  }

  private size() {
    return { width: this.dom.clientWidth || 1, height: this.dom.clientHeight || 1 }
  }

  /** Hauteur visible à la distance de référence, en mm. */
  private visibleHeight(): number {
    return 2 * this.focusDist * Math.tan((FOV * Math.PI) / 360)
  }

  /** Taille d'un pixel écran, en mm, à l'endroit du point p. */
  worldPerPixel(p: Vec3): number {
    const { height } = this.size()
    if (this.projection === 'orthographic') return this.visibleHeight() / height
    const fwd = this.rig.getWorldDirection(new Vector3())
    const depth = Math.max(this.rig.near, new Vector3(...p).sub(this.rig.position).dot(fwd))
    return (2 * depth * Math.tan((FOV * Math.PI) / 360)) / height
  }

  /** Rayon sous le curseur. En orthographique, son origine est reculée pour que toute la scène soit devant. */
  ray(cursor: Vec2): Ray {
    const { width, height } = this.size()
    const cam = this.camera
    cam.updateMatrixWorld()
    const ndc = new Vector3((cursor[0] / width) * 2 - 1, 1 - (cursor[1] / height) * 2, 0.5)
    const fwd = this.rig.getWorldDirection(new Vector3())
    if (this.projection === 'orthographic') {
      const p = ndc.unproject(cam)
      // Point du plan de la caméra sous le curseur, puis recul.
      p.addScaledVector(fwd, -p.clone().sub(this.rig.position).dot(fwd) - ORTHO_BACK)
      return { origin: p.toArray(), dir: fwd.toArray() }
    }
    const dir = ndc.unproject(cam).sub(cam.position).normalize()
    return { origin: cam.position.toArray(), dir: dir.toArray() }
  }

  /** Point de référence sous le curseur, pour le zoom et le déplacement : géométrie, sinon sol proche, sinon distance de référence. */
  pointAt(cursor: Vec2): Vector3 {
    const hit = this.hooks.hit(cursor)
    if (hit) return new Vector3(...hit)
    const r = this.ray(cursor)
    const dir = new Vector3(...r.dir)
    const fwd = this.rig.getWorldDirection(new Vector3())
    // Origine ramenée dans le plan de la caméra (utile en orthographique).
    const o = new Vector3(...r.origin)
    o.addScaledVector(fwd, -o.clone().sub(this.rig.position).dot(fwd))
    if (Math.abs(dir.z) > 1e-6) {
      const t = -o.z / dir.z
      if (t > 0 && t < this.focusDist * 4) return o.clone().addScaledVector(dir, t)
    }
    return o.addScaledVector(dir, this.focusDist)
  }

  // -------------------------------------------------------------------------
  // Événements

  pointerDown(e: PointerEvent, cursor: Vec2): boolean {
    if (e.button !== 1 && e.button !== 2) return false
    this.stopAnim()
    const pivot =
      e.button === 2
        ? new Vector3(...orbitPivot(this.ray(cursor), this.hooks.bounds(), this.hooks.hit(cursor)))
        : this.pointAt(cursor)
    this.mode = { kind: e.button === 2 ? 'orbit' : 'pan', pivot, last: cursor, pointerId: e.pointerId }
    this.orbitCenter = e.button === 2 ? pivot.toArray() : null
    this.dom.setPointerCapture(e.pointerId)
    e.preventDefault()
    this.changed()
    return true
  }

  pointerMove(e: PointerEvent, cursor: Vec2): boolean {
    const m = this.mode
    if (!m || e.pointerId !== m.pointerId) return false
    const dx = cursor[0] - m.last[0]
    const dy = cursor[1] - m.last[1]
    m.last = cursor
    if (m.kind === 'orbit') this.orbit(m.pivot, dx, dy)
    else this.pan(m.pivot, dx, dy)
    return true
  }

  pointerUp(e: PointerEvent): boolean {
    const m = this.mode
    if (!m || e.pointerId !== m.pointerId) return false
    this.mode = null
    this.orbitCenter = null
    if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId)
    this.changed()
    return true
  }

  wheelEvent(e: WheelEvent, cursor: Vec2): void {
    e.preventDefault()
    this.stopAnim()
    const lineScale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1
    const dx = e.deltaX * lineScale
    const dy = e.deltaY * lineScale
    if (this.wheel.classify(e) === 'zoom') {
      const k = e.ctrlKey ? 0.01 : 0.0018
      this.zoomAt(cursor, Math.exp(Math.max(-0.5, Math.min(0.5, dy * k))))
    } else {
      const { width, height } = this.size()
      this.pan(this.pointAt([width / 2, height / 2]), -dx, -dy)
    }
  }

  /**
   * Orbite pilotée depuis le cube d'orientation : pas de curseur dans la scène,
   * le pivot est le centre de la géométrie (l'origine si la scène est vide).
   */
  cubeOrbitStart(): void {
    this.stopAnim()
    const b = this.hooks.bounds()
    const c: Vec3 = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : [0, 0, 0]
    this.orbitCenter = c
    this.changed()
  }

  cubeOrbitMove(dx: number, dy: number): void {
    if (this.orbitCenter) this.orbit(new Vector3(...this.orbitCenter), dx, dy)
  }

  cubeOrbitEnd(): void {
    this.orbitCenter = null
    this.changed()
  }

  // -------------------------------------------------------------------------
  // Mouvements

  orbit(pivot: Vector3, dx: number, dy: number): void {
    const cam = this.rig
    const yaw = new Quaternion().setFromAxisAngle(Z, -dx * ORBIT_RAD_PER_PX)
    const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
    const pitch = new Quaternion().setFromAxisAngle(right, -dy * ORBIT_RAD_PER_PX)
    let q = yaw.clone().multiply(pitch)
    // On ne passe pas par-dessus les pôles : le haut de l'écran doit rester vers +Z.
    const up = new Vector3(0, 1, 0).applyQuaternion(q.clone().multiply(cam.quaternion))
    if (up.z < -1e-6) q = yaw
    const offset = cam.position.clone().sub(pivot).applyQuaternion(q)
    cam.position.copy(pivot).add(offset)
    cam.quaternion.premultiply(q).normalize()
    this.changed()
  }

  /** Déplace la vue de (dx, dy) pixels, le point `pivot` suivant le curseur. */
  pan(pivot: Vector3, dx: number, dy: number): void {
    const cam = this.rig
    const perPx = this.worldPerPixel(pivot.toArray())
    const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
    const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion)
    cam.position.addScaledVector(right, -dx * perPx).addScaledVector(up, dy * perPx)
    this.changed()
  }

  /**
   * Zoom vers le curseur : facteur > 1 pour s'éloigner. La pose avance vers le point visé ;
   * en orthographique, la hauteur visible suit la distance de référence, le point reste sous le curseur.
   */
  zoomAt(cursor: Vec2, factor: number): void {
    const cam = this.rig
    const p = this.pointAt(cursor)
    const offset = cam.position.clone().sub(p)
    const d = offset.length() * factor
    if (d < 20 || d > 2e6) return
    cam.position.copy(p).add(offset.multiplyScalar(factor))
    this.focusDist = Math.min(2e6, Math.max(50, this.focusDist * factor))
    this.changed()
  }

  // -------------------------------------------------------------------------
  // Vues

  /** Point visé au centre de l'écran, à la distance de référence. */
  private focusPoint(): Vector3 {
    const fwd = this.rig.getWorldDirection(new Vector3())
    return this.rig.position.clone().addScaledVector(fwd, this.focusDist)
  }

  /** Orientation regardant dans la direction `dir`, Z en haut (Y en haut pour les vues de dessus et dessous). */
  private orientation(dir: Vec3): Quaternion {
    const d = new Vector3(...dir).normalize()
    const up = Math.abs(d.z) > 0.999 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
    return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), d, up))
  }

  /** Distance pour cadrer une sphère de rayon r. */
  private fitDistance(r: number): number {
    const vfov = (FOV * Math.PI) / 180
    const { width, height } = this.size()
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (width / height))
    return (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.1
  }

  private sceneSphere(): { center: Vector3; radius: number } {
    const b = this.hooks.bounds()
    // Scène vide : cadrage centré sur l'origine.
    if (!b) return { center: new Vector3(0, 0, 0), radius: 1000 }
    const min = new Vector3(...b.min)
    const max = new Vector3(...b.max)
    return { center: min.clone().add(max).multiplyScalar(0.5), radius: Math.max(300, max.distanceTo(min) / 2) }
  }

  private pose(dir: Vec3, center: Vector3, distance: number): void {
    const q = this.orientation(dir)
    const fwd = new Vector3(0, 0, -1).applyQuaternion(q)
    this.rig.quaternion.copy(q)
    this.rig.position.copy(center).addScaledVector(fwd, -distance)
    this.focusDist = distance
  }

  /** Regarde la scène dans la direction `dir`, cadrée. */
  viewFrom(dir: Vec3): void {
    const { center, radius } = this.sceneSphere()
    const q = this.orientation(dir)
    const fwd = new Vector3(0, 0, -1).applyQuaternion(q)
    const d = this.fitDistance(radius)
    this.animateTo(center.clone().addScaledVector(fwd, -d), q, d)
  }

  /** Vue « Maison » : isométrique, cadrée sur la scène. */
  home(): void {
    this.viewFrom(HOME_DIR)
  }

  /** Cadre la scène sans changer l'orientation. */
  frame(): void {
    const { center, radius } = this.sceneSphere()
    const fwd = this.rig.getWorldDirection(new Vector3())
    const d = this.fitDistance(radius)
    this.animateTo(center.clone().addScaledVector(fwd, -d), this.rig.quaternion.clone(), d)
  }

  /** Vue « Maison » immédiate, au chargement. */
  resetHome(): void {
    const { center, radius } = this.sceneSphere()
    this.pose(HOME_DIR, center, this.fitDistance(radius))
    this.changed()
  }

  private animateTo(position: Vector3, quaternion: Quaternion, focusDist: number): void {
    this.stopAnim()
    const q0 = this.rig.quaternion.clone()
    const f0 = this.focusDist
    // Interpolation autour du point visé, pour tourner autour de la scène plutôt que de la traverser.
    const c0 = this.focusPoint()
    const c1 = position.clone().addScaledVector(new Vector3(0, 0, -1).applyQuaternion(quaternion), focusDist)
    const start = performance.now()
    const duration = 320
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const k = t * t * (3 - 2 * t)
      const q = q0.clone().slerp(quaternion, k)
      const f = f0 + (focusDist - f0) * k
      const c = c0.clone().lerp(c1, k)
      const fwd = new Vector3(0, 0, -1).applyQuaternion(q)
      this.rig.quaternion.copy(q)
      this.rig.position.copy(c).addScaledVector(fwd, -f)
      this.focusDist = f
      if (t === 1) this.rig.position.copy(position)
      this.changed()
      this.anim = t < 1 ? requestAnimationFrame(step) : null
    }
    this.anim = requestAnimationFrame(step)
  }

  private stopAnim(): void {
    if (this.anim !== null) cancelAnimationFrame(this.anim)
    this.anim = null
  }

  /** Met à jour les deux caméras depuis la pose, et la taille de l'écran. À appeler aussi au redimensionnement. */
  sync(): void {
    const p = this.perspective
    const { width, height } = this.size()
    p.aspect = width / height
    // Plans de découpe proportionnés à la distance : bonne précision de profondeur à toutes les échelles.
    p.near = Math.max(1, this.focusDist * 0.002)
    p.far = Math.max(1e5, this.focusDist * 200)
    p.updateProjectionMatrix()
    p.updateMatrixWorld()

    const o = this.orthographic
    o.position.copy(p.position)
    o.quaternion.copy(p.quaternion)
    o.left = -width / 2
    o.right = width / 2
    o.top = height / 2
    o.bottom = -height / 2
    o.zoom = height / this.visibleHeight()
    // Plans de découpe de part et d'autre de la pose : la pose peut se trouver dans la scène après un zoom.
    const depth = Math.max(1e5, this.focusDist * 50)
    o.near = -depth
    o.far = depth
    o.updateProjectionMatrix()
    o.updateMatrixWorld()
  }

  private changed(): void {
    this.sync()
    this.hooks.onChange()
  }

  dispose(): void {
    this.stopAnim()
  }
}
