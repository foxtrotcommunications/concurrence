import { CorpusIndex } from '../corpus/resolver.js';
import { CORPUS } from '../corpus/docs.js';
import { CoverageLedger } from '../ledger/ledger.js';
import { InMemoryLedgerStore } from '../ledger/store.js';

/**
 * Pod-side singletons, keyed by workspaceId so two workspaces sharing a
 * process can never see each other's state (the Chinese Wall at the store
 * boundary). The auditor's ledger is in-memory inside the pod; the
 * orchestrator's Firestore ledger is the cross-restart record.
 */

const corpusIndex = new CorpusIndex(CORPUS);
const ledgers = new Map<string, CoverageLedger>();

export function ledgerFor(workspaceId: string): CoverageLedger {
  let ledger = ledgers.get(workspaceId);
  if (!ledger) {
    ledger = new CoverageLedger(new InMemoryLedgerStore(), corpusIndex);
    ledgers.set(workspaceId, ledger);
  }
  return ledger;
}

export { corpusIndex };
