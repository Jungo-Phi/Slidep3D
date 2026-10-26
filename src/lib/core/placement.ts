// Logique de placement d'un point 3D à partir d'un curseur 2D.
// Module pur : aucune dépendance à Three.js ni à Svelte.
//
// Ordre de priorité fixe, pour que l'utilisateur puisse prévoir où tombe le point :
//   1. nœud existant sous le curseur
//   2. point sur un segment (milieu ou point quelconque)
//   3. axe X, Y ou Z depuis le dernier nœud
//   4. guide d'alignement (parallèle à un segment, même coordonnée qu'un nœud)
//   5. plan actif
// Un verrou (axe X/Y/Z ou inférence figée avec Shift) remplace cette cascade.
//
// Vue alignée : quand la caméra regarde dans l'axe (à moins de ALIGN_DEG d'un axe, sans plan forcé par Tab),
// le plan d'axes face à elle, passant par le dernier nœud (sinon l'origine), devient le plan de travail :
// on ne s'accroche qu'à ce qui est dans ce plan, et aux points où les segments le traversent.

import type { Scene, Segment } from './scene'
import {
  type Axis,
  type Line,
  type Plane,
  type Ray,
  type Vec2,
  type Vec3,
  AXES,
  AXIS_DIR,
  AXIS_INDEX,
  add,
  closestOnLineToRay,
  cross,
  dist,
  dist2,
  dot,
  dot2,
  eq,
  intersectRayPlane,
  len,
  len2,
  lerp,
  normalize,
  projectOnLine,
  roundTo,
  scale,
  sub,
  sub2,
} from './vec'

/** Ce que la caméra voit du curseur. */
export interface View {
  ray: Ray
  /** Position du curseur, en pixels écran. */
  cursor: Vec2
  /** Projection d'un point 3D en pixels écran ; null s'il est derrière la caméra. */
  project(p: Vec3): Vec2 | null
  /** Direction de visée de la caméra, normalisée. */
  viewDir: Vec3
}

export type PlaneName = 'xy' | 'xz' | 'yz'
export const PLANE_NAMES: readonly PlaneName[] = ['xy', 'xz', 'yz']
const PLANE_NORMAL_AXIS: Record<PlaneName, Axis> = { xy: 'z', xz: 'y', yz: 'x' }
const NORMAL_AXIS_PLANE: Record<Axis, PlaneName> = { z: 'xy', y: 'xz', x: 'yz' }

export interface ActivePlane extends Plane {
  /** Plan d'axes, ou plan oblique défini par les derniers nœuds. */
  name: PlaneName | 'oblique'
  source: 'nodes' | 'camera' | 'forced' | 'view'
  /** Repère du plan, utilisé pour l'arrondi à la grille. */
  u: Vec3
  v: Vec3
}

/** Verrou actif : axe (X/Y/Z) ou inférence figée par Shift. */
export type Constraint =
  | { type: 'line'; line: Line; label: string; axis?: Axis }
  | { type: 'plane'; plane: ActivePlane; label: string }

export interface Anchor {
  point: Vec3
  /** Nœud existant, absent si le premier point de la chaîne n'est pas encore créé. */
  nodeId?: string
}

export interface Tolerances {
  /** Rayon d'accrochage d'un nœud, en pixels. */
  nodePx: number
  /** Distance d'accrochage d'un segment, en pixels. */
  segmentPx: number
  /** Seuil angulaire d'accrochage aux axes, en degrés écran. */
  axisDeg: number
  /** Seuil angulaire des guides parallèles, en degrés écran. */
  parallelDeg: number
  /** Distance d'accrochage des guides d'alignement, en pixels. */
  alignPx: number
  /** En deçà de cette distance au dernier nœud, la direction visée n'est pas fiable. */
  minDirectionPx: number
}

export const DEFAULT_TOLERANCES: Tolerances = {
  nodePx: 12,
  segmentPx: 8,
  axisDeg: 6,
  parallelDeg: 4,
  alignPx: 7,
  minDirectionPx: 14,
}

export interface PlacementInput {
  view: View
  scene: Scene
  /** Dernier point de la chaîne en cours ; null si aucune chaîne. */
  anchor: Anchor | null
  /** Positions des derniers points de la chaîne, le dernier étant l'ancre. */
  chain: readonly Vec3[]
  forcedPlane: PlaneName | null
  constraint: Constraint | null
  /** Pas de la grille, en mm. */
  step: number
  tolerances?: Partial<Tolerances>
}

