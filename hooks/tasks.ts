export function planPathFrom(texts: { checkpoints?: string; feature?: string; orchestrator?: string }): string | undefined {
  const pick = (text: string | undefined, key: string): string | undefined => {
    if (!text) return undefined
    try {
      const v = JSON.parse(text)?.[key]
      return typeof v === 'string' && v ? v : undefined
    } catch {
      return undefined
    }
  }
  return pick(texts.checkpoints, 'plan') ?? pick(texts.feature, 'plan') ?? pick(texts.orchestrator, 'review_path')
}

export function parseTaskNames(planText: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of planText.split(/\r?\n/)) {
    const m = /^### (T\d+) (.*)$/.exec(line)
    if (!m) continue
    const rest = m[2]
    const i = rest.indexOf(' · ')
    const name = (i < 0 ? rest : rest.slice(0, i)).trim()
    if (name) out[m[1]] = name
  }
  return out
}

export function taskLabel(id: string, names: Record<string, string>): string {
  return names[id] ? `${id} · ${names[id]}` : id
}

export function agentTitle(
  a: { type?: string; description?: string; current?: string; tasks: string[]; doneTasks: string[] },
  names: Record<string, string>,
): string {
  const fallback = a.description || a.type || ''
  if (!a.type || !a.type.startsWith('superlite:')) return fallback
  const ids = (a.current ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (ids.length) return taskLabel(ids[0], names) + (ids.length > 1 ? ` +${ids.length - 1}` : '')
  if (a.tasks.length) return taskLabel(a.tasks[a.tasks.length - 1], names) + ' ✓'
  return fallback
}
