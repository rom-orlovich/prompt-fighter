/**
 * claude-tui fighter brain: instead of an API key + SDK call (see `openrouter.ts`), this
 * brain spawns a persistent, interactive `claude` TUI session in its own tmux window
 * (under the dedicated `pf-brains` tmux session, isolated from any `cc-harness` window)
 * and exchanges moves with it over a marker-based text protocol, polling the pane
 * content the same way the rest of this repo's tooling already talks to tmux panes.
 *
 * No API key, no SDK, no headless (`claude -p`) invocation — a real interactive TUI
 * window, kept alive for the whole match so the model retains conversational context
 * turn over turn, exactly like a human fighter would.
 *
 * The protocol is three plain-text markers:
 *   <<<PF_READY token=TOKEN>>>                    — the fighter signals it is up and briefed
 *   <<<PF_MOVE token=TOKEN turn=N>>> ... text ... <<<PF_END token=TOKEN turn=N>>>
 *                                                  — the fighter's reply for turn N
 * `TOKEN` is a random per-brain value so two claude-tui brains in the same match (or a
 * stale window from a previous run) never cross-read each other's markers, and `turn=N`
 * pins each reply to the exact turn that asked for it.
 *
 * The one rule that governs the whole design: **the pane is a shared channel.** Anything
 * sent into the TUI is echoed back into that same pane as the user's turn, so any text
 * the poller searches for must never appear in what we send. That is why the brief
 * (which has to spell the markers out in order to describe them) is delivered as a
 * launch-argument FILE rather than a typed message, and why `buildTurnMessage` names the
 * turn number in prose instead of writing a real marker pair. Break either rule and the
 * poller starts matching our own instructions instead of the model's answer.
 *
 * `nextMessage()` itself needs a real tmux + a real `claude` binary, so it is
 * intentionally NOT unit-tested here — only the pure marker-protocol functions
 * (`buildBrief`, `buildTurnMessage`, `extractMove`, `extractReady`) and the
 * `hasDispose`/factory-wiring surface are. `nextMessage()` is instead exercised only by
 * a live, behavioral D4 run.
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Speaker } from '../engine/types';
import type { BrainContext, FighterBrain } from './types';

const execFileAsync = promisify(execFile);

const DEFAULT_SESSION = 'pf-brains';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
/** How many lines of scrollback `capturePane` pulls per poll — enough to keep a whole
 * turn's marker pair in view without capturing unbounded history on every poll. */
const PANE_SCROLLBACK_LINES = 400;
/** Filename the TUI is launched with. `claude <arg>` treats its argument as the initial
 * *prompt text*, not a file flag — passing a bare filename works because the model then
 * reads that file out of its working directory. A plain basename (never an absolute
 * path) is required: some shells wrap `claude` in a function that turns the argument
 * into a git worktree name, and a path containing `/` is not a valid one. */
const BRIEF_FILENAME = 'brief.txt';

export interface ClaudeTuiBrainOptions {
  /** tmux session that holds every claude-tui window. Defaults to `pf-brains`. */
  session?: string;
  /** Command used to launch the interactive TUI. Defaults to `claude`. */
  claudeCommand?: string;
}

/** The subset of `BrainContext` needed to build the one-time system brief. */
export interface BriefContext {
  names: { p1: string; p2: string };
  topic: string;
  speaker: Speaker;
  opponent: Speaker;
}

function randomToken(): string {
  return randomBytes(4).toString('hex');
}

/**
 * The one-time brief: who the fighter is, who the opponent is, the topic, and the exact
 * marker format it must use for every future turn.
 *
 * This is written to a FILE and passed to `claude` as its launch argument — it is
 * deliberately NOT delivered as a typed follow-up message. That distinction is load
 * bearing, not stylistic: the TUI echoes every message it receives back into the pane as
 * the user's turn, and this text necessarily contains the literal READY marker in order
 * to *describe* it. Sent as a message, that echo lands in the pane before the model has
 * said anything, so `extractReady` matches the instructions rather than the model's
 * reply — a readiness handshake that always reports success instantly, including when
 * the brief never reached the model at all. Launching with the file means only the
 * bare filename is ever echoed, so a READY marker in the pane can only have come from
 * the model. Multi-line is safe here for the same reason (no `send-keys` involved).
 */
export function buildBrief(ctx: BriefContext, token: string): string {
  const myName = ctx.names[ctx.speaker];
  const opponentName = ctx.names[ctx.opponent];
  return [
    `You are ${myName}, a fighter in a rhetorical arena game, debating ${opponentName}.`,
    `TOPIC: "${ctx.topic}"`,
    '',
    'Every message you send IS a move in the fight: its length, confidence, evidence and',
    'whether it concedes or pivots decide what attack lands. Argue to win, in character.',
    '',
    'RESPONSE PROTOCOL — follow it exactly, every turn, with no exceptions:',
    'For each turn you are given, reply with ONLY your argument in 2-4 sentences, on ONE',
    'line, wrapped EXACTLY between these two markers:',
    `  <<<PF_MOVE token=${token} turn=N>>>`,
    `  <<<PF_END token=${token} turn=N>>>`,
    "where N is the turn number given in that turn's prompt. No preamble, no commentary,",
    'no tool calls, no markdown, no code fences, and no text outside the markers. Never',
    'emit markers for any turn other than the one you were just asked for.',
    '',
    `When you have read and understood this, print <<<PF_READY token=${token}>>> on its`,
    'own line and nothing else, then wait for turn instructions.'
  ].join('\n');
}

