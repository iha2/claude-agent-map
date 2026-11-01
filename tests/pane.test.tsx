import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const PLUGIN = 'claude-agent-map'
const PANE = 'claude-agent-map'

const props = (bodyColumns = 100) => ({
  title: 'Agent map',
  isFocused: false,
  bodyColumns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
})

const FILES: Record<string, string> = {
  '.superlite/metrics.jsonl': [
    '{"ev":"launch","t":1000,"agent_id":"r1","type":"superlite:implementer","model":"claude-sonnet-5-5","desc":"T3 templates"}',
    '{"ev":"stop","t":61000,"agent_id":"r1","type":"superlite:implementer","transcript":"C:/t/agent-r1.jsonl","last":"Status: DONE"}',
  ].join('\n'),
  '.superlite/pool.json': '{"agents":[{"id":"r1","tasks":["T3","T4"],"tier":"sonnet"}]}',
  'C:/t/agent-r1.jsonl':
    '{"type":"assistant","timestamp":"2026-10-20T10:00:00Z","message":{"id":"m1","usage":{"input_tokens":100,"output_tokens":400,"cache_read_input_tokens":1000,"cache_creation_input_tokens":0},"content":[]}}',
}

const RUN = { isFullscreen: true, columns: 160 }

let opens = 0

/** The world beneath the plugin: files from `files` by path suffix (anything else is missing), a pane that opens. */
function world(on: On, files: Record<string, string>, store: Record<string, unknown> = { hideDone: false }) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, store)
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    const hit = Object.keys(files).find(k => path === k || path.endsWith(`/${k}`))
    return hit === undefined ? { deny: `ENOENT ${e.path}` } : { value: files[hit]! }
  })
  on('fs.stat', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    const hit = Object.keys(files).find(k => path === k || path.endsWith(`/${k}`))
    return hit === undefined
      ? { deny: `ENOENT ${e.path}` }
      : { value: { kind: 'file' as const, size: files[hit]!.length, mtimeMs: files[hit]!.length, isLink: false } }
  })
  on('session.start', () => ({ cwd: '/' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  opens = 0
  on('ui.open', () => {
    opens += 1
    return { value: { isPlaced: true as const } }
  })
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return clock
}

async function svgSource(ui: { find: (q: { type?: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) {
  return String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
}

async function dotColor(ui: { findAll: (q: { type?: string; text?: string | RegExp }) => Promise<{ props: Record<string, unknown> }[]> }) {
  return (await ui.findAll({ type: 'Text', text: /^●$/ })).map(t => t.props.color)
}

describe('live status', () => {
  for (const surface of SURFACES) {
    test(`SubagentStart turns the card green, SubagentStop grey (${surface})`, async ($, on) => {
      world(on, {})
      await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'superlite:implementer' })
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: props() })

      expect(await ui.find({ key: 'card-a1' })).toBeDefined()
      expect((await dotColor(ui)).at(-1)).toBe('success')
      if (surface === 'desktop') expect(await svgSource(ui)).toContain('#22a35a')

      await $.classic.SubagentStop({
        agent_id: 'a1',
        agent_type: 'superlite:implementer',
        stop_hook_active: false,
        agent_transcript_path: '',
        last_assistant_message: 'Status: DONE',
      })
      expect((await dotColor(ui)).at(-1)).toBe('inactive')
      if (surface === 'desktop') expect(await svgSource(ui)).not.toContain('#22a35a')
    })
  }

  test('a subagent turn completing greys the card without SubagentStop', async ($, on) => {
    world(on, {})
    await $.classic.SubagentStart({ agent_id: 'a2', agent_type: 'superlite:implementer' })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: props() })
    expect((await dotColor(ui)).at(-1)).toBe('success')

    await $.turn.complete({ agentId: 'a2', turnId: 't2', answer: 'done' } as never)
    expect((await dotColor(ui)).at(-1)).toBe('inactive')
  })
})

