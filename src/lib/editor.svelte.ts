// État de l'éditeur : relie les événements (souris, clavier) au module de placement et à la scène.
// Aucune dépendance à Three.js : les composants fournissent une `View` construite depuis la caméra.

import {
  type Anchor,
  type Constraint,
  type PlaneName,
  type Snap,
  type View,
  DEFAULT_TOLERANCES,
  PLANE_NAMES,
  axisLine,
  lineLabelForAxis,
  pickNode,
  pickSegment,
  place,
  planeLabel,
  pointAtLength,
} from './core/placement'
import { History, Scene } from './core/scene'
import {
  type Axis,
  type Vec2,
  type Vec3,
  AXIS_DIR,
  AXIS_INDEX,
  add,
  cleanVec,
  closestOnLineToRay,
  dist,
  eq,
  roundTo,
  scale,
  sub,
} from './core/vec'

/** Pas de la grille et des positions, en mm. */
export const STEP = 10
const STORAGE_KEY = 'slidep3d-proto/scene'

export type Tool = 'beam' | 'select'
export interface Selection {
  nodes: ReadonlySet<string>
  segments: ReadonlySet<string>
}
export type Hover = { kind: 'node' | 'segment'; id: string } | null

const EMPTY_SELECTION: Selection = { nodes: new Set(), segments: new Set() }

interface Drag {
  axis: Axis
  ids: string[]
  line: { origin: Vec3; dir: Vec3 }
  startS: number
  applied: number
}

export class Editor {
  scene = new Scene()
  private history = new History()

  /** Incrémenté à chaque modification de la scène. */
  version = $state(0)
  canUndo = $state(false)
  canRedo = $state(false)

  tool = $state<Tool>('beam')
  /** Dernier point de la chaîne en cours. */
  anchor = $state.raw<Anchor | null>(null)
  /** Points de la chaîne en cours, le dernier étant l'ancre. */
  chain = $state.raw<Vec3[]>([])
  /** Segment sous le premier point, coupé seulement quand le deuxième point est posé. */
  private firstSegment: string | undefined

  forcedPlane = $state<PlaneName | null>(null)
  axisLock = $state<Axis | null>(null)
  /** Inférence figée par Shift. */
  frozen = $state.raw<Constraint | null>(null)
  snap = $state.raw<Snap | null>(null)
  /** Longueur tapée au clavier, en mm. */
  typed = $state('')
  cursor = $state.raw<Vec2 | null>(null)

  selection = $state.raw<Selection>(EMPTY_SELECTION)
  hover = $state.raw<Hover>(null)
  gizmoHover = $state<Axis | null>(null)
  dragging = $state(false)
  message = $state('')

  private view: View | null = null
  private drag: Drag | null = null

