# fresh-start

A Claude Code mod that turns "write a handoff, clear, pick it back up" into one press.

Press `[ handoff + clear ]` at the right end of the prompt footer, or type `/fresh [what the next session is for]`. Then:

1. Claude writes a handoff doc to `/tmp/claude-handoffs/<timestamp>-<session>.md`: goal, current state, next steps, decisions, open questions, suggested skills.
2. Once the file exists, the session runs `/clear`.
3. The prompt box fills with a "continue from this handoff doc" prompt. Press Enter to start.

If the turn is interrupted or no file appears, the session is left alone and a toast says so. Nothing runs on its own: only the button and `/fresh` start a handoff.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install fresh-start --marketplace razzamatazm/fresh-start
```

Answer `y` to add the marketplace, then press Enter to pick the user scope. It loads in that session right away and in every session after.

## Develop

```
claude plugin validate .
claude plugin test .
```
