import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { GateState, LedgerStore } from '@concurrence/tools-gate';
import { GCP_PROJECT } from '../services/vertex.ts';

/**
 * Firestore-backed LedgerStore: one document per gate, whole-state get/put.
 * CoverageLedger remains the single writer — this class is pure persistence
 * and enforces nothing. Uses ADC (or FIREBASE_SERVICE_ACCOUNT_JSON when set),
 * same as the rest of the stack.
 */
export class FirestoreLedgerStore implements LedgerStore {
  private readonly db: Firestore;

  constructor(collection = process.env['CONCURRENCE_LEDGER_COLLECTION'] ?? 'concurrence_gates') {
    this.db = firestore();
    this.collection = collection;
  }

  private readonly collection: string;

  async get(gateId: string): Promise<GateState | null> {
    const snap = await this.db.collection(this.collection).doc(gateId).get();
    return snap.exists ? (snap.data() as GateState) : null;
  }

  async put(state: GateState): Promise<void> {
    await this.db.collection(this.collection).doc(state.gate.gateId).set(state);
  }
}

let cached: Firestore | undefined;

function firestore(): Firestore {
  if (cached) return cached;
  if (getApps().length === 0) {
    const inlineCreds = process.env['FIREBASE_SERVICE_ACCOUNT_JSON'];
    initializeApp(
      inlineCreds
        ? { credential: cert(JSON.parse(inlineCreds)), projectId: GCP_PROJECT }
        : { projectId: GCP_PROJECT },
    );
  }
  cached = getFirestore();
  return cached;
}