export type SnapKind =
  | 'node'
  | 'midpoint'
  | 'on-segment'
  | 'axis'
  | 'parallel'
  | 'extension'
  | 'align'
  | 'plane'
  | 'constraint'

export type GuideColor = Axis | 'ref'

export interface Guide {
  from: Vec3
  to: Vec3
  color: GuideColor
}

export interface Snap {
  point: Vec3
  kind: SnapKind
  /** Libellé affiché près du curseur. */
  label: string
  /** Nœud réutilisé. */
  nodeId?: string
  /** Segment à couper (milieu ou point sur segment). */
  segmentId?: string
  /** Axe porté par la direction ancre → point, s'il y en a un (couleur de la ligne en cours). */
  axis?: Axis
  /** Droite suivie par l'accrochage, que Shift peut figer. */
  line?: Line
  lineLabel?: string
  /** Plan utilisé pour l'accrochage au plan. */
  plane: ActivePlane
  /** Lignes pointillées de référence. */
  guides: Guide[]
}

const AXIS_LABEL: Record<Axis, string> = { x: 'X', y: 'Y', z: 'Z' }
export const planeLabel = (p: ActivePlane): string =>
  p.name === 'oblique' ? 'plan des 3 derniers nœuds' : `plan ${p.name.toUpperCase()}`

// ---------------------------------------------------------------------------
// Plan actif

export function axisPlane(name: PlaneName, through: Vec3, source: ActivePlane['source']): ActivePlane {
  const n = PLANE_NORMAL_AXIS[name]
  const [ua, va] = AXES.filter((a) => a !== n)
  return { name, source, normal: AXIS_DIR[n], point: through, u: AXIS_DIR[ua], v: AXIS_DIR[va] }
}

/** Écart maximal entre la visée et un axe pour que la vue soit alignée sur un plan, en degrés. */
export const ALIGN_DEG = 15

/** Plan d'axes sur lequel la vue est alignée (visée à moins de ALIGN_DEG de sa normale), sinon null. */
export function alignedPlaneName(viewDir: Vec3): PlaneName | null {
  const cos = Math.cos((ALIGN_DEG * Math.PI) / 180)
  for (const a of AXES) if (Math.abs(viewDir[AXIS_INDEX[a]]) >= cos) return NORMAL_AXIS_PLANE[a]
  return null
}

/** Le point p est-il dans le plan ? */
export const onPlane = (p: Vec3, plane: Plane): boolean => Math.abs(dot(sub(p, plane.point), plane.normal)) < 1e-6

/** Plan d'axes le plus face à la caméra. */
export function facingPlaneName(viewDir: Vec3): PlaneName {
  // À égalité (vue isométrique), on préfère le sol, puis la face.
  let best: Axis = 'z'
  for (const a of ['y', 'x'] as const) {
    if (Math.abs(viewDir[AXIS_INDEX[a]]) > Math.abs(viewDir[AXIS_INDEX[best]]) + 1e-6) best = a
  }
  return NORMAL_AXIS_PLANE[best]
}

/**
 * Plan actif : forcé par Tab, sinon plan des 3 derniers points de la chaîne,
 * sinon plan d'axes le plus face à la caméra passant par le dernier point.
 */
export function activePlane(
  chain: readonly Vec3[],
  viewDir: Vec3,
  forced: PlaneName | null,
): ActivePlane {
  const through = chain.length > 0 ? chain[chain.length - 1] : ([0, 0, 0] as Vec3)
  if (forced) return axisPlane(forced, through, 'forced')
  if (chain.length >= 3) {
    const [p1, p2, p3] = chain.slice(-3)
    const d1 = sub(p2, p1)
    const d2 = sub(p3, p2)
    const n = cross(d1, d2)
    // Non alignés si l'angle entre les deux segments dépasse ~3°.
    if (len(n) > Math.sin((3 * Math.PI) / 180) * len(d1) * len(d2)) {
      const normal = normalize(n)
      const axisIdx = normal.findIndex((c) => Math.abs(c) > 1 - 1e-9)
      if (axisIdx >= 0) return axisPlane(NORMAL_AXIS_PLANE[AXES[axisIdx]], through, 'nodes')
      const u = normalize(d2)
      return { name: 'oblique', source: 'nodes', normal, point: through, u, v: cross(normal, u) }
    }
  }
  return axisPlane(facingPlaneName(viewDir), through, 'camera')
}

