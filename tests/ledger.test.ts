import { describe, expect, test } from 'claude-code/testing'

import { LEDGER_ROWS, ledgerMove, ledgerWindow } from '../hooks/ledger'

const L = Array.from({ length: 40 }, (_, i) => `L${i}`)

describe('ledger window', () => {
  test('rows constant', () => expect(LEDGER_ROWS).toBe(10))

  test('pinned to the end', () => {
    expect(ledgerWindow(L, null)).toEqual({ shown: L.slice(30), start: 30, older: 30, newer: 0 })
  })

  test('scrolled', () => {
    expect(ledgerWindow(L, 5)).toEqual({ shown: L.slice(5, 15), start: 5, older: 5, newer: 25 })
  })

  test('clamps', () => {
    expect(ledgerWindow(L, 99).start).toBe(30)
    expect(ledgerWindow(L, -3).start).toBe(0)
  })

  test('short ledger', () => {
    expect(ledgerWindow(['a', 'b'], null)).toEqual({ shown: ['a', 'b'], start: 0, older: 0, newer: 0 })
  })

  test('rows 0 or negative count as 1', () => {
    expect(ledgerWindow(L, null, 0).shown).toEqual(['L39'])
    expect(ledgerWindow(L, null, -4).shown).toEqual(['L39'])
  })

  test('ledgerMove', () => {
    expect(ledgerMove(40, null, -3)).toBe(27)
    expect(ledgerMove(40, 27, 3)).toBe(null)
    expect(ledgerMove(40, 0, -5)).toBe(0)
    expect(ledgerMove(5, null, -3)).toBe(null)
  })
})
