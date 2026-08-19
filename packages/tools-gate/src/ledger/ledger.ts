import type {
  Gate,
  GateDecision,
  GateRecord,
  GateState,
  RecordResult,
  RequirementState,
  Verdict,
} from '../types.js';
import type { CorpusIndex } from '../corpus/resolver.js';
import type { LedgerStore } from './store.js';

/**
 * The coverage ledger: single writer of gate state, and the enforcement
 * point for Concurrence's three deterministic gates.
 *
 *   1. ownership    — only the owning domain's verdict is ever recorded;
 *                     anyone else's opinion becomes a `misdirected` attempt.
 *   2. citation     — a pass must carry a citation that resolves inside the
 *                     owner's own corpus, or it is refused.
 *   3. completeness — SHIP renders only when every requirement is credited.
 *                     There is no other path to a SHIP decision.
 *
 * The model routes; this class decides truth.
 */
export class CoverageLedger {
  constructor(
    private readonly store: LedgerStore,
    private readonly corpus: CorpusIndex,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async openGate(gate: Gate): Promise<GateState> {
    if (gate.requirements.length === 0) {
      throw new Error(`gate ${gate.gateId} has no requirements`);
    }
    const seen = new Set<string>();
    for (const req of gate.requirements) {
      if (seen.has(req.id)) throw new Error(`duplicate requirement id: ${req.id}`);
      seen.add(req.id);
    }
    const state: GateState = {
      gate,
      openedAt: this.now(),
      requirements: Object.fromEntries(
        gate.requirements.map((requirement) => [
          requirement.id,
          { requirement, status: 'pending', attempts: [] } satisfies RequirementState,
        ]),
      ),
    };
    await this.store.put(state);
    return state;
  }

  async recordVerdict(gateId: string, verdict: Verdict): Promise<RecordResult> {
    const state = await this.mustGet(gateId);
    const reqState = state.requirements[verdict.requirementId];
    if (!reqState) {
      return { recorded: false, reason: 'unknown_requirement' };
    }
    const owner = reqState.requirement.ownerDomain;

    // Gate 1: ownership. A non-owner verdict is surfaced, never credited.
    if (verdict.fromDomain !== owner) {
      reqState.attempts.push({ verdict, reason: 'misdirected', askInstead: owner });
      await this.store.put(state);
      return { recorded: false, reason: 'misdirected', askInstead: owner, state: reqState };
    }

    // Gate 2: citation. A pass without a resolvable receipt into the
    // owner's corpus is refused regardless of how confident it sounded.
    if (verdict.outcome === 'pass') {
      if (!verdict.citation) {
        reqState.attempts.push({ verdict, reason: 'no_citation' });
        await this.store.put(state);
        return { recorded: false, reason: 'no_citation', state: reqState };
      }
      const resolved = this.corpus.resolve(owner, verdict.citation);
      if (!resolved) {
        reqState.attempts.push({ verdict, reason: 'unresolvable_citation' });
        await this.store.put(state);
        return { recorded: false, reason: 'unresolvable_citation', state: reqState };
      }
      reqState.status = 'credited';
      reqState.verdict = verdict;
      reqState.citation = resolved;
      await this.store.put(state);
      return { recorded: true, state: reqState };
    }

    // An owner's fail needs no receipt: it can only block a release, never
    // approve one, so the safe direction requires no proof.
    reqState.status = 'failed';
    reqState.verdict = verdict;
    delete reqState.citation;
    await this.store.put(state);
    return { recorded: true, state: reqState };
  }

  /**
   * Gate 3: completeness. Reads state, tallies, and decides. This is the
   * only producer of a SHIP decision in the entire system.
   */
  async renderGate(gateId: string): Promise<GateRecord> {
    const state = await this.mustGet(gateId);
    const requirements = state.gate.requirements.map((r) => {
      const reqState = state.requirements[r.id];
      if (!reqState) throw new Error(`requirement state missing: ${r.id}`);
      return reqState;
    });
    const counts = {
      credited: requirements.filter((r) => r.status === 'credited').length,
      failed: requirements.filter((r) => r.status === 'failed').length,
      pending: requirements.filter((r) => r.status === 'pending').length,
      rejectedAttempts: requirements.reduce((n, r) => n + r.attempts.length, 0),
    };
    const decision: GateDecision = counts.credited === requirements.length ? 'SHIP' : 'HOLD';
    return {
      gateId,
      release: state.gate.release,
      decision,
      requirements,
      counts,
    };
  }

  async getState(gateId: string): Promise<GateState | null> {
    return this.store.get(gateId);
  }

  private async mustGet(gateId: string): Promise<GateState> {
    const state = await this.store.get(gateId);
    if (!state) throw new Error(`unknown gate: ${gateId}`);
    return state;
  }
}
