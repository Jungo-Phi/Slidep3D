<script lang="ts">
  import { Canvas } from '@threlte/core'
  import { NoToneMapping } from 'three'
  import Viewport from './components/Viewport.svelte'
  import ViewCube from './components/ViewCube.svelte'
  import { planeLabel } from './lib/core/placement'
  import type { Axis, Vec2, Vec3 } from './lib/core/vec'
  import { Editor, STEP, type Tool } from './lib/editor.svelte'
  import type { CameraController, Projection } from './lib/three/cameraController'
  import { AXIS_COLORS } from './lib/three/colors'

  const editor = new Editor()
  let controller = $state<CameraController>()
  let camQuat = $state<[number, number, number, number]>([0, 0, 0, 1])
  let projection = $state<Projection>('orthographic')
  let showHelp = $state(false)
  let selectionScreen = $state.raw<Vec2 | null>(null)
  let fileInput: HTMLInputElement

  const onCamera = (q: [number, number, number, number]) => (camQuat = q)

  const viewFrom = (dir: Vec3) => controller?.viewFrom(dir)
  const frame = () => controller?.frame()
  const home = () => controller?.home()
  const toggleProjection = () => (projection = projection === 'perspective' ? 'orthographic' : 'perspective')
  const counts = $derived.by(() => {
    void editor.version
    return { nodes: editor.scene.nodes.size, segments: editor.scene.segments.size }
  })

  const fmt = (x: number) => (Math.round(x * 10) / 10).toLocaleString('fr-FR')
  /** Nombre pour un champ de saisie : sans séparateur de milliers, virgule décimale. */
  const numText = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',')

  function applyCoord(axis: Axis, input: HTMLInputElement, current: number) {
    const v = Number(input.value.trim().replace(',', '.').replace(/\s/g, ''))
    if (input.value.trim() !== '' && Number.isFinite(v)) editor.setSelectionCoord(axis, v)
    else input.value = numText(current)
  }

  function coordKey(e: KeyboardEvent, current: number) {
    const input = e.currentTarget as HTMLInputElement
    if (e.key === 'Enter') input.blur()
    else if (e.key === 'Escape') {
      input.value = numText(current)
      input.blur()
    }
  }

  function save() {
    const blob = new Blob([editor.toJSONString()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'slidep3d-scene.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function open(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file && editor.load(await file.text())) requestAnimationFrame(() => controller?.frame())
  }

  const AXIS_KEYS: Record<string, Axis> = { KeyX: 'x', KeyY: 'y', KeyZ: 'z' }

  function onKeyDown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    const mod = e.ctrlKey || e.metaKey
    if (mod) {
      const k = e.key.toLowerCase()
      if (k === 'z') editor[e.shiftKey ? 'redo' : 'undo']()
      else if (k === 'y') editor.redo()
      else if (k === 's') save()
      else if (k === 'o') fileInput.click()
      else return
      e.preventDefault()
      return
    }
    if (e.key === 'Shift') {
      if (!e.repeat) editor.freeze()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      editor.cyclePlane()
      return
    }
    if (/^[0-9.,]$/.test(e.key)) {
      editor.typeChar(e.key)
      return
    }
    switch (e.key) {
      case 'Escape':
        editor.escape()
        return
      case 'Enter':
        editor.enterLength()
        return
      case 'Backspace':
        if (editor.typed) editor.backspace()
        else editor.deleteSelection()
        e.preventDefault()
        return
      case 'Delete':
        editor.deleteSelection()
        return
    }
    if (AXIS_KEYS[e.code]) {
      editor.toggleAxisLock(AXIS_KEYS[e.code])
      return
    }
    switch (e.code) {
      case 'KeyL':
      case 'KeyB':
        editor.setTool('beam')
        break
      case 'KeyV':
      case 'Space':
        editor.setTool('select')
        e.preventDefault()
        break
      case 'KeyF':
        frame()
        break
      case 'KeyH':
        home()
        break
      case 'KeyP':
        toggleProjection()
        break
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key === 'Shift') editor.unfreeze()
  }

  const tools: { id: Tool; label: string; key: string }[] = [
    { id: 'select', label: 'Sélection', key: 'V' },
    { id: 'beam', label: 'Poutre', key: 'L' },
  ]

  const lockLabel = $derived(
    editor.axisLock ? `axe ${editor.axisLock.toUpperCase()}` : editor.frozen ? editor.frozen.label : null,
  )
  const planeText = $derived(
    editor.snap
      ? planeLabel(editor.snap.plane) + (editor.forcedPlane ? ' (Tab)' : '')
      : editor.forcedPlane
        ? `plan ${editor.forcedPlane.toUpperCase()} (Tab)`
        : 'automatique',
  )
</script>

{#snippet coords(p: Vec3)}
  <div class="coords">
    {#each ['x', 'y', 'z'] as const as a, i (a)}
      <span><b style:color={AXIS_COLORS[a]}>{a.toUpperCase()}</b> {fmt(p[i])}</span>
    {/each}
  </div>
{/snippet}

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={() => editor.unfreeze()} />

<div class="app">
  <header class="toolbar">
    <strong class="brand">Slidep 3D <span>prototype</span></strong>
    <div class="group">
      {#each tools as t (t.id)}
        <button class:active={editor.tool === t.id} onclick={() => editor.setTool(t.id)} title="{t.label} ({t.key})">
          {t.label}
        </button>
      {/each}
    </div>
    <div class="group">
      <button
        onclick={() => editor.deleteSelection()}
        disabled={editor.selection.nodes.size + editor.selection.segments.size === 0}
        title="Supprimer (Suppr)">Supprimer</button
      >
    </div>
    <div class="group">
      <button onclick={() => editor.newScene()} title="Supprime tous les nœuds et segments (annulable)">Vider la scène</button>
      <!-- Ouverture et enregistrement JSON : au clavier seulement (Ctrl+O, Ctrl+S). -->
      <input bind:this={fileInput} type="file" accept=".json,application/json" hidden onchange={open} />
    </div>
    <div class="spacer"></div>
    <div class="group">
      <button onclick={() => editor.undo()} disabled={!editor.canUndo} title="Annuler (Ctrl+Z)">Annuler</button>
      <button onclick={() => editor.redo()} disabled={!editor.canRedo} title="Rétablir (Ctrl+Y)">Rétablir</button>
    </div>
    <button class:active={showHelp} onclick={() => (showHelp = !showHelp)}>Aide</button>
  </header>

  <main class="stage">
    <Canvas toneMapping={NoToneMapping} renderMode="on-demand">
      <Viewport
        {editor}
        {projection}
        bind:controller
        oncamera={onCamera}
        onselectionscreen={(p) => (selectionScreen = p)}
      />
    </Canvas>

    {#if editor.cursor && (editor.snap || editor.dragDelta)}
      {@const [x, y] = editor.cursor}
      <div class="tip" style:left="{x + 18}px" style:top="{y + 18}px">
        {#if editor.dragDelta}
          {@const d = editor.dragDelta}
          <div style:color={AXIS_COLORS[d.axis]}>Δ{d.axis.toUpperCase()} = {fmt(d.mm)} mm</div>
        {:else if editor.snap}
          <div class="label" style:color={editor.snap.axis ? AXIS_COLORS[editor.snap.axis] : undefined}>
            {editor.snap.label}
          </div>
          {#if editor.target}{@render coords(editor.target)}{/if}
          {#if editor.currentLength !== null}
            <!-- Champ d'apparence saisissable : la longueur se tape directement au clavier. -->
            <div class="length-row">
              <span class="field" class:filled={editor.typed !== ''}>
                {#if editor.typed}{editor.typed}{:else}{fmt(editor.currentLength)}{/if}<span class="caret"></span>
              </span>
              mm
              <small>{editor.typed ? 'Entrée pour valider' : 'tapez une longueur'}</small>
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Coordonnées de la sélection, près d'elle, éditables ; elles suivent le déplacement au gizmo. -->
    {#if selectionScreen && editor.tool === 'select' && editor.gizmoCenter}
      {@const ids = editor.selectedNodeIds}
      {@const center = editor.gizmoCenter}
      <div class="tip editable" style:left="{selectionScreen[0] + 16}px" style:top="{selectionScreen[1] + 16}px">
        <div class="label">{ids.length === 1 ? `Nœud ${ids[0]}` : `Centre de ${ids.length} nœuds`}</div>
        <div class="coords">
          {#each ['x', 'y', 'z'] as const as a, i (a)}
            <label>
              <b style:color={AXIS_COLORS[a]}>{a.toUpperCase()}</b>
              <input
                class="field"
                type="text"
                inputmode="decimal"
                value={numText(center[i])}
                onchange={(e) => applyCoord(a, e.currentTarget, center[i])}
                onkeydown={(e) => coordKey(e, center[i])}
              />
            </label>
          {/each}
        </div>
      </div>
    {/if}

    <div class="cube-slot">
      <ViewCube
        quaternion={camQuat}
        onview={viewFrom}
        onorbitstart={() => controller?.cubeOrbitStart()}
        onorbit={(dx, dy) => controller?.cubeOrbitMove(dx, dy)}
        onorbitend={() => controller?.cubeOrbitEnd()}
      />
      <div class="segmented" role="group" aria-label="Projection">
        <button
          class:active={projection === 'perspective'}
          onclick={() => (projection = 'perspective')}
          title="Projection perspective (P)">Perspective</button
        >
        <button
          class:active={projection === 'orthographic'}
          onclick={() => (projection = 'orthographic')}
          title="Projection orthographique (P)">Ortho</button
        >
      </div>
    </div>

    {#if editor.message}
      <button class="message" onclick={() => (editor.message = '')}>{editor.message}</button>
    {/if}

    {#if showHelp}
      <aside class="help">
        <h3>Souris</h3>
        <ul>
          <li><b>Clic gauche</b> pose un nœud (outil Poutre) ou sélectionne</li>
          <li><b>Double-clic</b>, <b>Échap</b> ou clic sur un nœud existant termine la chaîne</li>
          <li><b>Échap</b> sans chaîne en cours : passe en Sélection</li>
          <li><b>Clic droit glissé</b> tourne autour du pivot (cible orange) : le nœud ou segment visé, sinon un point dans le volume de la géométrie, sinon l'origine</li>
          <li><b>Molette appuyée</b> ou <b>deux doigts</b> déplace la vue</li>
          <li><b>Molette</b> ou <b>pincement</b> zoome vers le curseur</li>
        </ul>
        <h3>Clavier</h3>
        <ul>
          <li><b>X, Y, Z</b> verrouille l'axe depuis le dernier nœud</li>
          <li><b>Shift</b> maintenu fige l'accrochage en cours</li>
          <li><b>Tab</b> force le plan XY → XZ → YZ → auto</li>
          <li><b>chiffres + Entrée</b> longueur exacte en mm</li>
          <li><b>L</b> Poutre, <b>V</b> Sélection</li>
          <li><b>H</b> vue Maison, <b>F</b> cadrer, <b>P</b> perspective ↔ ortho</li>
          <li>Cube : clic sur une face, une arête ou un coin pour regarder la scène de là, cadrée</li>
          <li><b>Suppr</b> supprime, <b>Ctrl+Z / Ctrl+Y</b> annule, rétablit</li>
          <li><b>Ctrl+S</b> enregistre la scène en JSON, <b>Ctrl+O</b> en ouvre une</li>
        </ul>
        <h3>Accrochages, par priorité</h3>
        <ol>
          <li>nœud existant</li>
          <li>milieu ou point d'un segment</li>
          <li>axe X, Y, Z depuis le dernier nœud</li>
          <li>parallèle à un segment, même coordonnée qu'un nœud</li>
          <li>plan actif</li>
        </ol>
        <h3>Vue dans l'axe (dessus, face, côté)</h3>
        <ul>
          <li>On dessine dans le plan face à la caméra, passant par le dernier nœud (sinon l'origine) ; la grille s'y place</li>
          <li>Seuls les nœuds et segments de ce plan accrochent, plus les points où un segment le traverse</li>
          <li>Pour dessiner dans un autre plan : sélectionner un nœud de ce plan, puis Poutre</li>
        </ul>
      </aside>
    {/if}
  </main>

  <footer class="status">
    <span>Outil : <b>{editor.tool === 'beam' ? 'Poutre' : 'Sélection'}</b></span>
    {#if editor.tool === 'beam'}
      <span>Plan : <b>{planeText}</b></span>
      {#if lockLabel}<span class="lock">Verrou : <b>{lockLabel}</b></span>{/if}
      <span>{editor.anchor ? 'Chaîne en cours — Échap pour terminer' : 'Cliquez pour commencer une chaîne — Échap pour sélectionner'}</span>
    {:else}
      <span>
        {editor.selection.nodes.size} nœud(s), {editor.selection.segments.size} segment(s) sélectionné(s)
        {#if editor.gizmoCenter}— glissez une flèche pour déplacer{/if}
      </span>
    {/if}
    <span class="spacer"></span>
    <span>Pas {STEP} mm</span>
    <span>{counts.nodes} nœuds · {counts.segments} segments</span>
  </footer>
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    overflow: hidden;
    font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #1f2937;
    background: #eef1f5;
  }
  :global(#app) {
    height: 100%;
  }
  .app {
    display: grid;
    grid-template-rows: auto 1fr auto;
    height: 100%;
  }
  .toolbar,
  .status {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 10px;
    background: #fff;
    border-bottom: 1px solid #d6dbe3;
    user-select: none;
  }
  .status {
    border-top: 1px solid #d6dbe3;
    border-bottom: none;
    gap: 18px;
    color: #4b5563;
    font-size: 12px;
  }
  .brand span {
    font-weight: 400;
    color: #6b7280;
  }
  .group {
    display: flex;
    gap: 2px;
  }
  .spacer {
    flex: 1;
  }
  button {
    font: inherit;
    padding: 4px 10px;
    border: 1px solid #cbd2dc;
    background: #f8fafc;
    border-radius: 5px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: #eef2f7;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button.active,
  button.active:hover:not(:disabled) {
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
  }
  .stage {
    position: relative;
    min-height: 0;
  }
  .tip {
    position: absolute;
    pointer-events: none;
    padding: 3px 7px;
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid #d6dbe3;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }
  .tip .label {
    font-weight: 600;
  }
  .tip .coords {
    display: flex;
    gap: 10px;
    font-variant-numeric: tabular-nums;
  }
  .tip.editable {
    pointer-events: auto;
  }
  .tip.editable label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tip.editable input.field {
    width: 62px;
    min-width: 0;
    color: #111827;
    font: inherit;
    text-align: right;
  }
  .tip.editable input.field:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
  }
  .length-row {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 3px;
  }
  .field {
    display: inline-flex;
    align-items: center;
    min-width: 64px;
    padding: 1px 5px;
    background: #fff;
    border: 1px solid #94a3b8;
    border-radius: 3px;
    color: #9ca3af;
    font-variant-numeric: tabular-nums;
  }
  .field.filled {
    color: #111827;
    font-weight: 600;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
  }
  .caret {
    display: inline-block;
    width: 1px;
    height: 13px;
    margin-left: 1px;
    background: #111827;
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .tip small {
    color: #6b7280;
    font-weight: 400;
  }
  .cube-slot {
    position: absolute;
    top: 8px;
    right: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .segmented {
    display: flex;
  }
  .segmented button {
    border-radius: 0;
    font-size: 12px;
  }
  .segmented button:first-child {
    border-radius: 5px 0 0 5px;
  }
  .segmented button:last-child {
    border-radius: 0 5px 5px 0;
    margin-left: -1px;
  }
  .lock b {
    color: #b45309;
  }
  .message {
    position: absolute;
    left: 50%;
    top: 12px;
    transform: translateX(-50%);
    background: #fee2e2;
    border-color: #fca5a5;
    color: #991b1b;
  }
  .help {
    position: absolute;
    left: 12px;
    top: 12px;
    width: 330px;
    padding: 4px 14px 10px;
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid #d6dbe3;
    border-radius: 6px;
    font-size: 12px;
  }
  .help h3 {
    margin: 10px 0 4px;
    font-size: 12px;
  }
  .help ul,
  .help ol {
    margin: 0;
    padding-left: 18px;
  }
</style>
