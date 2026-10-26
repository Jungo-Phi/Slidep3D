<script lang="ts">
  import { Canvas } from '@threlte/core'
  import { NoToneMapping } from 'three'
  import Viewport from './components/Viewport.svelte'
  import ViewCube from './components/ViewCube.svelte'
  import { planeLabel } from './lib/core/placement'
  import type { Axis, Vec2, Vec3 } from './lib/core/vec'
  import { Editor, STEP, type Tool } from './lib/editor.svelte'
  import type { CameraController } from './lib/three/cameraController'
  import { AXIS_COLORS } from './lib/three/colors'

  const editor = new Editor()
  let controller = $state<CameraController>()
  let camQuat = $state<[number, number, number, number]>([0, 0, 0, 1])
  let showHelp = $state(false)
  let selectionScreen = $state.raw<{ at: Vec2; side: Vec2 } | null>(null)
  let fileInput: HTMLInputElement

  const onCamera = (q: [number, number, number, number]) => (camQuat = q)

  const viewFrom = (dir: Vec3) => controller?.viewFrom(dir)
  const frame = () => controller?.frame()
  const home = () => controller?.home()
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
        <button class:active={editor.tool === t.id} class:selecting={t.id === 'select'} onclick={() => editor.setTool(t.id)} title="{t.label} ({t.key})">
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
    <div class="group">
      <button class:active={showHelp} onclick={() => (showHelp = !showHelp)}>Aide</button>
    </div>
  </header>

  <main class="stage">
    <Canvas toneMapping={NoToneMapping} renderMode="on-demand">
      <Viewport
        {editor}
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
      {@const { at, side } = selectionScreen}
      <!-- Placée dans le quadrant libre de flèches, pour ne jamais masquer le gizmo. -->
      <div
        class="tip editable"
        style:left="{at[0] + 20 * side[0]}px"
        style:top="{at[1] + 20 * side[1]}px"
        style:transform="translate({side[0] < 0 ? '-100%' : '0'}, {side[1] < 0 ? '-100%' : '0'})"
      >
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
          <li><b>H</b> vue Maison et <b>F</b> cadrer</li>
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
  /* Thème « Slidep clair » de Slidep (`slidep-light`), mêmes teintes que `lib/three/colors.ts`. */
  :global(:root) {
    color-scheme: light;
    --accent: #d7530b;
    --accent-dark: #9c4211;
    --ink: #001d59;
    --ink-soft: rgba(0, 29, 89, 0.7);
    --ink-faint: rgba(0, 29, 89, 0.38);
    --paper: #fff3d6;
    --ground: #fdecc9;
    --toolbar: #fdcda0;
    --selection: #7190e5;
    --selection-dark: #3f63c8;
    --divider-paper: #ccc2ab;
    --divider-toolbar: #caa480;
    --hover: rgba(0, 0, 0, 0.1);
    --shadow: 4px 4px 4px rgba(0, 0, 0, 0.2);
    --error: #d32f2f;
  }
  :global(html, body) {
    margin: 0;
    height: 100%;
    overflow: hidden;
    font: 14px/1.4 'Source Sans 3', 'Source Sans Pro', 'Roboto', 'Helvetica', 'Arial', sans-serif;
    color: var(--ink);
    background: var(--ground);
  }
  :global(::selection) {
    background: rgba(215, 83, 11, 0.2);
  }
  :global(:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
    padding: 4px 8px;
    min-height: 32px;
    background: var(--toolbar);
    user-select: none;
  }
  .status {
    min-height: 0;
    padding: 3px 10px;
    background: var(--paper);
    border-top: 1px solid var(--divider-paper);
    gap: 18px;
    color: var(--ink-soft);
    font-size: 13px;
  }
  .status b {
    color: var(--ink);
    font-weight: 600;
  }
  .brand {
    font-weight: 700;
    font-size: 16px;
  }
  .brand span {
    font-weight: 400;
    color: var(--ink-soft);
  }
  .group {
    display: flex;
    gap: 2px;
    padding-left: 12px;
    border-left: 1px solid var(--divider-toolbar);
  }
  .spacer {
    flex: 1;
  }
  /* Le vide qui pousse un groupe à droite le sépare déjà : pas de filet en plus. */
  .spacer + .group {
    padding-left: 0;
    border-left: none;
  }
  button {
    font: inherit;
    font-weight: 500;
    padding: 4px 10px;
    color: var(--ink);
    border: 1px solid transparent;
    background: transparent;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }
  button:hover:not(:disabled) {
    background: var(--hover);
  }
  button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  button.active,
  button.active:hover:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }
  button.active:hover:not(:disabled) {
    background: var(--accent-dark);
  }
  /* Comme la palette de Slidep : l'outil de sélection s'allume en bleu, les outils de tracé en orange. */
  button.active.selecting {
    background: var(--selection);
  }
  button.active.selecting:hover:not(:disabled) {
    background: var(--selection-dark);
  }
  .stage {
    position: relative;
    min-height: 0;
  }
  .tip {
    position: absolute;
    pointer-events: none;
    padding: 3px 8px;
    background: var(--paper);
    border: 2px solid var(--accent);
    border-radius: 6px;
    font-size: 13px;
    white-space: nowrap;
    box-shadow: var(--shadow);
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
    color: var(--ink);
    font: inherit;
    text-align: right;
  }
  .tip.editable input.field:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(215, 83, 11, 0.25);
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
    border: 1px solid var(--divider-paper);
    border-radius: 4px;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }
  .field.filled {
    color: var(--ink);
    font-weight: 600;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(215, 83, 11, 0.25);
  }
  .caret {
    display: inline-block;
    width: 1px;
    height: 14px;
    margin-left: 1px;
    background: var(--ink);
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .tip small {
    color: var(--ink-soft);
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
  .lock b {
    color: var(--accent-dark);
  }
  .message {
    position: absolute;
    left: 50%;
    top: 12px;
    transform: translateX(-50%);
    background: var(--paper);
    border: 2px solid var(--error);
    box-shadow: var(--shadow);
    color: var(--error);
  }
  .message:hover:not(:disabled) {
    background: #fbe3cf;
  }
  .help {
    position: absolute;
    left: 12px;
    top: 12px;
    width: 340px;
    max-height: calc(100% - 24px);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 4px 14px 10px;
    background: var(--paper);
    border: 2px solid var(--accent);
    border-radius: 6px;
    box-shadow: var(--shadow);
    font-size: 13px;
  }
  .help h3 {
    margin: 10px 0 4px;
    font-size: 14px;
    font-weight: 600;
    color: var(--accent);
  }
  .help ul,
  .help ol {
    margin: 0;
    padding-left: 18px;
  }
</style>
