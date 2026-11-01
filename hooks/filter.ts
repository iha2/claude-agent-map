import type { Card } from './model'

/** With `hideDone`, the running cards and every ancestor of one; the rest are counted as hidden. Order is kept. */
export function visibleCards(cards: Card[], hideDone: boolean): { shown: Card[]; hidden: number } {
  if (!hideDone) return { shown: cards, hidden: 0 }
  const byId = new Map(cards.map(c => [c.id, c]))
  const keep = new Set<string>()
  for (const c of cards) {
    if (c.status !== 'running') continue
    let cur: Card | undefined = c
    // a parent loop or an unknown parent ends the walk
    while (cur && !keep.has(cur.id)) {
      keep.add(cur.id)
      cur = cur.parent ? byId.get(cur.parent) : undefined
    }
  }
  const shown = cards.filter(c => keep.has(c.id))
  return { shown, hidden: cards.length - shown.length }
}
