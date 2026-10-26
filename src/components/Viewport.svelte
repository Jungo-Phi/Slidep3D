<script lang="ts">
  // Vue 3D : affiche la scène et transmet les événements à l'éditeur et à la caméra.
  // Aucune logique de placement ici : tout passe par `Editor` et le module pur `core/placement`.
  import { T, useThrelte } from '@threlte/core'
  import { onDestroy } from 'svelte'
  import { Color, Vector3 } from 'three'
  import { boundsOf } from '../lib/core/pivot'
  import { DEFAULT_TOLERANCES, pickNode, pickSegment } from '../lib/core/placement'
  import { type Axis, type Vec2, type Vec3, AXES, AXIS_DIR, add, pointSegment2, scale } from '../lib/core/vec'
  import type { Editor } from '../lib/editor.svelte'
  import { CameraController, type Projection } from '../lib/three/cameraController'
  import { COLORS } from '../lib/three/colors'
  import { Grid } from '../lib/three/grid'
  import { Overlay, gizmoLength } from '../lib/three/overlay'
  import { SceneMeshes } from '../lib/three/sceneMeshes'
  import { makeView, projector } from '../lib/three/view'

  interface Props {
    editor: Editor
    projection: Projection
    controller?: CameraController
    oncamera?: (quaternion: [number, number, number, number]) => void
    /** Position écran du centre de la sélection (pour afficher ses coordonnées), null s'il n'y en a pas. */
    onselectionscreen?: (p: Vec2 | null) => void
  }

  let { editor, projection, controller = $bindable(), oncamera, onselectionscreen }: Props = $props()

  const { invalidate, canvas, scene: threeScene, size: canvasSize } = useThrelte()
  threeScene.background = new Color(COLORS.background)

  const grid = new Grid()
  const meshes = new SceneMeshes()
  const overlay = new Overlay()

  let lastCursor: Vec2 | null = null
  let down: { x: number; y: number; id: number } | null = null

  const size = () => ({ width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 })
  const viewAt = (cursor: Vec2) => {
    const { width, height } = size()
    return makeView(ctrl, width, height, cursor)
  }
  const cursorOf = (e: MouseEvent): Vec2 => {
    const r = canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  const ctrl = new CameraController(canvas, {
    hit(cursor) {
      const view = viewAt(cursor)
      const n = pickNode(view, editor.scene, DEFAULT_TOLERANCES.nodePx)
      if (n) return n.point
      const s = pickSegment(view, editor.scene, DEFAULT_TOLERANCES.segmentPx)
      return s ? s.point : null
    },
    bounds() {
      return boundsOf([...editor.scene.nodes.values()].map((n) => [n.x, n.y, n.z] as const))
    },
    onChange() {
      updateGrid()
      if (lastCursor && !ctrl.busy) editor.update(viewAt(lastCursor))
      drawOverlay()
      const q = ctrl.perspective.quaternion
      oncamera?.([q.x, q.y, q.z, q.w])
      invalidate()
    },
  })
  controller = ctrl
  const pixelSize = (p: Vec3) => ctrl.worldPerPixel(p)

  // Premier cadrage, une fois la taille du canevas connue.
  requestAnimationFrame(() => ctrl.resetHome())

  $effect(() => ctrl.setProjection(projection))

  // Redimensionnement : Threlte recalcule le cadre des caméras, on réapplique la pose.
  $effect(() =>
    canvasSize.subscribe(() => {
      ctrl.sync()
      drawOverlay()
      invalidate()
    }),
  )

  /** La grille suit le plan de travail : il passe par le dernier nœud de la chaîne, sinon par l'origine. */
  function updateGrid() {
    grid.update(ctrl.perspective, ctrl.focusDist, editor.tool === 'beam' ? editor.anchor?.point : undefined)
  }

  $effect(() => {
    updateGrid()
    invalidate()
  })

  function gizmoHit(cursor: Vec2): Axis | null {
    const c = editor.tool === 'select' ? editor.gizmoCenter : null
    if (!c) return null
    const { width, height } = size()
    const project = projector(ctrl.camera, width, height)
    const a = project(c)
    if (!a) return null
    const length = gizmoLength(pixelSize, c)
    let best: { axis: Axis; d: number } | null = null
    for (const axis of AXES) {
      const b = project(add(c, scale(AXIS_DIR[axis], length)))
      if (!b) continue
      const { d, t } = pointSegment2(cursor, a, b)
      if (d < 10 && t > 0.12 && (!best || d < best.d)) best = { axis, d }
    }
    return best?.axis ?? null
  }

  function drawOverlay() {
    const center = editor.tool === 'select' ? editor.gizmoCenter : null
    overlay.update(
      {
        anchor: editor.tool === 'beam' ? (editor.anchor?.point ?? null) : null,
        target: editor.tool === 'beam' ? editor.target : null,
        snap: editor.tool === 'beam' ? editor.snap : null,
        typed: editor.typedLength !== null,
        gizmo: center
          ? { center, hover: editor.gizmoHover, active: editor.dragDelta?.axis ?? null }
          : null,
        pivot: ctrl.orbitCenter,
        eye:
          ctrl.projection === 'perspective'
            ? {
                position: ctrl.perspective.position.toArray(),
                forward: ctrl.perspective.getWorldDirection(new Vector3()).toArray(),
              }
            : null,
      },
      pixelSize,
    )
    const { width, height } = size()
    onselectionscreen?.(center ? projector(ctrl.camera, width, height)(center) : null)
  }

  // Événements souris -------------------------------------------------------

  function onPointerDown(e: PointerEvent) {
    const cursor = cursorOf(e)
    lastCursor = cursor
    if (ctrl.pointerDown(e, cursor)) return
    if (e.button !== 0) return
    const axis = gizmoHit(cursor)
    if (axis && editor.startDrag(axis, viewAt(cursor))) {
      canvas.setPointerCapture(e.pointerId)
      return
    }
    down = { x: cursor[0], y: cursor[1], id: e.pointerId }
  }

  function onPointerMove(e: PointerEvent) {
    const cursor = cursorOf(e)
    lastCursor = cursor
    if (ctrl.pointerMove(e, cursor)) {
      // Le tracé reste actif pendant qu'on tourne : on recalcule l'accrochage sous le curseur.
      editor.update(viewAt(cursor))
      return
    }
    if (!editor.dragging) editor.gizmoHover = gizmoHit(cursor)
    editor.pointerMove(viewAt(cursor))
  }

  function onPointerUp(e: PointerEvent) {
    const cursor = cursorOf(e)
    if (ctrl.pointerUp(e)) {
      editor.update(viewAt(cursor))
      return
    }
    if (editor.dragging) {
      editor.endDrag()
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      return
    }
    if (down && down.id === e.pointerId && Math.hypot(cursor[0] - down.x, cursor[1] - down.y) < 5) {
      editor.click(viewAt(cursor), e.shiftKey)
    }
    down = null
  }

  function onDoubleClick() {
    if (editor.tool === 'beam') editor.endChain()
  }

  function onWheel(e: WheelEvent) {
    const cursor = cursorOf(e)
    lastCursor = cursor
    ctrl.wheelEvent(e, cursor)
  }

  function onLeave() {
    lastCursor = null
    editor.pointerLeave()
  }

  const preventMenu = (e: Event) => e.preventDefault()
  // Empêche le défilement automatique du navigateur au clic molette.
  const preventMiddle = (e: MouseEvent) => e.button === 1 && e.preventDefault()

  $effect(() => {
    canvas.style.touchAction = 'none'
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('dblclick', onDoubleClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', preventMenu)
    canvas.addEventListener('mousedown', preventMiddle)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('dblclick', onDoubleClick)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', preventMenu)
      canvas.removeEventListener('mousedown', preventMiddle)
    }
  })

  // Rendu à la demande -------------------------------------------------------

  $effect(() => {
    void editor.version
    meshes.rebuild(editor.scene)
    invalidate()
  })

  $effect(() => {
    meshes.paint(editor.selection, editor.hover, new Set(editor.tool === 'select' ? editor.selectedNodeIds : []))
    invalidate()
  })

  $effect(() => {
    drawOverlay()
    invalidate()
  })

  onDestroy(() => {
    ctrl.dispose()
    meshes.dispose()
  })
</script>

{#if projection === 'orthographic'}
  <T is={ctrl.orthographic} makeDefault />
{:else}
  <T is={ctrl.perspective} makeDefault />
{/if}
<T.HemisphereLight args={['#ffffff', '#b8c0cc', 1.4]} />
<T.DirectionalLight position={[3000, -5000, 8000]} intensity={1.8} />
<T.DirectionalLight position={[-4000, 3000, 2000]} intensity={0.5} />
<T is={grid.object} />
<T is={meshes.object} />
<T is={overlay.object} />
