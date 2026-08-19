import { beforeEach, describe, expect, it } from 'vitest';
import { CorpusIndex } from '../corpus/resolver.js';
import type { PolicyDoc } from '../corpus/types.js';
import type { Gate, Verdict } from '../types.js';
import { CoverageLedger } from './ledger.js';
import { InMemoryLedgerStore } from './store.js';

const corpus = new CorpusIndex([
  {
    docId: 'sec-policy',
    domain: 'security',
    title: 'Security Policy',
    sections: [{ id: 'deps-1', heading: 'Dependency review', body: 'New dependencies require a CVE scan.' }],
  },
  {
    docId: 'lic-matrix',
    domain: 'licensing',
    title: 'License Matrix',
    sections: [{ id: 'sdk-3', heading: 'Third-party SDKs', body: 'SDK terms must permit redistribution.' }],
  },
] satisfies PolicyDoc[]);

const gate: Gate = {
  gateId: 'g1',
  release: 'Mobile 4.2 — adds analytics and a new payment SDK',
  requirements: [
    { id: 'r-cve', label: 'New dependencies CVE-scanned', ownerDomain: 'security' },
    { id: 'r-sdk', label: 'Payment SDK license permits redistribution', ownerDomain: 'licensing' },
  ],
};

const verdict = (over: Partial<Verdict>): Verdict => ({
  requirementId: 'r-cve',
  fromDomain: 'security',
  outcome: 'pass',
  rationale: 'scan clean',
  citation: { docId: 'sec-policy', sectionId: 'deps-1' },
  ...over,
});

const uncited = (over: Partial<Verdict>): Verdict => {
  const v = verdict(over);
  delete v.citation;
  return v;
};

describe('CoverageLedger', () => {
  let ledger: CoverageLedger;

  beforeEach(async () => {
    ledger = new CoverageLedger(new InMemoryLedgerStore(), corpus);
    await ledger.openGate(gate);
  });

  it('credits an owner pass with a resolvable citation', async () => {
    const result = await ledger.recordVerdict('g1', verdict({}));
    expect(result.recorded).toBe(true);
    const record = await ledger.renderGate('g1');
    const req = record.requirements.find((r) => r.requirement.id === 'r-cve');
    expect(req?.status).toBe('credited');
    expect(req?.citation?.sectionHeading).toBe('Dependency review');
  });

  it('ownership gate: refuses a non-owner verdict and names the owner', async () => {
    // The Mateo moment: SRE answering a licensing question earns nothing.
    const result = await ledger.recordVerdict('g1', verdict({ requirementId: 'r-sdk', fromDomain: 'sre' }));
    expect(result).toMatchObject({ recorded: false, reason: 'misdirected', askInstead: 'licensing' });
    const record = await ledger.renderGate('g1');
    const req = record.requirements.find((r) => r.requirement.id === 'r-sdk');
    expect(req?.status).toBe('pending');
    expect(req?.attempts).toHaveLength(1);
  });

  it('ownership gate: even the owner domain cannot credit someone else’s requirement', async () => {
    const result = await ledger.recordVerdict('g1', verdict({ requirementId: 'r-sdk', fromDomain: 'security' }));
    expect(result).toMatchObject({ recorded: false, reason: 'misdirected', askInstead: 'licensing' });
  });

  it('citation gate: refuses a confident pass with no citation', async () => {
    const result = await ledger.recordVerdict('g1', uncited({}));
    expect(result).toMatchObject({ recorded: false, reason: 'no_citation' });
    expect((await ledger.renderGate('g1')).requirements[0]?.status).toBe('pending');
  });

  it('citation gate: refuses a citation into another domain’s corpus', async () => {
    const result = await ledger.recordVerdict(
      'g1',
      verdict({ citation: { docId: 'lic-matrix', sectionId: 'sdk-3' } }),
    );
    expect(result).toMatchObject({ recorded: false, reason: 'unresolvable_citation' });
  });

  it('citation gate: refuses a fabricated section id', async () => {
    const result = await ledger.recordVerdict(
      'g1',
      verdict({ citation: { docId: 'sec-policy', sectionId: 'made-up' } }),
    );
    expect(result).toMatchObject({ recorded: false, reason: 'unresolvable_citation' });
  });

  it('records an owner fail without requiring a citation', async () => {
    const result = await ledger.recordVerdict('g1', uncited({ outcome: 'fail' }));
    expect(result.recorded).toBe(true);
    const record = await ledger.renderGate('g1');
    expect(record.requirements[0]?.status).toBe('failed');
    expect(record.decision).toBe('HOLD');
  });

  it('lets the owner supersede a fail with a later credited pass', async () => {
    await ledger.recordVerdict('g1', uncited({ outcome: 'fail' }));
    const result = await ledger.recordVerdict('g1', verdict({}));
    expect(result.recorded).toBe(true);
    expect((await ledger.renderGate('g1')).requirements[0]?.status).toBe('credited');
  });

  it('completeness gate: HOLD until every requirement is credited, then SHIP', async () => {
    await ledger.recordVerdict('g1', verdict({}));
    expect((await ledger.renderGate('g1')).decision).toBe('HOLD');

    await ledger.recordVerdict(
      'g1',
      verdict({
        requirementId: 'r-sdk',
        fromDomain: 'licensing',
        citation: { docId: 'lic-matrix', sectionId: 'sdk-3' },
      }),
    );
    const record = await ledger.renderGate('g1');
    expect(record.decision).toBe('SHIP');
    expect(record.counts).toEqual({ credited: 2, failed: 0, pending: 0, rejectedAttempts: 0 });
  });

  it('keeps the full audit trail: misdirection then correct routing', async () => {
    await ledger.recordVerdict('g1', verdict({ requirementId: 'r-sdk', fromDomain: 'sre' }));
    await ledger.recordVerdict(
      'g1',
      verdict({
        requirementId: 'r-sdk',
        fromDomain: 'licensing',
        citation: { docId: 'lic-matrix', sectionId: 'sdk-3' },
      }),
    );
    const record = await ledger.renderGate('g1');
    const req = record.requirements.find((r) => r.requirement.id === 'r-sdk');
    expect(req?.status).toBe('credited');
    expect(req?.attempts.map((a) => a.reason)).toEqual(['misdirected']);
    expect(record.counts.rejectedAttempts).toBe(1);
  });

  it('refuses verdicts for unknown requirements and unknown gates', async () => {
    const result = await ledger.recordVerdict('g1', verdict({ requirementId: 'nope' }));
    expect(result).toMatchObject({ recorded: false, reason: 'unknown_requirement' });
    await expect(ledger.recordVerdict('g9', verdict({}))).rejects.toThrow(/unknown gate/);
  });

  it('rejects gates with duplicate or zero requirements at open', async () => {
    await expect(ledger.openGate({ ...gate, gateId: 'g2', requirements: [] })).rejects.toThrow(/no requirements/);
    await expect(
      ledger.openGate({
        ...gate,
        gateId: 'g3',
        requirements: [gate.requirements[0]!, gate.requirements[0]!],
      }),
    ).rejects.toThrow(/duplicate requirement/);
  });
});
