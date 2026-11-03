import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  BACKSTOP_TOKENS,
  GOAL_TOKENS,
  RUNWAY_TOKENS,
  type Entry,
  points,
} from './compaction'

const WINDOW = 1_000_000

/** The usage the session answers beneath the mod: `tokens` used, the engine compacting at `autoAt`. */
const usage = (tokens: number, autoAt: number) =>
  ({
    startedAt: 0,
    context: {
      tokens,
      window: WINDOW,
      percent: Math.round((tokens / WINDOW) * 100),
      breakdown: { autoCompactThreshold: autoAt },
    },
    rateLimits: [],
  }) as never

/** A store the test keeps, since the test's own `$` carries no store noun. */
function kept(on: On): { readonly entries: () => readonly Entry[] } {
  let held: readonly Entry[] = []

  on('store.get', () => ({ value: held }))
  on('store.set', (_, e) => {
    held = (e.value ?? []) as readonly Entry[]

    return { value: undefined }
  })

  return { entries: () => held }
}

test('the goal alone sets both points', () => {
  expect(points({})).toEqual({
    goalTokens: GOAL_TOKENS,
    floorTokens: GOAL_TOKENS / 2,
    prepareTokens: GOAL_TOKENS - RUNWAY_TOKENS,
  })
})

test('a wider goal carries the floor and the prepare point with it', () => {
  expect(points({ goalTokens: 700_000 })).toEqual({
    goalTokens: 700_000,
    floorTokens: 350_000,
    prepareTokens: 620_000,
  })
})

test('an override replaces the point it names, the goal standing', () => {
  expect(points({ goalTokens: 300_000, prepareTokens: 267_000 })).toEqual({
    goalTokens: 300_000,
    floorTokens: 150_000,
    prepareTokens: 267_000,
  })
})

test('a value that is not a whole number above zero falls back to the derivation', () => {
  expect(points({ goalTokens: 0 })).toEqual(points({}))
  expect(points({ goalTokens: 300_000, floorTokens: -1, prepareTokens: 1.5 })).toEqual(points({}))
})

test('a prepare point under the floor is raised to it, so it names no refused request', () => {
  expect(points({ goalTokens: 300_000, prepareTokens: 100_000 })).toEqual({
    goalTokens: 300_000,
    floorTokens: 150_000,
    prepareTokens: 150_000,
  })
})

test('the context tool reports the goal and the points it implies', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.usage', () => ({ value: usage(200_000, GOAL_TOKENS - BACKSTOP_TOKENS) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = String((await $.tool.call({ tool: 'mcp__compaction__context' })).result)

  expect(text).toContain('a goal of 300,000')
  expect(text).toContain('requests from 150,000')
  expect(text).toContain('prepare point at 220,000')
  expect(text).toContain('past the request floor, below the prepare point.')
  expect(text).not.toContain('autoCompactWindow')
})

test("the report names autoCompactWindow when the engine's point does not follow the goal", async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.usage', () => ({ value: usage(200_000, 667_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = String((await $.tool.call({ tool: 'mcp__compaction__context' })).result)

  expect(text).toContain('the engine compacts at 667,000, not the 267,000 this goal implies')
  expect(text).toContain('`autoCompactWindow`')
  expect(text).toContain('set the goal to 700,000')
})

test('a recorded request keeps its reasoning across sessions', async ($, on) => {
  const log = kept(on)
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.usage', () => ({ value: usage(240_000, 267_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answered = await $.tool.call({
    tool: 'mcp__compaction__request',
    instructions: 'keep the merge order and the open asks',
    reasoning: 'the review rounds are spent and the next stretch is three merges',
  })

  expect(String(answered.result)).toContain('Recorded.')

  const entries = log.entries()
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    outcome: 'recorded',
    instructions: 'keep the merge order and the open asks',
    reasoning: 'the review rounds are spent and the next stretch is three merges',
    tokens: 240_000,
    goalTokens: 300_000,
    prepareTokens: 220_000,
    autoAt: 267_000,
    at: 1_700_000_000_000,
  })
})

test('a request with no reasoning is refused, and the refusal is kept too', async ($, on) => {
  const log = kept(on)
  mock.clock(on)
  on('session.usage', () => ({ value: usage(240_000, 267_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answered = await $.tool.call({
    tool: 'mcp__compaction__request',
    instructions: 'keep the merge order',
  })

  expect(String(answered.result)).toContain('Refused:')
  expect(String(answered.result)).toContain('"reasoning"')

  const entries = log.entries()
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ outcome: 'refused', autoAt: 267_000, tokens: 240_000 })
})

test('a clock that throws costs the reading, never the request', async ($, on) => {
  kept(on)
  on('clock.now', () => {
    throw new Error('no clock')
  })
  on('session.usage', () => ({ value: usage(240_000, 267_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answered = await $.tool.call({
    tool: 'mcp__compaction__request',
    instructions: 'keep the merge order',
    reasoning: 'the clock is beside the point',
  })

  expect(String(answered.result)).toContain('Recorded.')

  const text = String((await $.tool.call({ tool: 'mcp__compaction__context' })).result)
  expect(text).toContain('Pending request: "keep the merge order"')
})

test('a request below the floor is refused, the floor named as the goal implies it', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.usage', () => ({ value: usage(120_000, 267_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answered = await $.tool.call({
    tool: 'mcp__compaction__request',
    instructions: 'keep the merge order',
    reasoning: 'it feels long',
  })

  expect(String(answered.result)).toContain('below the request floor (150,000)')
})