describe('superlite records', () => {
  for (const surface of SURFACES) {
    test(`metrics rows fill the card; a press shows its details (${surface})`, async ($, on) => {
      world(on, FILES)
      const ran = await $.command.run({ command: 'claude-agent-map', args: '', origin: { kind: 'composer' }, presentation: RUN })
      expect(ran).toEqual({ text: 'Agent map opened (.superlite).' })

      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: props() })
      const card = await ui.find({ key: 'card-r1' })
      expect(card?.text).toContain('T3 templates')
      if (surface === 'desktop') {
        const svg = await svgSource(ui)
        expect(svg).toContain('T3 templates')
        expect(svg).toContain('sonnet · 1m 0s')
        expect(svg).toContain('1.5k tok')
        expect(svg).toContain('T3 T4')
      } else {
        expect(card?.text).toContain('sonnet · 1m 0s · 1.5k tok · T3 T4')
        expect(await ui.find({ key: 'box-r1' })).toBeDefined()
      }
      expect((await dotColor(ui)).at(-1)).toBe('inactive')

      await ui.press({ key: 'card-r1' })
      expect(await ui.find({ type: 'Text', text: 'done (from the run files)' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'main session' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'in 100, out 400' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Status: DONE' })).toBeDefined()

      await ui.press({ key: 'back' })
      expect(await ui.find({ key: 'card-r1' })).toBeDefined()
    })
  }

  test('missing files: no crash, live events only', async ($, on) => {
    world(on, {})
    const ran = await $.command.run({ command: 'claude-agent-map', args: '', origin: { kind: 'composer' }, presentation: RUN })
    expect(ran).toEqual({ text: 'Agent map opened (no .superlite records here; live events only).' })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: props(40) })
    expect(await ui.find({ type: 'Text', text: 'no subagents yet' })).toBeDefined()
  })

  test('the open_agent_map tool opens the pane on a project, read-only', async ($, on) => {
    world(on, FILES)
    const ran = await $.tool.call({ tool: 'mcp__claude-agent-map__open_agent_map', tool_use_id: 'tu1', dir: '.' })
    expect(ran).toMatchObject({ text: 'Agent map opened (./.superlite).' })
  })

  test('a project dir argument reads that project', async ($, on) => {
    world(on, { 'C:/runs/q2/.superlite/metrics.jsonl': FILES['.superlite/metrics.jsonl']! })
    const ran = await $.command.run({ command: 'claude-agent-map', args: 'C:/runs/q2', origin: { kind: 'composer' }, presentation: RUN })
    expect(ran).toEqual({ text: 'Agent map opened (C:/runs/q2/.superlite).' })
  })
})

describe('graph stability', () => {
  const desktop = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: props() })
  // the 1 s tick is armed by session.start
  const start = async ($: any) => {
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'superlite:implementer' })
  }

  test('the graph SVG stays the same while only the clock moves', async ($, on) => {
    const clock = world(on, {})
    await start($)
    const ui = await desktop($)
    const first = await svgSource(ui)
    const text = (await ui.find({ key: 'card-a1' }))?.text
    await clock.advance(1000)
    expect(await svgSource(ui)).toBe(first)
    expect((await ui.find({ key: 'card-a1' }))?.text).not.toBe(text)
  })

  test("a running agent's graph holds a live clock", async ($, on) => {
    world(on, {})
    await start($)
    const svg = await svgSource(await desktop($))
    expect(svg).toContain('data-clock="a1"')
    expect(svg).toContain('repeatCount="indefinite"')
  })

  test('a status change redraws the graph', async ($, on) => {
    world(on, {})
    await start($)
    const ui = await desktop($)
    const first = await svgSource(ui)
    await $.turn.complete({ agentId: 'a1', turnId: 't1', answer: 'done' } as never)
    const next = await svgSource(ui)
    expect(next).not.toBe(first)
    expect(next).not.toContain('data-clock="a1"')
  })

  test('details and back re-anchors', async ($, on) => {
    const clock = world(on, {})
    await start($)
    const ui = await desktop($)
    await clock.advance(5000)
    await ui.press({ key: 'card-a1' })
    await ui.press({ key: 'back' })
    expect(await svgSource(ui)).toContain('begin="-5s"')
  })

  test('reopen re-anchors', async ($, on) => {
    const clock = world(on, {})
    await start($)
    const ui = await desktop($)
    await clock.advance(7000)
    await $.command.run({ command: 'claude-agent-map', args: '', origin: { kind: 'composer' }, presentation: RUN })
    expect(await svgSource(ui)).toContain('begin="-7s"')
  })

  test('an auto-open re-anchors the reused graph', async ($, on) => {
    const files: Record<string, string> = { '/p/.superlite/sessions.json': reg('a') }
    const clock = world(on, files)
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.command.run({ command: 'claude-agent-map', args: '/p', origin: { kind: 'composer' }, presentation: RUN })
    await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'superlite:implementer' })
    const ui = await desktop($)
    await clock.advance(20_000)
    const before = opens
    files['/p/.superlite/pool.json'] = '{"agents":[{"id":"r1","tasks":["T1"],"tier":"sonnet"}]}'
    await clock.advance(3000)
    expect(opens).toBe(before + 1)
    expect(await svgSource(ui)).toMatch(/begin="-2[0-9]s"/)
  })
})

