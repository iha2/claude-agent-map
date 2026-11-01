import { describe, expect, test } from 'claude-code/testing'

import { emptySuperlite, mergeCards, parseRegistry, pickSession, registryPaths, slugColour } from '../hooks/model'

const REG = JSON.stringify({
  v: 2,
  active: 'a',
  host_worktree: '/p',
  sessions: [
    { slug: 'a', branch: 'superlite/sessions/a', worktree: '/p', status: 'active', created_at: 5 },
    { slug: 'b', branch: 'superlite/sessions/b', worktree: '/p/.superlite/worktrees/sessions/b', status: 'active' },
  ],
})

describe('session scope', () => {
  test('parseRegistry reads the registry keys', () => {
    expect(parseRegistry(REG)?.active).toBe('a')
    expect(parseRegistry(REG)?.host).toBe('/p')
    expect(parseRegistry(REG)?.sessions[0]).toEqual({ slug: 'a', branch: 'superlite/sessions/a', worktree: '/p', status: 'active', createdAt: 5 })
    expect(parseRegistry('nope')).toBeUndefined()
    expect(parseRegistry('[1]')).toBeUndefined()
  })

  test('registry missing fields', () => {
    const r = parseRegistry('{"sessions":[{"branch":"x"},{"slug":"z"}]}')
    expect(r?.sessions.map(s => s.slug)).toEqual(['z'])
    expect(parseRegistry('{"sessions":5}')).toEqual({ active: undefined, host: undefined, sessions: [] })
  })

  test('registryPaths walks up', () => {
    expect(registryPaths('/p/.superlite/worktrees/sessions/b/.superlite')).toEqual([
      '/p/.superlite/worktrees/sessions/b/.superlite/sessions.json',
      '/p/.superlite/worktrees/sessions/.superlite/sessions.json',
      '/p/.superlite/worktrees/.superlite/sessions.json',
      '/p/.superlite/sessions.json',
      '/.superlite/sessions.json',
    ])
    expect(registryPaths('C:/p/.superlite')).toEqual(['C:/p/.superlite/sessions.json', 'C:/.superlite/sessions.json'])
    expect(registryPaths('C:\\p\\.superlite')).toEqual(['C:/p/.superlite/sessions.json', 'C:/.superlite/sessions.json'])
  })

  test('pickSession', () => {
    const reg = parseRegistry(REG)!
    expect(pickSession(reg, '/p/.superlite/worktrees/sessions/b')?.slug).toBe('b')
    expect(pickSession(reg, '/p')?.slug).toBe('a')
    expect(pickSession(reg, '/q')).toBeUndefined()
  })

  test('pickSession ignores a parked row at the host', () => {
    const reg = parseRegistry(
      JSON.stringify({
        active: 'b',
        host_worktree: '/p',
        sessions: [
          { slug: 'a', branch: 'x/a', worktree: '/p', status: 'parked' },
          { slug: 'b', branch: 'x/b', worktree: '/p', status: 'active' },
          { slug: 'c', branch: 'x/c', worktree: '/p/.superlite/worktrees/sessions/c', status: 'active' },
        ],
      }),
    )!
    expect(pickSession(reg, '/p')?.slug).toBe('b')
    expect(pickSession(reg, '/p/')?.slug).toBe('b')
    expect(pickSession(reg, '/p/.superlite/worktrees/sessions/c')?.slug).toBe('c')
  })

  test('windows paths', () => {
    const reg = { sessions: [{ slug: 'w', branch: 'x', worktree: 'C:\\p', status: 'active' }] }
    expect(pickSession(reg, 'C:/p/')?.slug).toBe('w')
  })

  test('slugColour is stable', () => {
    expect(slugColour('a')).toBe(slugColour('a'))
    expect(slugColour('agent-map-blink')).not.toBe(slugColour('other-slug'))
    expect(slugColour('a')).toMatch(/^#[0-9a-f]{6}$/)
  })

  test('mergeCards since', () => {
    const files = {
      ...emptySuperlite(),
      launches: { r1: { id: 'r1', t: 1000 }, r2: { id: 'r2', t: 9000 }, r3: { id: 'r3', t: 100 } },
      stops: { r1: { id: 'r1', t: 1500 } },
    }
    expect(mergeCards({}, files, {}, { since: 5000 }).map(c => c.id)).toEqual(['r2'])
    const live = { r3: { id: 'r3', isActive: true } } as any
    expect(mergeCards(live, files, {}, { since: 5000 }).map(c => c.id).sort()).toEqual(['r2', 'r3'])
  })

  test('mergeCards without opts is unchanged', () => {
    const files = { ...emptySuperlite(), launches: { r1: { id: 'r1', t: 1000 } } }
    expect(mergeCards({}, files, {}, {})).toEqual(mergeCards({}, files, {}))
    expect(mergeCards({}, files, {}).length).toBe(1)
  })
})
