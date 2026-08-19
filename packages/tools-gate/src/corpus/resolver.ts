import type { Citation, Domain, ResolvedCitation } from '../types.js';
import type { PolicyDoc } from './types.js';

const EXCERPT_LENGTH = 240;

/**
 * Citation gate, mechanical half: a citation resolves only if the document
 * exists, the section exists, AND the document belongs to the domain that
 * owns the requirement being cited for. Anything else returns null and the
 * ledger refuses the verdict.
 */
export class CorpusIndex {
  private readonly docs = new Map<string, PolicyDoc>();

  constructor(docs: PolicyDoc[]) {
    for (const doc of docs) {
      if (this.docs.has(doc.docId)) {
        throw new Error(`duplicate docId in corpus: ${doc.docId}`);
      }
      this.docs.set(doc.docId, doc);
    }
  }

  resolve(ownerDomain: Domain, citation: Citation): ResolvedCitation | null {
    const doc = this.docs.get(citation.docId);
    if (!doc || doc.domain !== ownerDomain) return null;
    const section = doc.sections.find((s) => s.id === citation.sectionId);
    if (!section) return null;
    return {
      docId: doc.docId,
      sectionId: section.id,
      domain: doc.domain,
      docTitle: doc.title,
      sectionHeading: section.heading,
      excerpt:
        section.body.length > EXCERPT_LENGTH
          ? `${section.body.slice(0, EXCERPT_LENGTH)}…`
          : section.body,
    };
  }

  /** The slice of the corpus one domain is allowed to see. */
  docsFor(domain: Domain): PolicyDoc[] {
    return [...this.docs.values()].filter((d) => d.domain === domain);
  }
}
