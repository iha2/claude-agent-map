import { describe, expect, test } from 'claude-code/testing'

import { agentTitle, parseTaskNames, planPathFrom, taskLabel } from '../hooks/tasks'

describe('task names', () => {
  test('planPathFrom', () => {
    expect(planPathFrom({ checkpoints: '{"plan":"docs/plans/x.proto.md"}', orchestrator: '{"review_path":"docs/plans/x.feature.md"}' })).toBe('docs/plans/x.proto.md')
    expect(planPathFrom({ checkpoints: 'nope', feature: '{"plan":"docs/plans/x.feature.md"}' })).toBe('docs/plans/x.feature.md')
    expect(planPathFrom({ orchestrator: '{"review_path":"r.md"}' })).toBe('r.md')
    expect(planPathFrom({})).toBeUndefined()
  })

  test('parseTaskNames', () => {
    expect(parseTaskNames('### T3 session scope · Complexity 4 (O-1)\n### T10 x · y')).toEqual({ T3: 'session scope', T10: 'x' })
    expect(parseTaskNames('# Feature plan\n## Goal')).toEqual({})
    expect(parseTaskNames('### T4 plain name')).toEqual({ T4: 'plain name' })
  })

  test('heading noise', () => {
    expect(parseTaskNames('### T3: x · y\n#### T3 x · y')).toEqual({})
  })

  test('taskLabel', () => {
    expect(taskLabel('T3', { T3: 'session scope' })).toBe('T3 · session scope')
    expect(taskLabel('T9', {})).toBe('T9')
  })

  test('agentTitle', () => {
    const sp = 'superlite:implementer'
    expect(agentTitle({ type: sp, description: 'Implementer for T3', current: 'T7', tasks: ['T3', 'T7'], doneTasks: ['T3'] }, { T7: 'pane wiring' })).toBe('T7 · pane wiring')
    expect(agentTitle({ type: sp, current: 'T3,T5,T4', tasks: [], doneTasks: [] }, { T3: 'session scope' })).toBe('T3 · session scope +2')
    expect(agentTitle({ type: sp, description: 'd', tasks: ['T3', 'T7'], doneTasks: ['T3', 'T7'] }, { T7: 'pane wiring' })).toBe('T7 · pane wiring ✓')
    expect(agentTitle({ type: 'Explore', description: 'list hooks', current: 'T7', tasks: ['T7'], doneTasks: [] }, {})).toBe('list hooks')
    expect(agentTitle({ type: sp, description: 'd', tasks: [], doneTasks: [] }, {})).toBe('d')
  })

  test('current with spaces', () => {
    expect(agentTitle({ type: 'superlite:implementer', current: ' T7 , T8', tasks: [], doneTasks: [] }, { T7: 'pane wiring' })).toBe('T7 · pane wiring +1')
  })
})
