import { describe, expect, it } from 'vitest'
import { Editor } from '../src/lib/editor.svelte'

const editor = () => new Editor(false)

describe('chaîne de poutres', () => {
  it('chaque point posé prolonge la chaîne', () => {
    const e = editor()
    e.commitPoint([0, 0, 0], {})
    e.commitPoint([1000, 0, 0], {})
    e.commitPoint([1000, 0, 1000], {})
    expect(e.scene.segments.size).toBe(2)
    expect(e.anchor?.point).toEqual([1000, 0, 1000])
  })

  it('arriver sur un nœud existant termine la chaîne', () => {
    const e = editor()
    e.commitPoint([0, 0, 0], {})
    e.commitPoint([1000, 0, 0], {})
    e.commitPoint([1000, 1000, 0], {})
    e.commitPoint([0, 0, 0], { nodeId: 'N1' })
    expect(e.scene.segments.size).toBe(3)
    expect(e.scene.nodes.size).toBe(3)
    expect(e.anchor).toBeNull()
    expect(e.tool).toBe('beam')
  })

  it('un nœud existant atteint par sa position (longueur tapée) termine aussi la chaîne', () => {
    const e = editor()
    e.commitPoint([0, 0, 0], {})
    e.commitPoint([1000, 0, 0], {})
    e.commitPoint([0, 0, 0], {})
    expect(e.anchor).toBeNull()
  })

  it('commencer sur un nœud existant ne termine pas la chaîne', () => {
    const e = editor()
    e.commitPoint([0, 0, 0], {})
    e.commitPoint([1000, 0, 0], {})
    e.endChain()
    e.commitPoint([1000, 0, 0], { nodeId: 'N2' })
    e.commitPoint([1000, 0, 500], {})
    expect(e.anchor?.point).toEqual([1000, 0, 500])
  })

  it('couper un segment crée un nœud nouveau : la chaîne continue', () => {
    const e = editor()
    e.commitPoint([0, 0, 0], {})
    e.commitPoint([1000, 0, 0], {})
    e.endChain()
    e.commitPoint([500, 0, 500], {})
    e.commitPoint([500, 0, 0], { segmentId: 'S1' })
    expect(e.scene.segments.size).toBe(3)
    expect(e.anchor?.point).toEqual([500, 0, 0])
  })
})

describe('Échap', () => {
  it('quitte la chaîne, puis passe en sélection, puis vide la sélection', () => {
    const e = editor()
    e.commitPoint([0, 0, 0], {})
    e.commitPoint([1000, 0, 0], {})
    e.typed = '25'
    e.escape()
    expect(e.anchor).toBeNull()
    expect(e.typed).toBe('')
    expect(e.tool).toBe('beam')
    e.escape()
    expect(e.tool).toBe('select')
    e.selection = { nodes: new Set(['N1']), segments: new Set() }
    e.escape()
    expect(e.selection.nodes.size).toBe(0)
  })
})

describe('coordonnées de la sélection', () => {
  it('un nœud seul prend la coordonnée saisie', () => {
    const e = editor()
    e.commitPoint([0, 0, 0], {})
    e.commitPoint([1000, 0, 0], {})
    e.selection = { nodes: new Set(['N2']), segments: new Set() }
    e.setSelectionCoord('z', 750)
    expect(e.scene.pos('N2')).toEqual([1000, 0, 750])
    e.undo()
    expect(e.scene.pos('N2')).toEqual([1000, 0, 0])
  })

  it('plusieurs nœuds se déplacent ensemble, leur centre prend la coordonnée', () => {
    const e = editor()
    e.commitPoint([0, 0, 0], {})
    e.commitPoint([1000, 0, 0], {})
    e.selection = { nodes: new Set(), segments: new Set(['S1']) }
    e.setSelectionCoord('x', 0)
    expect(e.scene.pos('N1')).toEqual([-500, 0, 0])
    expect(e.scene.pos('N2')).toEqual([500, 0, 0])
  })
})

describe('passage en Poutre', () => {
  it('avec un nœud sélectionné, démarre la chaîne sur ce nœud', () => {
    const e = editor()
    e.commitPoint([0, 0, 0], {})
    e.commitPoint([1000, 0, 0], {})
    e.setTool('select')
    e.selection = { nodes: new Set(['N2']), segments: new Set() }
    e.setTool('beam')
    expect(e.anchor).toEqual({ point: [1000, 0, 0], nodeId: 'N2' })
    e.commitPoint([1000, 0, 800], {})
    expect(e.scene.findSegment('N2', 'N3')).toBeDefined()
  })

  it('sans sélection, commence à la première étape', () => {
    const e = editor()
    e.setTool('select')
    e.setTool('beam')
    expect(e.anchor).toBeNull()
  })
})

describe('point de traversée', () => {
  it('poser un point où un segment traverse le plan coupe ce segment', () => {
    const e = editor()
    e.commitPoint([400, -1000, 300], {})
    e.commitPoint([600, 1000, 700], {})
    e.endChain()
    e.commitPoint([0, 0, 0], {})
    e.commitPoint([500, 0, 500], { segmentId: 'S1' })
    expect(e.scene.segments.size).toBe(3)
    expect(e.scene.nodes.size).toBe(4)
  })
})
