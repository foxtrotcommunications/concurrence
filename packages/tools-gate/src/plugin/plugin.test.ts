import { describe, expect, it } from 'vitest';
import type { Gate } from '../types.js';
import { registerAuditorCapabilities } from './auditor.js';
import { registerDomainCapabilities, registerDomainTools } from './domain.js';
import { concurrenceGate, configFromEnv } from './plugin.js';
import type { CapabilityHandler, ToolDefinition } from './types.js';

const collect = () => {
  const tools = new Map<string, ToolDefinition>();
  const caps = new Map<string, CapabilityHandler>();
  return {
    tools,
    caps,
    toolRegistry: { register: (n: string, t: ToolDefinition) => void tools.set(n, t) },
    capRegistry: { register: (n: string, h: CapabilityHandler) => void caps.set(n, h) },
  };
};

const gate: Gate = {
  gateId: 'g1',
  release: 'test',
  requirements: [{ id: 'r1', label: 'CVE scan clean', ownerDomain: 'security' }],
};

describe('concurrenceGate plugin', () => {
  it('registers the domain registrar with tools and capabilities', () => {
    const { toolRegistry, capRegistry, tools, caps } = collect();
    concurrenceGate.register(toolRegistry, capRegistry, {
      domainType: 'domain',
      workspaceId: 'ws1',
      policyDomain: 'licensing',
    });
    expect([...tools.keys()]).toEqual(['read_policy']);
    expect([...caps.keys()]).toEqual(['domain.corpus', 'domain.identity']);
  });

  it('read_policy exposes only the pod own corpus', async () => {
    const { toolRegistry, tools } = collect();
    registerDomainTools(toolRegistry, { domainType: 'domain', workspaceId: 'ws1', policyDomain: 'licensing' });
    const result = (await tools.get('read_policy')!.handler({})) as { docs: Array<{ docId: string }> };
    expect(result.docs.map((d) => d.docId)).toEqual(['lic-matrix']);
  });

  it('domain.corpus capability is scoped to the pod domain', async () => {
    const { capRegistry, caps } = collect();
    registerDomainCapabilities(capRegistry, { domainType: 'domain', workspaceId: 'ws1', policyDomain: 'sre' });
    const result = (await caps.get('domain.corpus')!(
      {},
      { workspaceId: 'ws1', domainType: 'domain' },
    )) as { docs: Array<{ domain: string }> };
    expect(result.docs.every((d) => d.domain === 'sre')).toBe(true);
  });

  it('auditor capabilities run the full gate lifecycle with enforcement', async () => {
    const { capRegistry, caps } = collect();
    registerAuditorCapabilities(capRegistry, { domainType: 'auditor', workspaceId: 'wsA' });
    const ctx = { workspaceId: 'wsA', domainType: 'auditor' as const };

    await caps.get('gate.open')!(gate as unknown as Record<string, unknown>, ctx);

    const misdirected = (await caps.get('gate.record')!(
      {
        gateId: 'g1',
        verdict: { requirementId: 'r1', fromDomain: 'sre', outcome: 'pass', rationale: 'sure' },
      },
      ctx,
    )) as { recorded: boolean; reason?: string };
    expect(misdirected).toMatchObject({ recorded: false, reason: 'misdirected' });

    await caps.get('gate.record')!(
      {
        gateId: 'g1',
        verdict: {
          requirementId: 'r1',
          fromDomain: 'security',
          outcome: 'pass',
          rationale: 'scan clean',
          citation: { docId: 'sec-policy', sectionId: 'deps-cve' },
        },
      },
      ctx,
    );
    const rendered = (await caps.get('gate.render')!({ gateId: 'g1' }, ctx)) as { decision: string };
    expect(rendered.decision).toBe('SHIP');
  });

  it('auditor ledgers are isolated per workspace', async () => {
    const { capRegistry, caps } = collect();
    registerAuditorCapabilities(capRegistry, { domainType: 'auditor', workspaceId: 'x' });
    await caps.get('gate.open')!(
      { ...gate, gateId: 'iso' } as unknown as Record<string, unknown>,
      { workspaceId: 'ws-one', domainType: 'auditor' },
    );
    const other = await caps.get('gate.state')!({ gateId: 'iso' }, { workspaceId: 'ws-two', domainType: 'auditor' });
    expect(other).toBeNull();
  });

  it('getCapabilities matches the registrar surfaces', () => {
    expect(concurrenceGate.getCapabilities('auditor')).toEqual(['gate.open', 'gate.record', 'gate.render', 'gate.state']);
    expect(concurrenceGate.getCapabilities('domain')).toEqual(['domain.corpus', 'domain.identity']);
  });

  it('configFromEnv resolves type and policy domain from env and name heuristics', () => {
    expect(configFromEnv({ DOMAIN_TYPE: 'auditor', WS_ID: 'a' })).toEqual({
      domainType: 'auditor',
      workspaceId: 'a',
    });
    expect(configFromEnv({ CONCURRENCE_DOMAIN: 'data-governance', WS_ID: 'b' })).toEqual({
      domainType: 'domain',
      workspaceId: 'b',
      policyDomain: 'data-governance',
    });
    expect(configFromEnv({ WS_NAME: 'Data Governance', WS_ID: 'c' })).toMatchObject({
      policyDomain: 'data-governance',
    });
    expect(configFromEnv({ WS_NAME: 'Auditor', WS_ID: 'd' })).toMatchObject({ domainType: 'auditor' });
  });
});
