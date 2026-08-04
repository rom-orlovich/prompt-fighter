import { describe, it, expect } from 'vitest';
import {
  FIGHTER_IDS,
  normaliseModelName,
  hashModelName,
  fighterForModel,
  selectFighter,
  selectMatchup
} from '../src/engine/selection';

describe('deterministic fighter selection', () => {
  it('knows the four-fighter roster', () => {
    expect([...FIGHTER_IDS].sort()).toEqual(['CLAUDE', 'CODEX', 'GEMINI', 'LOCAL 7B']);
  });

  it('normalises case and surrounding whitespace', () => {
    expect(normaliseModelName('  Claude  ')).toBe('CLAUDE');
    expect(hashModelName('  Claude  ')).toBe(hashModelName('CLAUDE'));
    expect(fighterForModel('claude')).toBe(fighterForModel('CLAUDE'));
  });

  it('hashes a model name to a stable non-negative integer', () => {
    const first = hashModelName('mistral-7b-instruct');
    expect(Number.isInteger(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 50; i++) {
      expect(hashModelName('mistral-7b-instruct')).toBe(first);
    }
  });

  it('maps the same model name to the same fighter every time', () => {
    for (const model of ['gpt-4o-mini', 'llama-3-70b', 'qwen2.5', 'deepseek-v3']) {
      const first = fighterForModel(model);
      expect(FIGHTER_IDS).toContain(first);
      for (let i = 0; i < 25; i++) {
        expect(fighterForModel(model), `${model} stability`).toBe(first);
      }
    }
  });

  it('spreads different model names across more than one fighter', () => {
    const models = [
      'gpt-4o',
      'llama-3-70b',
      'qwen2.5-coder',
      'deepseek-v3',
      'phi-4',
      'mixtral-8x7b',
      'command-r',
      'yi-34b'
    ];
    expect(new Set(models.map(fighterForModel)).size).toBeGreaterThanOrEqual(2);
  });

  it('prefers a fighter named by the transcript over the hash', () => {
    const picked = selectFighter({ modelName: 'some-random-model', transcriptFighter: 'GEMINI' });
    expect(picked.fighter).toBe('GEMINI');
    expect(picked.source).toBe('transcript');
  });

  it('accepts a transcript fighter in any casing', () => {
    expect(selectFighter({ modelName: 'x', transcriptFighter: ' local 7b ' }).fighter).toBe('LOCAL 7B');
  });

  it('ignores an unknown transcript fighter and falls back to the hash', () => {
    const picked = selectFighter({ modelName: 'some-random-model', transcriptFighter: 'NOT A FIGHTER' });
    expect(picked.source).toBe('hash');
    expect(picked.fighter).toBe(fighterForModel('some-random-model'));
  });

  it('selects each side independently', () => {
    const mirror = selectMatchup({ modelName: 'gpt-4o' }, { modelName: 'gpt-4o' });
    expect(mirror.p1.fighter).toBe(mirror.p2.fighter);

    const mixed = selectMatchup({ modelName: 'x', transcriptFighter: 'CLAUDE' }, { modelName: 'y' });
    expect(mixed.p1.fighter).toBe('CLAUDE');
    expect(mixed.p1.source).toBe('transcript');
    expect(mixed.p2.source).toBe('hash');
    expect(FIGHTER_IDS).toContain(mixed.p2.fighter);
  });

  it('keeps the bundled transcript matchups intact', () => {
    const a = selectMatchup(
      { modelName: 'CLAUDE', transcriptFighter: 'CLAUDE' },
      { modelName: 'CODEX', transcriptFighter: 'CODEX' }
    );
    expect([a.p1.fighter, a.p2.fighter]).toEqual(['CLAUDE', 'CODEX']);

    const b = selectMatchup(
      { modelName: 'GEMINI', transcriptFighter: 'GEMINI' },
      { modelName: 'LOCAL 7B', transcriptFighter: 'LOCAL 7B' }
    );
    expect([b.p1.fighter, b.p2.fighter]).toEqual(['GEMINI', 'LOCAL 7B']);
  });

  it('handles an empty model name without throwing', () => {
    expect(FIGHTER_IDS).toContain(fighterForModel(''));
    expect(FIGHTER_IDS).toContain(selectFighter({ modelName: '' }).fighter);
  });
});