const OPEN = { command: 'claude-agent-map', origin: { kind: 'composer' as const }, presentation: RUN }
const mountOn = ($: any, surface: 'terminal' | 'desktop' = 'desktop', p = props()) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: p })
// `session use` swaps which session lives in the host folder
const reg = (active: string) => {
  const other = active === 'a' ? 'b' : 'a'
  const row = (slug: string, worktree: string) => ({ slug, branch: `superlite/sessions/${slug}`, worktree, status: 'active', created_at: 5000 })
  return JSON.stringify({
    v: 2,
    active,
    host_worktree: '/p',
    sessions: [row(active, '/p'), row(other, `/p/.superlite/worktrees/sessions/${other}`)],
  })
}
const launch = (id: string, t: number) => `{"ev":"launch","t":${t},"agent_id":"${id}","type":"superlite:implementer","desc":"D ${id}"}`

describe('graph stability (resync)', () => {
  const T = 'C:/t/subagents/agent-a1.jsonl'
  const row = (n: number) =>
    `{"type":"assistant","timestamp":"2026-10-20T10:00:00Z","message":{"id":"m${n}","usage":{"input_tokens":${n},"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0},"content":[]}}`
  const begin = async ($: any, files: Record<string, string>) => {
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'superlite:implementer', transcript_path: 'C:/t.jsonl' })
  }

  test('tokens wait for the resync', async ($, on) => {
    const files: Record<string, string> = { 'C:/t/subagents/agent-a1.jsonl': row(1000) }
    const clock = world(on, files)
    await begin($, files)
    const ui = await mountOn($)
    await clock.advance(3000)
    const first = await svgSource(ui)
    expect(first).toContain('1.0k tok')
    files[T] = `${row(2500)} `
    await clock.advance(6000)
    expect(await svgSource(ui)).toBe(first)
    await clock.advance(60_000)
    expect(await svgSource(ui)).toContain('2.5k tok')
  })

  test('the resync re-anchors', async ($, on) => {
    const clock = world(on, {})
    await begin($, {})
    const ui = await mountOn($)
    const first = await svgSource(ui)
    await clock.advance(61_000)
    const second = await svgSource(ui)
    expect(second).not.toBe(first)
    expect(second).toContain('begin="-61s"')
    await clock.advance(1000)
    expect(await svgSource(ui)).toBe(second)
  })

  test('an agent change redraws', async ($, on) => {
    const files: Record<string, string> = {}
    const clock = world(on, files)
    await begin($, files)
    const ui = await mountOn($)
    const first = await svgSource(ui)
    await $.classic.SubagentStart({ agent_id: 'a2', agent_type: 'superlite:reviewer' })
    expect(await svgSource(ui)).not.toBe(first)
  })
})

