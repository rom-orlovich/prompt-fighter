import { describe, it, expect } from 'vitest';
import { words, similarity } from '../src/engine/text';

describe('words', () => {
  it('lowercases, strips punctuation and drops stopwords', () => {
    expect(words('The microservices ARE, in fact, complex!')).toEqual([
      'microservices',
      'fact',
      'complex'
    ]);
  });

  it('ignores the contents of code fences', () => {
    expect(words('look:\n```ts\nkubernetes cluster\n```')).toEqual(['look']);
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
