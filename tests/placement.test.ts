import { describe, expect, it } from 'vitest'
import {
  type PlacementInput,
  activePlane,
  axisLine,
  axisPlane,
  lineLabelForAxis,
  place,
  pointAtLength,
  roundInPlane,
} from '../src/lib/core/placement'
import { Scene } from '../src/lib/core/scene'
import { type Vec3, dist, dot, normalize, sub } from '../src/lib/core/vec'
import { makeCamera } from './camera'

const iso = makeCamera({ eye: [3000, -3000, 4000], target: [0, 0, 0] })

function input(over: Partial<PlacementInput> & Pick<PlacementInput, 'view'>): PlacementInput {
  return { scene: new Scene(), anchor: null, chain: [], forcedPlane: null, constraint: null, step: 10, ...over }
}

function expectPoint(p: Vec3 | undefined, q: Vec3, digits = 6) {
  expect(p).toBeDefined()
  for (let i = 0; i < 3; i++) expect(p![i]).toBeCloseTo(q[i], digits)
}

/** Scène avec une poutre N1 (0,0,0) – N2 (1000,0,0). */
function oneBeam() {
  const scene = new Scene()
  const a = scene.addNode([0, 0, 0])
  const b = scene.addNode([1000, 0, 0])
  scene.addSegment(a.id, b.id)
  return { scene, a, b }
}

describe('plan actif', () => {
  it('sans nœud, prend le plan XY en vue isométrique', () => {
    const p = activePlane([], normalize([-1, 1, -1]), null)
    expect(p.name).toBe('xy')
    expect(p.source).toBe('camera')
  })

  it('prend le plan d’axes le plus face à la caméra, passant par le dernier nœud', () => {
    const p = activePlane([[100, 200, 300]], [0, 1, -0.2], null)
    expect(p.name).toBe('xz')
    expect(p.point).toEqual([100, 200, 300])
  })

  it('prend le plan des 3 derniers nœuds', () => {
    const p = activePlane([[0, 0, 0], [1000, 0, 0], [1000, 0, 1000]], [0, 0, -1], null)
    expect(p.name).toBe('xz')
    expect(p.source).toBe('nodes')
  })

  it('accepte un plan oblique', () => {
    const p = activePlane([[0, 0, 0], [1000, 0, 0], [1000, 1000, 1000]], [0, 0, -1], null)
    expect(p.name).toBe('oblique')
    expect(Math.abs(dot(p.normal, normalize([0, -1, 1])))).toBeCloseTo(1)
  })

  it('ignore 3 nœuds alignés', () => {
    const p = activePlane([[0, 0, 0], [1000, 0, 0], [2000, 0, 0]], [0, 0, -1], null)
    expect(p.source).toBe('camera')
    expect(p.name).toBe('xy')
  })

  it('obéit au plan forcé par Tab', () => {
    const p = activePlane([[0, 0, 0], [1000, 0, 0], [1000, 0, 1000]], [0, 0, -1], 'yz')
    expect(p.name).toBe('yz')
    expect(p.source).toBe('forced')
    expect(p.point).toEqual([1000, 0, 1000])
  })
})

describe('arrondi à la grille', () => {
  it('arrondit les coordonnées monde dans un plan d’axes et garde la profondeur du plan', () => {
    const plane = axisPlane('xy', [3, 4, 123.4], 'camera')
    expect(roundInPlane([14, -26, 123.4], plane, 10)).toEqual([10, -30, 123.4])
  })

  it('arrondit dans le repère local d’un plan oblique', () => {
    const plane = activePlane([[0, 0, 0], [1000, 0, 0], [1000, 1000, 1000]], [0, 0, -1], null)
    const p = roundInPlane([1004, 503, 503], plane, 10)
    // Le point reste dans le plan…
    expect(dot(sub(p, plane.point), plane.normal)).toBeCloseTo(0)
    // … à une distance du dernier nœud multiple du pas le long de chaque axe du repère.
    const a = dot(sub(p, plane.point), plane.u)
    const b = dot(sub(p, plane.point), plane.v)
    expect(Math.abs(a / 10 - Math.round(a / 10))).toBeLessThan(1e-9)
    expect(Math.abs(b / 10 - Math.round(b / 10))).toBeLessThan(1e-9)
  })
})

