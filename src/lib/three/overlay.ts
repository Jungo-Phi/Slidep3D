// Retour visuel du tracé et gizmo de déplacement. Tout est redessiné à chaque mouvement :
// quelques dizaines de sommets, aucun coût notable.

import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Vector3,
} from 'three'
import type { Guide, Snap } from '../core/placement'
import { type Axis, type Vec3, AXES, AXIS_DIR, add, dist, dot, scale, sub } from '../core/vec'
import { AXIS_COLORS, COLORS, SNAP_COLORS } from './colors'
import { BEAM_SIZE } from './sceneMeshes'

export interface OverlayState {
  anchor: Vec3 | null
  target: Vec3 | null
  snap: Snap | null
  /** Une longueur est tapée : le point vient du clavier. */
  typed: boolean
  gizmo: { center: Vec3; hover: Axis | null; active: Axis | null } | null
  /** Pivot de l'orbite en cours. */
  pivot: Vec3 | null
  /**
   * Œil de la caméra perspective (null en orthographique) : les pointillés sont coupés devant lui,
   * car une ligne qui passe derrière la caméra ne s'affiche pas en pointillé.
   */
  eye: { position: Vec3; forward: Vec3 } | null
}

type Dash = { from: Vec3; to: Vec3; color: string }

/** Partie du segment située devant l'œil, à au moins `minDepth` de profondeur ; null si rien n'est devant. */
function clipInFront(d: Dash, eye: NonNullable<OverlayState['eye']>, minDepth: number): Dash | null {
  const depth = (p: Vec3) => dot(sub(p, eye.position), eye.forward) - minDepth
  const a = depth(d.from)
  const b = depth(d.to)
  if (a < 0 && b < 0) return null
  if (a >= 0 && b >= 0) return d
  const t = a / (a - b)
  const cut = add(d.from, scale(sub(d.to, d.from), t))
  return a < 0 ? { ...d, from: cut } : { ...d, to: cut }
}

/** Taille d'un pixel écran en mm à l'endroit d'un point : donne des tailles écran constantes dans les deux projections. */
export type PixelSize = (p: Vec3) => number

/** Longueur des flèches du gizmo, en mm. */
export const gizmoLength = (px: PixelSize, center: Vec3): number => px(center) * 110

function discTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.beginPath()
  g.arc(32, 32, 26, 0, Math.PI * 2)
  g.fillStyle = '#ffffff'
  g.fill()
  return new CanvasTexture(c)
}

/** Cible du pivot : anneau blanc cerclé de sombre, avec un point central. */
function pivotTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const ring = (r: number, w: number, color: string) => {
    g.beginPath()
    g.arc(32, 32, r, 0, Math.PI * 2)
    g.lineWidth = w
    g.strokeStyle = color
    g.stroke()
  }
  ring(24, 9, '#1f2937')
  ring(24, 4, '#f59e0b')
  g.beginPath()
  g.arc(32, 32, 6, 0, Math.PI * 2)
  g.fillStyle = '#1f2937'
  g.fill()
  return new CanvasTexture(c)
}

const onTop = { depthTest: false, depthWrite: false, transparent: true }

function setPositions(geometry: BufferGeometry, points: readonly Vec3[]): void {
  geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3))
  geometry.computeBoundingSphere()
}

export class Overlay {
  readonly object = new Group()

