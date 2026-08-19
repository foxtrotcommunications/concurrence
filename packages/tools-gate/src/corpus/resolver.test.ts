import { describe, expect, it } from 'vitest';
import { CorpusIndex } from './resolver.js';
import type { PolicyDoc } from './types.js';

const docs: PolicyDoc[] = [
  {
    docId: 'sec-policy',
    domain: 'security',
    title: 'Security Policy',
    sections: [
      { id: 'deps-1', heading: 'Dependency review', body: 'All new dependencies require a CVE scan.' },
      { id: 'auth-2', heading: 'Auth changes', body: 'Authentication changes require a threat model update.' },
    ],
  },
  {
    docId: 'lic-matrix',
    domain: 'licensing',
    title: 'License Compatibility Matrix',
    sections: [{ id: 'agpl-1', heading: 'AGPL', body: 'AGPL-licensed code may not ship in distributed binaries.' }],
  },
];

describe('CorpusIndex', () => {
  const index = new CorpusIndex(docs);

  it('resolves a valid citation within the owner domain', () => {
    const resolved = index.resolve('security', { docId: 'sec-policy', sectionId: 'deps-1' });
    expect(resolved).not.toBeNull();
    expect(resolved?.sectionHeading).toBe('Dependency review');
    expect(resolved?.excerpt).toContain('CVE scan');
  });

  it('refuses a citation into another domain corpus', () => {
    expect(index.resolve('sre', { docId: 'sec-policy', sectionId: 'deps-1' })).toBeNull();
    expect(index.resolve('security', { docId: 'lic-matrix', sectionId: 'agpl-1' })).toBeNull();
  });

  it('refuses unknown docs and sections', () => {
    expect(index.resolve('security', { docId: 'nope', sectionId: 'deps-1' })).toBeNull();
    expect(index.resolve('security', { docId: 'sec-policy', sectionId: 'nope' })).toBeNull();
  });

  it('truncates long section bodies in the excerpt', () => {
    const long = new CorpusIndex([
      {
        docId: 'd',
        domain: 'sre',
        title: 'Runbook',
        sections: [{ id: 's', heading: 'H', body: 'x'.repeat(500) }],
      },
    ]);
    const resolved = long.resolve('sre', { docId: 'd', sectionId: 's' });
    expect(resolved?.excerpt.length).toBeLessThanOrEqual(241);
    expect(resolved?.excerpt.endsWith('…')).toBe(true);
  });

  it('scopes docsFor to a single domain', () => {
    expect(new CorpusIndex(docs).docsFor('licensing').map((d) => d.docId)).toEqual(['lic-matrix']);
  });

  it('rejects duplicate docIds at construction', () => {
    expect(() => new CorpusIndex([docs[0]!, docs[0]!])).toThrow(/duplicate docId/);
  });
});
