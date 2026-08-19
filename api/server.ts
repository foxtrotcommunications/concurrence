import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { CORPUS, CorpusIndex, CoverageLedger } from '@concurrence/tools-gate';
import { FirestoreLedgerStore } from './ledger/firestoreStore.ts';
import { generateGate } from './generator/gateGen.ts';
import { runGate } from './orchestrator/agent.ts';
import { FakeFleetClient } from './orchestrator/fleetClient.ts';
import { A2AFleetClient } from './orchestrator/fleetClient.a2a.ts';
import type { FleetClient } from './orchestrator/fleetClient.ts';
import type { FleetDirectory } from './provisioning/provision.ts';

/**
 * Dashboard API. State lives in the Firestore-backed coverage ledger (one doc
 * per gate) — the server holds nothing a restart would lose. The run endpoint
 * streams the orchestrator's routing feed over SSE; the board polls the gate
 * record, which only ever reflects what the ledger recorded.
 */

const PORT = Number(process.env.PORT ?? 8899);
const ledger = new CoverageLedger(new FirestoreLedgerStore(), new CorpusIndex(CORPUS));

// Fleet directory: env secret in production (a2a keys never bake into an
// image layer), fleet.json locally.
const fleetFile = process.env.CONCURRENCE_FLEET_FILE ?? 'fleet.json';
const directory: FleetDirectory | null = process.env.CONCURRENCE_FLEET_JSON
  ? (JSON.parse(process.env.CONCURRENCE_FLEET_JSON) as FleetDirectory)
  : existsSync(fleetFile)
    ? (JSON.parse(readFileSync(fleetFile, 'utf8')) as FleetDirectory)
    : null;

const pickFleet = (mode: string | undefined, quirk: string | undefined): FleetClient | string => {
  if (mode === 'pods') {
    return directory ? new A2AFleetClient(directory) : `no fleet directory at ${fleetFile}`;
  }
  return new FakeFleetClient(quirk === 'confabulate' ? { confabulateFirst: ['security'] } : {});
};

const app = express();
app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => void res.json({ ok: true, pods: directory !== null }));

app.get('/api/corpus', (_req, res) => void res.json({ corpus: CORPUS }));

app.post('/api/gate', async (req, res) => {
  try {
    const release = String(req.body?.release ?? '').trim();
    if (!release) return void res.status(400).json({ error: 'release description is required' });
    const gateId = `gate-${randomUUID().slice(0, 8)}`;
    const { gate, repairs } = await generateGate(release, { gateId });
    await ledger.openGate(gate);
    res.json({ gate, repairs });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/gate/:id', async (req, res) => {
  try {
    res.json(await ledger.renderGate(String(req.params.id)));
  } catch {
    res.status(404).json({ error: 'unknown gate' });
  }
});

// SSE: run the orchestrator over an open gate, streaming the routing feed.
app.get('/api/gate/:id/run', async (req, res) => {
  const gateId = String(req.params.id);
  const state = await ledger.getState(gateId);
  if (!state) return void res.status(404).json({ error: 'unknown gate' });

  const fleet = pickFleet(String(req.query.mode ?? 'fake'), String(req.query.quirk ?? ''));
  if (typeof fleet === 'string') return void res.status(400).json({ error: fleet });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (type: string, data: unknown) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await runGate(
      { ledger, fleet, gateId, release: state.gate.release },
      (line) => send('log', { line }),
    );
    send('done', { record: result.record, summary: result.finalText });
  } catch (err) {
    send('error', { message: (err as Error).message });
  } finally {
    res.end();
  }
});

// Production: serve the built client (vite build → dist/client) with an SPA
// fallback; in dev, vite serves the frontend and proxies /api here.
const clientDir = new URL('../dist/client', import.meta.url).pathname;
if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => void res.sendFile(`${clientDir}/index.html`));
}

app.listen(PORT, () => {
  console.log(`[concurrence] api on :${PORT} (pods directory: ${directory ? 'loaded' : 'absent'})`);
});
