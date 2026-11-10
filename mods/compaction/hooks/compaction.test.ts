import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import {
  BACKSTOP_TOKENS,
  GOAL_TOKENS,
  IDLE_MS,
  MAX_RESUME,
  RESUME_DEFAULT,
  RUNWAY_TOKENS,
  type Entry,
  points,
} from './compaction'

const WINDOW = 1_000_000

/** The usage the session answers beneath the mod: `tokens` used, the engine compacting at `autoAt`. */
const usage = (tokens: number, autoAt: number, window = WINDOW) =>
  ({
    startedAt: 0,
    context: {
      tokens,
      window,
      percent: Math.round((tokens / window) * 100),
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

test("an engine point above the goal's is room to run on judgement, not a setting to fix", async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.usage', () => ({ value: usage(200_000, 667_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = String((await $.tool.call({ tool: 'mcp__compaction__context' })).result)

  expect(text).toContain(
    "the engine compacts at 667,000; past the 300,000 goal, compacting is the thread's call up to there",
  )
  expect(text).not.toContain('line them up')
  expect(text).not.toContain('set the goal to')
})

test("an engine point below the goal's names autoCompactWindow, since the goal is never reached", async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.usage', () => ({ value: usage(200_000, 200_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = String((await $.tool.call({ tool: 'mcp__compaction__context' })).result)

  expect(text).toContain('the engine compacts at 200,000, below the 267,000 this goal implies')
  expect(text).toContain('`autoCompactWindow`')
  expect(text).toContain('`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`')
  expect(text).toContain('set the goal to 233,000')
})

test("a goal wider than the model's window is set lower, since no setting moves the engine past it", async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.usage', () => ({ value: usage(100_000, 167_000, 200_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = String((await $.tool.call({ tool: 'mcp__compaction__context' })).result)

  expect(text).toContain("the 300,000 goal is wider than this model's 200,000-token window")
  expect(text).toContain('Set the goal to 200,000')
  expect(text).not.toContain('`autoCompactWindow`')
  expect(text).not.toContain('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE')
})

test("an engine point above its implied point is neither room nor a fault, so no note", async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.usage', () => ({ value: usage(200_000, 285_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = String((await $.tool.call({ tool: 'mcp__compaction__context' })).result)

  expect(text).toContain('automatic compaction at 285,000')
  expect(text).not.toContain('Note:')
})

test("an engine point at the goal itself is neither room nor a fault, so no note", async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.usage', () => ({ value: usage(200_000, 300_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = String((await $.tool.call({ tool: 'mcp__compaction__context' })).result)

  expect(text).toContain('automatic compaction at 300,000')
  expect(text).not.toContain('Note:')
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

/** A session at 240k with a request made and its turn ended, its command and submits recorded. */
async function compacted(
  $: Engine,
  on: On,
  request: Readonly<Record<string, string>>,
  fail: { readonly compact?: boolean; readonly submit?: boolean } = {},
) {
  const log = kept(on)
  const clock = mock.clock(on)
  const commands: { command: string; args?: string }[] = []
  const submitted: string[] = []
  on('session.usage', () => ({ value: usage(240_000, 267_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.run', (_, e) => {
    commands.push({ command: e.command, args: e.args })
    if (fail.compact) throw new Error('compact broke')

    return {}
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    if (fail.submit) throw new Error('submit broke')

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__compaction__request', ...request })
  await $.turn.complete({
    answer: 'done',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  await clock.advance(IDLE_MS)

  const last = String((await $.tool.call({ tool: 'mcp__compaction__context' })).result)
  return { commands, submitted, outcomes: log.entries().map((e) => e.outcome), last }
}

const ASKED = { instructions: 'keep the merge order', reasoning: 'the reviews are spent' }

test('a request naming a resume prompt submits exactly that, after /compact', async ($, on) => {
  const resume = 'Pick up the third merge; the queue is in RESUME.md.'
  const run = await compacted($, on, { ...ASKED, resume })

  expect(run.commands).toEqual([{ command: 'compact', args: 'keep the merge order' }])
  expect(run.submitted).toEqual([resume])
  expect(run.outcomes).toEqual(['recorded', 'ran', 'resumed'])
  expect(run.last).toContain('then submitted the resume prompt')
})

test('a request with no resume prompt submits the default', async ($, on) => {
  const run = await compacted($, on, ASKED)

  expect(run.submitted).toEqual([RESUME_DEFAULT])
})

test('a submit that fails is its own outcome, the compaction kept as ran', async ($, on) => {
  const run = await compacted($, on, ASKED, { submit: true })

  expect(run.outcomes).toEqual(['recorded', 'ran', 'unresumed'])
  expect(run.last).toContain('ran /compact at 240,000 tokens, but the resume prompt did not submit')
  expect(run.last).not.toContain('/compact did not run')
})

test('a /compact that fails submits nothing', async ($, on) => {
  const run = await compacted($, on, ASKED, { compact: true })

  expect(run.submitted).toEqual([])
  expect(run.outcomes).toEqual(['recorded', 'failed'])
  expect(run.last).toContain('/compact did not run:')
})

test('a resume prompt past its length is refused, the refusal naming it', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.usage', () => ({ value: usage(240_000, 267_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answered = await $.tool.call({
    tool: 'mcp__compaction__request',
    ...ASKED,
    resume: 'x'.repeat(MAX_RESUME + 1),
  })

  expect(String(answered.result)).toContain('Refused:')
  expect(String(answered.result)).toContain('"resume"')
})