/**
 * Arrondi à la grille dans le plan : coordonnées monde pour un plan d'axes,
 * repère local centré sur le dernier point pour un plan oblique.
 */
export function roundInPlane(p: Vec3, plane: ActivePlane, step: number): Vec3 {
  if (plane.name !== 'oblique') {
    const n = AXIS_INDEX[PLANE_NORMAL_AXIS[plane.name]]
    const r = p.map((c, i) => (i === n ? plane.point[i] : roundTo(c, step)))
    return [r[0], r[1], r[2]]
  }
  const local = sub(p, plane.point)
  const a = roundTo(dot(local, plane.u), step)
  const b = roundTo(dot(local, plane.v), step)
  return add(plane.point, add(scale(plane.u, a), scale(plane.v, b)))
}

// ---------------------------------------------------------------------------
// Recherche sous le curseur (aussi utilisée pour le survol et la sélection)

export function pickNode(
  view: View,
  scene: Scene,
  tolPx: number,
  exclude?: (id: string) => boolean,
): { id: string; point: Vec3; px: number } | null {
  let best: { id: string; point: Vec3; px: number } | null = null
  for (const n of scene.nodes.values()) {
    if (exclude?.(n.id)) continue
    const p: Vec3 = [n.x, n.y, n.z]
    const s = view.project(p)
    if (!s) continue
    const px = dist2(s, view.cursor)
    if (px <= tolPx && (!best || px < best.px)) best = { id: n.id, point: p, px }
  }
  return best
}

export interface SegmentHit {
  segment: Segment
  /** Point du segment le plus proche du rayon. */
  point: Vec3
  /** Distance depuis nodeA, en mm. */
  s: number
  length: number
  px: number
}

export function pickSegment(
  view: View,
  scene: Scene,
  tolPx: number,
  include?: (seg: Segment) => boolean,
): SegmentHit | null {
  let best: SegmentHit | null = null
  for (const seg of scene.segments.values()) {
    if (include && !include(seg)) continue
    const [a, b] = scene.segmentEnds(seg)
    const length = dist(a, b)
    if (length === 0) continue
    const line = { origin: a, dir: normalize(sub(b, a)) }
    const c = closestOnLineToRay(line, view.ray)
    let s: number
    if (c) {
      s = Math.max(0, Math.min(length, c.s))
    } else {
      // Segment vu en bout : on prend le point le plus proche à l'écran.
      const sa = view.project(a)
      const sb = view.project(b)
      if (!sa || !sb) continue
      s = 0
      if (len2(sub2(sb, sa)) > 0) {
        const t = dot2(sub2(view.cursor, sa), sub2(sb, sa)) / dot2(sub2(sb, sa), sub2(sb, sa))
        s = Math.max(0, Math.min(1, t)) * length
      }
    }
    const point = add(a, scale(line.dir, s))
    const sp = view.project(point)
    if (!sp) continue
    const px = dist2(sp, view.cursor)
    if (px <= tolPx && (!best || px < best.px)) best = { segment: seg, point, s, length, px }
  }
  return best
}

// ---------------------------------------------------------------------------
// Placement

interface Ctx extends PlacementInput {
  tol: Tolerances
  plane: ActivePlane
  /** Vue alignée : plan de travail hors duquel on ne s'accroche pas. */
  workPlane: ActivePlane | null
}

export function place(input: PlacementInput): Snap | null {
  const tol = { ...DEFAULT_TOLERANCES, ...input.tolerances }
  const aligned = input.forcedPlane ? null : alignedPlaneName(input.view.viewDir)
  const plane = aligned
    ? axisPlane(aligned, input.anchor?.point ?? [0, 0, 0], 'view')
    : activePlane(input.chain, input.view.viewDir, input.forcedPlane)
  const ctx: Ctx = { ...input, tol, plane, workPlane: aligned ? plane : null }

  const snap = input.constraint ? constrained(ctx, input.constraint) : cascade(ctx)
  if (!snap) return null
  return finish(ctx, snap)
}

