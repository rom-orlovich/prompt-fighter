/** Picks between the two `FighterBrain` implementations. Defaults to `local` so the
 * CLI and server run with zero setup — see `local.ts`'s doc comment for why. */

import { createLocalBrain } from './local';
import { createOpenRouterBrain } from './openrouter';
import type { FighterBrain } from './types';

export type BrainKind = 'local' | 'openrouter';

export interface CreateBrainOptions {
  apiKey?: string;
  model?: string;
  persona?: string;
}

export function createBrain(kind: BrainKind, options: CreateBrainOptions = {}): FighterBrain {
  if (kind === 'openrouter') return createOpenRouterBrain(options);
  return createLocalBrain();
}

export type { FighterBrain, BrainContext } from './types';
