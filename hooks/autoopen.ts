// Run keys for opening the agent map by itself once per run. Pure: no `$`.
export type AutoOpen = 'agents' | 'superlite' | 'off'

export function autoOpenMode(options: unknown): AutoOpen {
  const v = options && typeof options === 'object' ? (options as { autoOpen?: unknown }).autoOpen : undefined
  return v === 'agents' || v === 'superlite' || v === 'off' ? v : 'agents'
}

/** The run key a subagent spawn belongs to; undefined when the mode does not open for it. */
export function spawnRunKey(
  mode: AutoOpen,
  s: { type?: string; at: number; wasIdle: boolean; slug?: string; current?: string },
): string | undefined {
  if (mode === 'off') return undefined
  const isSuperlite = (s.type ?? '').startsWith('superlite:')
  if (mode === 'superlite' && !isSuperlite) return undefined
  // a spawn after idle is a new run; otherwise it joins the run in progress
  if (!s.wasIdle && s.current) return s.current
  return `${isSuperlite ? s.slug || 'superlite' : 'agents'}:${s.at}`
}

/** The run key the superlite files show; the run start is the pool's mtime, the first launch, or a building feature's start. */
export function fileRunKey(
  mode: AutoOpen,
  f: { slug?: string; poolMtime?: number; firstLaunchT?: number; featureBuilding?: boolean; startedT?: number },
): string | undefined {
  if (mode === 'off' || !f.slug) return undefined
  const start = f.poolMtime ?? f.firstLaunchT ?? (f.featureBuilding ? f.startedT : undefined)
  return start === undefined ? undefined : `${f.slug}:${start}`
}

export function shouldOpen(key: string | undefined, opened: string | undefined): boolean {
  return key !== undefined && key !== opened
}
