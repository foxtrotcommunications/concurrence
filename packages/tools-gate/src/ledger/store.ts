import type { GateState } from '../types.js';

/**
 * Persistence seam for the coverage ledger. CoverageLedger is the single
 * writer; nothing else may call put(). The in-memory store backs tests and
 * local runs; a Firestore adapter (one doc per gate) backs production.
 */
export interface LedgerStore {
  get(gateId: string): Promise<GateState | null>;
  put(state: GateState): Promise<void>;
}

export class InMemoryLedgerStore implements LedgerStore {
  private readonly gates = new Map<string, GateState>();

  async get(gateId: string): Promise<GateState | null> {
    const state = this.gates.get(gateId);
    return state ? structuredClone(state) : null;
  }

  async put(state: GateState): Promise<void> {
    this.gates.set(state.gate.gateId, structuredClone(state));
  }
}
