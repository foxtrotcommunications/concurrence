export interface Requirement {
  id: string;
  label: string;
  ownerDomain: string;
}

export interface Gate {
  gateId: string;
  release: string;
  requirements: Requirement[];
}

export interface RejectedAttempt {
  verdict: { fromDomain: string; outcome: string; rationale: string };
  reason: string;
  askInstead?: string;
}

export interface RequirementState {
  requirement: Requirement;
  status: 'pending' | 'credited' | 'failed';
  verdict?: { fromDomain: string; outcome: string; rationale: string };
  citation?: { docTitle: string; sectionHeading: string; docId: string; sectionId: string };
  attempts: RejectedAttempt[];
}

export interface GateRecord {
  gateId: string;
  release: string;
  decision: 'SHIP' | 'HOLD';
  requirements: RequirementState[];
  counts: { credited: number; failed: number; pending: number; rejectedAttempts: number };
}