function cascade(ctx: Ctx): Snap | null {
  return (
    snapNode(ctx) ??
    snapSegment(ctx) ??
    snapAxis(ctx) ??
    snapParallel(ctx) ??
    snapAlign(ctx) ??
    snapPlane(ctx)
  )
}

/** 1. Nœud existant sous le curseur. */
function snapNode(ctx: Ctx): Snap | null {
  const wp = ctx.workPlane
  const hit = pickNode(ctx.view, ctx.scene, ctx.tol.nodePx, wp ? (id) => !onPlane(ctx.scene.pos(id), wp) : undefined)
  if (!hit) return null
  return {
    point: hit.point,
    kind: 'node',
    label: `nœud ${hit.id}`,
    nodeId: hit.id,
    plane: ctx.plane,
    guides: [],
    ...directionLine(ctx, hit.point),
  }
}

/** Vue alignée : point où un segment traverse le plan de travail, s'il est sous le curseur. */
function crossingHit(ctx: Ctx, wp: ActivePlane): { seg: Segment; point: Vec3; px: number } | null {
  let best: { seg: Segment; point: Vec3; px: number } | null = null
  for (const seg of ctx.scene.segments.values()) {
    const [a, b] = ctx.scene.segmentEnds(seg)
    const da = dot(sub(a, wp.point), wp.normal)
    const db = dot(sub(b, wp.point), wp.normal)
    // Traversée franche : une extrémité dans le plan est déjà un nœud du plan.
    if (!((da < -1e-6 && db > 1e-6) || (da > 1e-6 && db < -1e-6))) continue
    const point = lerp(a, b, da / (da - db))
    const sp = ctx.view.project(point)
    if (!sp) continue
    const px = dist2(sp, ctx.view.cursor)
    if (px <= ctx.tol.nodePx && (!best || px < best.px)) best = { seg, point, px }
  }
  return best
}

/**
 * 2. Point sur un segment : milieu, ou point quelconque arrondi le long du segment.
 * En vue alignée : seulement les segments du plan de travail, ou le point où un segment le traverse.
 */
function snapSegment(ctx: Ctx): Snap | null {
  const wp = ctx.workPlane
  const inPlane = wp ? (seg: Segment) => ctx.scene.segmentEnds(seg).every((p) => onPlane(p, wp)) : undefined
  const hit = pickSegment(ctx.view, ctx.scene, ctx.tol.segmentPx, inPlane)
  const cross = wp ? crossingHit(ctx, wp) : null
  if (cross && (!hit || cross.px < hit.px)) {
    return {
      point: cross.point,
      kind: 'on-segment',
      label: `traversée de ${cross.seg.id}`,
      segmentId: cross.seg.id,
      plane: ctx.plane,
      guides: [],
      ...directionLine(ctx, cross.point),
    }
  }
  if (!hit) return null
  const { segment: seg, length } = hit
  const [a, b] = ctx.scene.segmentEnds(seg)
  const mid = lerp(a, b, 0.5)
  const midScreen = ctx.view.project(mid)
  const base = { plane: ctx.plane, guides: [] as Guide[] }
  if (midScreen && dist2(midScreen, ctx.view.cursor) <= ctx.tol.nodePx) {
    return { ...base, point: mid, kind: 'midpoint', label: `milieu de ${seg.id}`, segmentId: seg.id, ...directionLine(ctx, mid) }
  }
  const s = roundTo(hit.s, ctx.step)
  if (s <= 0 || s >= length) {
    const nodeId = s <= 0 ? seg.nodeA : seg.nodeB
    const point = s <= 0 ? a : b
    return { ...base, point, kind: 'node', label: `nœud ${nodeId}`, nodeId, ...directionLine(ctx, point) }
  }
  const point = lerp(a, b, s / length)
  return { ...base, point, kind: 'on-segment', label: `sur ${seg.id}`, segmentId: seg.id, ...directionLine(ctx, point) }
}

