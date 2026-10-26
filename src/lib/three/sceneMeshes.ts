// Poutres (tubes carrés) et nœuds (sphères) en InstancedMesh : un seul appel de rendu chacun,
// pour rester fluide avec des centaines de segments.

import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import type { Scene } from '../core/scene'
import type { Hover, Selection } from '../editor.svelte'
import { COLORS } from './colors'

/** Côté du tube carré, en mm. */
export const BEAM_SIZE = 24
export const NODE_RADIUS = 22

const tmpM = new Matrix4()
const tmpColor = new Color()
const X = new Vector3()
const Y = new Vector3()
const Zv = new Vector3()
const P = new Vector3()

export class SceneMeshes {
  readonly object = new Group()
  private beams: InstancedMesh
  private nodes: InstancedMesh
  private beamIds: string[] = []
  private nodeIds: string[] = []

  constructor() {
    this.object.name = 'scene'
    this.beams = this.makeBeams(256)
    this.nodes = this.makeNodes(256)
  }

  private makeBeams(capacity: number): InstancedMesh {
    const m = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.15 }),
      capacity,
    )
    m.instanceMatrix.setUsage(DynamicDrawUsage)
    // Crée l'attribut de couleur dès le départ, pour que le shader en tienne compte.
    m.setColorAt(0, tmpColor.set('#ffffff'))
    m.count = 0
    m.frustumCulled = false
    this.object.add(m)
    return m
  }

  private makeNodes(capacity: number): InstancedMesh {
    const m = new InstancedMesh(
      new SphereGeometry(1, 20, 14),
      new MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0.1 }),
      capacity,
    )
    m.instanceMatrix.setUsage(DynamicDrawUsage)
    // Crée l'attribut de couleur dès le départ, pour que le shader en tienne compte.
    m.setColorAt(0, tmpColor.set('#ffffff'))
    m.count = 0
    m.frustumCulled = false
    this.object.add(m)
    return m
  }

  /** Agrandit un InstancedMesh si la scène dépasse sa capacité. */
  private ensure(kind: 'beams' | 'nodes', n: number): void {
    const cur = this[kind]
    if (n <= cur.instanceMatrix.count) return
    let cap = cur.instanceMatrix.count
    while (cap < n) cap *= 2
    this.object.remove(cur)
    cur.geometry.dispose()
    ;(cur.material as MeshStandardMaterial).dispose()
    cur.dispose()
    this[kind] = kind === 'beams' ? this.makeBeams(cap) : this.makeNodes(cap)
  }

  /** Reconstruit les matrices d'instances après une modification de la scène. */
  rebuild(scene: Scene): void {
    this.ensure('beams', scene.segments.size)
    this.ensure('nodes', scene.nodes.size)

    this.beamIds = []
    let i = 0
    for (const s of scene.segments.values()) {
      const [a, b] = scene.segmentEnds(s)
      X.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      const length = X.length()
      X.normalize()
      // Roulis stable : une face du tube regarde vers le haut, ou vers +Y pour une poutre verticale.
      Zv.set(0, 0, 1)
      if (Math.abs(X.z) > 0.999) Zv.set(0, 1, 0)
      Y.crossVectors(Zv, X).normalize()
      Zv.crossVectors(X, Y)
      tmpM.makeBasis(
        X.multiplyScalar(length),
        Y.multiplyScalar(BEAM_SIZE),
        Zv.multiplyScalar(BEAM_SIZE),
      )
      P.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
      tmpM.setPosition(P)
      this.beams.setMatrixAt(i, tmpM)
      this.beamIds.push(s.id)
      i++
    }
    this.beams.count = i
    this.beams.instanceMatrix.needsUpdate = true

    this.nodeIds = []
    i = 0
    for (const n of scene.nodes.values()) {
      tmpM.makeScale(NODE_RADIUS, NODE_RADIUS, NODE_RADIUS).setPosition(n.x, n.y, n.z)
      this.nodes.setMatrixAt(i, tmpM)
      this.nodeIds.push(n.id)
      i++
    }
    this.nodes.count = i
    this.nodes.instanceMatrix.needsUpdate = true
  }

  /** Couleurs de survol et de sélection. */
  paint(selection: Selection, hover: Hover, selectedNodes: ReadonlySet<string>): void {
    const pick = (kind: 'node' | 'segment', id: string, selected: boolean, base: string) =>
      hover && hover.kind === kind && hover.id === id ? COLORS.hover : selected ? COLORS.selected : base
    this.beamIds.forEach((id, i) => {
      this.beams.setColorAt(i, tmpColor.set(pick('segment', id, selection.segments.has(id), COLORS.beam)))
    })
    this.nodeIds.forEach((id, i) => {
      this.nodes.setColorAt(i, tmpColor.set(pick('node', id, selectedNodes.has(id), COLORS.node)))
    })
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true
    if (this.nodes.instanceColor) this.nodes.instanceColor.needsUpdate = true
  }

  dispose(): void {
    for (const m of [this.beams, this.nodes]) {
      m.geometry.dispose()
      ;(m.material as MeshStandardMaterial).dispose()
      m.dispose()
    }
  }
}
