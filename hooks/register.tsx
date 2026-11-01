import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LiveAgent, Superlite, Usage } from '../types'
import {
  elapsedMs,
  emptySuperlite,
  fileActive,
  fmtDuration,
  fmtTokens,
  ledgerFor,
  mergeCards,
  parseLedger,
  parseMetrics,
  parsePool,
  parseRegistry,
  pickSession,
  registryPaths,
  slugColour,
  subagentTranscript,
  tierOf,
  totalTokens,
  transcriptUsage,
} from './model'
import type { Card, Status } from './model'
import { clockBand, graphSvg, treeOrder } from './graph'
import type { GraphNode } from './graph'
import { autoOpenMode, fileRunKey, shouldOpen, spawnRunKey } from './autoopen'
import type { AutoOpen } from './autoopen'
import { visibleCards } from './filter'
import { agentTitle, parseTaskNames, planPathFrom, taskLabel } from './tasks'
import { LedgerBox, ledgerMove } from './ledger'

const PANE = 'claude-agent-map'
const TITLE = 'Agent map'
const TOOL = 'open_agent_map'

const live = atom({ plugin: 'claude-agent-map', key: 'live' } as const, {})
const usage = atom({ plugin: 'claude-agent-map', key: 'usage' } as const, {})
const files = atom({ plugin: 'claude-agent-map', key: 'files' } as const, emptySuperlite())
const selected = atom({ plugin: 'claude-agent-map', key: 'selected' } as const, null)
const now = atom({ plugin: 'claude-agent-map', key: 'now' } as const, 0)
const mainActive = atom({ plugin: 'claude-agent-map', key: 'mainActive' } as const, false)
const mainModel = atom({ plugin: 'claude-agent-map', key: 'mainModel' } as const, '')
const opened = atom({ plugin: 'claude-agent-map', key: 'opened' } as const, '')
const runKey = atom({ plugin: 'claude-agent-map', key: 'runKey' } as const, '')
const hideDone = atom({ plugin: 'claude-agent-map', key: 'hideDone' } as const, true)
const ledgerOffsets = atom({ plugin: 'claude-agent-map', key: 'ledgerOffsets' } as const, {})

type $ = EngineInterface

// Each transcript's mtime when last read: read again only when it moved.
const readAt = new Map<string, number>()

// The plan's task names, read again only when the plan file's mtime moves.
let planAt: { path: string; mtime: number; names: Record<string, string> } | undefined

// The last graph drawn, keyed on everything but the ticking clock: the Svg source stays identical between ticks.
let lastGraph: { key: string; at: number; g: { source: string; width: number; height: number } } | undefined

// A running graph is redrawn at least this often: it re-anchors the clocks and shows the tokens.
const RESYNC_MS = 60_000

/** Per Claude session: the auto-open mode, and whether the first refresh has looked at the run files yet. */
type Ctx = { mode: AutoOpen; seeded: boolean; fileKey?: string }

async function upsert($: $, id: string, fn: (prev: LiveAgent | undefined) => LiveAgent): Promise<void> {
  await update($, live, (all: Record<string, LiveAgent> | undefined) => ({ ...(all ?? {}), [id]: fn(all?.[id]) }))
}

async function markStarted($: $, id: string, fields: Partial<LiveAgent>, ctx?: Ctx): Promise<void> {
  const t = await $.clock.now()
  const before = await read($, live)
  const wasIdle = !Object.values(before).some(a => a.isActive)
  await upsert($, id, prev => ({
    id,
    type: fields.type || prev?.type || '',
    description: fields.description || prev?.description || '',
    model: fields.model ?? prev?.model,
    startedAt: prev?.startedAt ?? t,
    stoppedAt: undefined,
    isActive: true,
    isAborted: false,
    parent: fields.parent ?? prev?.parent,
    transcript: fields.transcript ?? prev?.transcript,
    last: prev?.last,
  }))
  await update($, now, () => t)
  if (ctx) {
    const type = fields.type || before[id]?.type
    const slug = (await read($, files)).session?.slug
    const key = spawnRunKey(ctx.mode, { type, at: t, wasIdle, slug, current: (await read($, runKey)) || undefined })
    if (key) await update($, runKey, () => key)
    await maybeOpen($, key)
  }
}

