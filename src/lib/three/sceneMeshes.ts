// Poutres (tubes carrés) et nœuds (sphères) en InstancedMesh : un seul appel de rendu chacun,
// pour rester fluide avec des centaines de segments.

import {
  BackSide,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { Scene } from '../core/scene'
import type { Hover, Selection } from '../editor.svelte'
import { COLORS, THEME } from './colors'

/** Côté du tube carré, en mm. */
export const BEAM_SIZE = 24
export const NODE_RADIUS = 22
/** Épaisseur du trait de bord, en px écran : le trait standard de Slidep. */
export const EDGE_WIDTH = 1.5
/** Épaisseur du trait d'un élément survolé : le survol épaissit le trait au lieu de recolorer le corps, comme dans Slidep. */
export const HOVER_EDGE_WIDTH = 3

/** Les 12 arêtes du cube unité centré, en paires d'indices de coins (coin i : bit 0 → x, bit 1 → y, bit 2 → z). */
const CUBE_EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
]
/** Coordonnées par poutre dans le tableau des arêtes : 12 arêtes de 2 points de 3 coordonnées. */
const EDGE_FLOATS = CUBE_EDGES.length * 6
const CORNERS = Array.from({ length: 8 }, () => new Vector3())

const tmpM = new Matrix4()
const tmpColor = new Color()
const X = new Vector3()
const Y = new Vector3()
const Zv = new Vector3()
const P = new Vector3()

// Contour des nœuds : une sphère un peu plus grande, vue de l'intérieur (faces arrière seules),
// qui dépasse de la silhouette d'une épaisseur fixe en px, `aWidth` × `uPx`.
const hullVertex = /* glsl */ `
  attribute float aWidth;
  uniform float uPx;
  void main() {
    vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float radius = length(instanceMatrix[0].xyz);
    vec3 p = center + normalize(position) * (radius + aWidth * uPx);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
  }
`
const hullFragment = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
    #include <colorspace_fragment>
  }
