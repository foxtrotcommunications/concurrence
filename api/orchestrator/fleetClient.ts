import { CORPUS, type Domain, type Requirement } from '@concurrence/tools-gate';

/**
 * The seam to the domain pods. The A2A implementation (real Roundtable pods)
 * and this deterministic fake are drop-in replacements; the orchestrator
 * never knows which it is talking to.
 */

export interface DomainResponse {
  outcome: 'pass' | 'fail' | 'decline';
  rationale: string;
  citation?: { docId: string; sectionId: string };
}

export interface FleetClient {
  consultDomain(domain: Domain, requirement: Requirement, release: string): Promise<DomainResponse>;
}

export interface FakeFleetOptions {
  /**
   * Domains that answer their FIRST consult per requirement with a confident
   * pass and no citation — the confabulation the ledger must catch. Repeat
   * consults return a proper receipt, so the agent can recover by re-asking.
   */
  confabulateFirst?: Domain[];
  /** Requirement ids the owner genuinely fails. */
  failRequirements?: string[];
}

/**
 * Deterministic stand-in for the pod fleet, grounded in the real corpora:
 * an owner answers with a citation into its own policy (picked by keyword
 * overlap with the requirement label); a non-owner declines and points at
 * the owner — the Chinese Wall behavior the real pods exhibit.
 */
export class FakeFleetClient implements FleetClient {
  private readonly consulted = new Set<string>();

  constructor(private readonly options: FakeFleetOptions = {}) {}

  async consultDomain(domain: Domain, requirement: Requirement, _release: string): Promise<DomainResponse> {
    if (domain !== requirement.ownerDomain) {
      return {
        outcome: 'decline',
        rationale: `This is outside my policy area — ${requirement.ownerDomain} owns "${requirement.label}". Ask them.`,
      };
    }

    if (this.options.failRequirements?.includes(requirement.id)) {
      return {
        outcome: 'fail',
        rationale: `Reviewed against our policy: this release does not currently satisfy "${requirement.label}".`,
      };
    }

    const key = `${domain}:${requirement.id}`;
    const firstConsult = !this.consulted.has(key);
    this.consulted.add(key);
    if (firstConsult && this.options.confabulateFirst?.includes(domain)) {
      return {
        outcome: 'pass',
        rationale: 'This is fine — I am confident it complies with our policy.',
      };
    }

    const doc = CORPUS.find((d) => d.domain === domain);
    if (!doc) return { outcome: 'decline', rationale: `No policy corpus for domain ${domain}.` };
    const section = bestSection(doc.sections, `${requirement.id} ${requirement.label}`);
    return {
      outcome: 'pass',
      rationale: `Verified against ${doc.title} § "${section.heading}".`,
      citation: { docId: doc.docId, sectionId: section.id },
    };
  }
}

const STEM = 5;
const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);

/**
 * Pick the section a requirement most plausibly rests on.
 *
 * Matching is prefix-based rather than exact-substring: policy prose and
 * requirement text rarely share an inflection ("alerting"/"alert",
 * "metrics"/"metric"), and exact matching scored every section zero — which
 * silently handed every requirement to whichever section happened to be
 * first. Headings weigh more than bodies, and the requirement id counts as
 * signal because generated ids are topical ("payment-sdk-observability").
 */
const bestSection = <T extends { heading: string; body: string }>(
  sections: T[],
  requirementText: string,
): T => {
  const wanted = new Set(tokens(requirementText).map((w) => w.slice(0, STEM)));
  const hits = (text: string): number => {
    const stems = new Set(tokens(text).map((w) => w.slice(0, STEM)));
    let n = 0;
    for (const stem of wanted) if (stems.has(stem)) n++;
    return n;
  };

  let best = sections[0]!;
  let bestScore = -1;
  for (const section of sections) {
    const score = hits(section.heading) * 3 + hits(section.body);
    if (score > bestScore) {
      best = section;
      bestScore = score;
    }
  }
  return best;
};
