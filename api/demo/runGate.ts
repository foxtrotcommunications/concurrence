import { CORPUS, CorpusIndex, CoverageLedger, InMemoryLedgerStore } from '@concurrence/tools-gate';
import { generateGate } from '../generator/gateGen.ts';
import { runGate } from '../orchestrator/agent.ts';
import { FakeFleetClient } from '../orchestrator/fleetClient.ts';

/**
 * Full live turn: free-text release → generated owned checklist → ADK agent
 * routes each requirement to its owner over the fleet seam → deterministic
 * ledger records verdicts → render_gate decides.
 *
 * The security domain confabulates on first consult (confident pass, no
 * receipt) so the run shows the citation gate refusing it and the agent
 * recovering by re-consulting. Needs ADC.
 */

const release =
  process.argv.slice(2).join(' ') ||
  'Mobile app 4.2: adds product analytics events, a new third-party payment SDK, and a schema migration for saved carts.';

console.log(`release: ${release}\n`);

const { gate, repairs } = await generateGate(release, { gateId: 'live-gate' });
if (repairs.length) console.log(`generator repairs: ${repairs.join(' | ')}`);
console.log('gate:');
for (const r of gate.requirements) console.log(`  [${r.ownerDomain}] ${r.id}: ${r.label}`);

const ledger = new CoverageLedger(new InMemoryLedgerStore(), new CorpusIndex(CORPUS));
await ledger.openGate(gate);

console.log('\nrunning orchestrator…\n');
const result = await runGate({
  ledger,
  fleet: new FakeFleetClient({ confabulateFirst: ['security'] }),
  gateId: 'live-gate',
  release,
});

for (const line of result.transcript) console.log(line.length > 220 ? `${line.slice(0, 220)}…` : line);

console.log(`\nagent says:\n${result.finalText.trim()}`);
console.log(`\nledger says (authoritative): ${result.record.decision}`, result.record.counts);
if (result.record.decision !== 'SHIP' || result.record.counts.rejectedAttempts === 0) {
  console.log(
    result.record.counts.rejectedAttempts === 0
      ? 'NOTE: expected at least one rejected attempt (confabulation quirk did not surface).'
      : 'NOTE: gate did not fully credit — inspect transcript.',
  );
}
