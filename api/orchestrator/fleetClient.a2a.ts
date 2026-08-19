import type { Domain, Requirement } from '@concurrence/tools-gate';
import { sendA2aMessage } from '../services/roundtable.js';
import type { FleetDirectory } from '../provisioning/provision.js';
import type { DomainResponse, FleetClient } from './fleetClient.js';

/**
 * Live fleet client: consults real Roundtable domain pods over A2A. Drop-in
 * for FakeFleetClient — the orchestrator cannot tell them apart, and the
 * ledger enforces the same gates on whatever comes back.
 */
export class A2AFleetClient implements FleetClient {
  constructor(private readonly directory: FleetDirectory) {}

  async consultDomain(domain: Domain, requirement: Requirement, release: string): Promise<DomainResponse> {
    const pod = this.directory.domains[domain];
    if (!pod) {
      return { outcome: 'decline', rationale: `No pod for domain "${domain}" in the fleet directory.` };
    }
    const prompt = `Review request.
Release under review: ${release}
Requirement (id: ${requirement.id}): ${requirement.label}
Respond with your verdict JSON only.`;

    const { text } = await sendA2aMessage(pod.workspaceUrl, pod.a2aApiKey, prompt);
    return parseDomainReply(text);
  }
}

/**
 * Parse a domain pod's verdict JSON out of its reply text (pure, unit
 * tested). Anything unparseable degrades to a rationale-only decline — the
 * ledger then simply never credits it, which is the safe direction.
 */
export function parseDomainReply(text: string): DomainResponse {
  const candidate = extractJsonObject(text);
  if (!candidate) {
    return { outcome: 'decline', rationale: `Unparseable reply: ${text.slice(0, 200)}` };
  }
  const outcome = candidate['outcome'];
  if (outcome !== 'pass' && outcome !== 'fail' && outcome !== 'decline') {
    return { outcome: 'decline', rationale: `Reply had no valid outcome: ${text.slice(0, 200)}` };
  }
  const rationale = typeof candidate['rationale'] === 'string' ? candidate['rationale'] : '';
  const rawCitation = candidate['citation'] as { docId?: unknown; sectionId?: unknown } | undefined;
  const citation =
    rawCitation &&
    typeof rawCitation.docId === 'string' &&
    typeof rawCitation.sectionId === 'string' &&
    rawCitation.docId.length > 0 &&
    rawCitation.sectionId.length > 0
      ? { docId: rawCitation.docId, sectionId: rawCitation.sectionId }
      : undefined;
  return { outcome, rationale, ...(citation ? { citation } : {}) };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