describe('superlite session', () => {
  test('one named session, only its fresh agents, an accent; follows session use', async ($, on) => {
    const files: Record<string, string> = {
      '/p/.superlite/sessions.json': reg('a'),
      '/p/.superlite/metrics.jsonl': [launch('r0', 1000), launch('r1', 9000)].join('\n'),
    }
    const clock = world(on, files)
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.command.run({ ...OPEN, args: '/p' })
    const ui = await mountOn($)
    expect(await ui.find({ type: 'Text', text: /a · superlite\/sessions\/a/ })).toBeDefined()
    expect(await ui.find({ key: 'card-r1' })).toBeDefined()
    expect(await ui.find({ key: 'card-r0' })).toBeUndefined()
    const svgA = await svgSource(ui)
    expect(svgA).toContain('data-accent')

    files['/p/.superlite/sessions.json'] = reg('b')
    files['/p/.superlite/metrics.jsonl'] = launch('q1', 9000)
    await clock.advance(3000)
    expect(await ui.find({ type: 'Text', text: /b · superlite\/sessions\/b/ })).toBeDefined()
    expect(await ui.find({ key: 'card-q1' })).toBeDefined()
    expect(await ui.find({ key: 'card-r1' })).toBeUndefined()
    expect(await svgSource(ui)).not.toBe(svgA)
    expect(await svgSource(ui)).toContain('data-accent')
  })

  test('the working directory is the session folder', async ($, on) => {
    world(on, {
      '/p/.superlite/sessions.json': reg('a'),
      '/p/.superlite/worktrees/sessions/b/.superlite/metrics.jsonl': launch('q1', 9000),
    })
    await $.command.run({ ...OPEN, args: '/p/.superlite/worktrees/sessions/b' })
    const ui = await mountOn($)
    expect(await ui.find({ type: 'Text', text: /b · superlite\/sessions\/b/ })).toBeDefined()
    expect(await ui.find({ key: 'card-q1' })).toBeDefined()
  })

  test('no registry: no superlite session', async ($, on) => {
    world(on, FILES)
    await $.command.run({ ...OPEN, args: '' })
    const ui = await mountOn($)
    expect(await ui.find({ type: 'Text', text: /no superlite session/ })).toBeDefined()
  })

  test('per-session folder: the next session starts at the working directory', async ($, on) => {
    world(on, { '/other/.superlite/metrics.jsonl': launch('o1', 1) })
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.command.run({ ...OPEN, args: '/other' })
    expect(await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: props() }).then((u: any) => u.find({ key: 'card-o1' }))).toBeDefined()
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    const r = await $.command.run({ ...OPEN, args: '' })
    expect(r).toEqual({ text: 'Agent map opened (no .superlite records here; live events only).' })
  })
})

describe('auto-open', () => {
  const spawn = ($: any, id: string, type = 'Explore') => $.classic.SubagentStart({ agent_id: id, agent_type: type })
  const stop = ($: any, id: string, type = 'Explore') =>
    $.classic.SubagentStop({ agent_id: id, agent_type: type, stop_hook_active: false, agent_transcript_path: '', last_assistant_message: '' })

  test('a subagent run opens the pane once per run', async ($, on) => {
    const clock = world(on, {})
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await clock.advance(1000)
    await spawn($, 'x1')
    expect(opens).toBe(1)
    await clock.advance(1000)
    await spawn($, 'x2')
    expect(opens).toBe(1)
    await stop($, 'x1')
    await stop($, 'x2')
    await clock.advance(1000)
    await spawn($, 'x3')
    expect(opens).toBe(2)
  })

  test('superlite mode', { options: { autoOpen: 'superlite' } }, async ($, on) => {
    const clock = world(on, {})
    await clock.advance(1000)
    await spawn($, 'x1')
    expect(opens).toBe(0)
    await clock.advance(1000)
    await spawn($, 'x2', 'superlite:implementer')
    expect(opens).toBe(1)
  })

  test('off mode: nothing opens, the command still does', { options: { autoOpen: 'off' } }, async ($, on) => {
    world(on, {})
    await spawn($, 'x1', 'superlite:implementer')
    expect(opens).toBe(0)
    await $.command.run({ ...OPEN, args: '' })
    expect(opens).toBe(1)
  })

  test('closed pane stays closed within the run', async ($, on) => {
    const clock = world(on, {})
    await clock.advance(1000)
    await spawn($, 'x1')
    expect(opens).toBe(1)
    // the person closes the pane here: nothing of ours reopens it within the run
    await clock.advance(1000)
    await spawn($, 'x2')
    expect(opens).toBe(1)
  })

  test('pool.json appearing for the session opens it on the next refresh', async ($, on) => {
    const files: Record<string, string> = { '/p/.superlite/sessions.json': reg('a') }
    const clock = world(on, files)
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.command.run({ ...OPEN, args: '/p' })
    const before = opens
    await clock.advance(3000)
    expect(opens).toBe(before)
    files['/p/.superlite/pool.json'] = '{"agents":[{"id":"r1","tasks":["T1"],"tier":"sonnet"}]}'
    await clock.advance(3000)
    expect(opens).toBe(before + 1)
    await clock.advance(6000)
    expect(opens).toBe(before + 1)
  })
})

