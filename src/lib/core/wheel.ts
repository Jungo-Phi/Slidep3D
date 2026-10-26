// Le navigateur ne dit pas si un événement `wheel` vient d'une molette ou d'un pavé tactile.
// Heuristique : le premier événement d'une rafale décide, les suivants suivent,
// pour que l'inertie du pavé tactile ne bascule pas en zoom au milieu d'un geste.

export type WheelIntent = 'zoom' | 'pan'

export interface WheelSample {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  timeStamp: number
}

const BURST_GAP_MS = 220

export class WheelClassifier {
  private last = -Infinity
  private current: WheelIntent = 'zoom'

  classify(e: WheelSample): WheelIntent {
    // Pincement au pavé tactile : Chrome, Edge et Firefox l'envoient en wheel + ctrlKey.
    if (e.ctrlKey) {
      this.last = e.timeStamp
      return 'zoom'
    }
    if (e.timeStamp - this.last > BURST_GAP_MS) this.current = classifyFirst(e)
    this.last = e.timeStamp
    return this.current
  }
}

export function classifyFirst(e: WheelSample): WheelIntent {
  // Défilement en lignes ou en pages : molette classique (Firefox).
  if (e.deltaMode !== 0) return 'zoom'
  // Composante horizontale : pavé tactile (ou molette inclinable, rare).
  if (e.deltaX !== 0) return 'pan'
  const y = Math.abs(e.deltaY)
  // Les crans de molette donnent de grands pas (≈100 px, ou 120 × échelle d'affichage).
  if (y >= 50) return 'zoom'
  // Petits pas, souvent fractionnaires : pavé tactile.
  return 'pan'
}
