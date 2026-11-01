// The agent map as an SVG tree, top to bottom: the main session at the top, each
// agent under the agent that spawned it. Children hang off a trunk on their
// parent's left and wrap into rows to fit the pane. Pure: a string out.
import type { Status } from './model'

export type GraphNode = {
  id: string
  parent?: string
  title: string
  meta: string
  tasks: string
  status: Status
  /** The agent type (`superlite:implementer`, `Explore`, ...): picks the edge style. */
  type?: string
  /** A running node's elapsed ms when the graph was built; absent for done and aborted. */
  clockMs?: number
}

export type GraphMain = { title: string; meta: string; status: Status; accent?: string }

const NODE_W = 216
const NODE_H = 58
const GAP_X = 14
const GAP_Y = 44
const INDENT = 30
const TRUNK = 14
const PAD = 8

export const COLORS: Record<Status, string> = { running: '#22a35a', aborted: '#d1242f', done: '#9aa0a6' }
const LINE = '#b8bec4'

export type Role = 'coordinator' | 'implementer' | 'reviewer' | 'fixer' | 'final' | 'other'

/** One edge style per kind of agent: color, width, dash (none is solid). */
export const ROLES: Record<Role, { label: string; color: string; width: number; dash?: string }> = {
  coordinator: { label: 'coordinator', color: '#8250df', width: 2.6 },
  implementer: { label: 'implementer', color: '#0969da', width: 1.8 },
  reviewer: { label: 'reviewer', color: '#bf8700', width: 1.8, dash: '6 4' },
  fixer: { label: 'fixer', color: '#e16f24', width: 2, dash: '2 3' },
  final: { label: 'final review', color: '#1a7f75', width: 2, dash: '10 3 2 3' },
  other: { label: 'other', color: '#8c959f', width: 1.5 },
}

export function roleOf(type: string | undefined): Role {
  const t = (type ?? '').toLowerCase()
  if (t.includes('final-review')) return 'final'
  if (t.includes('coordinator')) return 'coordinator'
  if (t.includes('fixer')) return 'fixer'
  if (t.includes('review')) return 'reviewer'
  if (t.includes('implementer')) return 'implementer'
  return 'other'
}

const LEGEND_H = 26
const INK = '#1f2328'
const DIM = '#59636e'
const CARD = '#f6f8fa'

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s
}

type Item = { id: string; title: string; meta: string; tasks: string; status: Status; type?: string; clockMs?: number; accent?: string; kids: Item[] }
type Laid = { item: Item; w: number; h: number; rows: { kids: Laid[]; w: number; h: number }[] }

/** Children by parent; a parent the list does not hold is the main session. */
export function buildTree(main: GraphMain, nodes: GraphNode[]): Item {
  const ids = new Set(nodes.map(n => n.id))
  const items = new Map<string, Item>(nodes.map(n => [n.id, { ...n, kids: [] }]))
  const root: Item = { id: 'main', ...main, tasks: '', kids: [] }
  for (const n of nodes) {
    const up = n.parent && n.parent !== n.id && ids.has(n.parent) ? items.get(n.parent)! : root
    up.kids.push(items.get(n.id)!)
  }
  // a parent cycle in the records would orphan its members: hang them off the main session
  const seen = new Set<string>()
  const walk = (i: Item) => {
    seen.add(i.id)
    i.kids.forEach(walk)
  }
  walk(root)
  for (const n of nodes) {
    if (seen.has(n.id)) continue
    const orphan = items.get(n.id)!
    for (const i of items.values()) i.kids = i.kids.filter(k => k !== orphan)
    root.kids.push(orphan)
    walk(orphan)
  }
  return root
}

function lay(item: Item, maxW: number): Laid {
  const kids = item.kids.map(k => lay(k, Math.max(NODE_W, maxW - INDENT)))
  const rows: Laid['rows'] = []
  for (const k of kids) {
    const row = rows[rows.length - 1]
    if (row && row.w + GAP_X + k.w <= maxW - INDENT) {
      row.kids.push(k)
      row.w += GAP_X + k.w
      row.h = Math.max(row.h, k.h)
    } else rows.push({ kids: [k], w: k.w, h: k.h })
  }
  const w = Math.max(NODE_W, ...rows.map(r => INDENT + r.w))
  const h = NODE_H + rows.reduce((s, r) => s + GAP_Y + r.h, 0)
  return { item, w, h, rows }
}