describe('auto-open: pool.json rewrites', () => {
  const POOL = (n: number) => `{"agents":[{"id":"r1","tasks":["T1"],"tier":"sonnet"}],"n":${'1'.repeat(n)}}`

  test('a pool.json rewrite is not a new run (no launch rows)', async ($, on) => {
    const files: Record<string, string> = { '/p/.superlite/sessions.json': reg('a') }
    const clock = world(on, files)
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.command.run({ ...OPEN, args: '/p' })
    const before = opens
    files['/p/.superlite/pool.json'] = POOL(1)
    await clock.advance(3000)
    expect(opens).toBe(before + 1)
    // the person closes the pane; superlite rewrites pool.json twice
    files['/p/.superlite/pool.json'] = POOL(5)
    await clock.advance(3000)
    files['/p/.superlite/pool.json'] = POOL(9)
    await clock.advance(3000)
    expect(opens).toBe(before + 1)
  })

  test('with launch rows, rewrites keep the run and a new first launch opens it', async ($, on) => {
    const files: Record<string, string> = {
      '/p/.superlite/sessions.json': reg('a'),
      '/p/.superlite/pool.json': POOL(1),
      '/p/.superlite/metrics.jsonl': launch('r1', 9000),
    }
    const clock = world(on, files)
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.command.run({ ...OPEN, args: '/p' })
    const before = opens
    files['/p/.superlite/pool.json'] = POOL(5)
    await clock.advance(3000)
    files['/p/.superlite/pool.json'] = POOL(9)
    files['/p/.superlite/metrics.jsonl'] = [launch('r1', 9000), launch('r2', 12000)].join('\n')
    await clock.advance(3000)
    expect(opens).toBe(before)
    // a new run: its first launch is later, after the agents finished
    files['/p/.superlite/metrics.jsonl'] = launch('r3', 50000)
    await clock.advance(3000)
    expect(opens).toBe(before + 1)
  })
})

describe('ledger box', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `L${i}`)
  const PROG = { '.superlite/progress.md': lines.join('\n') }
  for (const surface of SURFACES) {
    test(`scrolls in its own box (${surface})`, async ($, on) => {
      const files: Record<string, string> = { ...PROG }
      const clock = world(on, files)
      await $.session.start({ source: 'startup', cwd: '/' } as never)
      await $.command.run({ ...OPEN, args: '' })
      const ui = await mountOn($, surface)
      const box = async () => (await ui.find({ key: 'ledger-main' }))?.text ?? ''
      expect(await box()).toContain('L39')
      expect(await box()).not.toContain('L29')
      expect((await ui.find({ key: 'ledger-older-main' }))?.text).toContain('▲ older (30)')
      const svg = surface === 'desktop' ? await svgSource(ui) : ''
      await ui.press({ key: 'ledger-older-main' })
      expect(await box()).toContain('L29')
      expect(await box()).not.toContain('L39')
      expect(await ui.find({ key: 'ledger-newer-main' })).toBeDefined()
      if (surface === 'desktop') expect(await svgSource(ui)).toBe(svg)
      files['.superlite/progress.md'] = [...lines, 'L40'].join('\n')
      await clock.advance(3000)
      expect(await box()).toContain('L29')
      expect((await ui.find({ key: 'ledger-newer-main' }))?.text).toContain('11')
      await ui.press({ key: 'ledger-end-main' })
      expect(await box()).toContain('L40')
      expect(await ui.find({ key: 'ledger-newer-main' })).toBeUndefined()
    })
  }

  test('the wheel moves the ledger once the pane is at its end', async ($, on) => {
    world(on, { ...PROG })
    on('ui.scroll', () => ({}))
    await $.command.run({ ...OPEN, args: '' })
    const ui = await mountOn($, 'terminal', { ...props(), scroll: { offset: 30, bodyRows: 10 } })
    await $.ui.scroll({ component: 'Pane', requestId: PANE, offset: 30, by: -3, bodyRows: 10, contentRows: 40, origin: { kind: 'person' } } as never)
    expect((await ui.find({ key: 'ledger-main' }))?.text).toContain('L27')
  })

  test('a card details show its ledger lines in a box', async ($, on) => {
    world(on, { ...FILES, '.superlite/progress.md': 'sent T3+T4 to r1\nT3 note\ncheckpoint T3 abc' })
    await $.command.run({ ...OPEN, args: '' })
    const ui = await mountOn($, 'terminal')
    await ui.press({ key: 'card-r1' })
    expect(await ui.find({ key: 'ledger-r1' })).toBeDefined()
  })
})