  private previewBeam = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial({ color: COLORS.preview, transparent: true, opacity: 0.35, depthWrite: false }),
  )
  private rubber = new Line(new BufferGeometry(), new LineBasicMaterial({ ...onTop, color: COLORS.preview }))
  private shadowLine = new Line(new BufferGeometry(), new LineBasicMaterial({ ...onTop, color: COLORS.shadow, opacity: 0.35 }))
  private dashed = new LineSegments(
    new BufferGeometry(),
    new LineDashedMaterial({ ...onTop, vertexColors: true, dashSize: 20, gapSize: 15, opacity: 0.9 }),
  )
  private marker: Points
  private shadow: Points
  private pivot: Points
  private gizmo = new Group()
  private arrows = {} as Record<Axis, { group: Group; materials: MeshBasicMaterial[] }>

  constructor() {
    this.object.name = 'overlay'
    const tex = discTexture()
    this.marker = new Points(
      new BufferGeometry(),
      new PointsMaterial({ ...onTop, size: 11, sizeAttenuation: false, map: tex, alphaTest: 0.5 }),
    )
    this.shadow = new Points(
      new BufferGeometry(),
      new PointsMaterial({ ...onTop, size: 9, sizeAttenuation: false, map: tex, alphaTest: 0.5, color: COLORS.shadow, opacity: 0.45 }),
    )
    this.pivot = new Points(
      new BufferGeometry(),
      new PointsMaterial({ ...onTop, size: 26, sizeAttenuation: false, map: pivotTexture(), alphaTest: 0.3 }),
    )
    this.pivot.renderOrder = 30
    this.object.add(this.pivot)
    const top = [this.rubber, this.dashed, this.marker, this.shadow, this.shadowLine]
    for (const o of top) o.renderOrder = 10
    this.marker.renderOrder = 12
    this.object.add(this.previewBeam, ...top, this.gizmo)
    this.buildGizmo()
    this.clear()
  }

  private buildGizmo(): void {
    const shaft = new CylinderGeometry(0.018, 0.018, 0.8, 10)
    shaft.translate(0, 0.4, 0)
    const head = new ConeGeometry(0.07, 0.22, 16)
    head.translate(0, 0.89, 0)
    for (const axis of AXES) {
      const materials = [0, 1].map(() => new MeshBasicMaterial({ ...onTop, color: AXIS_COLORS[axis] }))
      const group = new Group()
      group.add(new Mesh(shaft, materials[0]), new Mesh(head, materials[1]))
      // Les géométries pointent vers +Y : on les tourne vers l'axe voulu.
      group.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...AXIS_DIR[axis]))
      group.renderOrder = 20
      group.traverse((o) => (o.renderOrder = 20))
      this.gizmo.add(group)
      this.arrows[axis] = { group, materials }
    }
  }

  private clear(): void {
    for (const o of [this.previewBeam, this.rubber, this.shadowLine, this.dashed, this.marker, this.shadow, this.gizmo, this.pivot]) {
      o.visible = false
    }
  }

  update(s: OverlayState, px: PixelSize): void {
    this.clear()
    if (s.pivot) {
      setPositions(this.pivot.geometry, [s.pivot])
      this.pivot.visible = true
    }
    if (s.gizmo) this.updateGizmo(s.gizmo, px)
    const { snap, target, anchor } = s
    if (!snap || !target) return
    const u = px(target)

    const axis = snap.axis
    const lineColor = axis ? AXIS_COLORS[axis] : COLORS.preview

    // Point visé.
    setPositions(this.marker.geometry, [target])
    ;(this.marker.material as PointsMaterial).color.set(s.typed ? '#111827' : SNAP_COLORS[snap.kind])
    this.marker.visible = true

    // Ligne en cours, en volume pour lire l'orientation, et en trait par-dessus tout.
    if (anchor && dist(anchor, target) > 1e-6) {
      setPositions(this.rubber.geometry, [anchor, target])
      ;(this.rubber.material as LineBasicMaterial).color.set(lineColor)
      this.rubber.visible = true
      this.placeBeam(anchor, target, lineColor)
    }

    // Pointillés : guides de référence et droite suivie, prolongée hors de l'écran.
    const far = u * 4000
    let dashes: Dash[] = snap.guides.map((g: Guide) => ({
      from: g.from,
      to: g.to,
      color: g.color === 'ref' ? COLORS.ref : AXIS_COLORS[g.color],
    }))
    if (snap.line && (snap.kind === 'axis' || snap.kind === 'parallel' || snap.kind === 'extension' || snap.kind === 'constraint')) {
      dashes.push({
        from: add(snap.line.origin, scale(snap.line.dir, -far)),
        to: add(snap.line.origin, scale(snap.line.dir, far)),
        color: axis ? AXIS_COLORS[axis] : COLORS.ref,
      })
    }

    // Rappels vers les plans d'axes, chacun de la couleur de l'axe qu'il suit : il se lit comme une coordonnée.
    // Z : jusqu'au plan XY ; X : jusqu'au plan YZ ; Y : jusqu'au plan XZ.
    const [x, y, z] = target
    const ground: Vec3 = [x, y, 0]
    // Si la droite suivie est déjà la verticale du point, le rappel Z la doublerait (deux pointillés décalés).
    const followsVertical = dashes.length > snap.guides.length && Math.abs(snap.line?.dir[2] ?? 0) > 1 - 1e-9
    if (Math.abs(z) > 1e-6 && !followsVertical) dashes.push({ from: target, to: ground, color: AXIS_COLORS.z })
    if (Math.abs(x) > 1e-6) dashes.push({ from: target, to: [0, y, z], color: AXIS_COLORS.x })
    if (Math.abs(y) > 1e-6) dashes.push({ from: target, to: [x, 0, z], color: AXIS_COLORS.y })
    if (Math.abs(z) > 1e-6) {
      setPositions(this.shadow.geometry, [ground])
      this.shadow.visible = true
      if (anchor) {
        setPositions(this.shadowLine.geometry, [[anchor[0], anchor[1], 0], ground])
        this.shadowLine.visible = true
      }
    }
    if (s.eye) {
      const eye = s.eye
      dashes = dashes.flatMap((d) => clipInFront(d, eye, u * 20) ?? [])
    }
    this.setDashes(dashes, u)
  }

  private placeBeam(a: Vec3, b: Vec3, color: string): void {
    const x = new Vector3(...sub(b, a))
    const length = x.length()
    x.normalize()
    const z = Math.abs(x.z) > 0.999 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
    const y = new Vector3().crossVectors(z, x).normalize()
    z.crossVectors(x, y)
    const m = new Matrix4().makeBasis(x.multiplyScalar(length), y.multiplyScalar(BEAM_SIZE), z.multiplyScalar(BEAM_SIZE))
    m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
    this.previewBeam.matrixAutoUpdate = false
    this.previewBeam.matrix.copy(m)
    ;(this.previewBeam.material as MeshBasicMaterial).color.set(color)
    this.previewBeam.visible = true
  }

  private setDashes(dashes: Dash[], pixel: number): void {
    if (dashes.length === 0) return
    const g = this.dashed.geometry
    setPositions(g, dashes.flatMap((x) => [x.from, x.to]))
    const c = new Color()
    g.setAttribute(
      'color',
      new Float32BufferAttribute(dashes.flatMap((x) => (c.set(x.color), [c.r, c.g, c.b, c.r, c.g, c.b])), 3),
    )
    this.dashed.computeLineDistances()
    const m = this.dashed.material as LineDashedMaterial
    m.dashSize = pixel * 8
    m.gapSize = pixel * 6
    this.dashed.visible = true
  }

  private updateGizmo(g: NonNullable<OverlayState['gizmo']>, px: PixelSize): void {
    this.gizmo.visible = true
    this.gizmo.position.set(...g.center)
    this.gizmo.scale.setScalar(gizmoLength(px, g.center))
    for (const axis of AXES) {
      const lit = g.active === axis || (!g.active && g.hover === axis)
      for (const m of this.arrows[axis].materials) m.color.set(lit ? COLORS.hover : AXIS_COLORS[axis])
      this.arrows[axis].group.visible = !g.active || g.active === axis
    }
  }
}

