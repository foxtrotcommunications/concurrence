import type { Domain } from '../types.js';

/**
 * Policy corpora are structured so citations are code-resolvable: a verdict's
 * receipt is a (docId, sectionId) pair that must exist — and must belong to
 * the citing requirement's OWNER domain. A domain cannot cite another
 * domain's policy; that is the Chinese Wall expressed at the corpus layer.
 */

export interface PolicySection {
  id: string;
  heading: string;
  body: string;
}

export interface PolicyDoc {
  docId: string;
  /** The single domain this document belongs to. */
  domain: Domain;
  title: string;
  sections: PolicySection[];
}
