/** The roster. Colors are the models' own brand hues, used for lighting and rim glow. */

import type { FighterVisual } from './roster/visuals';
import { visualFor } from './roster/visuals';

export interface FighterProfile {
  name: string;
  color: number;
  accent: number;
  tagline: string;
  superName: string;
  visual: FighterVisual;
}

export const ROSTER: Record<string, FighterProfile> = {
  CLAUDE: {
    name: 'CLAUDE',
    color: 0xd97757,
    accent: 0xffc7a8,
    tagline: 'nuance specialist',
    superName: 'CONSTITUTIONAL BARRIER',
    visual: visualFor('CLAUDE')
  },
  CODEX: {
    name: 'CODEX',
    color: 0x10a37f,
    accent: 0x7df0cd,
    tagline: 'ships with confidence',
    superName: 'CONFIDENT FABRICATION',
    visual: visualFor('CODEX')
  },
  GEMINI: {
    name: 'GEMINI',
    color: 0x4285f4,
    accent: 0xa8c7ff,
    tagline: 'context window bully',
    superName: 'CONTEXT WINDOW SLAM',
    visual: visualFor('GEMINI')
  },
  'LOCAL 7B': {
    name: 'LOCAL 7B',
    color: 0xa855f7,
    accent: 0xe0bbff,
    tagline: 'fast and shallow',
    superName: 'FAST INFERENCE',
    visual: visualFor('LOCAL 7B')
  },
  IRON_FIST: {
    name: 'IRON_FIST',
    color: 0x8c8c9a,
    accent: 0xd4d4dc,
    tagline: 'unbreakable and slow to anger',
    superName: 'ADAMANTINE REBUTTAL',
    visual: visualFor('IRON_FIST')
  },
  VIPER: {
    name: 'VIPER',
    color: 0x76b900,
    accent: 0xd4ff6b,
    tagline: 'strikes once, strikes true',
    superName: 'VENOM INJECTION',
    visual: visualFor('VIPER')
  },
  WARDEN: {
    name: 'WARDEN',
    color: 0x2c3e91,
    accent: 0x8fa8ff,
    tagline: 'holds the line no matter what',
    superName: 'IMMOVABLE VERDICT',
    visual: visualFor('WARDEN')
  },
  BLAZE: {
    name: 'BLAZE',
    color: 0xff4500,
    accent: 0xffb347,
    tagline: 'burns through every argument',
    superName: 'SCORCHED EARTH',
    visual: visualFor('BLAZE')
  }
};

export function profileFor(name: string): FighterProfile {
  return (
    ROSTER[name] ?? {
      name,
      color: 0x8899aa,
      accent: 0xccd6e0,
      tagline: 'unknown model',
      superName: 'FINAL ARGUMENT',
      visual: visualFor(name)
    }
  );
}
