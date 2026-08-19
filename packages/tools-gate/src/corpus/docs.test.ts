import { describe, expect, it } from 'vitest';
import { CORPUS, DOMAINS } from './docs.ts';
import { CorpusIndex } from './resolver.ts';

describe('CORPUS', () => {
  it('constructs a valid index (unique docIds)', () => {
    expect(() => new CorpusIndex(CORPUS)).not.toThrow();
  });

  it('covers every known domain with at least one doc', () => {
    const covered = new Set(CORPUS.map((d) => d.domain));
    for (const domain of DOMAINS) expect(covered.has(domain)).toBe(true);
  });

  it('has unique section ids within each doc and non-empty bodies', () => {
    for (const doc of CORPUS) {
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const section of doc.sections) {
        expect(section.body.length).toBeGreaterThan(40);
        expect(section.id).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });

  it('every section is resolvable by its own domain and no other', () => {
    const index = new CorpusIndex(CORPUS);
    for (const doc of CORPUS) {
      for (const section of doc.sections) {
        const citation = { docId: doc.docId, sectionId: section.id };
        expect(index.resolve(doc.domain, citation)).not.toBeNull();
        for (const other of DOMAINS.filter((d) => d !== doc.domain)) {
          expect(index.resolve(other, citation)).toBeNull();
        }
      }
    }
  });
});
