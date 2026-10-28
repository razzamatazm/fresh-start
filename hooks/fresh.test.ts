import { expect, mock, test } from 'claude-code/testing'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const TURN = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('/fresh writes a handoff, clears, then pre-fills the continue prompt', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 7) })
  const submitted: string[] = []
  const filled: string[] = []
  const ran: string[] = []

  on('session.id', () => ({ value: 'abcdef1234' }))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({
    value: '# Handoff\n\n## Next steps\n1. Rerun the suite\n\n## Continue prompt\nRebase PR #42 onto main, then rerun npm test.\nInvoke code-review once it is green.\n',
  }))
  on('command.run', { command: 'clear' }, () => {
    ran.push('clear')
    return { text: '' }
  })
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('turn.complete', () => ({ text: 'done' }))

  const out = await $.command.run({ ...RUN, command: 'fresh', args: 'finish the PR' })
  await clock.settle()
  const path = '/tmp/claude-handoffs/2026-10-07T00-00-00-000Z-abcdef12.md'
  expect(out.text).toContain(path)
  expect(submitted[0]).toContain(path)
  expect(submitted[0]).toContain('finish the PR')
  expect(submitted[0]).toContain('## Continue prompt')

  await $.turn.complete(TURN)
  await clock.settle()

  expect(ran).toEqual(['clear'])
  expect(filled[0]).toContain(`Read the handoff doc at ${path}`)
  expect(filled[0]).toContain('Rebase PR #42 onto main, then rerun npm test.')
  expect(filled[0]).toContain('Invoke code-review once it is green.')
  expect(filled[0]).not.toContain('Continue from where we left off')
  expect(filled[0]).not.toContain('Rerun the suite')
})

test('a doc without a continue section falls back to the generic prompt', async ($, on) => {
  const clock = mock.clock(on)
  const filled: string[] = []

  on('session.id', () => ({ value: 'abcdef1234' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '# Handoff\n\n## Next steps\n1. Rerun the suite\n' }))
  on('command.run', { command: 'clear' }, () => ({ text: '' }))
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('turn.complete', () => ({ text: 'done' }))

  await $.command.run({ ...RUN, command: 'fresh', args: '' })
  await clock.settle()
  await $.turn.complete(TURN)
  await clock.settle()

  expect(filled[0]).toContain('Continue from where we left off')
})

test('an interrupted handoff turn leaves the session alone', async ($, on) => {
  const clock = mock.clock(on)
  const ran: string[] = []

  on('session.id', () => ({ value: 'abcdef1234' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('fs.exists', () => ({ value: true }))
  on('command.run', { command: 'clear' }, () => {
    ran.push('clear')
    return { text: '' }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.command.run({ ...RUN, command: 'fresh', args: '' })
  await $.turn.complete({ ...TURN, isAborted: true, reason: 'aborted' })
  await clock.settle()

  expect(ran).toEqual([])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the footer button sits after the mode labels and starts a handoff (${surface})`, async ($, on) => {
    const clock = mock.clock(on)
    const submitted: string[] = []

    on('session.id', () => ({ value: 'abcdef1234' }))
    on('prompt.submit', ($, e) => {
      submitted.push(e.text)
      return { text: e.text }
    })

    const ui = await $.ui.mount({ plugin: 'fresh-start', surface, component: 'SessionMode', props: { modes: ['focus'] } })
    expect(await ui.find({ type: 'Text', text: /focus/ })).toBeDefined()

    await ui.press({ key: 'fresh' })
    await clock.settle()
    expect(submitted.length).toBe(1)
    expect(await ui.find({ type: 'Text', text: /writing handoff/ })).toBeDefined()
    await ui.unmount()
  })
}
