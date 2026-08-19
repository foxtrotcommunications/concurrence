import { describe, expect, it } from 'vitest';
import { parseGeneratedGate } from './parse.ts';

const opts = {
  gateId: 'g1',
  release: 'test release',
  knownDomains: ['security', 'licensing', 'data-governance', 'sre'],
};

const wrap = (requirements: unknown): string => JSON.stringify({ requirements });

describe('parseGeneratedGate', () => {
  it('accepts clean output without repairs', () => {
    const result = parseGeneratedGate(
      wrap([
        { id: 'cve-scan', label: 'New deps CVE-scanned', ownerDomain: 'security' },
        { id: 'sdk-terms', label: 'SDK terms permit redistribution', ownerDomain: 'licensing' },
      ]),
      opts,
    );
    expect(result.repairs).toEqual([]);
    expect(result.gate.requirements).toHaveLength(2);
    expect(result.gate.requirements[0]).toEqual({
      id: 'cve-scan',
      label: 'New deps CVE-scanned',
      ownerDomain: 'security',
    });
  });

  it('tolerates a code fence despite instructions', () => {
    const fenced = '```json\n' + wrap([{ id: 'a', label: 'A', ownerDomain: 'sre' }]) + '\n```';
    expect(parseGeneratedGate(fenced, opts).gate.requirements).toHaveLength(1);
  });

  it('remaps unknown owners to the fallback domain and reports it', () => {
    const result = parseGeneratedGate(wrap([{ id: 'a', label: 'A', ownerDomain: 'compliance' }]), opts);
    expect(result.gate.requirements[0]?.ownerDomain).toBe('security');
    expect(result.repairs.join(' ')).toContain('remapped unknown owner "compliance"');
  });

  it('slugifies ids and derives missing ids from labels', () => {
    const result = parseGeneratedGate(
      wrap([
        { id: 'CVE Scan!', label: 'x', ownerDomain: 'security' },
        { label: 'Rollback plan tested', ownerDomain: 'sre' },
      ]),
      opts,
    );
    expect(result.gate.requirements.map((r) => r.id)).toEqual(['cve-scan', 'rollback-plan-tested']);
  });

  it('de-duplicates colliding ids', () => {
    const result = parseGeneratedGate(
      wrap([
        { id: 'dup', label: 'first', ownerDomain: 'sre' },
        { id: 'dup', label: 'second', ownerDomain: 'sre' },
      ]),
      opts,
    );
    expect(result.gate.requirements.map((r) => r.id)).toEqual(['dup', 'dup-2']);
  });

  it('drops unlabeled requirements and caps the total', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `r${i}`, label: `req ${i}`, ownerDomain: 'sre' }));
    const result = parseGeneratedGate(wrap([{ id: 'x', ownerDomain: 'sre' }, ...many]), opts);
    expect(result.gate.requirements).toHaveLength(10);
    expect(result.repairs.join(' ')).toContain('no label');
    expect(result.repairs.join(' ')).toContain('beyond the first 10');
  });

  it('throws on non-JSON, empty, and uncovered mustCover domains', () => {
    expect(() => parseGeneratedGate('not json', opts)).toThrow(/not valid JSON/);
    expect(() => parseGeneratedGate(wrap([]), opts)).toThrow(/no requirements/);
    expect(() =>
      parseGeneratedGate(wrap([{ id: 'a', label: 'A', ownerDomain: 'sre' }]), {
        ...opts,
        mustCover: ['licensing'],
      }),
    ).toThrow(/uncovered: licensing/);
  });
});
