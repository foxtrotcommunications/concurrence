import { CORPUS, type Domain, type Gate } from '@concurrence/tools-gate';
import { genai, TEXT_MODEL } from '../services/vertex.ts';
import { parseGeneratedGate, type ParseResult } from './parse.ts';

/**
 * Free-text release description → owned gate checklist. The model proposes
 * requirements and owners; parseGeneratedGate repairs and enforces. The
 * prompt shows each domain's section headings (not bodies) so ownership
 * lands where the policy actually lives without leaking corpora across
 * domains at generation time.
 */

const domainCatalog = (): string =>
  CORPUS.map(
    (doc) =>
      `- ${doc.domain}: "${doc.title}" covering ${doc.sections.map((s) => s.heading.toLowerCase()).join('; ')}`,
  ).join('\n');

const PROMPT = (release: string, domains: Domain[]) => `You generate a release-readiness gate checklist.

Release under review:
${release}

Domain authorities and what their policies cover:
${domainCatalog()}

Produce 4-8 gate requirements for THIS release. Rules:
- Each requirement is one concrete, checkable claim about this release, phrased so its owner can verify it against their policy.
- ownerDomain must be exactly one of: ${domains.join(', ')}. Assign the domain whose policy actually governs the claim.
- Cover every domain that is plausibly implicated by the release; do not invent requirements for domains the release clearly does not touch.
- Only include requirements this specific release makes relevant.

Respond with ONLY a JSON object, no code fence:
{"requirements": [{"id": "kebab-case-slug", "label": "…", "ownerDomain": "…"}]}`;

export async function generateGate(
  release: string,
  opts: { gateId: string; mustCover?: Domain[] } = { gateId: `gate-${Math.random().toString(36).slice(2, 8)}` },
): Promise<ParseResult & { gate: Gate }> {
  const domains = [...new Set(CORPUS.map((d) => d.domain))];
  const response = await genai().models.generateContent({
    model: TEXT_MODEL,
    contents: PROMPT(release, domains),
    config: { responseMimeType: 'application/json', temperature: 0.2 },
  });
  const text = response.text;
  if (!text) throw new Error('empty generator response');
  return parseGeneratedGate(text, {
    gateId: opts.gateId,
    release,
    knownDomains: domains,
    ...(opts.mustCover ? { mustCover: opts.mustCover } : {}),
  });
}
