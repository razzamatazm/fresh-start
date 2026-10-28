import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Phase } from '../types'

const phase = atom({ plugin: 'fresh-start', key: 'phase' } as const, 'idle' as Phase)

const HANDOFF_DIR = '/tmp/claude-handoffs'
const CONTINUE_HEADING = 'Continue prompt'

export function handoffPrompt(path: string, focus: string): string {
  const focusLine = focus
    ? `The next session will focus on: ${focus}. Tailor the doc to that.`
    : 'Assume the next session continues the current work where it stands.'

  return [
    `Write a handoff document for this conversation to ${path} with the Write tool, so a fresh session with no memory of this one can continue the work. Do nothing else this turn: no other edits, no commits, no questions.`,
    '',
    focusLine,
    '',
    'Cover, in this order:',
    '1. Goal: what we are trying to get done and why.',
    '2. Current state: what is done, what is half done, what is verified and how. Name the branch, worktree path, open PRs and running background processes.',
    '3. Next steps: the exact next action first, then the rest in order.',
    '4. Decisions and constraints: calls already made (and by whom) that the next session must not re-litigate, plus gotchas hit along the way.',
    '5. Open questions: anything waiting on the user.',
    '6. Suggested skills: which skills the next session should invoke with the Skill tool, and when.',
    `7. A final section headed exactly "## ${CONTINUE_HEADING}": the message the user will send to start the next session, written to that session in the second person. Two to five sentences specific to this work: the first concrete action (command, file, PR or issue by name), what to check still holds before acting, and which skills to invoke first. No generic advice, nothing after it.`,
    '',
    'Reference specs, plans, issues, commits and diffs by path or URL instead of copying them. Redact secrets and personal data. After writing, reply with one line: the path.',
  ].join('\n')
}

// The body of the doc's continue section, up to the next heading; empty when it is missing.
export function tailoredContinue(doc: string): string {
  const lines = doc.split('\n')
  const start = lines.findIndex(line => /^#{1,6}\s*continue prompt\s*$/i.test(line.trim()))
  if (start === -1) {
    return ''
  }

  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^#{1,6}\s/.test(line))

  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

export function continuePrompt(path: string, tailored = ''): string {
  const read = `Read the handoff doc at ${path} in full before doing anything else.`
  const guard = 'If anything in the doc no longer matches reality, tell me what changed before acting on it.'
  if (tailored) {
    return [read, tailored, guard].join(' ')
  }

  return [
    `Continue from where we left off. ${read}`,
    'Treat its decisions as settled, check that the current state it describes still holds (git status, branch, open PRs), invoke the skills it suggests, then pick up with its first next step.',
    guard,
  ].join(' ')
}

async function readTailored($: EngineInterface, path: string): Promise<string> {
  try {
    return tailoredContinue(await $.fs.read(path))
  } catch {
    return ''
  }
}

// The handoff in flight; a reload mid-handoff drops it and the band offers the button again.
let pendingPath: string | null = null

async function start($: EngineInterface, focus: string): Promise<string> {
  if ((await read($, phase)) !== 'idle') {
    return 'A handoff is already in progress.'
  }

  const id = await $.session.id()
  const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-')
  pendingPath = `${HANDOFF_DIR}/${stamp}-${id.slice(0, 8)}.md`
  await update($, phase, () => 'writing')
  const text = handoffPrompt(pendingPath, focus.trim())
  // A submit from inside the command's own hook would wait on that hook; send it after.
  $.clock.after(0, () => void $.prompt.submit({ text }))

  return `Writing handoff to ${pendingPath}; the session clears when it lands.`
}

async function reset($: EngineInterface): Promise<void> {
  pendingPath = null
  await update($, phase, () => 'idle')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'fresh',
      description: 'Write a handoff doc, clear the session, and pre-fill a prompt to continue from it',
      argumentHint: '[what the next session is for]',
    })

    return next(e)
  })

  on('command.run', { command: 'fresh' }, async ($, e) => ({ text: await start($, e.args ?? '') }))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const path = pendingPath
    if (e.agentId !== undefined || path === null || (await read($, phase)) !== 'writing') {
      return result
    }

    if (e.isAborted || e.reason !== 'answer' || !(await $.fs.exists(path))) {
      await reset($)
      $.ui.toast('Handoff not written; session left as it was.')

      return result
    }

    await update($, phase, () => 'clearing')
    // Out of the hook first: a command run inside the hook the turn waits on is refused.
    $.clock.after(0, () => {
      void (async () => {
        try {
          const tailored = await readTailored($, path)
          await $.command.run({ command: 'clear' })
          await $.prompt.fill({ text: continuePrompt(path, tailored) })
          $.ui.toast('Fresh session ready. Press Enter to continue.')
        } catch (error) {
          $.ui.toast(`Clear failed: ${String(error)}. Handoff is at ${path}`)
        } finally {
          await reset($)
        }
      })()
    })

    return result
  })

  // The right end of the footer under the prompt, where the mode labels sit; this draws
  // the engine's labels as it would and the button after them, so it is always there.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const current = await read($, phase)
    const { Box, Button, Text } = $.ui.resolve(e)
    const modes = e.props.modes.join(' & ')

    return (
      <Box>
        {modes ? <Text dimColor>{modes} </Text> : null}
        {current === 'idle' ? (
          <Button key="fresh" label="handoff + clear" dimColor onPress={() => void start($, '')} />
        ) : (
          <Text dimColor>{current === 'writing' ? 'writing handoff...' : 'clearing...'}</Text>
        )}
      </Box>
    )
  })
}
