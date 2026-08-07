/** Picks between the `local`, `openrouter`, and `claude-tui` `FighterBrain`
 * implementations. Defaults to `local` so the CLI and server run with zero
 * setup — see `local.ts`'s doc comment for why. */

import { createLocalBrain } from './local';
import { createOpenRouterBrain } from './openrouter';
import type { FighterBrain } from './types';

export type BrainKind = 'local' | 'openrouter' | 'claude-tui';

export interface CreateBrainOptions {
  apiKey?: string;
  model?: string;
  persona?: string;
}

/**
 * `claude-tui.ts` is Node-only — it touches `node:child_process` at module scope
 * (`promisify(execFile)`, evaluated the instant the module loads, not just when a
 * claude-tui brain is actually used). `main.ts` (the browser entry point) imports
 * this file for its `local` brain, and a *static* top-level `import` of
 * `claude-tui.ts` here would pull that Node-only module eagerly into the same
 * bundle graph, crashing the whole browser app on page load — Vite externalizes
 * `node:child_process` for the browser, and merely importing the module then
 * touches the externalized stub's `.execFile` property, which throws immediately.
 * A `local`/`openrouter`-only page (the entire browser UI — see `main.ts`, which
 * never requests `'claude-tui'`) must never pay that cost. Loading it via a
 * dynamic `import()` INSIDE the branch that actually needs it makes Vite/Rollup
 * code-split `claude-tui.ts` into its own chunk that is only ever fetched and
 * evaluated when a caller (only the Node CLI, `src/cli/fight.ts`) actually asks
 * for `'claude-tui'` — the browser bundle never touches it.
 */
export async function createBrain(
  kind: BrainKind,
  options: CreateBrainOptions = {}
): Promise<FighterBrain> {
  if (kind === 'openrouter') return createOpenRouterBrain(options);
  if (kind === 'claude-tui') {
    const { createClaudeTuiBrain } = await import('./claude-tui');
    return createClaudeTuiBrain();
  }
  return createLocalBrain();
}

export type { FighterBrain, BrainContext } from './types';