/** Opens the pane when `key` is a run not yet opened for; a pane the person closed stays closed within its run. */
async function maybeOpen($: $, key: string | undefined): Promise<void> {
  if (!shouldOpen(key, (await read($, opened)) || undefined)) return
  await update($, opened, () => key!)
  await openPane($).catch(() => undefined)
}

async function markStopped($: $, id: string, fields: Partial<LiveAgent>): Promise<void> {
  const t = await $.clock.now()
  await upsert($, id, prev => ({
    id,
    type: fields.type || prev?.type || '',
    description: prev?.description || '',
    model: prev?.model,
    startedAt: prev?.startedAt,
    stoppedAt: t,
    isActive: false,
    isAborted: fields.isAborted ?? prev?.isAborted,
    parent: prev?.parent,
    transcript: fields.transcript ?? prev?.transcript,
    last: fields.last ?? prev?.last,
  }))
  await update($, now, () => t)
}

async function readText($: $, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

/** Re-reads the .superlite records and the transcripts not yet final; every read may fail, none throws. */
async function refresh($: $, ctx: Ctx): Promise<void> {
  const before = await read($, files)
  const dir = before.dir
  const fresh: Superlite = emptySuperlite(dir)

  // the superlite session this folder belongs to, from the nearest registry
  let since: number | undefined
  let base = dir
  const root = dir.replace(/[\\/]+\.superlite$/, '')
  for (const path of registryPaths(dir)) {
    const text = await readText($, path)
    const reg = text === undefined ? undefined : parseRegistry(text)
    if (!reg) continue
    const row = pickSession(reg, root)
    if (row) {
      fresh.session = { slug: row.slug, branch: row.branch, accent: slugColour(row.slug), since: row.createdAt }
      base = `${row.worktree.replace(/[\\/]+$/, '')}/.superlite`
      since = row.createdAt
    }
    break
  }
  if (fresh.session?.slug !== before.session?.slug) {
    readAt.clear()
    planAt = undefined
    lastGraph = undefined
    await update($, usage, () => ({}))
    await update($, ledgerOffsets, () => ({}))
  }

  // the names carry over until the plan says otherwise: no flicker between refreshes
  if (fresh.session?.slug === before.session?.slug) fresh.taskNames = before.taskNames

  const metrics = await readText($, `${base}/metrics.jsonl`)
  if (metrics !== undefined) Object.assign(fresh, { hasMetrics: true }, parseMetrics(metrics))
  const pool = await readText($, `${base}/pool.json`)
  if (pool !== undefined) fresh.pool = parsePool(pool)
  const ledger = await readText($, `${base}/progress.md`)
  if (ledger !== undefined) Object.assign(fresh, parseLedger(ledger))

  try {
    for (const a of await $.agent.list()) {
      const running = a.status === 'running' || a.status === 'pending' || a.status === 'waiting'
      const known = (await read($, live))[a.id]
      const failed = a.status === 'failed' || a.status === 'killed'
      if (known && known.isActive === running && (running || !!known.isAborted === failed)) continue
      if (running) await markStarted($, a.id, { type: a.type, description: a.description, parent: a.parentId })
      else if (known) await markStopped($, a.id, { isAborted: failed })
    }
  } catch {
    // no agent list on this host: the events alone
  }

  const agents = await read($, live)
  const got: Record<string, Usage> = {}
  const mtimes: Record<string, number> = {}
  for (const id of new Set([...Object.keys(agents), ...Object.keys(fresh.stops)])) {
    const path = agents[id]?.transcript ?? fresh.stops[id]?.transcript
    if (!path) continue
    let mtime: number
    try {
      mtime = (await $.fs.stat(path)).mtimeMs
    } catch {
      continue
    }
    mtimes[id] = mtime
    if (readAt.get(id) === mtime) continue
    const text = await readText($, path)
    if (text === undefined) continue
    got[id] = transcriptUsage(text)
    readAt.set(id, mtime)
  }
  fresh.active = fileActive(fresh, mtimes, await $.clock.now())
  await update($, files, () => fresh)

  // a run the files show (another process's) opens the pane once, like a spawn here
  if (fresh.session) {
    let poolMtime: number | undefined
    try {
      poolMtime = (await $.fs.stat(`${base}/pool.json`)).mtimeMs
    } catch {
      // no pool yet
    }
    const launches = Object.values(fresh.launches)
      .map(l => l.t)
      .filter((t): t is number => t !== undefined && (since === undefined || t >= since))
    const feature = await readText($, `${base}/feature.json`)
    let status: unknown
    let startedT: number | undefined
    try {
      const j = feature === undefined ? undefined : JSON.parse(feature)
      status = j?.status
      startedT = typeof j?.started === 'number' ? j.started : undefined
    } catch {
      // not json
    }
    // superlite rewrites pool.json on every dispatch and checkpoint: its mtime marks a run only when nothing steadier does
    const hasStart = launches.length > 0 || (status === 'building' && startedT !== undefined)
    let key = fileRunKey(ctx.mode, {
      slug: fresh.session.slug,
      poolMtime: hasStart ? undefined : poolMtime,
      firstLaunchT: launches.length ? Math.min(...launches) : undefined,
      featureBuilding: status === 'building',
      startedT,
    })
    // a file-keyed run in progress (its pool.json still there) keeps its key through the rewrites
    if (key && !hasStart && poolMtime !== undefined && ctx.fileKey?.startsWith(`${fresh.session.slug}:`)) key = ctx.fileKey
    if (key) ctx.fileKey = key
    if (!ctx.seeded) {
      // what was already there when the map first looked is not a new run
      ctx.seeded = true
      if (key) await update($, opened, () => key)
    } else await maybeOpen($, key)
  } else ctx.seeded = true
  if (Object.keys(got).length) await update($, usage, (all: Record<string, Usage> | undefined) => ({ ...(all ?? {}), ...got }))

  // task names from the plan the run files point at
  let names: Record<string, string> | undefined
  const [checkpoints, feature, orchestrator] = await Promise.all(
    ['checkpoints', 'feature', 'orchestrator'].map(n => readText($, `${base}/${n}.json`)),
  )
  const planPath = planPathFrom({ checkpoints, feature, orchestrator })
  if (planPath) {
    const full = /^([\\/]|[A-Za-z]:)/.test(planPath) ? planPath : `${base.replace(/[\\/]+\.superlite$/, '')}/${planPath}`
    try {
      const mtime = (await $.fs.stat(full)).mtimeMs
      if (planAt?.path !== full || planAt.mtime !== mtime) {
        const text = await readText($, full)
        if (text !== undefined) planAt = { path: full, mtime, names: parseTaskNames(text) }
      }
      if (planAt?.path === full) names = planAt.names
    } catch {
      planAt = undefined
    }
  } else planAt = undefined
  if (JSON.stringify(names) !== JSON.stringify(fresh.taskNames)) await update($, files, (all: Superlite) => ({ ...all, taskNames: names }))
}

async function openPane($: $): Promise<void> {
  lastGraph = undefined
  const r = await $.ui.open({ id: PANE, title: TITLE })
  if (!r.isPlaced) await $.ui.toast(`Agent map is open but no surface shows it now: ${JSON.stringify(r)}`)
}

function dirOf(args: string): string | undefined {
  const a = args.trim().replace(/^["']|["']$/g, '').replace(/[\\/]+$/, '')
  if (!a) return undefined
  return /(^|[\\/])\.superlite$/.test(a) ? a : `${a}/.superlite`
}

/** Points the map at a project (or its .superlite folder) when given one, refreshes it and opens the pane. */
async function show($: $, args: string, ctx: Ctx): Promise<string> {
  const dir = dirOf(args)
  if (dir) {
    readAt.clear()
    await update($, usage, () => ({}))
    await update($, ledgerOffsets, () => ({}))
    await update($, files, () => emptySuperlite(dir))
  }
  lastGraph = undefined
  await update($, selected, () => null)
  const t = await $.clock.now()
  await update($, now, () => t)
  await refresh($, ctx).catch(() => undefined)
  await openPane($)
  const f = await read($, files)

  return f.hasMetrics ? `Agent map opened (${f.dir}).` : 'Agent map opened (no .superlite records here; live events only).'
}

export const register: Register = (on, options) => {
  const ctx: Ctx = { mode: autoOpenMode(options), seeded: false }
  let lastScroll = { offset: 0, bodyRows: 0 }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'claude-agent-map',
      description: 'Show the agent map: the main session and each subagent, read-only',
      argumentHint: '[project dir]',
      immediate: true,
    })
    await $.tool.register({
      name: TOOL,
      description:
        'Opens the read-only agent map pane beside the transcript: the main session and each subagent with its tier, time, tokens, tasks and ledger lines. Call it when the user asks to watch a superlite run. dir: the project folder (or its .superlite folder); omit for the working directory.',
      inputSchema: { type: 'object', properties: { dir: { type: 'string' } } },
      isDeferred: false,
    }).catch(() => undefined)
    try {
      const model = await $.session.model()
      await update($, mainModel, () => model)
    } catch {
      // no model yet
    }
    // the finished-agents choice outlives the session
    await update($, hideDone, async () => (await $.store.get('hideDone').catch(() => undefined)) !== false)
    // a new Claude session starts at its working directory, not at the project an earlier one was pointed at
    await update($, files, () => emptySuperlite())
    void refresh($, ctx).catch(() => undefined)

    let ticks = 0
    $.clock.every(1000, () => {
      ticks += 1
      void (async () => {
        const agents = await read($, live)
        const busy =
          (await read($, mainActive)) || Object.values(agents).some(a => a.isActive) || (await read($, files)).active.length > 0
        if (busy) {
          const t = await $.clock.now()
          await update($, now, () => t)
        }
        if (ticks % 3 === 0) await refresh($, ctx)
      })().catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'claude-agent-map' }, async ($, e) => ({ text: await show($, e.args, ctx) }))

  on('tool.call', { tool: 'mcp__claude-agent-map__open_agent_map' }, async ($, e) => {
    const dir = (e as { dir?: unknown }).dir
    const text = await show($, typeof dir === 'string' ? dir : '', ctx)

    return { result: text, text, isReadOnly: true as const }
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.agentId)
        await markStarted($, ran.agentId, { type: e.subagentType, description: e.description, model: ran.model, parent: e.parentAgentId }, ctx)
    } catch {
      // the map is a view: never in the spawn's way
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStart', async ($, e, next) => {
    await markStarted($, e.agent_id, { type: e.agent_type, transcript: subagentTranscript(e.transcript_path, e.agent_id) }, ctx).catch(
      () => undefined,
    )

    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await markStopped($, e.agent_id, {
      type: e.agent_type,
      transcript: e.agent_transcript_path || undefined,
      last: e.last_assistant_message,
    }).catch(() => undefined)
    readAt.delete(e.agent_id)
    void refresh($, ctx).catch(() => undefined)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await update($, mainActive, () => true).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) await update($, mainActive, () => false).catch(() => undefined)
    else {
      // Fallback when classic.SubagentStop is skipped by a plugin ahead of us.
      const failed = e.isAborted || e.reason === 'aborted' || e.reason === 'error'
      await markStopped($, e.agentId, failed ? { isAborted: true } : {}).catch(() => undefined)
    }

    return done
  })

  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    // the pane scrolls first; once it is at its end the wheel moves the main ledger
    const atEnd = lastScroll.bodyRows > 0 && lastScroll.offset + lastScroll.bodyRows >= e.contentRows
    if (atEnd && e.by !== 0 && (await read($, selected)) === null) {
      const lines = (await read($, files)).ledger.length
      const offsets = (await read($, ledgerOffsets)) as Record<string, number | null>
      const cur = offsets.main ?? null
      const to = ledgerMove(lines, cur, e.by)
      if (to !== cur) {
        await update($, ledgerOffsets, (all: Record<string, number | null> | undefined) => ({ ...(all ?? {}), main: to }))
        return {}
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const f = await read($, files)
    const stored = await $.store.get('hideDone').catch(() => undefined)
    const mirrored = await read($, hideDone)
    const hiding = stored === undefined ? mirrored : stored !== false
    const cards = mergeCards(await read($, live), f, await read($, usage), { since: f.session?.since })
    const at = (await read($, now)) || Date.now()
    const pick = await read($, selected)
    const offsets = (await read($, ledgerOffsets)) as Record<string, number | null>
    const el = $.ui.resolve(e)
    lastScroll = e.props.scroll
    const ledgerBox = (id: string, title: string, lines: string[]) => (
      <LedgerBox
        el={el}
        id={id}
        title={title}
        lines={lines}
        offset={offsets[id] ?? null}
        onMove={(o: number | null) => update($, ledgerOffsets, (all: Record<string, number | null> | undefined) => ({ ...(all ?? {}), [id]: o }))}
      />
    )
    const isMainActive = await read($, mainActive)
    const model = await read($, mainModel)
    const cols = e.props.bodyColumns
    const active = cards.filter(c => c.isActive).length
    const tone = { running: 'success', aborted: 'error', done: 'inactive' } as const
    const dot = (st: Status) => <Text color={tone[st]}>●</Text>
    const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
    const shortType = (t: string) => t.split(':').pop() || '-'
    const cardWidth = Math.max(24, Math.min(36, Math.floor(((cols || 80) - 28) / 2) - 1))

    const head = (
      <Text>
        <Text weight="semibold">{TITLE}</Text>
        <Text dimColor>
          {' '}
          {f.session ? `${f.session.slug} · ${f.session.branch}` : 'no superlite session'} · {cards.length} agents · {active} active
          {f.hasMetrics ? ` · ${f.dir}` : ''}
        </Text>
      </Text>
    )

    const { shown, hidden } = visibleCards(cards, hiding)
    const names = f.taskNames ?? {}
    const hasNames = Object.keys(names).length > 0
    const titleOf = (c: Card) =>
      (hasNames
        ? agentTitle({ type: c.type, description: c.description, current: f.pool[c.id]?.current, tasks: c.tasks, doneTasks: c.doneTasks }, names)
        : '') ||
      c.description ||
      c.type ||
      c.id
    const card = pick ? cards.find(c => c.id === pick) : undefined
    if (card) {
      lastGraph = undefined
      const t = card.usage?.tokens
      const rows: [string, string][] = [
        ['Agent', card.id],
        ['Type', card.type || '-'],
        ['Model', card.model ?? '-'],
        ['Tier', card.tier ?? '-'],
        ['Tasks', card.tasks.map(t => taskLabel(t, names)).join(', ') || '-'],
        ['Status', `${card.status}${card.isKnownLive ? '' : ' (from the run files)'}`],
        ['Parent', card.parent ? (cards.find(c => c.id === card.parent)?.description ?? card.parent) : 'main session'],
        ['Started', card.startedAt ? new Date(card.startedAt).toISOString() : '-'],
        ['Elapsed', fmtDuration(elapsedMs(card, at))],
        ['Tokens', t ? `${totalTokens(t)} (in ${t.input}, out ${t.output}, cache read ${t.cacheRead}, cache write ${t.cacheWrite})` : '-'],
        ['Tool calls', card.usage ? String(card.usage.toolCalls) : '-'],
        ['Transcript', card.transcript ?? '-'],
      ]

      return (
        <Box flexDirection="column">
          {head}
          <Button key="back" plain onPress={() => update($, selected, () => null)}>
            ‹ Back to map
          </Button>
          <Text>
            {dot(card.status)} <Text weight="semibold">{titleOf(card)}</Text>
          </Text>
          {rows.map(([k, v]) => (
            <Text>
              <Text dimColor>{k.padEnd(11)}</Text>
              {v}
            </Text>
          ))}
          {ledgerBox(card.id, 'Ledger', ledgerFor(f.ledger, card))}
          {card.last ? <Text dimColor>Last message</Text> : null}
          {card.last ? <Text>{card.last.slice(0, 1200)}</Text> : null}
        </Box>
      )
    }

    const metaOf = (c: Card) => `${c.tier ?? '?'} · ${fmtDuration(elapsedMs(c, at))} · ${fmtTokens(c.usage ? totalTokens(c.usage.tokens) : undefined)}`
    const labelsOf = (c: Card) => c.tasks.map(t => taskLabel(t, names) + (c.doneTasks.includes(t) ? '✓' : ''))
    const sepOf = (c: Card) => (c.tasks.some(t => names[t]) ? ', ' : ' ')
    const tasksOf = (c: Card) => (c.tasks.length ? labelsOf(c).join(sepOf(c)) : shortType(c.type))
    const mainMeta = `${tierOf(model) ?? (model || '-')} · ${cards.length} subagents · ${active} active`
    const ledgerRows = ledgerBox('main', 'Ledger (progress.md)', f.ledger)

    const mainStatus: Status = isMainActive || active > 0 ? 'running' : 'done'
    // tokens are drawn but not keyed: they wait for the next redraw
    const tokOf = (c: Card) => (c.usage ? fmtTokens(totalTokens(c.usage.tokens)) : undefined)
    const metaOfNode = (c: Card, withTokens: boolean) =>
      [c.tier ?? '?', c.status === 'running' ? undefined : fmtDuration(elapsedMs(c, at)), withTokens ? tokOf(c) : undefined]
        .filter((x): x is string => !!x)
        .join(' · ')
    const nodeOf = (c: Card, withTokens: boolean): GraphNode => ({
      id: c.id,
      parent: c.parent,
      title: titleOf(c),
      meta: metaOfNode(c, withTokens),
      clockMs: c.status === 'running' ? elapsedMs(c, at) : undefined,
      tasks: tasksOf(c),
      status: c.status,
      type: c.type,
    })
    const nodes: GraphNode[] = shown.map(c => nodeOf(c, true))
    const main = { title: f.session?.slug ?? 'Main session', meta: mainMeta, status: mainStatus, accent: f.session?.accent }

    const byId = new Map(cards.map(c => [c.id, c]))
    const toggle = hiding ? 'Show finished (' + hidden + ')' : 'Hide finished'
    const tree = [
      <Text>
        {dot(mainStatus)} <Text weight="semibold">Main session</Text> <Text dimColor>{mainMeta}</Text>
      </Text>,
      ...(cards.length === 0 ? [<Text dimColor>└─ no subagents yet</Text>] : []),
      ...(cards.length > 0 && shown.length === 0 ? [<Text dimColor>└─ No running agents</Text>] : []),
      ...treeOrder(main, nodes).map(row => {
        const c = byId.get(row.id)!
        const lead = row.trail.map(more => (more ? '│  ' : '   ')).join('') + (row.isLast ? '└─ ' : '├─ ')
        return (
          <Box key={`box-${c.id}`} flexDirection="row">
            <Text dimColor>{lead}</Text>
            <Button key={`card-${c.id}`} plain onPress={() => update($, selected, () => c.id)}>
              {dot(c.status)} {clip(titleOf(c), Math.max(16, cardWidth))}{' '}
              <Text dimColor>
                {metaOf(c)} · {tasksOf(c)}
              </Text>
            </Button>
          </Box>
        )
      }),
    ]

    const headRow = (
      <Box flexDirection="row" gap={2}>
        {head}
        {
          <Button
            key="toggle-finished"
            variant="secondary"
            onPress={async () => {
              const was = await $.store.get('hideDone').catch(() => undefined)
              const next = was === undefined ? !(await read($, hideDone)) : was === false
              await $.store.set('hideDone', next).catch(() => undefined)
              await update($, hideDone, () => next)
            }}
          >
            {toggle}
          </Button>
        }
      </Box>
    )

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const width = Math.max(420, (cols || 110) * 8)
      const keyNodes = shown.map(c => nodeOf(c, false)).map(n => ({ ...n, clockMs: n.clockMs === undefined ? undefined : clockBand(n.clockMs) }))
      const key = JSON.stringify({ main, width, hideDone: hiding, nodes: keyNodes })
      const anyRunning = cards.some(c => c.status === 'running')
      if (!lastGraph || lastGraph.key !== key || (anyRunning && at - lastGraph.at > RESYNC_MS))
        lastGraph = { key, at, g: graphSvg(main, nodes, width) }
      const g = lastGraph.g
      return (
        <Box flexDirection="column" gap={1}>
          {headRow}
          <Svg source={g.source} alt={`Agent map: main session and ${cards.length} subagents, ${active} running`} width={g.width} height={g.height} isInteractive />
          <Box flexDirection="column">{tree}</Box>
          <Box flexDirection="column">{ledgerRows}</Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {headRow}
        {tree}
        {ledgerRows}
      </Box>
    )
  })
}