/** Écart angulaire (degrés, sans orientation) entre la direction visée à l'écran et une direction 3D depuis l'ancre. */
function screenAngle(ctx: Ctx, anchor: Vec3, dir: Vec3): number | null {
  const { view } = ctx
  const a = view.project(anchor)
  if (!a) return null
  const c = sub2(view.cursor, a)
  if (len2(c) < ctx.tol.minDirectionPx) return null
  // Longueur de sonde proportionnelle à la distance caméra, pour une projection stable.
  const probe = Math.max(1, dist(view.ray.origin, anchor) * 0.05)
  let b = view.project(add(anchor, scale(dir, probe)))
  if (!b) {
    b = view.project(add(anchor, scale(dir, -probe)))
    if (!b) return null
  }
  const d = sub2(b, a)
  // Direction presque dans l'axe de visée : pas de direction écran fiable.
  if (len2(d) < 2) return null
  const cos = Math.abs(dot2(c, d)) / (len2(c) * len2(d))
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI
}

/** Point d'une droite issue de l'ancre, le plus proche du rayon, à distance arrondie au pas. */
function pointOnLine(ctx: Ctx, line: Line): Vec3 | null {
  const c = closestOnLineToRay(line, ctx.view.ray)
  if (!c || c.rayT <= 0) return null
  const s = roundTo(c.s, ctx.step)
  return add(line.origin, scale(line.dir, s))
}

/** 3. Axe X, Y ou Z depuis le dernier nœud. */
function snapAxis(ctx: Ctx): Snap | null {
  if (!ctx.anchor) return null
  const anchor = ctx.anchor.point
  let best: { axis: Axis; angle: number } | null = null
  for (const axis of AXES) {
    // En vue alignée, un axe qui sort du plan de travail est exclu.
    if (ctx.workPlane && Math.abs(dot(AXIS_DIR[axis], ctx.workPlane.normal)) > 1e-6) continue
    const angle = screenAngle(ctx, anchor, AXIS_DIR[axis])
    if (angle !== null && angle <= ctx.tol.axisDeg && (!best || angle < best.angle)) best = { axis, angle }
  }
  if (!best) return null
  const line = { origin: anchor, dir: AXIS_DIR[best.axis] }
  const point = pointOnLine(ctx, line)
  if (!point || eq(point, anchor)) return null
  const label = `sur axe ${AXIS_LABEL[best.axis]}`
  return { point, kind: 'axis', label, axis: best.axis, line, lineLabel: label, plane: ctx.plane, guides: [] }
}

/** 4a. Parallèle à un segment existant (ou dans son prolongement s'il part de l'ancre). */
function snapParallel(ctx: Ctx): Snap | null {
  if (!ctx.anchor) return null
  const anchor = ctx.anchor.point
  let best: { seg: Segment; dir: Vec3; angle: number } | null = null
  for (const seg of ctx.scene.segments.values()) {
    const [a, b] = ctx.scene.segmentEnds(seg)
    const dir = normalize(sub(b, a))
    if (len(dir) === 0) continue
    // Les directions d'axes sont déjà couvertes par l'accrochage aux axes.
    if (dir.some((c) => Math.abs(c) > 1 - 1e-9)) continue
    if (ctx.workPlane && Math.abs(dot(dir, ctx.workPlane.normal)) > 1e-6) continue
    const angle = screenAngle(ctx, anchor, dir)
    if (angle !== null && angle <= ctx.tol.parallelDeg && (!best || angle < best.angle)) best = { seg, dir, angle }
  }
  if (!best) return null
  const line = { origin: anchor, dir: best.dir }
  const point = pointOnLine(ctx, line)
  if (!point || eq(point, anchor)) return null
  const [a, b] = ctx.scene.segmentEnds(best.seg)
  const touchesAnchor =
    ctx.anchor.nodeId !== undefined && (best.seg.nodeA === ctx.anchor.nodeId || best.seg.nodeB === ctx.anchor.nodeId)
  const kind = touchesAnchor ? 'extension' : 'parallel'
  const label = touchesAnchor ? `prolongement de ${best.seg.id}` : `parallèle à ${best.seg.id}`
  return { point, kind, label, line, lineLabel: label, plane: ctx.plane, guides: [{ from: a, to: b, color: 'ref' }] }
}

