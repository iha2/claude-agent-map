import { describe, expect, test } from 'claude-code/testing'

import { visibleCards } from '../hooks/filter'
import type { Card } from '../hooks/model'

const card = (id: string, status: 'running' | 'done', parent?: string) =>
  ({ id, status, parent, type: '', description: '', tasks: [], doneTasks: [], isActive: status === 'running', isKnownLive: true }) as Card

describe('visible cards', () => {
  test('running plus ancestors', () => {
    const a = card('a', 'done')
    const b = card('b', 'running', 'a')
    const c = card('c', 'done')
    expect(visibleCards([a, b, c], true)).toEqual({ shown: [a, b], hidden: 1 })
  })

  test('all done', () => {
    expect(visibleCards([card('a', 'done'), card('c', 'done')], true)).toEqual({ shown: [], hidden: 2 })
  })

  test('hideDone false shows all', () => {
    const all = [card('a', 'done'), card('b', 'running')]
    expect(visibleCards(all, false)).toEqual({ shown: all, hidden: 0 })
  })

  test('parent cycle does not hang', () => {
    const a = card('a', 'done', 'b')
    const b = card('b', 'running', 'a')
    expect(visibleCards([a, b], true)).toEqual({ shown: [a, b], hidden: 0 })
  })

  test('missing parent is ignored', () => {
    const b = card('b', 'running', 'zz')
    expect(visibleCards([b], true)).toEqual({ shown: [b], hidden: 0 })
  })
})
