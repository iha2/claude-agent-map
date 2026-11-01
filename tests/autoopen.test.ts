import { describe, expect, test } from 'claude-code/testing'

import { autoOpenMode, fileRunKey, shouldOpen, spawnRunKey } from '../hooks/autoopen'

describe('auto-open keys', () => {
  test('autoOpenMode', () => {
    expect(autoOpenMode({ autoOpen: 'off' })).toBe('off')
    expect(autoOpenMode({ autoOpen: 'superlite' })).toBe('superlite')
    expect(autoOpenMode(undefined)).toBe('agents')
    expect(autoOpenMode({ autoOpen: 'x' })).toBe('agents')
  })

  test('spawnRunKey', () => {
    expect(spawnRunKey('agents', { type: 'Explore', at: 10, wasIdle: true })).toBe('agents:10')
    expect(spawnRunKey('agents', { type: 'Explore', at: 20, wasIdle: false, current: 'agents:10' })).toBe('agents:10')
    expect(spawnRunKey('superlite', { type: 'Explore', at: 10, wasIdle: true })).toBeUndefined()
    expect(spawnRunKey('superlite', { type: 'superlite:implementer', at: 10, wasIdle: true, slug: 'a' })).toBe('a:10')
    expect(spawnRunKey('agents', { type: 'superlite:implementer', at: 30, wasIdle: false, slug: 'a', current: 'a:10' })).toBe('a:10')
    expect(spawnRunKey('off', { type: 'superlite:implementer', at: 10, wasIdle: true, slug: 'a' })).toBeUndefined()
  })

  test('superlite slug missing', () => {
    expect(spawnRunKey('superlite', { type: 'superlite:x', at: 1, wasIdle: true })).toBe('superlite:1')
  })

  test('idle after a superlite run', () => {
    expect(spawnRunKey('agents', { type: 'superlite:x', at: 50, wasIdle: true, slug: 'a', current: 'a:10' })).toBe('a:50')
  })

  test('no current without idle starts a key', () => {
    expect(spawnRunKey('agents', { type: 'Explore', at: 7, wasIdle: false })).toBe('agents:7')
  })

  test('fileRunKey', () => {
    expect(fileRunKey('agents', { slug: 'a', poolMtime: 500 })).toBe('a:500')
    expect(fileRunKey('superlite', { slug: 'a', firstLaunchT: 700 })).toBe('a:700')
    expect(fileRunKey('agents', { poolMtime: 500 })).toBeUndefined()
    expect(fileRunKey('off', { slug: 'a', poolMtime: 500 })).toBeUndefined()
    expect(fileRunKey('agents', { slug: 'a', featureBuilding: true, startedT: 9 })).toBe('a:9')
    expect(fileRunKey('agents', { slug: 'a', startedT: 9 })).toBeUndefined()
  })

  test('shouldOpen', () => {
    expect(shouldOpen('a:1', 'a:1')).toBe(false)
    expect(shouldOpen('a:2', 'a:1')).toBe(true)
    expect(shouldOpen(undefined, 'a')).toBe(false)
    expect(shouldOpen('a:1', undefined)).toBe(true)
  })
})
