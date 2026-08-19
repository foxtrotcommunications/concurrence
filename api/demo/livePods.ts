import { readFileSync } from 'node:fs';
import { CORPUS, CorpusIndex, CoverageLedger, InMemoryLedgerStore } from '@concurrence/tools-gate';
import { generateGate } from '../generator/gateGen.ts';
import { runGate } from '../orchestrator/agent.ts';
import { A2AFleetClient } from '../orchestrator/fleetClient.a2a.ts';
import type { FleetDirectory } from '../provisioning/provision.ts';

/**
 * Live-pods run: same generator → ADK agent → ledger loop as `npm run demo`,
 * but consults the REAL Roundtable domain pods over A2A instead of the fake.
 *
 *   CONCURRENCE_FLEET_FILE=fleet.json npm run demo:pods [release text]
 *
 * The fleet file is the directory JSON that `npm run provision` prints.
 */

const fleetFile = process.env['CONCURRENCE_FLEET_FILE'] ?? 'fleet.json';
const directory = JSON.parse(readFileSync(fleetFile, 'utf8')) as FleetDirectory;

const release =
  process.argv.slice(2).join(' ') ||
  'Mobile app 4.2: adds product analytics events, a new third-party payment SDK, and a schema migration for saved carts.';

console.log(`release: ${release}\n`);

const { gate } = await generateGate(release, { gateId: `live-${process.pid}` });
console.log('gate:');
for (const r of gate.requirements) console.log(`  [${r.ownerDomain}] ${r.id}: ${r.label}`);

const ledger = new CoverageLedger(new InMemoryLedgerStore(), new CorpusIndex(CORPUS));
await ledger.openGate(gate);

console.log('\nrunning orchestrator against live pods…\n');
const result = await runGate({
  ledger,
  fleet: new A2AFleetClient(directory),
  gateId: gate.gateId,
  release,
});

for (const line of result.transcript) console.log(line.length > 240 ? `${line.slice(0, 240)}…` : line);
console.log(`\nagent says:\n${result.finalText.trim()}`);
console.log(`\nledger says (authoritative): ${result.record.decision}`, result.record.counts);