  constructor(restore = true) {
    if (restore && typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        try {
          this.scene = Scene.fromJSON(JSON.parse(saved))
        } catch {
          localStorage.removeItem(STORAGE_KEY)
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Dérivés

  get constraint(): Constraint | null {
    if (this.axisLock && this.anchor) {
      return {
        type: 'line',
        line: axisLine(this.anchor.point, this.axisLock),
        label: lineLabelForAxis(this.axisLock),
        axis: this.axisLock,
      }
    }
    return this.frozen
  }

  get typedLength(): number | null {
    const v = Number(this.typed.replace(',', '.'))
    return this.typed !== '' && Number.isFinite(v) && v > 0 ? v : null
  }

  /** Point que posera le prochain clic (ou Entrée si une longueur est tapée). */
  get target(): Vec3 | null {
    if (!this.snap) return null
    const l = this.typedLength
    if (l !== null && this.anchor) return pointAtLength(this.anchor.point, this.snap.point, l) ?? this.snap.point
    return this.snap.point
  }

  /** Nœuds concernés par la sélection (ceux des segments sélectionnés compris). */
  get selectedNodeIds(): string[] {
    void this.version
    const ids = new Set(this.selection.nodes)
    for (const id of this.selection.segments) {
      const s = this.scene.segments.get(id)
      if (s) {
        ids.add(s.nodeA)
        ids.add(s.nodeB)
      }
    }
    return [...ids].filter((id) => this.scene.nodes.has(id))
  }

  /** Centre du gizmo de déplacement. */
  get gizmoCenter(): Vec3 | null {
    const ids = this.selectedNodeIds
    if (ids.length === 0) return null
    let c: Vec3 = [0, 0, 0]
    for (const id of ids) c = add(c, this.scene.pos(id))
    return scale(c, 1 / ids.length)
  }

  // -------------------------------------------------------------------------
  // Souris

  pointerMove(view: View): void {
    this.view = view
    this.cursor = view.cursor
    if (this.drag) this.dragMove(view)
    else this.update()
  }

  pointerLeave(): void {
    if (this.drag) return
    this.view = null
    this.cursor = null
    this.snap = null
    this.hover = null
  }

  /** Recalcule l'accrochage avec la dernière vue (après un mouvement de caméra ou un changement d'état). */
  update(view: View | null = this.view): void {
    this.view = view
    if (!view) return
    if (this.tool === 'beam') {
      this.snap = place({
        view,
        scene: this.scene,
        anchor: this.anchor,
        chain: this.chain,
        forcedPlane: this.forcedPlane,
        constraint: this.constraint,
        step: STEP,
      })
      const s = this.snap
      this.hover = s?.nodeId ? { kind: 'node', id: s.nodeId } : s?.segmentId ? { kind: 'segment', id: s.segmentId } : null
    } else {
      this.snap = null
      this.hover = this.pick(view)
    }
  }

  pick(view: View): Hover {
    const n = pickNode(view, this.scene, DEFAULT_TOLERANCES.nodePx)
    if (n) return { kind: 'node', id: n.id }
    const s = pickSegment(view, this.scene, DEFAULT_TOLERANCES.segmentPx)
    if (s) return { kind: 'segment', id: s.segment.id }
    return null
  }

  click(view: View, shift: boolean): void {
    this.update(view)
    if (this.tool === 'beam') {
      const target = this.target
      if (!target || !this.snap) return
      const exact = this.typedLength === null
      this.commitPoint(target, exact ? this.snap : {})
      return
    }
    const hit = this.hover
    if (!hit) {
      if (!shift) this.selection = EMPTY_SELECTION
      return
    }
    const nodes = new Set(shift ? this.selection.nodes : [])
    const segments = new Set(shift ? this.selection.segments : [])
    const set = hit.kind === 'node' ? nodes : segments
    if (shift && set.has(hit.id)) set.delete(hit.id)
    else set.add(hit.id)
    this.selection = { nodes, segments }
  }

  // -------------------------------------------------------------------------
  // Tracé

  /**
   * Pose un point de la chaîne. Le premier point n'est créé qu'avec le deuxième (pas de nœud isolé).
   * Arriver sur un nœud existant termine la chaîne : on revient à la première étape.
   */
  commitPoint(p: Vec3, hint: { nodeId?: string; segmentId?: string }): void {
    p = cleanVec(p)
    const anchor = this.anchor
    if (anchor && eq(p, anchor.point)) return
    if (!anchor) {
      this.anchor = { point: p, nodeId: hint.nodeId }
      this.firstSegment = hint.segmentId
      this.chain = [p]
    } else {
      const onExisting = this.nodeAt(p, hint.nodeId) !== null
      let bId = ''
      this.mutate(() => {
        const aId = anchor.nodeId ?? this.materialize(anchor.point, this.firstSegment)
        bId = this.materialize(p, hint.segmentId, hint.nodeId)
        this.scene.addSegment(aId, bId)
      })
      if (onExisting) {
        this.endChain()
        return
      }
      this.anchor = { point: this.scene.pos(bId), nodeId: bId }
      this.firstSegment = undefined
      this.chain = [...this.chain, this.anchor.point].slice(-8)
    }
    this.typed = ''
    this.axisLock = null
    this.frozen = null
    this.update()
  }

  /** Nœud existant désigné par l'accrochage, ou situé exactement en p. */
  private nodeAt(p: Vec3, nodeId?: string): string | null {
    if (nodeId && this.scene.nodes.has(nodeId)) return nodeId
    for (const n of this.scene.nodes.values()) if (eq([n.x, n.y, n.z], p)) return n.id
    return null
  }

  /** Nœud au point p : existant, sur un segment (coupé en deux), ou nouveau. */
  private materialize(p: Vec3, segmentId?: string, nodeId?: string): string {
    const existing = this.nodeAt(p, nodeId)
    if (existing) return existing
    // Après une première coupe, le segment visé peut avoir changé d'identifiant : on cherche celui qui porte p.
    const hinted = segmentId ? this.scene.segments.get(segmentId) : undefined
    const candidates = hinted ? [hinted, ...this.scene.segments.values()] : [...this.scene.segments.values()]
    for (const s of candidates) {
      const [a, b] = this.scene.segmentEnds(s)
      const l = dist(a, b)
      if (l > 0 && Math.abs(dist(a, p) + dist(p, b) - l) < 1e-6) return this.scene.splitSegment(s.id, p).id
    }
    return this.scene.addNode(p).id
  }

  endChain(): void {
    this.anchor = null
    this.chain = []
    this.firstSegment = undefined
    this.typed = ''
    this.axisLock = null
    this.frozen = null
    this.update()
  }

  enterLength(): void {
    const target = this.target
    if (this.typedLength === null || !this.anchor || !target) return
    this.commitPoint(target, {})
  }

  typeChar(c: string): void {
    if (this.tool !== 'beam' || !this.anchor) return
    if (c === ',') c = '.'
    if (c === '.' && this.typed.includes('.')) return
    this.typed += c
  }

  backspace(): void {
    this.typed = this.typed.slice(0, -1)
  }

  toggleAxisLock(axis: Axis): void {
    if (this.tool !== 'beam') return
    this.axisLock = this.axisLock === axis ? null : axis
    this.frozen = null
    this.update()
  }

  /** Shift enfoncé : fige l'inférence en cours (sa droite, sinon son plan). */
  freeze(): void {
    if (this.tool !== 'beam' || this.frozen || this.axisLock || !this.snap) return
    const s = this.snap
    this.frozen = s.line
      ? { type: 'line', line: s.line, label: `${s.lineLabel ?? 'direction'} (Shift)`, axis: s.axis }
      : { type: 'plane', plane: s.plane, label: `${planeLabel(s.plane)} (Shift)` }
    this.update()
  }

  unfreeze(): void {
    if (!this.frozen) return
    this.frozen = null
    this.update()
  }

  /** Tab : plan automatique → XY → XZ → YZ → automatique. */
  cyclePlane(): void {
    const i = this.forcedPlane ? PLANE_NAMES.indexOf(this.forcedPlane) : -1
    this.forcedPlane = i + 1 < PLANE_NAMES.length ? PLANE_NAMES[i + 1] : null
    this.update()
  }

  /** Échap : quitte la chaîne en cours (retour à la première étape), puis passe en sélection, puis vide la sélection. */
  escape(): void {
    if (this.anchor) this.endChain()
    else if (this.tool === 'beam') this.setTool('select')
    else this.selection = EMPTY_SELECTION
    this.update()
  }

  /** Changement d'outil. Passer en Poutre avec un seul nœud sélectionné démarre la chaîne sur ce nœud (2ᵉ étape). */
  setTool(tool: Tool): void {
    if (this.tool === tool) return
    const { nodes, segments } = this.selection
    const startNode = tool === 'beam' && nodes.size === 1 && segments.size === 0 ? [...nodes][0] : null
    this.endChain()
    this.tool = tool
    if (startNode && this.scene.nodes.has(startNode)) {
      const point = this.scene.pos(startNode)
      this.anchor = { point, nodeId: startNode }
      this.chain = [point]
      this.selection = EMPTY_SELECTION
    }
    this.update()
  }

  // -------------------------------------------------------------------------
  // Édition

  deleteSelection(): void {
    const { nodes, segments } = this.selection
    if (nodes.size === 0 && segments.size === 0) return
    this.mutate(() => this.scene.delete(nodes, segments))
    this.selection = EMPTY_SELECTION
    this.update()
  }

  /**
   * Coordonnée saisie pour la sélection : un nœud seul prend la valeur ; plusieurs nœuds
   * sont déplacés ensemble pour que leur centre la prenne.
   */
  setSelectionCoord(axis: Axis, value: number): void {
    const center = this.gizmoCenter
    if (!center || !Number.isFinite(value)) return
    const delta = value - center[AXIS_INDEX[axis]]
    if (Math.abs(delta) < 1e-9) return
    const ids = this.selectedNodeIds
    this.mutate(() => this.scene.moveNodes(ids, scale(AXIS_DIR[axis], delta)))
    this.update()
  }

  /** Début du déplacement au gizmo, le long d'un axe, par pas de la grille. */
  startDrag(axis: Axis, view: View): boolean {
    const origin = this.gizmoCenter
    if (!origin) return false
    const line = { origin, dir: AXIS_DIR[axis] }
    const c = closestOnLineToRay(line, view.ray)
    if (!c) return false
    this.history.record(this.scene)
    this.drag = { axis, ids: this.selectedNodeIds, line, startS: c.s, applied: 0 }
    this.dragging = true
    return true
  }

  private dragMove(view: View): void {
    const d = this.drag!
    const c = closestOnLineToRay(d.line, view.ray)
    if (!c) return
    const s = roundTo(c.s - d.startS, STEP)
    if (s === d.applied) return
    this.scene.moveNodes(d.ids, scale(AXIS_DIR[d.axis], s - d.applied))
    d.applied = s
    this.changed()
  }

  endDrag(): void {
    if (!this.drag) return
    // Déplacement nul : on retire l'entrée d'historique inutile.
    if (this.drag.applied === 0) this.history.discardLast()
    this.drag = null
    this.dragging = false
    this.changed()
  }

  /** Longueur du déplacement en cours, pour l'affichage. */
  get dragDelta(): { axis: Axis; mm: number } | null {
    void this.version
    return this.drag ? { axis: this.drag.axis, mm: this.drag.applied } : null
  }

  undo(): void {
    const s = this.history.undo(this.scene)
    if (s) this.replaceScene(s)
  }

  redo(): void {
    const s = this.history.redo(this.scene)
    if (s) this.replaceScene(s)
  }

  private replaceScene(s: Scene): void {
    this.scene = s
    this.endChain()
    const nodes = new Set([...this.selection.nodes].filter((id) => s.nodes.has(id)))
    const segments = new Set([...this.selection.segments].filter((id) => s.segments.has(id)))
    this.selection = { nodes, segments }
    this.changed()
    this.update()
  }

  newScene(): void {
    if (this.scene.nodes.size === 0) return
    this.mutate(() => this.scene.clear())
    this.endChain()
    this.selection = EMPTY_SELECTION
  }

  toJSONString(): string {
    return JSON.stringify(this.scene.toJSON(), null, 2)
  }

  load(text: string): boolean {
    let s: Scene
    try {
      s = Scene.fromJSON(JSON.parse(text))
    } catch (e) {
      this.message = e instanceof Error ? e.message : String(e)
      return false
    }
    this.history.record(this.scene)
    this.selection = EMPTY_SELECTION
    this.replaceScene(s)
    this.message = ''
    return true
  }

  private mutate(fn: () => void): void {
    this.history.record(this.scene)
    fn()
    this.changed()
  }

  private changed(): void {
    this.version++
    this.canUndo = this.history.canUndo
    this.canRedo = this.history.canRedo
    if (!this.drag && typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.scene.toJSON()))
    }
  }

  /** Longueur affichée de la ligne en cours. */
  get currentLength(): number | null {
    const t = this.target
    return this.anchor && t ? dist(this.anchor.point, t) : null
  }

  /** Vecteur de la ligne en cours, pour l'affichage. */
  get currentVector(): Vec3 | null {
    const t = this.target
    return this.anchor && t ? sub(t, this.anchor.point) : null
  }
}
