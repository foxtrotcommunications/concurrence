/**
 * Core domain types for Concurrence.
 *
 * A Gate is a release-readiness checklist. Each Requirement is owned by
 * exactly one domain authority; only that owner's verdict can ever change
 * the requirement's status. Everything here is deterministic — no model
 * output is trusted past the boundaries enforced in ledger.ts.
 */

export type Domain = string;

export interface Requirement {
  id: string;
  label: string;
  /** The domain whose verdict is the only one that counts for this requirement. */
  ownerDomain: Domain;
}

export interface Gate {
  gateId: string;
  /** Free-text description of the release candidate under review. */
  release: string;
  requirements: Requirement[];
}

/** A pointer into a policy corpus that code can resolve — the "receipt". */
export interface Citation {
  docId: string;
  sectionId: string;
}

export type VerdictOutcome = 'pass' | 'fail';

/** What a domain pod (or the orchestrator on its behalf) submits. */
export interface Verdict {
  requirementId: string;
  /** The domain that issued this verdict — not necessarily the owner. */
  fromDomain: Domain;
  outcome: VerdictOutcome;
  rationale: string;
  citation?: Citation;
}

export type RequirementStatus = 'pending' | 'credited' | 'failed';

export type RejectionReason =
  | 'misdirected' // verdict came from a domain that does not own the requirement
  | 'no_citation' // a pass with no citation at all
  | 'unresolvable_citation' // citation does not resolve inside the owner's corpus
  | 'unknown_requirement';

/** A verdict the ledger refused, kept for the audit trail. */
export interface RejectedAttempt {
  verdict: Verdict;
  reason: RejectionReason;
  /** For misdirected attempts: the domain that actually owns the requirement. */
  askInstead?: Domain;
}

export interface ResolvedCitation extends Citation {
  domain: Domain;
  docTitle: string;
  sectionHeading: string;
  excerpt: string;
}

export interface RequirementState {
  requirement: Requirement;
  status: RequirementStatus;
  /** The owner-issued verdict currently in force (absent while pending). */
  verdict?: Verdict;
  /** Resolved receipt for a credited requirement. */
  citation?: ResolvedCitation;
  /** Every refused verdict, in order — misdirections and missing receipts. */
  attempts: RejectedAttempt[];
}

export interface GateState {
  gate: Gate;
  requirements: Record<string, RequirementState>;
  openedAt: string;
}

export type GateDecision = 'SHIP' | 'HOLD';

/** The audit record render_gate produces. The model never writes this. */
export interface GateRecord {
  gateId: string;
  release: string;
  decision: GateDecision;
  requirements: RequirementState[];
  counts: {
    credited: number;
    failed: number;
    pending: number;
    rejectedAttempts: number;
  };
}

export type RecordResult =
  | { recorded: true; state: RequirementState }
  | { recorded: false; reason: RejectionReason; askInstead?: Domain; state?: RequirementState };
