import type { SnapKind } from '../core/placement'
import type { Axis } from '../core/vec'

/** Le thème « Slidep clair » de Slidep (`slidep-light` dans `mui-theme.ts`), repris tel quel. */
export const THEME = {
  accent: '#D7530B',
  accentDark: '#9C4211',
  ink: '#001D59',
  paper: '#fff3d6',
  appBackground: '#FDECC9',
  toolbar: '#fdcda0',
  fillBody: '#B7E2FF',
  fillNode: '#FFBE80',
  selectionStroke: '#6595D0',
  selectionBox: '#7190E5',
}

export const AXIS_COLORS: Record<Axis, string> = { x: '#e5484d', y: '#30a46c', z: '#3e63dd' }

export const COLORS = {
  background: THEME.appBackground,
  beam: THEME.fillBody,
  node: THEME.fillNode,
  selected: THEME.selectionStroke,
  preview: THEME.accent,
  ref: '#8b5cf6',
  shadow: THEME.ink,
  /** Traits de grille : le fond assombri vers le noir, comme la grille de Slidep, qui garde ainsi sa teinte. */
  grid: '#7F7664',
  /** Couleur de sol de l'éclairage hémisphérique, chaude pour ne pas bleuir le fond crème. */
  groundLight: '#d9c7a3',
}

/** Couleur du marqueur d'accrochage selon son type. */
export const SNAP_COLORS: Record<SnapKind, string> = {
  node: '#16a34a',
  midpoint: '#06b6d4',
  'on-segment': '#ef4444',
  axis: THEME.ink,
  parallel: COLORS.ref,
  extension: COLORS.ref,
  align: COLORS.ref,
  plane: THEME.ink,
  constraint: THEME.ink,
}
