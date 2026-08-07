/** Picks between the `local`, `openrouter`, and `claude-tui` `FighterBrain`
 * implementations. Defaults to `local` so the CLI and server run with zero
 * setup — see `local.ts`'s doc comment for why. */

import { createLocalBrain } from './local';
import { createOpenRouterBrain } from './openrouter';
import { createClaudeTuiBrain } from './claude-tui';
import type { FighterBrain } from './types';

export type BrainKind = 'local' | 'openrouter' | 'claude-tui';

export interface CreateBrainOptions {
  apiKey?: string;
  model?: string;
  persona?: string;
}

export function createBrain(kind: BrainKind, options: CreateBrainOptions = {}): FighterBrain {
  if (kind === 'openrouter') return createOpenRouterBrain(options);
  if (kind === 'claude-tui') return createClaudeTuiBrain();
  return createLocalBrain();
}

export type { FighterBrain, BrainContext } from './types';
