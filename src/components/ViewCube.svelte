<script lang="ts">
  // Cube d'orientation en CSS 3D, synchronisé avec la caméra. Cube chanfreiné : 6 faces, 12 arêtes
  // et 8 coins, chacun cliquable pour regarder la scène depuis sa direction (26 vues).
  // Les coins, petits, ont une zone de clic élargie calculée à l'écran, sans changer le chanfrein.
  // Clic droit glissé sur le cube : orbite de la vue.
  import { Matrix4, Quaternion } from 'three'
  import type { Vec3 } from '../lib/core/vec'

  interface Props {
    /** Orientation de la caméra (x, y, z, w). */
    quaternion: readonly [number, number, number, number]
    /** Direction de visée demandée (de la caméra vers la scène). */
    onview: (dir: Vec3) => void
    onorbitstart: () => void
    onorbit: (dx: number, dy: number) => void
    onorbitend: () => void
  }

  let { quaternion, onview, onorbitstart, onorbit, onorbitend }: Props = $props()

  /**
   * Cube de demi-côté H, chanfreiné : arêtes coupées sur une largeur C, coins coupés plus profond (D)
   * pour être faciles à viser. Les faces deviennent des octogones, les coins des hexagones ;
   * la largeur des arêtes ne dépend que de C. Dimensions en pixels.
   */
  const H = 36
  const C = 12
  const D = 6

  type V = [number, number, number]
  const norm = (v: V): V => {
    const l = Math.hypot(...v)
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  const crossV = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dotV = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  interface Piece {
    key: string
    kind: 'face' | 'edge' | 'corner'
    label?: string
    /** Direction extérieure : la caméra regarde dans la direction opposée. */
    n: V
    /** Centre du polygone, coordonnées monde. */
    center: V
    style: string
  }

  /**
   * Polygone plan donné par ses sommets (coordonnées monde, Z en haut) → div CSS 3D découpé.
   * `u` : axe x du div (sens de lecture du texte) ; y = u × n vers le bas, car le repère CSS est indirect.
   */
  function piece(key: string, kind: Piece['kind'], verts: V[], n: V, u: V, label?: string): Piece {
    const c: V = [0, 1, 2].map((i) => verts.reduce((s, v) => s + v[i], 0) / verts.length) as V
    const v = crossV(u, n)
    const local = verts.map((p) => {
      const d: V = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
      return [dotV(d, u), dotV(d, v)]
    })
    const r = Math.max(...local.flat().map(Math.abs))
    const clip = local.map(([x, y]) => `${(x + r).toFixed(2)}px ${(y + r).toFixed(2)}px`).join(', ')
    const m = [...u, 0, ...v, 0, ...n, 0, ...c, 1].map((x) => +x.toFixed(4))
    return {
      key,
      kind,
      label,
      n,
      center: c,
      style: `width:${2 * r}px;height:${2 * r}px;margin:${-r}px 0 0 ${-r}px;transform:matrix3d(${m.join(',')});clip-path:polygon(${clip})`,
    }
  }

  const AX: V[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const scaleV = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s]
  const addV = (...vs: V[]): V => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0] as V)

  /** Plan de coupe : points p tels que n·p ≤ d. */
  interface Cut {
    key: string
    kind: Piece['kind']
    n: V
    d: number
    /** Axe x du div (sens de lecture du texte des faces). */
    u: V
    label?: string
  }

  function cuts(): Cut[] {
    const out: Cut[] = []
    const faces: { label: string; n: V; u: V }[] = [
      { label: 'Dessus', n: [0, 0, 1], u: [1, 0, 0] },
      { label: 'Dessous', n: [0, 0, -1], u: [1, 0, 0] },
      { label: 'Face', n: [0, -1, 0], u: [1, 0, 0] },
      { label: 'Arrière', n: [0, 1, 0], u: [-1, 0, 0] },
      { label: 'Droite', n: [1, 0, 0], u: [0, 1, 0] },
      { label: 'Gauche', n: [-1, 0, 0], u: [0, -1, 0] },
    ]
    for (const f of faces) out.push({ key: f.label, kind: 'face', n: f.n, d: H, u: f.u, label: f.label })
    // Arêtes : plans à 45° entre deux faces, coupant chacune sur une largeur C.
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        for (const si of [-1, 1]) {
          for (const sj of [-1, 1]) {
            const n = norm(addV(scaleV(AX[i], si), scaleV(AX[j], sj)))
            out.push({ key: `e${i}${si}${j}${sj}`, kind: 'edge', n, d: (2 * H - C) / Math.SQRT2, u: AX[3 - i - j] })
          }
        }
      }
    }
    // Coins : plans perpendiculaires aux diagonales, plus profonds que le chanfrein des arêtes.
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const n = norm([sx, sy, sz])
          out.push({ key: `c${sx}${sy}${sz}`, kind: 'corner', n, d: (3 * H - 2 * C - D) / Math.sqrt(3), u: norm(crossV([0, 0, 1], n)) })
        }
      }
    }
    return out
  }

  /** Polygone d'un plan de coupe : grand carré dans le plan, découpé par tous les autres (Sutherland–Hodgman). */
  function polygon(c: Cut, all: Cut[]): V[] {
    const v = crossV(c.u, c.n)
    const center = scaleV(c.n, c.d)
    let poly: V[] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) => addV(center, scaleV(c.u, a * 3 * H), scaleV(v, b * 3 * H)))
    for (const o of all) {
      if (o === c) continue
      const side = (p: V) => dotV(p, o.n) - o.d
      const next: V[] = []
      poly.forEach((p, i) => {
        const q = poly[(i + 1) % poly.length]
        const sp = side(p)
        const sq = side(q)
        if (sp <= 1e-9) next.push(p)
        if ((sp < -1e-9 && sq > 1e-9) || (sp > 1e-9 && sq < -1e-9)) {
          const t = sp / (sp - sq)
          next.push(addV(p, scaleV(addV(q, scaleV(p, -1)), t)))
        }
      })
      poly = next
    }
    return poly
  }

  function buildPieces(): Piece[] {
    const all = cuts()
    return all.map((c) => piece(c.key, c.kind, polygon(c, all), c.n, c.u, c.label))
  }

  const pieces = buildPieces()
  const byKey = new Map(pieces.map((p) => [p.key, p]))
  const corners = pieces.filter((p) => p.kind === 'corner')

  /** Rayon de la zone de clic des coins, en pixels écran autour du coin. */
  const CORNER_HIT_PX = 10

  // Monde → écran CSS : rotation inverse de la caméra, puis Y inversé (le Y CSS va vers le bas).
  const cubeMatrix = $derived.by(() => {
    const m = new Matrix4().makeRotationFromQuaternion(new Quaternion(...quaternion)).invert()
    return m.premultiply(new Matrix4().makeScale(1, -1, 1))
  })
  const cubeTransform = $derived(`matrix3d(${cubeMatrix.elements.map((x) => x.toFixed(6)).join(',')})`)

  const viewOf = (p: Piece): Vec3 => [-p.n[0], -p.n[1], -p.n[2]]

  let root: HTMLDivElement
  let hovered = $state<string | null>(null)
  let drag: { x: number; y: number } | null = null

  /** Pièce sous le pointeur : un coin proche à l'écran d'abord, sinon la face ou l'arête touchée. */
  function pickKey(e: PointerEvent): string | null {
    const r = root.getBoundingClientRect()
    const px = e.clientX - (r.left + r.width / 2)
    const py = e.clientY - (r.top + r.height / 2)
    const m = cubeMatrix.elements
    let best: { key: string; score: number } | null = null
    for (const c of corners) {
      // Centre de l'hexagone du coin projeté à l'écran ; nz > 0 : tourné vers l'utilisateur.
      const [x, y, z] = c.center
      const sx = m[0] * x + m[4] * y + m[8] * z
      const sy = m[1] * x + m[5] * y + m[9] * z
      const nz = m[2] * c.n[0] + m[6] * c.n[1] + m[10] * c.n[2]
      if (nz < -0.25) continue
      const d = Math.hypot(sx - px, sy - py)
      // À distance égale, on préfère le coin le plus tourné vers l'utilisateur.
      const score = d - 8 * nz
      if (d <= CORNER_HIT_PX && (!best || score < best.score)) best = { key: c.key, score }
    }
    if (best) return best.key
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')
    return el?.dataset.key ?? null
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button === 2) {
      drag = { x: e.clientX, y: e.clientY }
      hovered = null
      root.setPointerCapture(e.pointerId)
      onorbitstart()
      e.preventDefault()
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (drag) {
      onorbit(e.clientX - drag.x, e.clientY - drag.y)
      drag = { x: e.clientX, y: e.clientY }
      return
    }
    hovered = pickKey(e)
  }

  function onPointerUp(e: PointerEvent) {
    if (drag) {
      drag = null
      if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId)
      onorbitend()
      return
    }
    if (e.button !== 0) return
    const p = byKey.get(pickKey(e) ?? '')
    if (p) onview(viewOf(p))
  }