describe('priorité 5 : plan actif', () => {
  it('pose le premier point sur le sol, arrondi au pas', () => {
    const snap = place(input({ view: iso.viewAt([123, 456, 0]) }))
    expect(snap?.kind).toBe('plane')
    expect(snap?.label).toBe('plan XY')
    expectPoint(snap?.point, [120, 460, 0])
  })

  it('suit le plan forcé par Tab', () => {
    const scene = new Scene()
    const n = scene.addNode([0, 0, 0])
    const snap = place(
      input({ view: iso.viewAt([-437, 0, 612]), scene, anchor: { point: [0, 0, 0], nodeId: n.id }, chain: [[0, 0, 0]], forcedPlane: 'xz' }),
    )
    expect(snap?.kind).toBe('plane')
    expect(snap?.label).toBe('plan XZ (Tab)')
    expectPoint(snap?.point, [-440, 0, 610])
  })

  it('se replie sur le plan face à la caméra si le plan actif est vu par la tranche', () => {
    const front = makeCamera({ eye: [500, -5000, 0], target: [500, 0, 0] })
    const scene = new Scene()
    const n1 = scene.addNode([0, 0, 0])
    const n2 = scene.addNode([1000, 0, 0])
    const n3 = scene.addNode([1000, 1000, 0])
    scene.addSegment(n1.id, n2.id)
    scene.addSegment(n2.id, n3.id)
    const snap = place(
      input({
        view: front.viewAt([1500, 1000, 700]),
        scene,
        anchor: { point: [1000, 1000, 0], nodeId: n3.id },
        chain: [[0, 0, 0], [1000, 0, 0], [1000, 1000, 0]],
      }),
    )
    expect(snap?.kind).toBe('plane')
    expect(snap?.plane.name).toBe('xz')
    expect(snap?.point[1]).toBeCloseTo(1000)
  })
})

describe('priorité 1 : nœud existant', () => {
  it('accroche un nœud dans la tolérance en pixels', () => {
    const { scene, b } = oneBeam()
    const snap = place(input({ view: iso.viewAt([1000, 0, 0], [6, -5]), scene }))
    expect(snap?.kind).toBe('node')
    expect(snap?.nodeId).toBe(b.id)
    expectPoint(snap?.point, [1000, 0, 0])
  })

  it('passe avant le segment', () => {
    const { scene, a } = oneBeam()
    const snap = place(input({ view: iso.viewAt([0, 0, 0], [8, 0]), scene }))
    expect(snap?.nodeId).toBe(a.id)
  })
})

describe('priorité 2 : point sur un segment', () => {
  it('accroche le milieu', () => {
    const { scene } = oneBeam()
    const snap = place(input({ view: iso.viewAt([500, 0, 0], [4, 3]), scene }))
    expect(snap?.kind).toBe('midpoint')
    expect(snap?.label).toBe('milieu de S1')
    expect(snap?.segmentId).toBe('S1')
    expectPoint(snap?.point, [500, 0, 0])
  })

  it('accroche un point quelconque à une distance arrondie au pas', () => {
    const { scene } = oneBeam()
    const snap = place(input({ view: iso.viewAt([237, 0, 0], [0, 2]), scene }))
    expect(snap?.kind).toBe('on-segment')
    expect(snap?.segmentId).toBe('S1')
    expectPoint(snap?.point, [240, 0, 0], 3)
  })
})

describe('priorité 3 : axes depuis le dernier nœud', () => {
  it('trace une verticale à la souris : profondeur = point de l’axe le plus proche du rayon', () => {
    const scene = new Scene()
    const n = scene.addNode([500, 500, 0])
    const anchor = { point: [500, 500, 0] as Vec3, nodeId: n.id }
    // Curseur au-dessus du nœud à l'écran, avec un léger écart latéral.
    const snap = place(input({ view: iso.viewAt([500, 500, 734], [3, 0]), scene, anchor, chain: [anchor.point] }))
    expect(snap?.kind).toBe('axis')
    expect(snap?.axis).toBe('z')
    expect(snap?.label).toBe('sur axe Z')
    expect(snap?.point[0]).toBe(500)
    expect(snap?.point[1]).toBe(500)
    expect(snap?.point[2]).toBeGreaterThan(650)
    expect(snap?.point[2]).toBeLessThan(820)
    expect(snap!.point[2] % 10).toBe(0)
  })

  it('accroche l’axe X même hors du plan actif', () => {
    const scene = new Scene()
    const n = scene.addNode([0, 0, 1000])
    const anchor = { point: [0, 0, 1000] as Vec3, nodeId: n.id }
    const snap = place(input({ view: iso.viewAt([812, 0, 1000]), scene, anchor, chain: [anchor.point], forcedPlane: 'yz' }))
    expect(snap?.kind).toBe('axis')
    expectPoint(snap?.point, [810, 0, 1000], 6)
  })

  it('ne s’active pas loin de la direction de l’axe', () => {
    const scene = new Scene()
    const n = scene.addNode([0, 0, 0])
    const anchor = { point: [0, 0, 0] as Vec3, nodeId: n.id }
    const snap = place(input({ view: iso.viewAt([600, 400, 0]), scene, anchor, chain: [anchor.point] }))
    expect(snap?.kind).toBe('plane')
  })
})

