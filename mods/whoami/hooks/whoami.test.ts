import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { isAccount, type Reading, readingText } from './whoami'

const NOW = Date.parse('2026-11-21T12:00:00Z')
const HOUR = 3_600_000
const RESETS = '2026-11-24T12:00:00Z'

/** The engine beneath the mod: `whoami.sh`'s three lines, the usage endpoint's answer, a store. */
function engine(on: On, sh: string, usage: { status: number; text?: string }, kept: Record<string, unknown> = {}) {
  const lines: string[] = []
  const waiting: Array<() => void> = []
  const store = { ...kept }

  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('clock.now', () => ({ value: NOW }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: sh, stderr: '' } }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => ({
    value: { status: usage.status, ok: usage.status < 300, headers: {}, text: usage.text ?? '' },
  }))
  on('ui.log', (_, e) => {
    if (e.to !== 'debug') lines.push(e.text)
    waiting.shift()?.()

    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  return {
    store,
    lines,
    /** Resolves once the mod has logged its next line. */
    logged: () => new Promise<void>(resolve => waiting.push(resolve)),
  }
}

const start = { cwd: '/', surface: 'terminal', isInteractive: true } as never
const turn = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never
const body = (week: number, fiveHour: number) =>
  JSON.stringify({
    seven_day: { utilization: week, resets_at: RESETS },
    five_hour: { utilization: fiveHour, resets_at: RESETS },
  })

test('a login matches its declared account by local part, or by a dotted local part', () => {
  expect(isAccount('alice@example.com', 'alice')).toBe(true)
  expect(isAccount('Alice.Work@example.com', 'alice@other.example')).toBe(true)
  expect(isAccount('alicex@example.com', 'alice')).toBe(false)
  expect(isAccount('', 'alice')).toBe(false)
})

test('the five-hour window joins from 50%, and an old reading says how old', () => {
  const reading: Reading = { at: NOW, week: { percentUsed: 34, resetsAt: RESETS }, fiveHour: { percentUsed: 49 } }

  expect(readingText(reading, NOW)).toMatch(/^week 34% \(resets \w{3} \d\d:\d\d\)$/)
  expect(readingText({ ...reading, fiveHour: { percentUsed: 50 } }, NOW)).toContain(' · 5h 50%')
  expect(readingText(reading, NOW + 3 * HOUR)).toContain(' · as of 3h ago')
  expect(readingText({ at: NOW, fiveHour: { percentUsed: 8 } }, NOW)).toBe('5h 8%')
})

test('an answer with no windows reads as no reading rather than an empty one', async ($, on) => {
  const e = engine(on, 'alice@example.com\n\n\n', { status: 200, text: '{"seven_day": null, "five_hour": null}' })
  const logged = e.logged()

  await $.session.start(start)
  await logged

  expect(e.lines[0]).toBe('alice · plain claude · usage after the first reply (no usage windows)')
  expect(e.store['usage:alice']).toBeUndefined()
})

test('a 200 that is not JSON names no parser error', async ($, on) => {
  const e = engine(on, 'alice@example.com\n\n\n', { status: 200, text: '<html>' })
  const logged = e.logged()

  await $.session.start(start)
  await logged

  expect(e.lines[0]).toBe('alice · plain claude · usage after the first reply (unreadable answer)')
})

test('plain claude, signed in, gets its account, its launch and the week', async ($, on) => {
  const e = engine(on, 'alice@example.com\n\n\n', { status: 200, text: body(34, 8) })
  const logged = e.logged()

  await $.session.start(start)
  await logged

  expect(e.lines[0]).toMatch(/^alice · plain claude · week 34% \(resets \w{3} \d\d:\d\d\)$/)
  expect((e.store['usage:alice'] as Reading).week?.percentUsed).toBe(34)
})

test('a login that is not the declared account is flagged, and a 429 shows the kept reading', async ($, on) => {
  const kept: Reading = { at: NOW - 3 * HOUR, week: { percentUsed: 20, resetsAt: RESETS } }
  const e = engine(on, 'carol@example.com\nwork\nbob@example.com\n', { status: 429 }, { 'usage:carol': kept })
  const logged = e.logged()

  await $.session.start(start)
  await logged

  expect(e.lines[0]).toMatch(/^⚠ carol \(expected bob\) · claude-as work · week 20% .* · as of 3h ago$/)
})

test('with no reading anywhere, the first turn that reports one logs it once', async ($, on) => {
  const e = engine(on, 'alice@example.com\nwork\nalice\n', { status: 429 })
  on('session.usage', () => ({
    value: { rateLimits: [{ kind: 'seven_day', percentUsed: 40, resetsAt: RESETS }] },
  }))
  const first = e.logged()

  await $.session.start(start)
  await first
  expect(e.lines[0]).toBe('alice · claude-as work · usage after the first reply (HTTP 429)')

  const second = e.logged()
  await $.turn.complete(turn)
  await second
  expect(e.lines[1]).toMatch(/^week 40% /)
  expect((e.store['usage:alice'] as Reading).week?.percentUsed).toBe(40)

  await $.turn.complete(turn)
  await $.turn.complete(turn)
  expect(e.lines.length).toBe(2)
})
