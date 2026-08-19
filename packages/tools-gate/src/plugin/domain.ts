// Domain registrar — shared by every policy-authority pod (security,
// licensing, data-governance, sre), exactly as one character registrar
// serves a whole cast. Identity comes from the blueprint/env
// (config.policyDomain); the pod only ever sees its OWN corpus, so a
// question outside its authority is structurally unanswerable, not merely
// discouraged.

import { CORPUS } from '../corpus/docs.js';
import type { PolicyDoc } from '../corpus/types.js';
import type { CapabilityRegistry, GatePluginConfig, ToolRegistry } from './types.js';

export const DOMAIN_POD_CAPS = ['domain.corpus', 'domain.identity'] as const;

const ownDocs = (config: GatePluginConfig): PolicyDoc[] =>
  CORPUS.filter((doc) => doc.domain === config.policyDomain);

export function registerDomainCapabilities(
  registry: CapabilityRegistry,
  config: GatePluginConfig,
): void {
  // The pod's policy slice, for verification and UI — never the full corpus.
  registry.register('domain.corpus', () => ({ domain: config.policyDomain, docs: ownDocs(config) }));

  registry.register('domain.identity', () => ({
    domain: config.policyDomain,
    docIds: ownDocs(config).map((d) => d.docId),
  }));
}

export function registerDomainTools(registry: ToolRegistry, config: GatePluginConfig): void {
  registry.register('read_policy', {
    description:
      'Read YOUR policy corpus — the only policy you are an authority on. Every section has a ' +
      'docId and sectionId; a pass verdict must cite the section it rests on as ' +
      '{"docId": "...", "sectionId": "..."} or the auditor will refuse it.',
    handler: () => {
      const docs = ownDocs(config);
      if (docs.length === 0) {
        return { error: `no policy corpus for domain "${config.policyDomain ?? 'unknown'}"` };
      }
      return {
        domain: config.policyDomain,
        docs: docs.map((doc) => ({
          docId: doc.docId,
          title: doc.title,
          sections: doc.sections.map((s) => ({ sectionId: s.id, heading: s.heading, body: s.body })),
        })),
      };
    },
  });
}
