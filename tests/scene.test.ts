import { describe, expect, it } from 'vitest'
import { History, Scene } from '../src/lib/core/scene'

describe('scène', () => {
  it('partage un nœud entre plusieurs segments', () => {
    const s = new Scene()
    const a = s.addNode([0, 0, 0])
    const b = s.addNode([1000, 0, 0])
    const c = s.addNode([0, 1000, 0])
    s.addSegment(a.id, b.id)
    s.addSegment(a.id, c.id)
    expect(s.nodes.size).toBe(3)
    expect(s.segmentsOf(a.id)).toHaveLength(2)
  })

  it('refuse les doublons et les segments de longueur nulle', () => {
    const s = new Scene()
    const a = s.addNode([0, 0, 0])
    const b = s.addNode([1000, 0, 0])
    const s1 = s.addSegment(a.id, b.id)
    expect(s.addSegment(b.id, a.id)).toBe(s1)
    expect(s.addSegment(a.id, a.id)).toBeNull()
    expect(s.segments.size).toBe(1)
  })

  it('coupe un segment en deux', () => {
    const s = new Scene()
    const a = s.addNode([0, 0, 0])
    const b = s.addNode([1000, 0, 0])
    const seg = s.addSegment(a.id, b.id)!
    const m = s.splitSegment(seg.id, [500, 0, 0])
    expect(s.segments.size).toBe(2)
    expect(s.findSegment(a.id, m.id)?.id).toBe(seg.id)
    expect(s.findSegment(m.id, b.id)).toBeDefined()
    expect(s.findSegment(a.id, b.id)).toBeUndefined()
  })

  it('supprime un nœud avec ses segments, et les nœuds devenus isolés', () => {
    const s = new Scene()
    const a = s.addNode([0, 0, 0])
    const b = s.addNode([1000, 0, 0])
    const c = s.addNode([2000, 0, 0])
    s.addSegment(a.id, b.id)
    s.addSegment(b.id, c.id)
    s.delete([b.id], [])
    expect(s.segments.size).toBe(0)
    expect(s.nodes.size).toBe(0)
  })

  it('supprime un segment sans toucher aux nœuds encore utilisés', () => {
    const s = new Scene()
    const a = s.addNode([0, 0, 0])
    const b = s.addNode([1000, 0, 0])
    const c = s.addNode([2000, 0, 0])
    const s1 = s.addSegment(a.id, b.id)!
    s.addSegment(b.id, c.id)
    s.delete([], [s1.id])
    expect([...s.nodes.keys()].sort()).toEqual([b.id, c.id].sort())
  })

  it('déplace des nœuds sans résidus d’arrondi', () => {
    const s = new Scene()
    const a = s.addNode([0.1, 0.2, 0])
    s.moveNodes([a.id], [0.2, 0.1, -0])
    expect(s.pos(a.id)).toEqual([0.3, 0.3, 0])
  })

  it('se sauvegarde et se recharge en JSON, en reprenant la numérotation', () => {
    const s = new Scene()
    const a = s.addNode([0, 0, 0])
    const b = s.addNode([1000, 0, 2500])
    s.addSegment(a.id, b.id)
    const json = JSON.parse(JSON.stringify(s.toJSON()))
    const r = Scene.fromJSON(json)
    expect(r.toJSON()).toEqual(s.toJSON())
    expect(r.addNode([1, 2, 3]).id).toBe('N3')
  })

  it('refuse un fichier invalide', () => {
    expect(() => Scene.fromJSON({ foo: 1 })).toThrow()
    expect(() =>
      Scene.fromJSON({ format: 'slidep3d-proto', version: 1, units: 'mm', nodes: [], segments: [{ id: 'S1', nodeA: 'N1', nodeB: 'N2' }] }),
    ).toThrow()
  })
})

describe('historique', () => {
  it('annule et rétablit', () => {
    const h = new History()
    let s = new Scene()
    h.record(s)
    const a = s.addNode([0, 0, 0])
    const b = s.addNode([1000, 0, 0])
    s.addSegment(a.id, b.id)
    expect(h.canUndo).toBe(true)
    s = h.undo(s)!
    expect(s.segments.size).toBe(0)
    expect(h.canRedo).toBe(true)
    s = h.redo(s)!
    expect(s.segments.size).toBe(1)
    expect(h.redo(s)).toBeNull()
  })

  it('une nouvelle action efface le rétablissement', () => {
    const h = new History()
    let s = new Scene()
    h.record(s)
    s.addNode([0, 0, 0])
    s = h.undo(s)!
    h.record(s)
    expect(h.canRedo).toBe(false)
  })
})