/** Droite d'intersection du plan actif et du plan {coordonnée axis = c}. */
function planeAxisLine(plane: ActivePlane, axis: Axis, c: number): Line | null {
  const n1 = plane.normal
  const n2 = AXIS_DIR[axis]
  const u = cross(n1, n2)
  if (len(u) < 1e-6) return null
  const d1 = dot(n1, plane.point)
  const d2 = c
  const n11 = dot(n1, n1)
  const n22 = dot(n2, n2)
  const n12 = dot(n1, n2)
  const det = n11 * n22 - n12 * n12
  const origin = add(scale(n1, (d1 * n22 - d2 * n12) / det), scale(n2, (d2 * n11 - d1 * n12) / det))
  return { origin, dir: normalize(u) }
}

/** Résout le système 3×3 des plans n_i · p = d_i (règle de Cramer). */
function solve3(n: [Vec3, Vec3, Vec3], d: [number, number, number]): Vec3 | null {
  const det = dot(n[0], cross(n[1], n[2]))
  if (Math.abs(det) < 1e-9) return null
  const p = add(
    add(scale(cross(n[1], n[2]), d[0]), scale(cross(n[2], n[0]), d[1])),
    scale(cross(n[0], n[1]), d[2]),
  )
  return scale(p, 1 / det)
}

/** 4b. Même coordonnée qu'un autre nœud, dans le plan actif (une ou deux coordonnées). */
function snapAlign(ctx: Ctx): Snap | null {
  const { plane, view } = ctx
  type Cand = { axis: Axis; nodeId: string; nodePos: Vec3; line: Line; point: Vec3; px: number }
  const bestPerAxis = new Map<Axis, Cand>()
  for (const n of ctx.scene.nodes.values()) {
    if (n.id === ctx.anchor?.nodeId) continue
    const np: Vec3 = [n.x, n.y, n.z]
    for (const axis of AXES) {
      const line = planeAxisLine(plane, axis, np[AXIS_INDEX[axis]])
      if (!line) continue
      const c = closestOnLineToRay(line, view.ray)
      if (!c || c.rayT <= 0) continue
      const s = view.project(c.point)
      if (!s) continue
      const px = dist2(s, view.cursor)
      const cur = bestPerAxis.get(axis)
      if (px <= ctx.tol.alignPx && (!cur || px < cur.px)) {
        bestPerAxis.set(axis, { axis, nodeId: n.id, nodePos: np, line, point: c.point, px })
      }
    }
  }
  const cands = [...bestPerAxis.values()].sort((a, b) => a.px - b.px)
  if (cands.length === 0) return null

  const label = (c: Cand) => `même ${AXIS_LABEL[c.axis]} que ${c.nodeId}`
  const guide = (c: Cand, to: Vec3): Guide => ({ from: c.nodePos, to, color: c.axis })

  // Deux alignements à la fois : intersection exacte.
  if (cands.length >= 2) {
    const [c1, c2] = cands
    const p = solve3(
      [plane.normal, AXIS_DIR[c1.axis], AXIS_DIR[c2.axis]],
      [dot(plane.normal, plane.point), c1.nodePos[AXIS_INDEX[c1.axis]], c2.nodePos[AXIS_INDEX[c2.axis]]],
    )
    if (p) {
      return {
        point: p,
        kind: 'align',
        label: `${label(c1)}, ${label(c2)}`,
        plane,
        guides: [guide(c1, p), guide(c2, p)],
        ...directionLine(ctx, p),
      }
    }
  }

  const c = cands[0]
  // Arrondi le long de la droite : coordonnée monde si la droite suit un axe, sinon depuis l'ancre.
  const axisIdx = c.line.dir.findIndex((x) => Math.abs(x) > 1 - 1e-9)
  let point: Vec3
  if (axisIdx >= 0) {
    const r = [...c.point]
    r[axisIdx] = roundTo(r[axisIdx], ctx.step)
    point = [r[0], r[1], r[2]]
  } else {
    const ref = projectOnLine(ctx.anchor?.point ?? c.line.origin, c.line)
    const s = roundTo(dot(sub(c.point, ref.point), c.line.dir), ctx.step)
    point = add(ref.point, scale(c.line.dir, s))
  }
  return {
    point,
    kind: 'align',
    label: label(c),
    plane,
    guides: [guide(c, point)],
    line: c.line,
    lineLabel: label(c),
  }
}

