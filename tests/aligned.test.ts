import { describe, expect, it } from 'vitest'
import { type PlacementInput, alignedPlaneName, place } from '../src/lib/core/placement'
import { Scene } from '../src/lib/core/scene'
import { normalize } from '../src/lib/core/vec'
import { makeCamera } from './camera'

// Vue de face : la caméra regarde vers +Y, plan de travail XZ.
const front = makeCamera({ eye: [0, -8000, 500], target: [0, 0, 500] })

function input(over: Partial<PlacementInput> & Pick<PlacementInput, 'view'>): PlacementInput {
  return { scene: new Scene(), anchor: null, chain: [], forcedPlane: null, constraint: null, step: 10, ...over }
}

describe('vue alignée sur un plan', () => {
  it('détecte le plan face à la caméra, à 15° près', () => {
    expect(alignedPlaneName([0, 1, 0])).toBe('xz')
    expect(alignedPlaneName(normalize([0.2, 1, -0.1]))).toBe('xz')
    expect(alignedPlaneName([0, 0, -1])).toBe('xy')
    expect(alignedPlaneName(normalize([-1, 1, -1]))).toBeNull()
  })

  it('le plan de travail passe par l’origine sans chaîne', () => {
    const snap = place(input({ view: front.view([700, 300]) }))
    expect(snap?.kind).toBe('plane')
    expect(snap?.plane.source).toBe('view')
    expect(snap?.point[1]).toBeCloseTo(0)
  })

  it('le plan de travail passe par le dernier nœud', () => {
    const scene = new Scene()
    const a = scene.addNode([0, 650, 0])
    const b = scene.addNode([1000, 650, 0])
    scene.addSegment(a.id, b.id)
    const snap = place(input({ view: front.view([300, 200]), scene, anchor: { point: [0, 650, 0], nodeId: a.id }, chain: [[0, 650, 0]] }))
    expect(snap?.point[1]).toBeCloseTo(650)
  })

  it('ignore un nœud hors du plan', () => {
    const scene = new Scene()
    const a = scene.addNode([500, 800, 500])
    const b = scene.addNode([500, 800, 1500])
    scene.addSegment(a.id, b.id)
    const snap = place(input({ view: front.viewAt([500, 800, 500]), scene }))
    expect(snap?.nodeId).toBeUndefined()
    expect(snap?.point[1]).toBeCloseTo(0)
  })

  it('s’accroche à un nœud du plan', () => {
    const scene = new Scene()
    const a = scene.addNode([500, 0, 500])
    const b = scene.addNode([500, 900, 500])
    scene.addSegment(a.id, b.id)
    const snap = place(input({ view: front.viewAt([500, 0, 500]), scene }))
    expect(snap?.nodeId).toBe(a.id)
  })

  it('s’accroche au point où un segment traverse le plan', () => {
    const scene = new Scene()
    const a = scene.addNode([400, -1000, 300])
    const b = scene.addNode([600, 1000, 700])
    scene.addSegment(a.id, b.id)
    const snap = place(input({ view: front.viewAt([500, 0, 500]), scene }))
    expect(snap?.kind).toBe('on-segment')
    expect(snap?.segmentId).toBe('S1')
    expect(snap?.label).toContain('traversée')
    expect(snap?.point[0]).toBeCloseTo(500)
    expect(snap?.point[1]).toBeCloseTo(0)
    expect(snap?.point[2]).toBeCloseTo(500)
  })

  it('un plan forcé par Tab l’emporte sur la vue', () => {
    const snap = place(input({ view: front.view([700, 300]), forcedPlane: 'xy' }))
    expect(snap?.plane.source).not.toBe('view')
  })
})
