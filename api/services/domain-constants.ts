// Canonical definitions for pod tools and bridge-contract capability actions.
// Kept in lockstep with @concurrence/tools-gate's DOMAIN_CAPS — if a
// capability is added there, its action belongs here.

import type { PodDomainType } from '@concurrence/tools-gate';

// Pods run Gemini via Vertex (hackathon requirement: Gemini 3.5+).
export const DOMAIN_AI_PROVIDER = 'gemini-enterprise';
export const DOMAIN_AI_MODEL = 'gemini-3.5-flash';

export const GATE_ACTIONS = [
  'capability:gate.open',
  'capability:gate.record',
  'capability:gate.render',
  'capability:gate.state',
] as const;

export const DOMAIN_POD_ACTIONS = ['capability:domain.corpus', 'capability:domain.identity'] as const;

export const DOMAIN_TOOLS: Record<PodDomainType, string[]> = {
  domain: ['read_policy'],
  auditor: ['gate_status'],
};

export const DOMAIN_ACTIONS: Record<PodDomainType, string[]> = {
  domain: [...DOMAIN_POD_ACTIONS],
  auditor: [...GATE_ACTIONS],
};