`

export class SceneMeshes {
  readonly object = new Group()
  private beams: InstancedMesh
  private nodes: InstancedMesh
  private hull: InstancedMesh<SphereGeometry, ShaderMaterial>
  /** Trait de bord des poutres, à l'encre, comme le contour des corps dans Slidep. */
  private edges = this.makeEdges(EDGE_WIDTH)
  /** Trait épaissi de la poutre survolée, par-dessus le trait normal. */
  private hoverEdges = this.makeEdges(HOVER_EDGE_WIDTH)
  private edgePositions: number[] = []
  private beamIds: string[] = []
  private nodeIds: string[] = []
  /** Taille d'un pixel écran en mm (vue orthographique : la même partout). */
  private px = 1
  /** Derniers arguments de `paint`, réappliqués après `rebuild` : les indices d'instances ont pu changer. */
  private painted: Parameters<SceneMeshes['paint']> | null = null

  constructor() {
    this.object.name = 'scene'
    this.beams = this.makeBeams(256)
    ;[this.nodes, this.hull] = this.makeNodes(256)
  }

  private makeEdges(width: number): LineSegments2 {
    const l = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: THEME.ink, linewidth: width }))
    l.frustumCulled = false
    l.visible = false
    this.object.add(l)
    return l
  }

  private makeBeams(capacity: number): InstancedMesh {
    const m = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      // Faces repoussées en profondeur : le trait de bord, posé exactement sur les arêtes, passe devant sans scintiller.
      new MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.55,
        metalness: 0.15,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
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

  private makeNodes(capacity: number): [InstancedMesh, InstancedMesh<SphereGeometry, ShaderMaterial>] {
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

    const hullGeometry = new SphereGeometry(1, 32, 20)
    const widths = new InstancedBufferAttribute(new Float32Array(capacity).fill(EDGE_WIDTH), 1)
    widths.setUsage(DynamicDrawUsage)
    hullGeometry.setAttribute('aWidth', widths)
    const hull = new InstancedMesh(
      hullGeometry,
      new ShaderMaterial({
        vertexShader: hullVertex,
        fragmentShader: hullFragment,
        side: BackSide,
        uniforms: { uPx: { value: this.px }, uColor: { value: new Color(THEME.ink) } },
      }),
      capacity,
    )
    // Mêmes matrices que les nœuds : le contour les suit sans recopie.
    hull.instanceMatrix = m.instanceMatrix
    hull.count = 0
    hull.frustumCulled = false
    this.object.add(m, hull)
    return [m, hull]
  }

  /** Agrandit un InstancedMesh si la scène dépasse sa capacité. */
  private ensure(kind: 'beams' | 'nodes', n: number): void {
    const cur = this[kind]
    if (n <= cur.instanceMatrix.count) return
    let cap = cur.instanceMatrix.count
    while (cap < n) cap *= 2
    const old = kind === 'beams' ? [cur] : [cur, this.hull]
    for (const m of old) {
      this.object.remove(m)
      m.geometry.dispose()
      ;(m.material as MeshStandardMaterial | ShaderMaterial).dispose()
      m.dispose()
    }
    if (kind === 'beams') this.beams = this.makeBeams(cap)
    else [this.nodes, this.hull] = this.makeNodes(cap)
  }

  /** À appeler à chaque mouvement de caméra : garde le contour des nœuds à épaisseur constante à l'écran. */
  setPixelSize(px: number): void {
    this.px = px
    this.hull.material.uniforms.uPx.value = px
  }

  /** Reconstruit les matrices d'instances après une modification de la scène. */
  rebuild(scene: Scene): void {
    this.ensure('beams', scene.segments.size)
    this.ensure('nodes', scene.nodes.size)

    this.beamIds = []
    const edges: number[] = []
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
      CORNERS.forEach((c, k) => c.set((k & 1) - 0.5, ((k >> 1) & 1) - 0.5, ((k >> 2) & 1) - 0.5).applyMatrix4(tmpM))
      for (const [e0, e1] of CUBE_EDGES) edges.push(...CORNERS[e0].toArray(), ...CORNERS[e1].toArray())
      this.beamIds.push(s.id)
      i++
    }
    this.beams.count = i
    this.beams.instanceMatrix.needsUpdate = true
    this.edgePositions = edges
    this.setEdges(this.edges, edges)

    this.nodeIds = []
    i = 0
    for (const n of scene.nodes.values()) {
      tmpM.makeScale(NODE_RADIUS, NODE_RADIUS, NODE_RADIUS).setPosition(n.x, n.y, n.z)
      this.nodes.setMatrixAt(i, tmpM)
      this.nodeIds.push(n.id)
      i++
    }
    this.nodes.count = i
    this.hull.count = i
    this.nodes.instanceMatrix.needsUpdate = true
    if (this.painted) this.paint(...this.painted)
  }

  /** Géométrie neuve à chaque fois : `setPositions` alloue de nouveaux tampons sans libérer les anciens. */
  private setEdges(line: LineSegments2, positions: number[]): void {
    line.geometry.dispose()
    line.geometry = new LineSegmentsGeometry()
    if (positions.length) line.geometry.setPositions(positions)
    line.visible = positions.length > 0
  }

  /** Couleurs de sélection, et trait épaissi de l'élément survolé. */
  paint(selection: Selection, hover: Hover, selectedNodes: ReadonlySet<string>): void {
    this.painted = [selection, hover, selectedNodes]
    const hovered = (kind: 'node' | 'segment', id: string) => hover?.kind === kind && hover.id === id
    let hoveredBeam = -1
    this.beamIds.forEach((id, i) => {
      if (hovered('segment', id)) hoveredBeam = i
      this.beams.setColorAt(i, tmpColor.set(selection.segments.has(id) ? COLORS.selected : COLORS.beam))
    })
    const widths = this.hull.geometry.getAttribute('aWidth') as InstancedBufferAttribute
    this.nodeIds.forEach((id, i) => {
      this.nodes.setColorAt(i, tmpColor.set(selectedNodes.has(id) ? COLORS.selected : COLORS.node))
      widths.setX(i, hovered('node', id) ? HOVER_EDGE_WIDTH : EDGE_WIDTH)
    })
    widths.needsUpdate = true
    this.setEdges(
      this.hoverEdges,
      hoveredBeam < 0 ? [] : this.edgePositions.slice(hoveredBeam * EDGE_FLOATS, (hoveredBeam + 1) * EDGE_FLOATS),
    )
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true
    if (this.nodes.instanceColor) this.nodes.instanceColor.needsUpdate = true
  }

  dispose(): void {
    for (const m of [this.beams, this.nodes, this.hull]) {
      m.geometry.dispose()
      ;(m.material as MeshStandardMaterial | ShaderMaterial).dispose()
      m.dispose()
    }
    for (const l of [this.edges, this.hoverEdges]) {
      l.geometry.dispose()
      l.material.dispose()
    }
  }
}
