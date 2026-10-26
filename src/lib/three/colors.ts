import type { SnapKind } from '../core/placement'
import type { Axis } from '../core/vec'

export const AXIS_COLORS: Record<Axis, string> = { x: '#e5484d', y: '#30a46c', z: '#3e63dd' }

export const COLORS = {
  background: '#eef1f5',
  beam: '#9aa3b2',
  node: '#4b5563',
  hover: '#f59e0b',
  selected: '#2563eb',
  preview: '#f59e0b',
  ref: '#8b5cf6',
  shadow: '#1f2937',
}

/** Couleur du marqueur d'accrochage selon son type. */
export const SNAP_COLORS: Record<SnapKind, string> = {
  node: '#16a34a',
  midpoint: '#06b6d4',
  'on-segment': '#ef4444',
  axis: '#111827',
  parallel: COLORS.ref,
  extension: COLORS.ref,
  align: COLORS.ref,
  plane: '#111827',
  constraint: '#111827',
}
