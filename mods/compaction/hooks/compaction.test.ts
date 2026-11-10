import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import {
  AFTER_NOTE,
  BACKSTOP_TOKENS,
  GOAL_TOKENS,
  IDLE_MS,
  MAX_RESUME,
  RESUME_DEFAULT,
  RUNWAY_TOKENS,
  type Entry,
  points,
  prepareNote,
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

/** What a compaction leaves: one message, the summary. */
const SUMMARY = [{ role: 'user' as const, text: 'the summary', toolUses: [] }]

/** How the world beneath the mod answers: each call's failure shape, and the first compaction's. */
type World = {
  /**
   * `throws` rejects; `fails` resolves with the output text, as the engine does when it cannot
   * compact; `fails beside another` does so while another compaction goes through within it.
   */
  readonly compact?: 'throws' | 'fails' | 'fails beside another'
  /** `throws` rejects; `drops` resolves `{ drop }`, as a hook's refusal does. */
  readonly submit?: 'throws' | 'drops'
  /** The first compaction is skipped by a hook beneath, or held until `release`. */
  readonly first?: 'skipped' | 'held' | 'held, then skipped'
  /** Runs after the turn ends and before the wait passes; `after`, once it has. */
  readonly meanwhile?: () => Promise<unknown>
  readonly after?: (commands: readonly unknown[]) => Promise<unknown>
  /** As the timer reads the context: the held compaction is released, or a main turn starts. */
  readonly onRead?: 'release' | 'turn'
}

/** A gate the held compaction waits on. */
let release: () => void = () => undefined

/** A session at 240k with a request made and its turn ended, its command and submits recorded. */
async function compacted($: Engine, on: On, request: Readonly<Record<string, string>>, world: World = {}) {
  const log = kept(on)
  const clock = mock.clock(on)
  const commands: { command: string; args?: string }[] = []
  const submitted: string[] = []
  const carried: (readonly string[])[] = []
  let compactions = 0
  let reads = 0
  on('session.usage', () => {
    reads += 1
    if (world.onRead === 'release' && reads > 2) release()
    if (world.onRead === 'turn' && reads === 3) void $.turn.start({ text: 'more', turnId: 't2' })

    return { value: usage(240_000, 267_000) }
  })
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.compact', async () => {
    compactions += 1
    if (compactions === 1 && world.first === 'skipped') return { skip: 'a hook beneath said no' }
    if (compactions === 1 && world.first?.startsWith('held')) {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      if (world.first === 'held, then skipped') return { skip: 'a hook beneath said no' }
    }
    if (world.compact === 'fails' || (world.compact === 'fails beside another' && compactions === 1)) {
      throw new Error('Not enough messages to compact.')
    }

    return { messages: SUMMARY }
  })
  on('command.run', async (_, e) => {
    commands.push({ command: e.command, args: e.args })
    if (world.compact === 'throws') throw new Error('compact broke')
    try {
      await $.session.compact({ trigger: 'manual', messages: SUMMARY })
    } catch {
      if (world.compact === 'fails beside another') {
        await $.session.compact({ trigger: 'auto', messages: SUMMARY })
      }
      return { text: 'Not enough messages to compact.' }
    }

    return { text: 'Compacted' }
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    carried.push(e.context ?? [])
    if (world.submit === 'throws') throw new Error('submit broke')
    if (world.submit === 'drops') return { drop: 'a Stop hook stands' }
    if (e.text.startsWith('/')) throw new Error('a text beginning with / would run a command (host check)')

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
  await world.meanwhile?.()
  await clock.advance(IDLE_MS)
  await world.after?.(commands)
  await clock.advance(IDLE_MS)

  const last = String((await $.tool.call({ tool: 'mcp__compaction__context' })).result)
  return { commands, submitted, carried, outcomes: log.entries().map((e) => e.outcome), last }
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

test('a requested cut whose resume entered owes no rebuild note, and the default says it', async ($, on) => {
  const run = await compacted($, on, { ...ASKED, resume: 'Read RESUME.md.' })
  await $.prompt.submit({ text: 'later', wait: false, origin: { kind: 'composer' } })

  expect(run.carried).toHaveLength(2)
  expect(run.carried.flat()).not.toContain(AFTER_NOTE)
  expect(RESUME_DEFAULT).toContain('live reads')
})

test('a requested cut whose resume was dropped still owes the rebuild note', async ($, on) => {
  const run = await compacted($, on, ASKED, { submit: 'drops' })
  await $.prompt.submit({ text: 'later', wait: false, origin: { kind: 'composer' } })

  expect(run.outcomes).toEqual(['recorded', 'ran', 'unresumed'])
  expect(run.carried.at(-1)).toEqual([AFTER_NOTE])
})

test('a request with no resume prompt submits the default', async ($, on) => {
  const run = await compacted($, on, ASKED)

  expect(run.submitted).toEqual([RESUME_DEFAULT])
})

test('a submit that fails is its own outcome, the compaction kept as ran', async ($, on) => {
  const run = await compacted($, on, ASKED, { submit: 'throws' })

  expect(run.outcomes).toEqual(['recorded', 'ran', 'unresumed'])
  expect(run.last).toContain('ran /compact at 240,000 tokens, but the resume prompt did not submit')
  expect(run.last).not.toContain('/compact did not run')
})

test('a /compact that fails submits nothing', async ($, on) => {
  const run = await compacted($, on, ASKED, { compact: 'throws' })

  expect(run.submitted).toEqual([])
  expect(run.outcomes).toEqual(['recorded', 'failed'])
  expect(run.last).toContain('/compact did not run:')
})

test('a resume prompt that is a slash command is refused, never recorded', async ($, on) => {
  const log = kept(on)
  mock.clock(on)
  on('session.usage', () => ({ value: usage(240_000, 267_000) }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answered = await $.tool.call({
    tool: 'mcp__compaction__request',
    ...ASKED,
    resume: '  /compact again',
  })

  expect(String(answered.result)).toContain('Refused:')
  expect(String(answered.result)).toContain('not beginning with "/"')
  expect(log.entries().map((e) => e.outcome)).toEqual(['refused'])
  const text = String((await $.tool.call({ tool: 'mcp__compaction__context' })).result)
  expect(text).toContain('Pending request: none.')
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

test('a /compact typed during the wait drops the request: no second compaction, no resume', async ($, on) => {
  const run = await compacted($, on, { ...ASKED, resume: 'MANGO' }, {
    meanwhile: () => $.session.compact({ trigger: 'manual', messages: SUMMARY }),
  })

  expect(run.commands).toEqual([])
  expect(run.submitted).toEqual([])
  expect(run.outcomes).toEqual(['recorded', 'dropped'])
  expect(run.last).toContain('dropped, as a manual compaction ran first.')
})

test("a subagent's compaction leaves the main thread's request standing", async ($, on) => {
  const run = await compacted($, on, ASKED, {
    meanwhile: () => $.session.compact({ trigger: 'auto', agentId: 'a1', messages: SUMMARY }),
  })

  expect(run.commands).toEqual([{ command: 'compact', args: 'keep the merge order' }])
  expect(run.outcomes).toEqual(['recorded', 'ran', 'resumed'])
})

test('a /compact that resolves with its failure is failed, and submits nothing', async ($, on) => {
  const run = await compacted($, on, ASKED, { compact: 'fails' })

  expect(run.commands).toHaveLength(1)
  expect(run.submitted).toEqual([])
  expect(run.outcomes).toEqual(['recorded', 'failed'])
  expect(run.last).toContain('/compact did not run: Not enough messages to compact.')
})

test('a resume prompt a hook drops is unresumed, with the reason', async ($, on) => {
  const run = await compacted($, on, ASKED, { submit: 'drops' })

  expect(run.outcomes).toEqual(['recorded', 'ran', 'unresumed'])
  expect(run.last).toContain('the resume prompt did not submit: a Stop hook stands')
})

test('a typed /compact that a hook skips leaves the request to run', async ($, on) => {
  const run = await compacted($, on, ASKED, {
    first: 'skipped',
    meanwhile: () => $.session.compact({ trigger: 'manual', messages: SUMMARY }),
  })

  expect(run.commands).toEqual([{ command: 'compact', args: 'keep the merge order' }])
  expect(run.outcomes).toEqual(['recorded', 'ran', 'resumed'])
})

test('a typed /compact still running when the wait passes holds the request, then drops it', async ($, on) => {
  let typed: Promise<unknown> = Promise.resolve()
  const run = await compacted($, on, ASKED, {
    first: 'held',
    meanwhile: async () => {
      typed = $.session.compact({ trigger: 'manual', messages: SUMMARY })
    },
    after: async () => {
      release()
      await typed
    },
  })

  expect(run.commands).toEqual([])
  expect(run.submitted).toEqual([])
  expect(run.outcomes).toEqual(['recorded', 'dropped'])
})

test('a held compaction skipped while the due timer reads the context drops the request, and nothing runs', async ($, on) => {
  let typed: Promise<unknown> = Promise.resolve()
  const run = await compacted($, on, ASKED, {
    first: 'held, then skipped',
    onRead: 'release',
    meanwhile: async () => {
      typed = $.session.compact({ trigger: 'manual', messages: SUMMARY })
    },
    after: () => typed,
  })

  expect(run.commands).toEqual([])
  expect(run.outcomes).toEqual(['recorded', 'dropped'])
  expect(run.last).toContain('another compaction was under way when it was due.')
})

test("another compaction going through inside the mod's failed /compact is not credited to it", async ($, on) => {
  const run = await compacted($, on, ASKED, { compact: 'fails beside another' })

  expect(run.commands).toHaveLength(1)
  expect(run.submitted).toEqual([])
  expect(run.outcomes).toEqual(['recorded', 'failed'])
})

test('an automatic compaction skipped mid-turn arms nothing; the request waits for the turn to end', async ($, on) => {
  let midTurn = -1
  const run = await compacted($, on, ASKED, {
    first: 'skipped',
    meanwhile: async () => {
      await $.turn.start({ text: 'more', turnId: 't2' })
      await $.session.compact({ trigger: 'auto', messages: SUMMARY })
    },
    after: async (commands) => {
      midTurn = commands.length
      await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    },
  })

  expect(midTurn).toBe(0)
  expect(run.commands).toEqual([{ command: 'compact', args: 'keep the merge order' }])
  expect(run.outcomes).toEqual(['recorded', 'ran', 'resumed'])
})

test('a main turn starting while the due timer reads the context keeps the request for its end', async ($, on) => {
  let midTurn = -1
  const run = await compacted($, on, ASKED, {
    onRead: 'turn',
    after: async (commands) => {
      midTurn = commands.length
      await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    },
  })

  expect(midTurn).toBe(0)
  expect(run.outcomes).toEqual(['recorded', 'ran', 'resumed'])
})

/** What the engine beneath the mod does with a prompt and a compaction, for the note tests. */
type Beneath = {
  /** Prompts whose text starts with this are dropped by a hook beneath, after the mod attached. */
  readonly dropping?: string
  /** A compaction a hook beneath skips. */
  readonly skipCompaction?: boolean
  /** Each context read waits on this. */
  readonly gate?: Promise<void>
}

/** A session whose context reads `count` tokens, recording what each entered prompt carried beside it. */
async function prompting($: Engine, on: On, count: () => number, beneath: Beneath = {}) {
  mock.store(on)
  mock.clock(on)
  const carried: (readonly string[])[] = []
  on('session.usage', async () => {
    await beneath.gate

    return { value: usage(count(), 667_000) }
  })
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.compact', () => (beneath.skipCompaction ? { skip: 'a hook beneath said no' } : { messages: SUMMARY }))
  on('prompt.submit', (_, e) => {
    if (beneath.dropping !== undefined && e.text.startsWith(beneath.dropping)) return { drop: 'a hook beneath said no' }
    carried.push(e.context ?? [])

    return { text: e.text }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const say = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  return { carried, say }
}

const NOTE_AT = (count: number) => [prepareNote(points({}), count)]

test('the first prompt past the prepare point carries the procedure, and only the first', async ($, on) => {
  const { carried, say } = await prompting($, on, () => 240_000)

  await say('next')
  await say('and the next')

  expect(carried).toEqual([NOTE_AT(240_000), []])
  expect(carried[0]?.[0]).toContain('mcp__compaction__request')
  expect(carried[0]?.[0]).toContain('"resume"')
})

test('a prompt below the prepare point carries nothing; one exactly at it carries the note', async ($, on) => {
  let count = GOAL_TOKENS - RUNWAY_TOKENS - 1
  const { carried, say } = await prompting($, on, () => count)

  await say('just below')
  count += 1
  await say('at the point')

  expect(carried).toEqual([[], NOTE_AT(GOAL_TOKENS - RUNWAY_TOKENS)])
  expect(carried[1]?.[0]).toContain('at or past the prepare point')
})

test('with a request already pending, no prepare note', async ($, on) => {
  const { carried, say } = await prompting($, on, () => 240_000)

  await $.tool.call({ tool: 'mcp__compaction__request', ...ASKED })
  await say('next')

  expect(carried).toEqual([[]])
})

test("a slash command's prompt carries no note, and the next prompt still gets it", async ($, on) => {
  const { carried } = await prompting($, on, () => 240_000)

  await $.prompt.submit({ text: '/review', command: { name: 'review', args: '' }, wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })

  expect(carried).toEqual([[], NOTE_AT(240_000)])
})

test('a prompt a hook beneath drops takes no note with it: the next prompt carries it', async ($, on) => {
  const { carried, say } = await prompting($, on, () => 240_000, { dropping: 'drop' })

  await say('drop me')
  await say('next')

  expect(carried).toEqual([NOTE_AT(240_000)])
})

test('two prompts in flight at once carry one prepare note between them', async ($, on) => {
  let open: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  const { carried, say } = await prompting($, on, () => 240_000, { gate })

  const both = Promise.all([say('one'), say('two')])
  open()
  await both

  expect(carried.flat()).toEqual(NOTE_AT(240_000))
})

for (const trigger of ['manual', 'auto'] as const) {
  test(`the first prompt after a compaction (${trigger}) carries the rebuild note, and the prepare note can come again`, async ($, on) => {
    let count = 240_000
    const { carried, say } = await prompting($, on, () => count)

    await say('next')
    await $.session.compact({ trigger, messages: SUMMARY })
    count = 60_000
    await say('after the cut')
    await say('later')
    count = 230_000
    await say('long again')

    expect(carried).toEqual([NOTE_AT(240_000), [AFTER_NOTE], [], NOTE_AT(230_000)])
    expect(carried[1]?.[0]).toContain('The summary carries what the session believed')
    expect(carried[1]?.[0]).toContain('rebuild from live reads')
  })
}

test('a compaction a hook skips owes no rebuild note', async ($, on) => {
  const { carried, say } = await prompting($, on, () => 60_000, { skipCompaction: true })

  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  await say('next')

  expect(carried).toEqual([[]])
})
