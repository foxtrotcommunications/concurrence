import {
  CORPUS,
  CorpusIndex,
  CoverageLedger,
  InMemoryLedgerStore,
  type Verdict,
} from '@concurrence/tools-gate';
import { generateGate } from '../generator/gateGen.ts';

/**
 * Live smoke: free-text release → generated owned checklist → ledger run
 * with scripted verdicts, exercising all three gates end to end. Needs ADC
 * (gcloud auth application-default) — everything after generation is
 * deterministic.
 */

const release =
  process.argv.slice(2).join(' ') ||
  'Mobile app 4.2: adds product analytics events, a new third-party payment SDK, and a schema migration for saved carts.';

console.log(`release: ${release}\n`);

const { gate, repairs } = await generateGate(release, { gateId: 'demo-gate' });
if (repairs.length) console.log(`repairs applied: ${repairs.join(' | ')}`);
console.log('generated gate:');
for (const r of gate.requirements) console.log(`  [${r.ownerDomain}] ${r.id}: ${r.label}`);

const corpus = new CorpusIndex(CORPUS);
const ledger = new CoverageLedger(new InMemoryLedgerStore(), corpus);
await ledger.openGate(gate);

const first = gate.requirements[0];
if (!first) throw new Error('empty gate');

console.log('\n--- gate 1: ownership ---');
const wrongDomain = CORPUS.find((d) => d.domain !== first.ownerDomain)!.domain;
const misdirected = await ledger.recordVerdict('demo-gate', {
  requirementId: first.id,
  fromDomain: wrongDomain,
  outcome: 'pass',
  rationale: 'looks fine to me',
} satisfies Verdict);
console.log(`${wrongDomain} answered ${first.ownerDomain}'s question →`, misdirected);

console.log('\n--- gate 2: citation ---');
const uncited = await ledger.recordVerdict('demo-gate', {
  requirementId: first.id,
  fromDomain: first.ownerDomain,
  outcome: 'pass',
  rationale: 'definitely compliant, trust me',
});
console.log('owner passed with no receipt →', uncited);

console.log('\n--- crediting every requirement with a real receipt ---');
for (const r of gate.requirements) {
  const doc = CORPUS.find((d) => d.domain === r.ownerDomain)!;
  const section = doc.sections[0]!;
  const result = await ledger.recordVerdict('demo-gate', {
    requirementId: r.id,
    fromDomain: r.ownerDomain,
    outcome: 'pass',
    rationale: `verified against ${doc.title}`,
    citation: { docId: doc.docId, sectionId: section.id },
  });
  console.log(`  ${r.id}: recorded=${result.recorded}`);
}

console.log('\n--- gate 3: completeness ---');
const record = await ledger.renderGate('demo-gate');
console.log(`decision: ${record.decision}`, record.counts);