</script>

<div
  class="viewcube"
  bind:this={root}
  style:cursor={hovered ? 'pointer' : 'default'}
  style:width="{H * 3.4}px"
  style:height="{H * 3.4}px"
  role="toolbar"
  tabindex="-1"
  aria-label="Cube d'orientation : clic pour choisir une vue, clic droit glissé pour tourner"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onpointerleave={() => (hovered = null)}
  oncontextmenu={(e) => e.preventDefault()}
>
  <div class="cube" style:transform={cubeTransform}>
    {#each pieces as p (p.key)}
      <div
        class="piece {p.kind}"
        class:hovered={hovered === p.key}
        data-key={p.key}
        style={p.style}
        title={p.label ? `Vue ${p.label.toLowerCase()}` : undefined}
      >
        {p.label ?? ''}
      </div>
    {/each}
    <div class="axis x"></div>
    <div class="axis y"></div>
    <div class="axis z"></div>
  </div>
</div>

<style>
  .viewcube {
    position: relative;
  }
  .cube {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0;
    height: 0;
    transform-style: preserve-3d;
  }
  .piece {
    position: absolute;
    left: 0;
    top: 0;
    padding: 0;
    border: none;
    color: #334155;
    font: 600 11px system-ui, sans-serif;
    backface-visibility: hidden;
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .face {
    background: #f1f5f9;
    box-shadow: inset 0 0 0 1px #94a3b8;
  }
  .edge {
    background: #cbd5e1;
  }
  .corner {
    background: #94a3b8;
  }
  .piece.hovered {
    background: #fbbf24;
  }
  /* Repère partant du coin (−X, −Y, −Z) du cube. Coordonnées monde dans .cube. */
  .axis {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    pointer-events: none;
  }
  .axis.x {
    width: 96px;
    height: 3px;
    background: #e5484d;
    transform: translate3d(-34px, -34px, -34px);
  }
  .axis.y {
    width: 3px;
    height: 96px;
    background: #30a46c;
    transform: translate3d(-34px, -34px, -34px);
  }
  .axis.z {
    width: 3px;
    height: 96px;
    background: #3e63dd;
    transform: translate3d(-34px, -34px, -34px) rotateX(90deg);
  }
</style>
