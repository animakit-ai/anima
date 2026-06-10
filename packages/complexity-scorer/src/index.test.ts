import { describe, it, expect } from 'vitest';
import { scoreComplexity, createScorer } from './index.js';

// Placeholder suite — real tests land with the extraction (SPEC.md checklist).
describe('@animakit/complexity-scorer (scaffold)', () => {
  it('exports scoreComplexity', () => {
    expect(typeof scoreComplexity).toBe('function');
  });

  it('exports createScorer', () => {
    expect(typeof createScorer).toBe('function');
  });

  it('throws until extraction lands', () => {
    expect(() => scoreComplexity('hello')).toThrow(/not yet implemented/);
  });
});