describe('task names', () => {
  const POOL = (current?: string) =>
    JSON.stringify({ agents: [{ id: 'r1', tasks: ['T3', 'T4'], current, type: 'superlite:implementer' }] })
  const named = (current = 'T7'): Record<string, string> => ({
    '/p/.superlite/sessions.json': reg('a'),
    '/p/.superlite/checkpoints.json': '{"plan":"docs/plans/x.proto.md"}',
    '/p/docs/plans/x.proto.md': '### T3 session scope · Complexity 4\n### T7 pane wiring · Complexity 7\n',
    '/p/.superlite/metrics.jsonl': '{"ev":"launch","t":9000,"agent_id":"r1","type":"superlite:implementer","desc":"Implementer for T3"}',
    '/p/.superlite/pool.json': POOL(current),
  })

  for (const surface of SURFACES) {
    test(`titles, tasks and details carry the names (${surface})`, async ($, on) => {
      world(on, named())
      await $.command.run({ ...OPEN, args: '/p' })
      const ui = await mountOn($, surface)
      const card = await ui.find({ key: 'card-r1' })
      expect(card?.text).toContain('T7 · pane wiring')
      expect(card?.text).toContain('T3 · session scope')
      if (surface === 'desktop') {
        const svg = await svgSource(ui)
        expect(svg).toContain('T7 · pane wiring')
        expect(svg).toMatch(/<title>[^<]*T3 · session scope/)
      }
      await ui.press({ key: 'card-r1' })
      expect(await ui.find({ type: 'Text', text: /T3 · session scope/ })).toBeDefined()
    })
  }

  test('a moved current changes the title and the SVG', async ($, on) => {
    const files = named()
    const clock = world(on, files)
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.command.run({ ...OPEN, args: '/p' })
    const ui = await mountOn($)
    const first = await svgSource(ui)
    files['/p/.superlite/pool.json'] = POOL('T3 ')
    await clock.advance(3000)
    expect((await ui.find({ key: 'card-r1' }))?.text).toContain('T3 · session scope')
    expect(await svgSource(ui)).not.toBe(first)
  })

  test('idle unnamed task shows a tick; Explore keeps its description', async ($, on) => {
    const files = named('')
    world(on, files)
    await $.classic.SubagentStart({ agent_id: 'x1', agent_type: 'Explore' })
    await $.command.run({ ...OPEN, args: '/p' })
    const ui = await mountOn($)
    expect((await ui.find({ key: 'card-r1' }))?.text).toContain('T4 ✓')
    expect(await ui.find({ key: 'card-x1' })).toBeDefined()
  })

  test('the plan is re-read only when its mtime moves', async ($, on) => {
    const files = named()
    const clock = world(on, files)
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.command.run({ ...OPEN, args: '/p' })
    const ui = await mountOn($)
    const first = await svgSource(ui)
    // same length, so the same mtime in this world: not read again
    files['/p/docs/plans/x.proto.md'] = files['/p/docs/plans/x.proto.md']!.replace('pane wiring', 'pane wirinG')
    await clock.advance(6000)
    expect(await svgSource(ui)).toBe(first)
    files['/p/docs/plans/x.proto.md'] += '### T9 later · x\n'
    await clock.advance(3000)
    expect(await svgSource(ui)).toContain('pane wirinG')
  })

  test('no plan: ids alone, no error', async ($, on) => {
    const files = named()
    delete files['/p/.superlite/checkpoints.json']
    world(on, files)
    await $.command.run({ ...OPEN, args: '/p' })
    const ui = await mountOn($)
    const card = await ui.find({ key: 'card-r1' })
    expect(card?.text).toContain('T7')
    expect(card?.text).not.toContain('pane wiring')
  })
})