const GLYPH_W = 6.6
const GLYPH_H = 13
const CLOCK_FONT = 'ui-monospace, Menlo, monospace'

export function clockBand(ms: number): 'short' | 'mid' | 'long' {
  return ms >= 3600000 ? 'long' : ms >= 600000 ? 'mid' : 'short'
}

/** Short stable token from the id, so ids that sanitize alike still get distinct clip ids. */
function slug(id: string): string {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0
  return `${id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24)}-${h.toString(36)}`
}

/**
 * An odometer clock drawn in SVG: one clipped digit strip per place, each stepping on its own
 * period with SMIL, all started `elapsedMs` in the past. The markup holds no per-second value,
 * so it is identical from one tick to the next. `x` is the left edge, `y` the text baseline.
 */
export function liveClock(id: string, elapsedMs: number, x: number, y: number): string {
  const band = clockBand(elapsedMs)
  const secs = Math.max(0, Math.floor(elapsedMs / 1000))
  const key = slug(id)
  // left to right: [dur, n] for a strip, or a literal colon
  const layout: ([number, number] | ':')[] =
    band === 'long' ? [[36000, 10], ':', [3600, 6], [600, 10], ':', [60, 6], [10, 10]]
    : band === 'mid' ? [[3600, 6], [600, 10], ':', [60, 6], [10, 10]]
    : [[600, 10], ':', [60, 6], [10, 10]]
  // the seconds-ones strip steps every second: dur 10s, n 10
  const out: string[] = [`<g data-clock="${esc(id)}">`]
  let cx = Math.round(x * 10) / 10
  layout.forEach((p, i) => {
    if (p === ':') {
      out.push(`<text x="${cx}" y="${y}" font-size="11" font-family="${CLOCK_FONT}" fill="${DIM}">:</text>`)
      cx = Math.round((cx + GLYPH_W) * 10) / 10
      return
    }
    const [dur, n] = p
    const cid = `clk-${key}-${i}`
    const values = Array.from({ length: n }, (_, d) => `0 ${-d * GLYPH_H}`).join(';')
    const times = Array.from({ length: n }, (_, d) => (d / n).toFixed(4).replace(/\.?0+$/, '') || '0').join(';')
    const digits = Array.from({ length: n }, (_, d) => `<text x="${cx}" y="${y + d * GLYPH_H}" font-size="11" font-family="${CLOCK_FONT}" fill="${DIM}">${d}</text>`).join('')
    out.push(
      `<clipPath id="${cid}"><rect x="${cx}" y="${y - 10}" width="${GLYPH_W}" height="${GLYPH_H - 1}"/></clipPath>`,
      `<g clip-path="url(#${cid})"><g>${digits}<animateTransform attributeName="transform" type="translate" calcMode="discrete" values="${values}" keyTimes="${times}" dur="${dur}s" begin="-${secs}s" repeatCount="indefinite"/></g></g>`,
    )
    cx = Math.round((cx + GLYPH_W) * 10) / 10
  })
  out.push('</g>')
  return out.join('')
}

function clockWidth(ms: number): number {
  return (clockBand(ms) === 'long' ? 7 : clockBand(ms) === 'mid' ? 5 : 4) * GLYPH_W
}

function box(x: number, y: number, n: Item, out: string[]): void {
  const color = COLORS[n.status]
  const run = n.status === 'running'
  const chars = Math.floor((NODE_W - 34) / 6.3)
  const cw = n.clockMs === undefined ? 0 : clockWidth(n.clockMs)
  const metaChars = chars + 3 - (cw ? Math.ceil((cw + 6) / 6.3) : 0)
  const accent = n.id === 'main' && n.accent && /^#[0-9a-fA-F]{6}$/.test(n.accent) ? n.accent : undefined
  out.push(
    `<g><title>${esc([n.title, n.meta, n.tasks, n.status, n.id === 'main' ? '' : n.id].filter(Boolean).join('\n'))}</title>`,
    `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}"${accent ? ` data-accent="${esc(accent)}"` : ''} rx="9" fill="${CARD}" stroke="${color}" stroke-width="${run || n.status === 'aborted' ? 2 : 1}"/>`,
    n.id === 'main' ? (accent ? `<rect x="${x + 1.5}" y="${y + 9}" width="4" height="${NODE_H - 18}" rx="2" fill="${esc(accent)}"/>` : '') : `<rect x="${x + 1.5}" y="${y + 9}" width="3" height="${NODE_H - 18}" rx="1.5" fill="${ROLES[roleOf(n.type)].color}"/>`,
    `<circle cx="${x + 14}" cy="${y + 17}" r="5" fill="${color}">${run ? '<animate attributeName="opacity" values="1;0.35;1" dur="1.4s" repeatCount="indefinite"/>' : ''}</circle>`,
    `<text x="${x + 26}" y="${y + 21}" font-size="12.5" font-weight="600" fill="${INK}">${esc(clip(n.title, chars))}</text>`,
    `<text x="${x + 12}" y="${y + 38}" font-size="11" fill="${DIM}">${esc(clip(n.meta, metaChars))}</text>`,
    cw ? liveClock(n.id, n.clockMs!, x + NODE_W - 12 - cw, y + 38) : '',
    n.tasks ? `<text x="${x + 12}" y="${y + 52}" font-size="11" fill="${DIM}">${esc(clip(n.tasks, chars + 3))}</text>` : '',
    '</g>',
  )
}

