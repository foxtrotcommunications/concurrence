import { beforeEach, describe, expect, it } from 'vitest';
import {
  CORPUS,
  CorpusIndex,
  CoverageLedger,
  InMemoryLedgerStore,
  type Gate,
} from '@concurrence/tools-gate';
import { FakeFleetClient } from './fleetClient.ts';
import { consultDomain, listRequirements, recordVerdict, renderGate, type GateToolContext } from './tools.ts';

const gate: Gate = {
  gateId: 'g1',
  release: 'adds a payment SDK and a cart schema migration',
  requirements: [
    { id: 'sdk-license', label: 'Payment SDK license permits redistribution', ownerDomain: 'licensing' },
    { id: 'rollback', label: 'Cart schema migration has a tested rollback plan', ownerDomain: 'sre' },
  ],
};

const makeCtx = async (fleet: FakeFleetClient): Promise<GateToolContext> => {
  const ledger = new CoverageLedger(new InMemoryLedgerStore(), new CorpusIndex(CORPUS));
  await ledger.openGate(gate);
  return { ledger, fleet, gateId: 'g1', release: gate.release };
};

describe('gate tools', () => {
  let ctx: GateToolContext;

  beforeEach(async () => {
    ctx = await makeCtx(new FakeFleetClient());
  });

  it('list_requirements reports owners and statuses', async () => {
    const result = await listRequirements(ctx);
    expect('requirements' in result && result.requirements).toHaveLength(2);
    if ('requirements' in result) {
      expect(result.requirements[0]).toMatchObject({ id: 'sdk-license', ownerDomain: 'licensing', status: 'pending' });
    }
  });

  it('an owner consult returns a citation that the ledger then credits', async () => {
    const response = await consultDomain(ctx, { domain: 'licensing', requirementId: 'sdk-license' });
    expect(response).toMatchObject({ outcome: 'pass' });
    if (!('error' in response) && response.outcome === 'pass' && response.citation) {
      const recorded = await recordVerdict(ctx, {
        requirementId: 'sdk-license',
        fromDomain: 'licensing',
        outcome: 'pass',
        rationale: response.rationale,
        citation: response.citation,
      });
      expect(recorded).toMatchObject({ recorded: true, status: 'credited' });
    } else {
      throw new Error('expected a cited pass from the owner');
    }
  });

  it('a non-owner consult declines and names the owner', async () => {
    const response = await consultDomain(ctx, { domain: 'sre', requirementId: 'sdk-license' });
    expect(response).toMatchObject({ outcome: 'decline' });
    if (!('error' in response)) expect(response.rationale).toContain('licensing');
  });

  it('recording a non-owner verdict returns a routing hint', async () => {
    const result = await recordVerdict(ctx, {
      requirementId: 'sdk-license',
      fromDomain: 'sre',
      outcome: 'pass',
      rationale: 'seems fine',
    });
    expect(result).toMatchObject({ recorded: false, reason: 'misdirected', askInstead: 'licensing' });
    if (!result.recorded) expect(result.hint).toContain('licensing');
  });

  it('confabulation quirk: first consult is uncited and refused, re-consult recovers', async () => {
    ctx = await makeCtx(new FakeFleetClient({ confabulateFirst: ['licensing'] }));

    const first = await consultDomain(ctx, { domain: 'licensing', requirementId: 'sdk-license' });
    if ('error' in first) throw new Error('unexpected error');
    expect(first.citation).toBeUndefined();

    const refused = await recordVerdict(ctx, {
      requirementId: 'sdk-license',
      fromDomain: 'licensing',
      outcome: 'pass',
      rationale: first.rationale,
    });
    expect(refused).toMatchObject({ recorded: false, reason: 'no_citation' });

    const second = await consultDomain(ctx, { domain: 'licensing', requirementId: 'sdk-license' });
    if ('error' in second || !second.citation) throw new Error('expected a receipt on re-consult');
    const recovered = await recordVerdict(ctx, {
      requirementId: 'sdk-license',
      fromDomain: 'licensing',
      outcome: 'pass',
      rationale: second.rationale,
      citation: second.citation,
    });
    expect(recovered).toMatchObject({ recorded: true, status: 'credited' });
  });

  it('owner fail is recorded and holds the gate', async () => {
    ctx = await makeCtx(new FakeFleetClient({ failRequirements: ['rollback'] }));
    const response = await consultDomain(ctx, { domain: 'sre', requirementId: 'rollback' });
    if ('error' in response) throw new Error('unexpected error');
    expect(response.outcome).toBe('fail');
    const recorded = await recordVerdict(ctx, {
      requirementId: 'rollback',
      fromDomain: 'sre',
      outcome: 'fail',
      rationale: response.rationale,
    });
    expect(recorded).toMatchObject({ recorded: true, status: 'failed' });
    expect((await renderGate(ctx)).decision).toBe('HOLD');
  });

  it('render_gate flips to SHIP only when everything is credited', async () => {
    for (const requirement of gate.requirements) {
      const response = await consultDomain(ctx, {
        domain: requirement.ownerDomain,
        requirementId: requirement.id,
      });
      if ('error' in response || !response.citation) throw new Error('expected cited pass');
      await recordVerdict(ctx, {
        requirementId: requirement.id,
        fromDomain: requirement.ownerDomain,
        outcome: 'pass',
        rationale: response.rationale,
        citation: response.citation,
      });
    }
    const rendered = await renderGate(ctx);
    expect(rendered.decision).toBe('SHIP');
    expect(rendered.requirements.every((r) => r.citation)).toBe(true);
  });

  it('fake fleet picks the plausible policy section for the requirement', async () => {
    const response = await consultDomain(ctx, { domain: 'sre', requirementId: 'rollback' });
    if ('error' in response || !response.citation) throw new Error('expected cited pass');
    expect(response.citation).toEqual({ docId: 'sre-runbook', sectionId: 'rollback' });
  });
});