/** 5. Plan actif, avec repli sur le plan d'axes le plus face à la caméra s'il est vu par la tranche. */
function snapPlane(ctx: Ctx): Snap | null {
  const planes = [ctx.plane]
  if (ctx.plane.source !== 'camera') {
    planes.push(axisPlane(facingPlaneName(ctx.view.viewDir), ctx.plane.point, 'camera'))
  }
  for (const plane of planes) {
    // Plan vu presque par la tranche : l'intersection serait trop instable.
    if (Math.abs(dot(plane.normal, ctx.view.ray.dir)) < 0.05) continue
    const hit = intersectRayPlane(ctx.view.ray, plane)
    if (!hit) continue
    const point = roundInPlane(hit.point, plane, ctx.step)
    const label = planeLabel(plane) + (plane.source === 'forced' ? ' (Tab)' : plane.source === 'view' ? ' (vue)' : '')
    return { point, kind: 'plane', label, plane, guides: [], ...directionLine(ctx, point) }
  }
  return null
}

/** Droite ancre → point, que Shift fige pour garder la direction. */
function directionLine(ctx: Ctx, point: Vec3): { line?: Line; lineLabel?: string } {
  if (!ctx.anchor || eq(point, ctx.anchor.point)) return {}
  return { line: { origin: ctx.anchor.point, dir: normalize(sub(point, ctx.anchor.point)) }, lineLabel: 'direction figée' }
}

/** Placement sous verrou : la cascade est remplacée par la contrainte. */
function constrained(ctx: Ctx, c: Constraint): Snap | null {
  if (c.type === 'plane') {
    const plane = c.plane
    const ref = snapNode(ctx) ?? snapSegment(ctx)
    if (ref) {
      const d = dot(sub(ref.point, plane.point), plane.normal)
      const point = sub(ref.point, scale(plane.normal, d))
      return {
        point,
        kind: 'constraint',
        label: `${c.label} · aligné sur ${ref.label}`,
        plane,
        guides: d === 0 ? [] : [{ from: ref.point, to: point, color: 'ref' }],
      }
    }
    if (Math.abs(dot(plane.normal, ctx.view.ray.dir)) < 0.02) return null
    const hit = intersectRayPlane(ctx.view.ray, plane)
    if (!hit) return null
    return { point: roundInPlane(hit.point, plane, ctx.step), kind: 'constraint', label: c.label, plane, guides: [] }
  }

  const line = c.line
  const base = { kind: 'constraint' as const, plane: ctx.plane, line, lineLabel: c.label }
  // Survoler un nœud ou un segment projette sa position sur la droite verrouillée.
  const ref = snapNode(ctx) ?? snapSegment(ctx)
  if (ref && !(ref.nodeId && ref.nodeId === ctx.anchor?.nodeId)) {
    const point = projectOnLine(ref.point, line).point
    if (!eq(point, line.origin)) {
      const guides: Guide[] = eq(point, ref.point) ? [] : [{ from: ref.point, to: point, color: 'ref' }]
      return { ...base, point, label: `${c.label} · aligné sur ${ref.label}`, guides }
    }
  }
  const point = pointOnLine(ctx, line) ?? line.origin
  return { ...base, point, label: c.label, guides: [] }
}

/** Couleur d'axe, et réutilisation d'un nœud existant tombant exactement au même endroit. */
function finish(ctx: Ctx, snap: Snap): Snap {
  if (ctx.anchor && !snap.axis) {
    const d = normalize(sub(snap.point, ctx.anchor.point))
    const i = d.findIndex((c) => Math.abs(c) > 1 - 1e-9)
    if (i >= 0) snap.axis = AXES[i]
  }
  if (!snap.nodeId && !snap.segmentId) {
    for (const n of ctx.scene.nodes.values()) {
      if (eq([n.x, n.y, n.z], snap.point)) {
        snap.nodeId = n.id
        break
      }
    }
  }
  return snap
}

/** Point à une longueur exacte dans la direction visée (saisie au clavier). */
export function pointAtLength(anchor: Vec3, target: Vec3, length: number): Vec3 | null {
  const d = sub(target, anchor)
  if (len(d) < 1e-9 || !(length > 0)) return null
  return add(anchor, scale(normalize(d), length))
}

export const lineLabelForAxis = (axis: Axis): string => `axe ${AXIS_LABEL[axis]} verrouillé`
export const axisLine = (origin: Vec3, axis: Axis): Line => ({ origin, dir: AXIS_DIR[axis] })