function draw(l: Laid, x: number, y: number, edges: string[], boxes: string[]): void {
  box(x, y, l.item, boxes)
  if (!l.rows.length) return
  const tx = x + TRUNK
  let top = y + NODE_H + GAP_Y
  let lastBus = 0
  for (const row of l.rows) {
    const bus = top - GAP_Y / 2
    lastBus = bus
    let cx = x + INDENT
    const centers: number[] = []
    for (const k of row.kids) {
      const kc = cx + NODE_W / 2
      centers.push(kc)
      const r = ROLES[roleOf(k.item.type)]
      const run = k.item.status === 'running'
      const faded = k.item.status === 'done' ? ' opacity="0.55"' : ''
      edges.push(
        `<path d="M${kc} ${bus} L${kc} ${top}" fill="none" stroke="${r.color}" stroke-width="${r.width + (run ? 0.6 : 0)}"${
          r.dash ? ` stroke-dasharray="${r.dash}"` : ''
        }${faded} data-role="${roleOf(k.item.type)}"${
          run ? '><animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite"/></path>' : '/>'
        }`,
      )
      draw(k, cx, top, edges, boxes)
      cx += k.w + GAP_X
    }
    edges.push(`<path d="M${tx} ${bus} L${Math.max(...centers)} ${bus}" fill="none" stroke="${LINE}" stroke-width="1.3"/>`)
    top += row.h + GAP_Y
  }
  edges.push(`<path d="M${tx} ${y + NODE_H} L${tx} ${lastBus}" fill="none" stroke="${LINE}" stroke-width="1.3"/>`)
}

/** The tree's SVG document and its size in CSS pixels, laid out to `maxWidth`. */
export function graphSvg(main: GraphMain, nodes: GraphNode[], maxWidth = 900): { source: string; width: number; height: number } {
  const laid = lay(buildTree(main, nodes), Math.max(NODE_W + INDENT, maxWidth - 2 * PAD))
  const used = (Object.keys(ROLES) as Role[]).filter(r => nodes.some(n => roleOf(n.type) === r))
  const width = Math.max(laid.w + 2 * PAD, PAD + used.length * 118)
  const height = laid.h + 2 * PAD + (used.length ? LEGEND_H : 0)
  const edges: string[] = []
  const boxes: string[] = []
  draw(laid, PAD, PAD, edges, boxes)
  const ly = laid.h + 2 * PAD + 12
  const legend = used
    .map((r, i) => {
      const x = PAD + i * 118
      const st = ROLES[r]
      return `<path d="M${x} ${ly} L${x + 26} ${ly}" stroke="${st.color}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/><text x="${x + 32}" y="${ly + 4}" font-size="11" fill="${DIM}">${st.label}</text>`
    })
    .join('')
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">${edges.join('')}${boxes.join('')}${legend}</svg>`
  return { source, width, height }
}

/** Depth-first order with each agent's depth, for the terminal's text tree. */
export function treeOrder(main: GraphMain, nodes: GraphNode[]): { id: string; depth: number; isLast: boolean; trail: boolean[] }[] {
  const out: { id: string; depth: number; isLast: boolean; trail: boolean[] }[] = []
  const walk = (i: Item, depth: number, trail: boolean[]) =>
    i.kids.forEach((k, j) => {
      const isLast = j === i.kids.length - 1
      out.push({ id: k.id, depth, isLast, trail })
      walk(k, depth + 1, [...trail, !isLast])
    })
  walk(buildTree(main, nodes), 0, [])
  return out
}
