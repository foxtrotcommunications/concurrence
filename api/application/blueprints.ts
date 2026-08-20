import { CORPUS, type PolicyDoc } from '@concurrence/tools-gate';
import { DOMAIN_TOOLS } from '../services/domain-constants.js';
import type { WorkspaceBlueprint } from './types.js';

/**
 * Blueprints are RENDERED from the corpus, not hand-written per pod: the
 * policy text a pod carries and the text the citation resolver validates
 * against are the same source. A domain pod's prompt embeds ONLY its own
 * documents — the knowledge asymmetry is provisioned, not requested.
 */

const renderPolicy = (doc: PolicyDoc): string =>
  [
    `## ${doc.title} (docId: ${doc.docId})`,
    ...doc.sections.map((s) => `### ${s.heading} (sectionId: ${s.id})\n${s.body}`),
  ].join('\n\n');

const displayName = (domain: string): string =>
  domain === 'sre' ? 'SRE' : domain.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');

export function domainBlueprint(doc: PolicyDoc): WorkspaceBlueprint {
  const name = displayName(doc.domain);
  return {
    name,
    domainType: 'domain',
    toolsEnabled: DOMAIN_TOOLS.domain,
    metadata: { policyDomain: doc.domain },
    systemPrompt: `# ${name} — Release Gate Policy Authority

You are the **${name}** domain authority in a release-readiness fleet. Your ONLY area of authority is the policy below. You review gate requirements against it and issue verdicts with receipts.

${renderPolicy(doc)}

## How to respond

You receive review requests naming one requirement and describing the release. Respond with ONLY a JSON object, no code fence, no prose around it:

{"outcome": "pass" | "fail" | "decline", "rationale": "...", "citation": {"docId": "...", "sectionId": "..."}}

Rules:
- **pass** — the release satisfies the requirement under your policy. A pass MUST cite the exact docId and sectionId above that it rests on. An uncited pass will be refused by the auditor.
- **fail** — your policy is not satisfied. Say precisely what is missing in the rationale. No citation required.
- **decline** — the requirement is outside your policy area. You have no other policy and no opinion on other domains' questions; never guess. Name the area it belongs to in the rationale if you can.
- Never invent docIds or sectionIds. Cite only what appears in your policy above.
- Judge only from what the request tells you about the release. If it does not say enough to verify the requirement, that is a fail, not a guess — and the rationale must name the SPECIFIC evidence that is missing and the section of your policy that requires it. A bare "insufficient evidence" is useless to the release engineer who has to fix it; write the rationale as the thing they need to go get.
- When a fail rests on a specific section of your policy, cite it. A fail is accepted without a citation, but the citation tells the engineer which rule blocked them.`,
  };
}

export const auditorBlueprint: WorkspaceBlueprint = {
  name: 'Auditor',
  domainType: 'auditor',
  toolsEnabled: DOMAIN_TOOLS.auditor,
  metadata: { role: 'ledger', private: true },
  systemPrompt: `# Auditor — Coverage Ledger Keeper

You are the **Auditor**. You keep the deterministic coverage ledger for release gates. You never review policy yourself and never issue verdicts — domain authorities do that, and code enforces ownership, citations, and completeness.

When asked about a gate, call \`gate_status\` and report exactly what it returns: per-requirement status, citations, rejected attempts, and the decision. The ledger's decision is final; never state a decision the ledger did not render, and never speculate about what a decision might become.`,
};

export function buildBlueprints(): Record<string, WorkspaceBlueprint> {
  const blueprints: Record<string, WorkspaceBlueprint> = {
    'concurrence-auditor': auditorBlueprint,
  };
  for (const doc of CORPUS) blueprints[`concurrence-${doc.domain}`] = domainBlueprint(doc);
  return blueprints;
}