/**
 * The per-turn prompt: either "open the debate" (turn 0, no prior opponent text) or a
 * quote of the opponent's last message to respond to. Also single-line for the same
 * paste-detection reason as `buildBrief`.
 *
 * Deliberately does NOT spell out the literal `<<<PF_MOVE token=... turn=N>>>` /
 * `<<<PF_END ...>>>` bracket syntax with the real turn number here (only `buildBrief`
 * does, once, using the placeholder letter `N`) — tmux echoes whatever is sent back
 * onto the pane as "typed" input before the model ever replies. If this message
 * contained a COMPLETE, real marker pair (open+close with the actual turn number),
 * `extractMove`'s poll would match that echoed prompt text itself as if it were the
 * model's answer — instantly, with only the connecting prose ("and"/"—") as the
 * "move" — before the model had said anything. Referring to the turn number in plain
 * prose (`turn=${ctx.turnIndex}` without the surrounding `<<<...>>>` brackets) still
 * tells the model which turn to answer, without ever forming a matchable pair.
 */
export function buildTurnMessage(ctx: BrainContext, token: string): string {
  const instruction = `Reply now for turn=${ctx.turnIndex}, using the exact marker format from your instructions with turn=${ctx.turnIndex}.`;
  return ctx.lastOpponentText
    ? `Your opponent just said: "${ctx.lastOpponentText}" — respond now, ${instruction}`
    : `Open the debate on: "${ctx.topic}" — reply now, ${instruction}`;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pulls the reply text out of a captured tmux pane for the exact `token`+`turn`, or
 * `undefined` if that block hasn't appeared yet (or belongs to a different token).
 * A terminal-wrapped multi-line reply (the TUI re-wraps long lines, sometimes with a
 * leading box-drawing/quote prefix) is rejoined into one line.
 */
export function extractMove(pane: string, token: string, turn: number): string | undefined {
  const t = escapeForRegex(token);
  const re = new RegExp(
    `<<<PF_MOVE token=${t} turn=${turn}>>>([\\s\\S]*?)<<<PF_END token=${t} turn=${turn}>>>`
  );
  const match = pane.match(re);
  if (!match) return undefined;

  const lines = match[1]
    .split('\n')
    .map((line) => line.replace(/^[\s│┃|>]+/, '').trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;
  return lines.join(' ');
}

/** True once the READY marker for this exact token has appeared anywhere in the pane. */
export function extractReady(pane: string, token: string): boolean {
  const t = escapeForRegex(token);
  return new RegExp(`<<<PF_READY token=${t}>>>`).test(pane);
}

/**
 * Duck-typed dispose guard. The shared `FighterBrain` interface (`types.ts`) stays
 * untouched — `local`/`openrouter` brains have nothing to clean up, only `claude-tui`
 * owns a real tmux window that must be closed. Callers (see `fight.ts`) check this
 * before calling `dispose()` instead of every brain having to implement a no-op.
 */
export function hasDispose(
  brain: FighterBrain
): brain is FighterBrain & { dispose(): Promise<void> } {
  return typeof (brain as Partial<{ dispose: unknown }>).dispose === 'function';
}

async function tmux(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('tmux', args);
  return stdout;
}

/** The `session:window` tmux target format, centralized so the 4 call sites that build
 * it can't drift from each other (a stray typo in one would silently target the wrong
 * window). */
function windowTarget(session: string, windowName: string): string {
  return `${session}:${windowName}`;
}

/**
 * Creates `windowName` inside `session`, creating the session itself first if this is
 * its first window. Deliberately does NOT create a separate `_placeholder` window when
 * bootstrapping the session — `tmux new-session -n <name>` names the session's very
 * first window directly, so the fighter's own window IS the session's first window.
 * This matters for cleanup: with no extra placeholder window ever created, killing the
 * last real fighter window (via `dispose()` below) is *always* also the session's last
 * window, which tmux destroys automatically — nothing is ever left orphaned in
 * `pf-brains` for a caller to separately notice and clean up.
 */
async function ensureWindowInSession(
  session: string,
  windowName: string,
  cwd: string
): Promise<void> {
  try {
    await tmux('has-session', '-t', session);
    await tmux('new-window', '-t', session, '-n', windowName, '-c', cwd);
  } catch {
    await tmux('new-session', '-d', '-s', session, '-n', windowName, '-c', cwd, '-x', '220', '-y', '60');
  }
}

/**
 * A throwaway, NON-GIT directory holding this brain's `brief.txt`, and the working
 * directory the TUI is launched in. Both properties matter:
 *  - non-git, because a `claude` shell wrapper adds "create a git worktree named after
 *    the argument" when invoked inside a repository — launching from the game's own
 *    checkout would litter it with a worktree per fighter.
 *  - throwaway, because it keeps the debater session out of any project's context
 *    (CLAUDE.md, skills, repo files), which is both cheaper and stops a fighter from
 *    wandering off to read source code instead of arguing.
 */
function createBriefDir(token: string, brief: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pf-brain-${token}-`));
  writeFileSync(join(dir, BRIEF_FILENAME), brief, 'utf8');
  return dir;
}

async function capturePane(session: string, windowName: string): Promise<string> {
  return tmux(
    'capture-pane',
    '-t',
    windowTarget(session, windowName),
    '-p',
    '-S',
    `-${PANE_SCROLLBACK_LINES}`
  );
}

/** Sends text and Enter as two separate tmux invocations — a single bundled
 * `send-keys "<text>" Enter` races the TUI's paste-detection heuristic on an
 * already-running window (see claude-tui-launch.md's "Sending a follow-up" section).
 * `-l` sends the text literally (no tmux key-name interpretation of the content).
 *
 * Even two separate invocations occasionally still lose the race (confirmed live: a
 * real match turn sat typed-but-unsubmitted in the input box for minutes) — so this
 * also applies the same recovery retry `scripts/tmux-send-followup.sh` uses: a short
 * wait, then one more standalone Enter. Pressing Enter against an empty/already-
 * submitted prompt is a harmless no-op in the Claude Code TUI, so the extra keypress
 * never double-submits anything. */
async function sendLine(session: string, windowName: string, text: string): Promise<void> {
  const target = windowTarget(session, windowName);
  await tmux('send-keys', '-t', target, '-l', text);
  await tmux('send-keys', '-t', target, 'Enter');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await tmux('send-keys', '-t', target, 'Enter');
}

async function pollPane(
  session: string,
  windowName: string,
  isDone: (pane: string) => boolean
): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const pane = await capturePane(session, windowName);
    if (isDone(pane)) return pane;
    if (Date.now() >= deadline) {
      throw new Error(
        `claude-tui brain: timed out after ${POLL_TIMEOUT_MS}ms waiting on tmux window "${windowName}"`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Creates a claude-tui brain. Construction is cheap and does nothing observable — the
 * tmux window is only spawned lazily, on the first `nextMessage()` call, so creating
 * (and never using) one in a test is free.
 */
export function createClaudeTuiBrain(
  options: ClaudeTuiBrainOptions = {}
): FighterBrain & { dispose(): Promise<void> } {
  const session = options.session ?? DEFAULT_SESSION;
  const claudeCommand = options.claudeCommand ?? 'claude';
  const token = randomToken();

  let windowName: string | undefined;
  let briefDir: string | undefined;
  let disposed = false;

  async function ensureWindow(briefCtx: BriefContext): Promise<string> {
    if (windowName) return windowName;
    const name = `brain-${briefCtx.speaker}-${token}`;
    const dir = createBriefDir(token, buildBrief(briefCtx, token));
    briefDir = dir;
    await ensureWindowInSession(session, name, dir);
    windowName = name;
    // The brief travels as the launch argument, so the model has it the moment it
    // boots — no typed follow-up, and therefore no fixed "wait for the TUI to come up"
    // sleep to race against. Bundling text+Enter in ONE send-keys is correct *here*
    // (unlike `sendLine`): this goes to the shell prompt, where there is no live Ink
    // app doing paste-detection yet.
    await tmux(
      'send-keys',
      '-t',
      windowTarget(session, name),
      `cd ${JSON.stringify(dir)} && ${claudeCommand} '${BRIEF_FILENAME}'`,
      'Enter'
    );
    // A genuine handshake: because the brief is never echoed into the pane, a READY
    // marker here can only have been printed by the model itself, so this really does
    // block until the fighter is up and has understood its instructions.
    await pollPane(session, name, (pane) => extractReady(pane, token));
    return name;
  }

  return {
    kind: 'claude-tui',

    async nextMessage(ctx: BrainContext): Promise<string> {
      if (disposed) {
        throw new Error('claude-tui brain: nextMessage() called after dispose()');
      }
      const name = await ensureWindow({
        names: ctx.names,
        topic: ctx.topic,
        speaker: ctx.speaker,
        opponent: ctx.opponent
      });
      await sendLine(session, name, buildTurnMessage(ctx, token));
      const pane = await pollPane(
        session,
        name,
        (p) => extractMove(p, token, ctx.turnIndex) !== undefined
      );
      const move = extractMove(pane, token, ctx.turnIndex);
      if (!move) {
        throw new Error(`claude-tui brain: no move extracted for turn ${ctx.turnIndex}`);
      }
      return move;
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      if (windowName) {
        try {
          await tmux('kill-window', '-t', windowTarget(session, windowName));
        } catch {
          // Already closed (or never fully opened) — dispose() must stay idempotent.
        }
      }
      if (briefDir) {
        try {
          rmSync(briefDir, { recursive: true, force: true });
        } catch {
          // A leftover temp brief is harmless; never let cleanup mask the match result.
        }
      }
    }
  };
}
