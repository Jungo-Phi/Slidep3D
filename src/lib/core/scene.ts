import { type Vec3, cleanVec, eq } from './vec'

export interface SceneNode {
  id: string
  x: number
  y: number
  z: number
}

export interface Segment {
  id: string
  nodeA: string
  nodeB: string
}

export interface SceneJSON {
  format: 'slidep3d-proto'
  version: 1
  units: 'mm'
  nodes: SceneNode[]
  segments: Segment[]
}

export const nodePos = (n: SceneNode): Vec3 => [n.x, n.y, n.z]

/**
 * Ossature de nœuds et de segments. Un nœud partagé par plusieurs segments
 * est un seul nœud. La scène ne garde jamais de nœud isolé.
 */
export class Scene {
  readonly nodes = new Map<string, SceneNode>()
  readonly segments = new Map<string, Segment>()
  private nextNode = 1
  private nextSegment = 1

  node(id: string): SceneNode {
    const n = this.nodes.get(id)
    if (!n) throw new Error(`Nœud inconnu : ${id}`)
    return n
  }

  pos(id: string): Vec3 {
    return nodePos(this.node(id))
  }

  segmentEnds(s: Segment): [Vec3, Vec3] {
    return [this.pos(s.nodeA), this.pos(s.nodeB)]
  }

  addNode(p: Vec3): SceneNode {
    const [x, y, z] = cleanVec(p)
    const n = { id: `N${this.nextNode++}`, x, y, z }
    this.nodes.set(n.id, n)
    return n
  }

  findSegment(a: string, b: string): Segment | undefined {
    for (const s of this.segments.values()) {
      if ((s.nodeA === a && s.nodeB === b) || (s.nodeA === b && s.nodeB === a)) return s
    }
    return undefined
  }

  /** Crée le segment a–b. Renvoie le segment existant s'il y en a déjà un, null si a === b. */
  addSegment(a: string, b: string): Segment | null {
    if (a === b) return null
    this.node(a)
    this.node(b)
    const existing = this.findSegment(a, b)
    if (existing) return existing
    const s = { id: `S${this.nextSegment++}`, nodeA: a, nodeB: b }
    this.segments.set(s.id, s)
    return s
  }

  /**
   * Coupe un segment en deux avec un nouveau nœud en p.
   * La première moitié garde l'identifiant du segment d'origine.
   */
  splitSegment(segmentId: string, p: Vec3): SceneNode {
    const s = this.segments.get(segmentId)
    if (!s) throw new Error(`Segment inconnu : ${segmentId}`)
    const [a, b] = this.segmentEnds(s)
    if (eq(p, a)) return this.node(s.nodeA)
    if (eq(p, b)) return this.node(s.nodeB)
    const n = this.addNode(p)
    const oldB = s.nodeB
    s.nodeB = n.id
    this.addSegment(n.id, oldB)
    return n
  }

  segmentsOf(nodeId: string): Segment[] {
    return [...this.segments.values()].filter((s) => s.nodeA === nodeId || s.nodeB === nodeId)
  }

  moveNodes(ids: Iterable<string>, delta: Vec3): void {
    for (const id of ids) {
      const n = this.node(id)
      const [x, y, z] = cleanVec([n.x + delta[0], n.y + delta[1], n.z + delta[2]])
      n.x = x
      n.y = y
      n.z = z
    }
  }

  /** Supprime nœuds et segments ; les segments des nœuds supprimés et les nœuds devenus isolés partent aussi. */
  delete(nodeIds: Iterable<string>, segmentIds: Iterable<string>): void {
    const nodes = new Set(nodeIds)
    for (const id of segmentIds) this.segments.delete(id)
    for (const s of [...this.segments.values()]) {
      if (nodes.has(s.nodeA) || nodes.has(s.nodeB)) this.segments.delete(s.id)
    }
    for (const id of nodes) this.nodes.delete(id)
    this.removeOrphans()
  }

  removeOrphans(): void {
    const used = new Set<string>()
    for (const s of this.segments.values()) {
      used.add(s.nodeA)
      used.add(s.nodeB)
    }
    for (const id of [...this.nodes.keys()]) if (!used.has(id)) this.nodes.delete(id)
  }

  clear(): void {
    this.nodes.clear()
    this.segments.clear()
    this.nextNode = 1
    this.nextSegment = 1
  }

  toJSON(): SceneJSON {
    return {
      format: 'slidep3d-proto',
      version: 1,
      units: 'mm',
      nodes: [...this.nodes.values()].map((n) => ({ ...n })),
      segments: [...this.segments.values()].map((s) => ({ ...s })),
    }
  }

  static fromJSON(data: unknown): Scene {
    const d = data as Partial<SceneJSON>
    if (!d || d.format !== 'slidep3d-proto' || !Array.isArray(d.nodes) || !Array.isArray(d.segments)) {
      throw new Error("Ce fichier n'est pas une scène Slidep 3D.")
    }
    const scene = new Scene()
    let maxN = 0
    let maxS = 0
    for (const n of d.nodes) {
      if (typeof n.id !== 'string' || ![n.x, n.y, n.z].every(Number.isFinite)) {
        throw new Error(`Nœud invalide : ${JSON.stringify(n)}`)
      }
      scene.nodes.set(n.id, { id: n.id, x: n.x, y: n.y, z: n.z })
      maxN = Math.max(maxN, idNumber(n.id))
    }
    for (const s of d.segments) {
      if (!scene.nodes.has(s.nodeA) || !scene.nodes.has(s.nodeB) || s.nodeA === s.nodeB) {
        throw new Error(`Segment invalide : ${JSON.stringify(s)}`)
      }
      scene.segments.set(s.id, { id: s.id, nodeA: s.nodeA, nodeB: s.nodeB })
      maxS = Math.max(maxS, idNumber(s.id))
    }
    scene.nextNode = maxN + 1
    scene.nextSegment = maxS + 1
    return scene
  }

  clone(): Scene {
    return Scene.fromJSON(this.toJSON())
  }
}

function idNumber(id: string): number {
  const m = /(\d+)$/.exec(id)
  return m ? Number(m[1]) : 0
}

/** Annuler / rétablir par copies de la scène : simple et suffisant pour quelques centaines d'éléments. */
export class History {
  private past: SceneJSON[] = []
  private future: SceneJSON[] = []
  constructor(private readonly limit = 200) {}

  /** À appeler juste avant de modifier la scène. */
  record(scene: Scene): void {
    this.past.push(scene.toJSON())
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }

  /** Oublie le dernier `record`, quand la modification annoncée n'a finalement rien changé. */
  discardLast(): void {
    this.past.pop()
  }

  undo(current: Scene): Scene | null {
    const prev = this.past.pop()
    if (!prev) return null
    this.future.push(current.toJSON())
    return Scene.fromJSON(prev)
  }

  redo(current: Scene): Scene | null {
    const next = this.future.pop()
    if (!next) return null
    this.past.push(current.toJSON())
    return Scene.fromJSON(next)
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  clear(): void {
    this.past = []
    this.future = []
  }
}
