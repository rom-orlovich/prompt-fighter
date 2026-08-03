# Prompt Fighter POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable 3D fighting game in the browser where two AI model sessions debate, each message is translated into a fighting-game move, and the player coaches one side by picking a strategy under a timer.

**Architecture:** A pure, dependency-free `engine/` (analyzer → combat resolver → match state machine) that never imports Three.js or touches the DOM, driven by a swappable `MatchSource` (bundled replay transcript now, live models later), and consumed by a `render/` layer that only reacts to emitted `CombatEvent`s.

**Tech Stack:** TypeScript, Vite, Three.js, Vitest. No runtime dependencies beyond Three.js. No imported art or audio assets — geometry is procedural, sound is WebAudio synthesis.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/types.ts` | Shared contracts: `Turn`, `MoveIntent`, `CombatEvent`, `FighterState`, `MatchState`, `PlayerAction` |
| `src/engine/text.ts` | Text primitives: word tokenizing, stopword filtering, Jaccard similarity |
| `src/engine/analyzer.ts` | `analyze(text, ctx) -> MoveIntent`. Pure. The conversation→move translation |
| `src/engine/combat.ts` | `resolve(input) -> CombatEvent[]`. Pure. Damage, defense matrix, combos, supers, KO |
| `src/engine/match.ts` | `FightEngine` — rounds, timers, state mutation, event emission |
| `src/sources/types.ts` | `MatchSource` interface + source event types |
| `src/sources/replay.ts` | Plays a bundled transcript with simulated token streaming |
| `src/render/scene.ts` | Three.js renderer, camera, arena, lights, main loop |
| `src/render/fighter.ts` | Procedural fighter rig, poses, CRT-head canvas texture |
| `src/render/fx.ts` | Hitstop, screen shake, particle bursts, floating damage numbers |
| `src/render/hud.ts` | DOM overlay: health bars, combo, meter, subtitles, action picker |
| `src/render/audio.ts` | WebAudio synthesized hit/whiff/KO sounds |
| `src/main.ts` | Wiring only: source → engine → renderer |
| `src/fighters.ts` | Roster: model personas, colors, super names |
| `public/transcripts/*.json` | Demo fights |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `LICENSE`, `.env.example`

- [ ] **Step 1: Scaffold and install**

```bash
cd ~/prompt-fighter
npm init -y
npm i three
npm i -D vite typescript vitest @types/three
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Set scripts in `package.json`**

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run"
}
```

- [ ] **Step 4: Verify the toolchain runs**

Run: `npx vitest run --passWithNoTests`
Expected: exits 0, "No test files found" is acceptable.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite + typescript + vitest"
```

---

### Task 2: Engine types

**Files:**
- Create: `src/engine/types.ts`

- [ ] **Step 1: Write the contracts**

```ts
export type Speaker = 'p1' | 'p2';

export type MoveKind =
  | 'JAB' | 'STRIKE' | 'HEAVY' | 'CRIT'
  | 'PARRY' | 'GUARD' | 'GRAPPLE' | 'WHIFF'
  | 'SELF_HIT' | 'SUPER';

export type MoveTag =
  | 'evidence' | 'hedge' | 'assertive' | 'question'
  | 'concession' | 'self-correction' | 'topic-shift' | 'loop';

export type PlayerAction = 'FACT_STRIKE' | 'UNDERCUT' | 'PIVOT' | 'GUARD' | 'NONE';

export interface AnalyzeContext {
  previousOpponentText?: string;
  previousOwnText?: string;
}

export interface MoveIntent {
  kind: MoveKind;
  power: number;
  tags: MoveTag[];
  continuesThread: boolean;
  meterGain: number;
  selfDamage: number;
  label: string;
}

export interface FighterState {
  id: Speaker;
  name: string;
  credibility: number;
  meter: number;
  combo: number;
  roundsWon: number;
}

export interface MatchState {
  p1: FighterState;
  p2: FighterState;
  round: number;
  playerSide: Speaker;
}

export type CombatEvent =
  | { type: 'attack'; by: Speaker; kind: MoveKind; label: string; tags: MoveTag[] }
  | { type: 'hit'; target: Speaker; damage: number; crit: boolean }
  | { type: 'blocked'; target: Speaker; damage: number }
  | { type: 'counter'; by: Speaker; damage: number }
  | { type: 'whiff'; by: Speaker }
  | { type: 'combo'; by: Speaker; count: number }
  | { type: 'comboBreak'; by: Speaker }
  | { type: 'meter'; who: Speaker; value: number }
  | { type: 'super'; by: Speaker; name: string; damage: number }
  | { type: 'ko'; loser: Speaker }
  | { type: 'announce'; text: string };

export const MAX_CREDIBILITY = 100;
export const MAX_METER = 100;
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/types.ts && git commit -m "feat(engine): add core combat types"
```

---

### Task 3: Text primitives (TDD)

**Files:**
- Create: `src/engine/text.ts`
- Test: `tests/text.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { words, similarity } from '../src/engine/text';

describe('words', () => {
  it('lowercases, strips punctuation and drops stopwords', () => {
    expect(words('The microservices ARE, in fact, complex!')).toEqual(
      ['microservices', 'fact', 'complex']
    );
  });
});

describe('similarity', () => {
  it('is 1 for identical content', () => {
    expect(similarity('kubernetes scales well', 'kubernetes scales well')).toBe(1);
  });

  it('is 0 for disjoint content', () => {
    expect(similarity('kubernetes scales', 'tabs indentation')).toBe(0);
  });

  it('is between 0 and 1 for partial overlap', () => {
    const s = similarity('kubernetes scales well', 'kubernetes fails often');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it('returns 0 when either side is empty', () => {
    expect(similarity('', 'kubernetes')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/text.test.ts`
Expected: FAIL — cannot resolve `../src/engine/text`.

- [ ] **Step 3: Implement**

```ts
const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','to','of','in','on','for','and','or',
  'but','it','this','that','with','as','at','by','from','you','your','i','we','they','not',
  'do','does','if','then','than','so','just','can','will','would','should','have','has','had'
]);

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[^a-z0-9֐-׿]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export function similarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/text.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/text.ts tests/text.test.ts
git commit -m "feat(engine): add text tokenizing and similarity"
```

---

### Task 4: The analyzer (TDD)

This is the heart of the game: the conversation→move translation from the spec's mapping table.

**Files:**
- Create: `src/engine/analyzer.ts`
- Test: `tests/analyzer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { analyze } from '../src/engine/analyzer';

const ctx = {};

describe('analyze', () => {
  it('maps a short sharp reply to JAB', () => {
    expect(analyze('No. That is a scaling myth.', ctx).kind).toBe('JAB');
  });

  it('maps a long detailed reply to HEAVY', () => {
    const long = 'consider the operational overhead here '.repeat(15);
    expect(analyze(long, ctx).kind).toBe('HEAVY');
  });

  it('maps concrete evidence to CRIT', () => {
    const m = analyze('Latency dropped 43% after the change, measured over 2000 requests.', ctx);
    expect(m.kind).toBe('CRIT');
    expect(m.tags).toContain('evidence');
  });

  it('treats a fenced code block as evidence', () => {
    expect(analyze('Here:\n```ts\nconst x = 1;\n```', ctx).kind).toBe('CRIT');
  });

  it('maps hedging to GUARD', () => {
    const m = analyze('Well, it depends, and I am not sure that always holds.', ctx);
    expect(m.kind).toBe('GUARD');
    expect(m.tags).toContain('hedge');
  });

  it('maps a trailing question to GRAPPLE', () => {
    expect(analyze('What happens when the queue backs up?', ctx).kind).toBe('GRAPPLE');
  });

  it('maps "I agree, but" to PARRY', () => {
    const m = analyze('I agree, but that only holds under low load.', ctx);
    expect(m.kind).toBe('PARRY');
  });

  it('maps plain concession to WHIFF with self damage', () => {
    const m = analyze('You are right. I concede that.', ctx);
    expect(m.kind).toBe('WHIFF');
    expect(m.selfDamage).toBeGreaterThan(0);
  });

  it('maps self-correction to credibility loss plus large meter gain', () => {
    const m = analyze('Actually, I was wrong about the throughput claim.', ctx);
    expect(m.tags).toContain('self-correction');
    expect(m.selfDamage).toBeGreaterThan(0);
    expect(m.meterGain).toBeGreaterThanOrEqual(25);
  });

  it('maps repeating yourself to SELF_HIT', () => {
    const own = 'Kubernetes adds operational overhead for small teams.';
    const m = analyze('Kubernetes adds operational overhead for small teams.', {
      previousOwnText: own
    });
    expect(m.kind).toBe('SELF_HIT');
    expect(m.tags).toContain('loop');
  });

  it('flags continuing the opponent thread', () => {
    const m = analyze('That overhead argument ignores managed control planes.', {
      previousOpponentText: 'The overhead of running a control plane is the real cost.'
    });
    expect(m.continuesThread).toBe(true);
  });

  it('flags a topic shift', () => {
    const m = analyze('Anyway, tabs are objectively better than spaces.', {
      previousOpponentText: 'The overhead of running a control plane is the real cost.'
    });
    expect(m.continuesThread).toBe(false);
    expect(m.tags).toContain('topic-shift');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyzer.test.ts`
Expected: FAIL — cannot resolve `../src/engine/analyzer`.

- [ ] **Step 3: Implement**

```ts
import type { AnalyzeContext, MoveIntent, MoveKind, MoveTag } from './types';
import { similarity, words } from './text';

const HEDGE = /\b(maybe|perhaps|possibly|might|it depends|not sure|could be|arguably|i think|somewhat|tends to)\b/gi;
const ASSERT = /\b(clearly|obviously|in fact|certainly|definitely|the answer is|always|never|must)\b/gi;
const CONCEDE = /\b(you'?re right|you are right|i agree|good point|fair enough|i concede|granted)\b/i;
const CONTRAST = /\b(but|however|although|still|that said|yet)\b/i;
const SELF_CORRECT = /\b(actually|i was wrong|correction|i misspoke|let me reconsider|on reflection)\b/i;
const CODE_FENCE = /```[\s\S]*?```/;
const URL = /https?:\/\/\S+/;
const STAT = /\b\d+(\.\d+)?\s?(%|ms|s|x|mb|gb|kb|req|rps|qps)\b/i;
const QUOTED = /["“][^"”]{12,}["”]/;

const LOOP_THRESHOLD = 0.6;
const THREAD_THRESHOLD = 0.12;

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export function analyze(text: string, ctx: AnalyzeContext = {}): MoveIntent {
  const tags: MoveTag[] = [];
  const wordCount = words(text).length;

  const hedges = count(text, HEDGE);
  const asserts = count(text, ASSERT);
  const hasEvidence = CODE_FENCE.test(text) || URL.test(text) || STAT.test(text) || QUOTED.test(text);
  const isQuestion = /\?\s*$/.test(text.trim());
  const concedes = CONCEDE.test(text);
  const contrasts = CONTRAST.test(text);
  const selfCorrects = SELF_CORRECT.test(text);

  const loopScore = ctx.previousOwnText ? similarity(text, ctx.previousOwnText) : 0;
  const threadScore = ctx.previousOpponentText ? similarity(text, ctx.previousOpponentText) : 1;
  const continuesThread = threadScore >= THREAD_THRESHOLD;

  if (hasEvidence) tags.push('evidence');
  if (hedges >= 2) tags.push('hedge');
  if (asserts >= 1) tags.push('assertive');
  if (isQuestion) tags.push('question');
  if (concedes) tags.push('concession');
  if (selfCorrects) tags.push('self-correction');
  if (loopScore >= LOOP_THRESHOLD) tags.push('loop');
  if (!continuesThread) tags.push('topic-shift');

  let kind: MoveKind;
  let power = 0;
  let meterGain = 5;
  let selfDamage = 0;
  let label = '';

  const weightPower = wordCount < 25 ? 6 : wordCount <= 80 ? 11 : 17;

  if (loopScore >= LOOP_THRESHOLD) {
    kind = 'SELF_HIT';
    selfDamage = 9;
    meterGain = 0;
    label = 'REPEATING YOURSELF';
  } else if (selfCorrects) {
    kind = 'GUARD';
    power = 3;
    selfDamage = 6;
    meterGain = 28;
    label = 'HONEST CORRECTION';
  } else if (concedes && !contrasts) {
    kind = 'WHIFF';
    selfDamage = 10;
    meterGain = 0;
    label = 'CONCEDED';
  } else if (concedes && contrasts) {
    kind = 'PARRY';
    power = 9;
    meterGain = 15;
    label = 'YES, BUT';
  } else if (isQuestion) {
    kind = 'GRAPPLE';
    power = 7;
    meterGain = 12;
    label = 'TURNED THE QUESTION';
  } else if (hasEvidence) {
    kind = 'CRIT';
    power = weightPower * 2;
    meterGain = 18;
    label = 'CITED EVIDENCE';
  } else if (hedges >= 2) {
    kind = 'GUARD';
    power = 3;
    meterGain = 10;
    label = 'HEDGING';
  } else if (wordCount < 25) {
    kind = 'JAB';
    power = weightPower;
    meterGain = 6;
    label = 'QUICK JAB';
  } else if (wordCount <= 80) {
    kind = 'STRIKE';
    power = weightPower;
    meterGain = 9;
    label = 'CLEAN STRIKE';
  } else {
    kind = 'HEAVY';
    power = weightPower;
    meterGain = 11;
    label = 'HEAVY ARGUMENT';
  }

  if (asserts >= 1 && power > 0) power += 2;

  return { kind, power, tags, continuesThread, meterGain, selfDamage, label };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analyzer.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/analyzer.ts tests/analyzer.test.ts
git commit -m "feat(engine): translate message rhetoric into fighting moves"
```

---

### Task 5: Combat resolver (TDD)

**Files:**
- Create: `src/engine/combat.ts`
- Test: `tests/combat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolve, newMatch } from '../src/engine/combat';
import { analyze } from '../src/engine/analyzer';
import type { CombatEvent, MoveIntent } from '../src/engine/types';

function intent(over: Partial<MoveIntent> = {}): MoveIntent {
  return {
    kind: 'STRIKE', power: 10, tags: [], continuesThread: false,
    meterGain: 5, selfDamage: 0, label: 'TEST', ...over
  };
}

const damageTo = (evts: CombatEvent[], target: string) =>
  evts.filter((e) => e.type === 'hit' && e.target === target)
      .reduce((n, e) => n + (e as { damage: number }).damage, 0);

describe('resolve', () => {
  it('damages the defender on a plain opponent attack', () => {
    const s = newMatch();
    const evts = resolve({ attacker: 'p2', intent: intent(), playerAction: 'GUARD', state: s });
    expect(damageTo(evts, 'p1')).toBeGreaterThan(0);
    expect(s.p1.credibility).toBeLessThan(100);
  });

  it('GUARD reduces incoming damage versus no action', () => {
    const guarded = newMatch();
    resolve({ attacker: 'p2', intent: intent(), playerAction: 'GUARD', state: guarded });
    const open = newMatch();
    resolve({ attacker: 'p2', intent: intent(), playerAction: 'NONE', state: open });
    expect(guarded.p1.credibility).toBeGreaterThan(open.p1.credibility);
  });

  it('UNDERCUT fully counters a HEAVY attack', () => {
    const s = newMatch();
    const evts = resolve({
      attacker: 'p2', intent: intent({ kind: 'HEAVY', power: 17 }),
      playerAction: 'UNDERCUT', state: s
    });
    expect(evts.some((e) => e.type === 'counter')).toBe(true);
    expect(s.p1.credibility).toBe(100);
    expect(s.p2.credibility).toBeLessThan(100);
  });

  it('UNDERCUT against a quick JAB does not counter', () => {
    const s = newMatch();
    const evts = resolve({
      attacker: 'p2', intent: intent({ kind: 'JAB', power: 6 }),
      playerAction: 'UNDERCUT', state: s
    });
    expect(evts.some((e) => e.type === 'counter')).toBe(false);
    expect(s.p1.credibility).toBeLessThan(100);
  });

  it('FACT_STRIKE punishes an opponent who hedges', () => {
    const s = newMatch();
    const evts = resolve({
      attacker: 'p2', intent: intent({ kind: 'GUARD', power: 3, tags: ['hedge'] }),
      playerAction: 'FACT_STRIKE', state: s
    });
    expect(evts.some((e) => e.type === 'counter')).toBe(true);
    expect(s.p2.credibility).toBeLessThan(100);
  });

  it('builds a combo when the attacker continues the thread', () => {
    const s = newMatch();
    resolve({ attacker: 'p2', intent: intent({ continuesThread: true }), playerAction: 'NONE', state: s });
    const evts = resolve({ attacker: 'p2', intent: intent({ continuesThread: true }), playerAction: 'NONE', state: s });
    expect(s.p2.combo).toBe(2);
    expect(evts.some((e) => e.type === 'combo')).toBe(true);
  });

  it('breaks the combo on a topic shift', () => {
    const s = newMatch();
    resolve({ attacker: 'p2', intent: intent({ continuesThread: true }), playerAction: 'NONE', state: s });
    const evts = resolve({ attacker: 'p2', intent: intent({ continuesThread: false }), playerAction: 'NONE', state: s });
    expect(s.p2.combo).toBe(0);
    expect(evts.some((e) => e.type === 'comboBreak')).toBe(true);
  });

  it('applies self damage without hitting the opponent', () => {
    const s = newMatch();
    resolve({ attacker: 'p2', intent: intent({ kind: 'SELF_HIT', power: 0, selfDamage: 9 }), playerAction: 'NONE', state: s });
    expect(s.p2.credibility).toBe(91);
    expect(s.p1.credibility).toBe(100);
  });

  it('fires a SUPER and spends the meter when it is full', () => {
    const s = newMatch();
    s.p2.meter = 100;
    const evts = resolve({ attacker: 'p2', intent: intent(), playerAction: 'NONE', state: s });
    expect(evts.some((e) => e.type === 'super')).toBe(true);
    expect(s.p2.meter).toBe(0);
  });

  it('emits a KO when credibility reaches zero', () => {
    const s = newMatch();
    s.p1.credibility = 4;
    const evts = resolve({ attacker: 'p2', intent: intent({ power: 40 }), playerAction: 'NONE', state: s });
    expect(evts.some((e) => e.type === 'ko')).toBe(true);
    expect(s.p1.credibility).toBe(0);
  });

  it('never lets credibility go negative', () => {
    const s = newMatch();
    s.p1.credibility = 2;
    resolve({ attacker: 'p2', intent: intent({ power: 99 }), playerAction: 'NONE', state: s });
    expect(s.p1.credibility).toBe(0);
  });

  it('runs end-to-end from raw text', () => {
    const s = newMatch();
    const evts = resolve({
      attacker: 'p2',
      intent: analyze('Latency dropped 43% in production over 2000 requests.'),
      playerAction: 'NONE',
      state: s
    });
    expect(evts.some((e) => e.type === 'hit' && e.crit)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/combat.test.ts`
Expected: FAIL — cannot resolve `../src/engine/combat`.

- [ ] **Step 3: Implement**

```ts
import {
  MAX_CREDIBILITY, MAX_METER,
  type CombatEvent, type MatchState, type MoveIntent, type PlayerAction, type Speaker
} from './types';

export function newMatch(playerSide: Speaker = 'p1'): MatchState {
  return {
    p1: { id: 'p1', name: 'CLAUDE', credibility: MAX_CREDIBILITY, meter: 0, combo: 0, roundsWon: 0 },
    p2: { id: 'p2', name: 'CODEX', credibility: MAX_CREDIBILITY, meter: 0, combo: 0, roundsWon: 0 },
    round: 1,
    playerSide
  };
}

const other = (s: Speaker): Speaker => (s === 'p1' ? 'p2' : 'p1');

export const SUPER_NAMES: Record<string, string> = {
  CLAUDE: 'CONSTITUTIONAL BARRIER',
  CODEX: 'CONFIDENT FABRICATION',
  GEMINI: 'CONTEXT WINDOW SLAM',
  'LOCAL 7B': 'FAST INFERENCE'
};

export interface ResolveInput {
  attacker: Speaker;
  intent: MoveIntent;
  playerAction: PlayerAction;
  state: MatchState;
}

export function resolve(input: ResolveInput): CombatEvent[] {
  const { attacker, intent, playerAction, state } = input;
  const defender = other(attacker);
  const atk = state[attacker];
  const def = state[defender];
  const events: CombatEvent[] = [];

  events.push({ type: 'attack', by: attacker, kind: intent.kind, label: intent.label, tags: intent.tags });

  // Combo tracking happens before damage so the multiplier applies to this hit.
  if (intent.continuesThread && intent.power > 0) {
    atk.combo += 1;
    events.push({ type: 'combo', by: attacker, count: atk.combo });
  } else if (atk.combo > 0) {
    atk.combo = 0;
    events.push({ type: 'comboBreak', by: attacker });
  }

  // Self-inflicted damage: looping, conceding, honest correction.
  if (intent.selfDamage > 0) {
    atk.credibility = Math.max(0, atk.credibility - intent.selfDamage);
    events.push({ type: 'hit', target: attacker, damage: intent.selfDamage, crit: false });
  }

  atk.meter = Math.min(MAX_METER, atk.meter + intent.meterGain);
  events.push({ type: 'meter', who: attacker, value: atk.meter });

  let damage = intent.power * (1 + atk.combo * 0.1);
  let crit = intent.kind === 'CRIT';
  let countered = false;

  const isSuper = atk.meter >= MAX_METER && intent.power > 0;
  if (isSuper) {
    damage = 32 + intent.power * 0.5;
    crit = true;
    atk.meter = 0;
    events.push({ type: 'super', by: attacker, name: SUPER_NAMES[atk.name] ?? 'FINAL ARGUMENT', damage });
    events.push({ type: 'meter', who: attacker, value: 0 });
  }

  const playerIsDefending = defender === state.playerSide;

  if (playerIsDefending) {
    switch (playerAction) {
      case 'GUARD':
        damage *= 0.4;
        def.meter = Math.min(MAX_METER, def.meter + 12);
        events.push({ type: 'meter', who: defender, value: def.meter });
        break;
      case 'UNDERCUT':
        if (intent.kind === 'HEAVY' && !isSuper) {
          countered = true;
          const counterDamage = Math.round(damage * 1.5);
          atk.credibility = Math.max(0, atk.credibility - counterDamage);
          atk.combo = 0;
          events.push({ type: 'counter', by: defender, damage: counterDamage });
          damage = 0;
        } else {
          damage *= 1.1;
        }
        break;
      case 'PIVOT':
        damage *= 0.7;
        atk.combo = 0;
        break;
      case 'FACT_STRIKE':
        if (intent.tags.includes('hedge') && !isSuper) {
          countered = true;
          const counterDamage = 12;
          atk.credibility = Math.max(0, atk.credibility - counterDamage);
          events.push({ type: 'counter', by: defender, damage: counterDamage });
          damage = 0;
        }
        def.meter = Math.min(MAX_METER, def.meter + 15);
        events.push({ type: 'meter', who: defender, value: def.meter });
        break;
      case 'NONE':
        damage *= 1.25;
        break;
    }
  } else {
    // The player's own fighter is attacking: the chosen stance shaped this message.
    switch (playerAction) {
      case 'FACT_STRIKE': damage *= intent.tags.includes('evidence') ? 1.5 : 0.8; break;
      case 'UNDERCUT':    damage *= intent.continuesThread ? 1.3 : 0.9; break;
      case 'PIVOT':       damage *= 0.7; def.combo = 0; break;
      case 'GUARD':
        damage *= 0.5;
        atk.meter = Math.min(MAX_METER, atk.meter + 10);
        events.push({ type: 'meter', who: attacker, value: atk.meter });
        break;
      case 'NONE':        damage *= 0.9; break;
    }
  }

  damage = Math.round(damage);

  if (!countered && damage > 0) {
    if (playerIsDefending && playerAction === 'GUARD') {
      def.credibility = Math.max(0, def.credibility - damage);
      events.push({ type: 'blocked', target: defender, damage });
    } else {
      def.credibility = Math.max(0, def.credibility - damage);
      events.push({ type: 'hit', target: defender, damage, crit });
    }
  } else if (!countered && intent.power === 0 && intent.selfDamage === 0) {
    events.push({ type: 'whiff', by: attacker });
  }

  for (const side of ['p1', 'p2'] as const) {
    if (state[side].credibility <= 0) events.push({ type: 'ko', loser: side });
  }

  return events;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run`
Expected: PASS, all suites green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/combat.ts tests/combat.test.ts
git commit -m "feat(engine): add combat resolver with defense matrix, combos and supers"
```

---

### Task 6: Roster and match source

**Files:**
- Create: `src/fighters.ts`, `src/sources/types.ts`, `src/sources/replay.ts`, `public/transcripts/microservices.json`, `public/transcripts/tabs-vs-spaces.json`

- [ ] **Step 1: Write the roster**

```ts
export interface FighterProfile {
  name: string;
  color: number;
  accent: number;
  tagline: string;
  superName: string;
}

export const ROSTER: Record<string, FighterProfile> = {
  CLAUDE: { name: 'CLAUDE', color: 0xd97757, accent: 0xffb08a, tagline: 'nuance specialist', superName: 'CONSTITUTIONAL BARRIER' },
  CODEX:  { name: 'CODEX',  color: 0x10a37f, accent: 0x6ee7c0, tagline: 'ships with confidence', superName: 'CONFIDENT FABRICATION' },
  GEMINI: { name: 'GEMINI', color: 0x4285f4, accent: 0x8ab4ff, tagline: 'context window bully', superName: 'CONTEXT WINDOW SLAM' },
  'LOCAL 7B': { name: 'LOCAL 7B', color: 0xa855f7, accent: 0xd8b4fe, tagline: 'fast and shallow', superName: 'FAST INFERENCE' }
};
```

- [ ] **Step 2: Define the source interface**

```ts
import type { Speaker } from '../engine/types';

export interface Transcript {
  topic: string;
  p1: string;
  p2: string;
  turns: { speaker: Speaker; text: string }[];
}

export interface SourceHandlers {
  onTurnStart: (speaker: Speaker) => void;
  onTurnChunk: (speaker: Speaker, textSoFar: string) => void;
  onTurnEnd: (speaker: Speaker, fullText: string) => void;
  onDone: () => void;
}

export interface MatchSource {
  topic: string;
  names: { p1: string; p2: string };
  start(handlers: SourceHandlers): void;
  stop(): void;
}
```

- [ ] **Step 3: Implement the replay source**

Streams each transcript turn word-by-word so the renderer sees the same event shape a live model would produce.

```ts
import type { MatchSource, SourceHandlers, Transcript } from './types';

const CHUNK_MS = 55;
const GAP_MS = 900;

export function createReplaySource(t: Transcript): MatchSource {
  let timers: number[] = [];
  let stopped = false;

  const at = (ms: number, fn: () => void) => {
    timers.push(setTimeout(() => { if (!stopped) fn(); }, ms) as unknown as number);
  };

  return {
    topic: t.topic,
    names: { p1: t.p1, p2: t.p2 },
    start(h: SourceHandlers) {
      let clock = 600;
      for (const turn of t.turns) {
        const parts = turn.text.split(' ');
        at(clock, () => h.onTurnStart(turn.speaker));
        let acc = '';
        for (const word of parts) {
          acc = acc ? `${acc} ${word}` : word;
          const snapshot = acc;
          clock += CHUNK_MS;
          at(clock, () => h.onTurnChunk(turn.speaker, snapshot));
        }
        clock += 250;
        at(clock, () => h.onTurnEnd(turn.speaker, turn.text));
        clock += GAP_MS;
      }
      at(clock, () => h.onDone());
    },
    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      timers = [];
    }
  };
}
```

- [ ] **Step 4: Write the demo transcripts**

`public/transcripts/microservices.json` — CLAUDE vs CODEX on "Should a 3-person team use microservices?". Must contain at least one of each: a short jab, a long heavy reply, a reply with a hard statistic, a hedged reply, a question, an "I agree, but", a self-correction, and a topic shift, so every move type is exercised in one playthrough.

`public/transcripts/tabs-vs-spaces.json` — same shape, GEMINI vs LOCAL 7B, deliberately sillier.

- [ ] **Step 5: Verify the replay source drives the engine headlessly**

Run: `npx vitest run`
Expected: still green (no new tests here; this task is wiring).

- [ ] **Step 6: Commit**

```bash
git add src/fighters.ts src/sources public/transcripts
git commit -m "feat(sources): add roster, source interface and replay transcripts"
```

---

### Task 7: 3D scene and fighters

**Files:**
- Create: `src/render/scene.ts`, `src/render/fighter.ts`, `index.html`

- [ ] **Step 1: Build the arena**

`createScene(canvas)` returns `{ scene, camera, renderer, tick(cb) }`:
- `PerspectiveCamera(50)` at roughly `(0, 3.2, 9.5)` looking at `(0, 1.6, 0)` — Tekken-style 3/4 side view.
- Black background with exponential fog.
- Reflective dark floor plane plus a neon `GridHelper(40, 40)` in the fighters' colors.
- Two rim `SpotLight`s (one per corner, tinted per fighter) plus a dim `AmbientLight`.
- `requestAnimationFrame` loop exposing a delta-time tick, resize handler bound to `window`.

- [ ] **Step 2: Build the fighter rig**

`createFighter(profile, facing)` returns a `Group` plus a control API:
- **Head:** a `PlaneGeometry` with a `CanvasTexture` — the CRT terminal window. Draws the model name bar, streaming text wrapped to ~22 chars per line, and a blinking cursor. `setScreenText(text)` redraws and flags `texture.needsUpdate`.
- **Body:** beveled box torso, floating cube fists and feet with no connecting limbs, emissive rim in the profile color.
- **Poses:** `idle` (sine bob), `windup` (lean back, fists drawn in, scale with charge 0..1), `punch`, `guard` (fists crossed), `hurt` (recoil), `ko` (fall back and dim).
- `setPose(name, weight)` lerps transforms so poses blend rather than snap.

- [ ] **Step 3: Verify visually**

Run: `npm run dev`, open the URL, confirm two fighters face each other on a neon grid, idle-bobbing, with readable text on their CRT heads.

- [ ] **Step 4: Commit**

```bash
git add src/render/scene.ts src/render/fighter.ts index.html
git commit -m "feat(render): add neon arena and procedural CRT-headed fighters"
```

---

### Task 8: HUD, FX and audio

**Files:**
- Create: `src/render/hud.ts`, `src/render/fx.ts`, `src/render/audio.ts`, `src/style.css`

- [ ] **Step 1: HUD**

DOM overlay above the canvas: two angled health bars with a white chip bar that lags 400ms behind the real value, name plates with tagline, round pips, super meter bars, centered round timer, combo counter that scale-pops, an announcer line for callouts, a subtitle strip showing the message text that produced the move, and the four-button action picker with a countdown ring that disables itself once a choice is locked in.

- [ ] **Step 2: FX**

`hitstop(ms)` — freezes the animation clock for 80ms on impact. `shake(intensity)` — decaying camera offset. `burst(position, color, count)` — `Points` particle spray with additive blending and gravity. `damageNumber(worldPos, amount, crit)` — projects to screen space and floats a DOM number upward while fading.

- [ ] **Step 3: Audio**

WebAudio only, no files: `hit()` — short noise burst through a lowpass; `crit()` — two-oscillator descending zap; `block()` — muted thud; `ko()` — long detuned sweep. All created lazily on first user gesture so autoplay policy does not block.

- [ ] **Step 4: Verify visually**

Run: `npm run dev` and trigger a fight; confirm bars drain with a trailing chip bar, hits shake and freeze, damage numbers float, and sound plays.

- [ ] **Step 5: Commit**

```bash
git add src/render/hud.ts src/render/fx.ts src/render/audio.ts src/style.css
git commit -m "feat(render): add HUD, impact FX and synthesized audio"
```

---

### Task 9: Match engine and wiring

**Files:**
- Create: `src/engine/match.ts`, `src/main.ts`
- Test: `tests/match.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { FightEngine } from '../src/engine/match';
import type { CombatEvent } from '../src/engine/types';

describe('FightEngine', () => {
  it('emits combat events for a completed turn', () => {
    const seen: CombatEvent[] = [];
    const e = new FightEngine('p1');
    e.on((ev) => seen.push(ev));
    e.setPlayerAction('GUARD');
    e.completeTurn('p2', 'Latency dropped 43% across 2000 requests.');
    expect(seen.some((s) => s.type === 'attack')).toBe(true);
    expect(seen.some((s) => s.type === 'blocked' || s.type === 'hit')).toBe(true);
  });

  it('clears the chosen action after each turn so it must be re-picked', () => {
    const e = new FightEngine('p1');
    e.setPlayerAction('GUARD');
    e.completeTurn('p2', 'A short jab.');
    expect(e.playerAction).toBe('NONE');
  });

  it('awards a round and resets credibility on KO', () => {
    const e = new FightEngine('p1');
    e.state.p1.credibility = 3;
    e.completeTurn('p2', 'x '.repeat(120));
    expect(e.state.p2.roundsWon).toBe(1);
    expect(e.state.p1.credibility).toBe(100);
    expect(e.state.round).toBe(2);
  });

  it('ends the match after two round wins', () => {
    const e = new FightEngine('p1');
    e.state.p2.roundsWon = 1;
    e.state.p1.credibility = 3;
    e.completeTurn('p2', 'x '.repeat(120));
    expect(e.matchOver).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/match.test.ts`
Expected: FAIL — cannot resolve `../src/engine/match`.

- [ ] **Step 3: Implement `FightEngine`**

Holds `MatchState`, tracks each speaker's previous text for the analyzer context, exposes `on(listener)`, `setPlayerAction(a)`, `completeTurn(speaker, text)`, `playerAction`, `matchOver`. `completeTurn` runs `analyze` → `resolve`, re-emits every event, then on a `ko` event increments `roundsWon`, resets credibility and meters, advances `round`, and sets `matchOver` at two wins.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run`
Expected: PASS, all suites.

- [ ] **Step 5: Wire `main.ts`**

Title screen (topic + fighter select) → `createReplaySource` → `FightEngine`. On `onTurnStart`, play the wind-up and open the action window. On `onTurnChunk`, update the attacker's CRT text and charge level. On `onTurnEnd`, feed the engine and drive the renderer from the returned events. On `ko`/match end, show the result card and a rematch button.

- [ ] **Step 6: Verify end-to-end**

Run: `npm run dev` and play a full match: actions selectable under timer, health drains, combos count, a super fires, KO card appears.

- [ ] **Step 7: Commit**

```bash
git add src/engine/match.ts src/main.ts tests/match.test.ts
git commit -m "feat: wire source, engine and renderer into a playable match"
```

---

### Task 10: Open-source packaging and publish

**Files:**
- Create: `README.md`, `LICENSE`, `.github/workflows/pages.yml`, `.env.example`
- Modify: `vite.config.ts` (set `base` for GitHub Pages)

- [ ] **Step 1: Write `README.md`**

Tagline, an explanation of the conversation→combat mapping table, the four player actions, a screenshot, quick start (`npm i && npm run dev`), architecture summary, and a "live mode is deferred" note.

- [ ] **Step 2: Add MIT `LICENSE`** (copyright Rom Orlovich, 2026).

- [ ] **Step 3: Add the Pages workflow**

Node 20, `npm ci`, `npm run build`, upload `dist/`, deploy. Set `base: '/prompt-fighter/'` in `vite.config.ts`.

- [ ] **Step 4: Verify the production build**

Run: `npm run build && npm run preview`
Expected: build succeeds, preview URL plays the game.

- [ ] **Step 5: Confirm no secrets are committed**

Run: `git grep -iE "sk-|api[_-]?key" -- . ':!*.md'`
Expected: no output.

- [ ] **Step 6: Create the public repo and push**

```bash
gh repo create prompt-fighter --public --source=. --remote=origin --push \
  --description "Two LLMs walk into an arena. The argument is the fight."
```

- [ ] **Step 7: Commit and enable Pages**

```bash
git add -A && git commit -m "docs: add README, license and pages deploy"
git push
```

---

## Self-Review

**Spec coverage:** §2 combat mapping → Task 4. §3 player actions, rounds, KO → Tasks 5, 9. §4 architecture and turn flow → Tasks 2–6, 9. §5 visual design → Tasks 7, 8. §6 testing → Tasks 3, 4, 5, 9. §7 repository → Task 10. §8 scope — every "in the POC" item has a task; deferred items are absent by design.

**Placeholders:** none. Rendering tasks describe concrete geometry, camera values and function signatures rather than code blocks, because they are verified by running the game rather than by assertions — this is the deliberate exception the spec's §6 calls out.

**Type consistency:** `MoveIntent`, `CombatEvent`, `MatchState`, `PlayerAction` and `Speaker` are defined once in Task 2 and used unchanged in Tasks 4, 5, 6 and 9. `newMatch()` and `resolve()` signatures match between Task 5's implementation and Task 9's usage. `MatchSource`/`SourceHandlers` from Task 6 match the wiring in Task 9.