describe('hide finished', () => {
  const stop = (id: string) => `{"ev":"stop","t":5000,"agent_id":"${id}","type":"superlite:implementer"}`
  const seed = (): Record<string, string> => ({
    '.superlite/metrics.jsonl': [launch('d1', 1000), launch('d2', 1000), launch('d3', 1000), stop('d1'), stop('d2'), stop('d3')].join('\n'),
  })
  const run = ($: any) => $.classic.SubagentStart({ agent_id: 'x1', agent_type: 'superlite:implementer' })
  const present = async (ui: any) => {
    const out: string[] = []
    for (const id of ['d1', 'd2', 'd3', 'x1']) if (await ui.find({ key: `card-${id}` })) out.push(id)
    return out
  }

  for (const surface of SURFACES) {
    test(`hides finished by default; the button toggles (${surface})`, async ($, on) => {
      world(on, seed(), {})
      await $.command.run({ ...OPEN, args: '' })
      await run($)
      const ui = await mountOn($, surface)
      expect(await present(ui)).toEqual(['x1'])
      expect((await ui.find({ key: 'toggle-finished' }))?.text).toBe('Show finished (3)')
      const hiddenSvg = surface === 'desktop' ? await svgSource(ui) : ''
      await ui.press({ key: 'toggle-finished' })
      expect(await present(ui)).toEqual(['d1', 'd2', 'd3', 'x1'])
      expect((await ui.find({ key: 'toggle-finished' }))?.text).toBe('Hide finished')
      if (surface === 'desktop') expect(await svgSource(ui)).not.toBe(hiddenSvg)
      await ui.press({ key: 'toggle-finished' })
      expect(await present(ui)).toEqual(['x1'])
      if (surface === 'desktop') expect(await svgSource(ui)).toBe(hiddenSvg)
    })

    test(`all finished: no running agents (${surface})`, async ($, on) => {
      world(on, seed(), {})
      await $.command.run({ ...OPEN, args: '' })
      const ui = await mountOn($, surface)
      expect(await present(ui)).toEqual([])
      expect(await ui.find({ type: 'Text', text: /No running agents/ })).toBeDefined()
      expect((await ui.find({ key: 'toggle-finished' }))?.text).toBe('Show finished (3)')
    })
  }

  for (const surface of SURFACES) {
    test(`the toggle is always drawn: no agents, and nothing finished (${surface})`, async ($, on) => {
      world(on, {}, {})
      await $.command.run({ ...OPEN, args: '' })
      const empty = await mountOn($, surface)
      expect((await empty.find({ key: 'toggle-finished' }))?.text).toBe('Show finished (0)')
      await empty.unmount()
      await run($)
      const ui = await mountOn($, surface)
      expect((await ui.find({ key: 'toggle-finished' }))?.text).toBe('Show finished (0)')
      await ui.press({ key: 'toggle-finished' })
      expect((await ui.find({ key: 'toggle-finished' }))?.text).toBe('Hide finished')
    })
  }

  test('a done parent of a running child stays', async ($, on) => {
    world(on, seed(), {})
    on('agent.spawn', () => ({ agentId: 'x1', model: 'm' }) as never)
    await $.classic.SubagentStart({ agent_id: 'p1', agent_type: 'superlite:implementer' })
    await $.classic.SubagentStop({ agent_id: 'p1', agent_type: 'superlite:implementer', stop_hook_active: false, agent_transcript_path: '', last_assistant_message: '' })
    await $.agent.spawn({ subagentType: 'superlite:implementer', description: 'c', prompt: 'c', parentAgentId: 'p1' } as never)
    await $.command.run({ ...OPEN, args: '' })
    const ui = await mountOn($)
    expect(await ui.find({ key: 'card-p1' })).toBeDefined()
    expect(await ui.find({ key: 'card-x1' })).toBeDefined()
    expect(await ui.find({ key: 'card-d1' })).toBeUndefined()
  })

  test('the choice survives a new session.start; the header counts stay complete', async ($, on) => {
    world(on, seed(), {})
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.command.run({ ...OPEN, args: '' })
    await run($)
    const ui = await mountOn($)
    expect(await ui.find({ type: 'Text', text: /4 agents · 1 active/ })).toBeDefined()
    await ui.press({ key: 'toggle-finished' })
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.command.run({ ...OPEN, args: '' })
    await ui.unmount()
    expect(await present(await mountOn($))).toEqual(['d1', 'd2', 'd3', 'x1'])
  })

  test('no press, no change: the SVG source is identical', async ($, on) => {
    const clock = world(on, seed(), {})
    await $.session.start({ source: 'startup', cwd: '/' } as never)
    await $.command.run({ ...OPEN, args: '' })
    await run($)
    const ui = await mountOn($)
    const first = await svgSource(ui)
    await clock.advance(6000)
    expect(await svgSource(ui)).toBe(first)
  })
})