describe('priorité 4 : guides d’alignement', () => {
  it('parallèle à un segment existant', () => {
    const scene = new Scene()
    const a = scene.addNode([0, 0, 0])
    const b = scene.addNode([1000, 1000, 0])
    scene.addSegment(a.id, b.id)
    const c = scene.addNode([2000, 0, 0])
    const anchor = { point: [2000, 0, 0] as Vec3, nodeId: c.id }
    const snap = place(input({ view: iso.viewAt([2503, 497, 0]), scene, anchor, chain: [anchor.point] }))
    expect(snap?.kind).toBe('parallel')
    expect(snap?.label).toBe('parallèle à S1')
    const d = sub(snap!.point, anchor.point)
    expect(d[0]).toBeCloseTo(d[1])
    expect(dist(snap!.point, anchor.point) % 10).toBeCloseTo(0)
    expect(snap?.guides).toHaveLength(1)
  })

  it('dans le prolongement du segment qui arrive au dernier nœud', () => {
    const scene = new Scene()
    const a = scene.addNode([0, 0, 0])
    const b = scene.addNode([1000, 1000, 0])
    scene.addSegment(a.id, b.id)
    const anchor = { point: [1000, 1000, 0] as Vec3, nodeId: b.id }
    const snap = place(input({ view: iso.viewAt([1500, 1500, 0], [2, 0]), scene, anchor, chain: [[0, 0, 0], anchor.point] }))
    expect(snap?.kind).toBe('extension')
    expect(snap?.label).toBe('prolongement de S1')
  })

  it('même coordonnée qu’un autre nœud', () => {
    const { scene, b } = oneBeam()
    const anchor = { point: [1000, 0, 0] as Vec3, nodeId: b.id }
    const snap = place(input({ view: iso.viewAt([2, 604, 0]), scene, anchor, chain: [anchor.point] }))
    expect(snap?.kind).toBe('align')
    expect(snap?.label).toBe('même X que N1')
    expectPoint(snap?.point, [0, 600, 0], 6)
    expect(snap?.guides[0].color).toBe('x')
  })

  it('deux alignements à la fois donnent l’intersection exacte', () => {
    const scene = new Scene()
    const a = scene.addNode([0, 0, 0])
    const b = scene.addNode([1000, 0, 0])
    const c = scene.addNode([1000, 800, 0])
    scene.addSegment(a.id, b.id)
    scene.addSegment(b.id, c.id)
    const snap = place(input({ view: iso.viewAt([3, 797, 0]), scene }))
    expect(snap?.kind).toBe('align')
    expectPoint(snap?.point, [0, 800, 0], 6)
    expect(snap?.guides).toHaveLength(2)
  })
})

describe('verrous', () => {
  it('l’axe verrouillé projette le nœud survolé sur l’axe', () => {
    const scene = new Scene()
    const n = scene.addNode([0, 0, 0])
    const far = scene.addNode([500, 800, 300])
    scene.addSegment(n.id, far.id)
    const anchor = { point: [0, 0, 0] as Vec3, nodeId: n.id }
    const snap = place(
      input({
        view: iso.viewAt([500, 800, 300]),
        scene,
        anchor,
        chain: [anchor.point],
        constraint: { type: 'line', line: axisLine([0, 0, 0], 'z'), label: lineLabelForAxis('z'), axis: 'z' },
      }),
    )
    expect(snap?.kind).toBe('constraint')
    expectPoint(snap?.point, [0, 0, 300])
    expect(snap?.axis).toBe('z')
    expect(snap?.label).toContain('axe Z verrouillé')
    expect(snap?.nodeId).toBeUndefined()
  })

  it('l’axe verrouillé suit le curseur même loin de l’axe', () => {
    const scene = new Scene()
    const n = scene.addNode([0, 0, 0])
    const anchor = { point: [0, 0, 0] as Vec3, nodeId: n.id }
    const snap = place(
      input({
        view: iso.viewAt([700, 600, 0]),
        scene,
        anchor,
        chain: [anchor.point],
        constraint: { type: 'line', line: axisLine([0, 0, 0], 'x'), label: lineLabelForAxis('x'), axis: 'x' },
      }),
    )
    expect(snap?.point[1]).toBe(0)
    expect(snap?.point[2]).toBe(0)
    expect(snap!.point[0]).toBeGreaterThan(0)
  })
})

describe('réutilisation et saisie', () => {
  it('réutilise un nœud qui tombe exactement au point calculé', () => {
    const scene = new Scene()
    const a = scene.addNode([100, 100, 0])
    const b = scene.addNode([100, 100, 1000])
    scene.addSegment(a.id, b.id)
    // Tolérances quasi nulles : seul l'arrondi au plan amène le point sur le nœud.
    const snap = place(
      input({
        view: iso.viewAt([100, 100, 0], [2, 0]),
        scene,
        step: 100,
        tolerances: { nodePx: 0.1, segmentPx: 0.1, alignPx: 0.1 },
      }),
    )
    expect(snap?.kind).toBe('plane')
    expect(snap?.nodeId).toBe(a.id)
  })

  it('pose un point à longueur exacte dans la direction visée', () => {
    expectPoint(pointAtLength([0, 0, 0], [0, 0, 37], 2500) ?? undefined, [0, 0, 2500])
    expect(pointAtLength([0, 0, 0], [0, 0, 0], 100)).toBeNull()
    expect(pointAtLength([0, 0, 0], [1, 0, 0], 0)).toBeNull()
  })
})
