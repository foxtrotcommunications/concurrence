// Push the current blueprints to the LIVE fleet.
//
//   cloud-sql-proxy --gcloud-auth --port 5439 roundtable-public:us-central1:roundtable-db &
//   ROUNDTABLE_API_KEY=… npm run push:prompts
//
// A pod reads its system prompt from ITS OWN DATABASE ROW, not from env: the
// SYSTEM_PROMPT env is a provisioning seed that core writes to the row only
// when the row is empty, and on every later boot the DB wins (deliberately —
// env-wins once reverted freshly pushed prompts across a fleet restart). So
// pushing a prompt means writing the row. Each pod's DATABASE_URL, harvested
// from its Deployment, is a Postgres role RLS-scoped to its own row — no
// admin credential is needed or used. The Firestore workspace doc is mirrored
// so the control-plane view stays consistent, the env is refreshed as a seed
// for future re-provisions, and the manifest is re-registered for future
// creates. No pod restart is needed; the prompt is read per-session.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import pg from 'pg';
import { CORPUS } from '@concurrence/tools-gate';
import { buildBlueprints } from '../application/blueprints.js';
import { concurrenceManifest } from '../application/manifest.js';
import { ControlPlaneClient } from '../services/roundtable.js';
import type { FleetDirectory } from './provision.js';

const NAMESPACE = 'rt-concurrence';
const ORG_ID = 'concurrence';
const DB_HOST = process.env['DB_HOST'] || '127.0.0.1';
const DB_PORT = Number(process.env['DB_PORT'] || 5439);

const fleet = JSON.parse(
  readFileSync(process.env['CONCURRENCE_FLEET_FILE'] ?? 'fleet.json', 'utf8'),
) as FleetDirectory;

const blueprints = buildBlueprints();
const deploymentOf = (workspaceId: string) => `rt-ws-${workspaceId.slice(0, 12).toLowerCase()}`;

/** DATABASE_URL from the pod's Deployment: literal value or secretKeyRef. */
function harvestDatabaseUrl(deployment: string): string {
  const spec = JSON.parse(
    execFileSync('kubectl', ['-n', NAMESPACE, 'get', 'deploy', deployment, '-o', 'json']).toString(),
  );
  for (const container of spec.spec.template.spec.containers) {
    for (const env of container.env ?? []) {
      if (env.name !== 'DATABASE_URL') continue;
      if (env.value) return env.value;
      const ref = env.valueFrom?.secretKeyRef;
      if (ref) {
        const secret = JSON.parse(
          execFileSync('kubectl', ['-n', NAMESPACE, 'get', 'secret', ref.name, '-o', 'json']).toString(),
        );
        return Buffer.from(secret.data[ref.key], 'base64').toString();
      }
    }
  }
  throw new Error(`no DATABASE_URL on ${deployment}`);
}

/** user/password/database from the pod's URL; host/port from the local proxy. */
function parseCred(url: string): { user: string; password: string; database: string } {
  const m = /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@[^/]+\/([^?]+)/.exec(url);
  if (!m) throw new Error('unparseable DATABASE_URL');
  return {
    user: decodeURIComponent(m[1]!),
    password: decodeURIComponent(m[2]!),
    database: decodeURIComponent(m[3]!),
  };
}

if (getApps().length === 0) initializeApp({ projectId: process.env['GCP_PROJECT'] ?? 'roundtable-public' });
const firestore = getFirestore();

const apiKey = process.env['ROUNDTABLE_API_KEY'];
if (apiKey) {
  const reg = await new ControlPlaneClient(apiKey).registerApplication('concurrence', concurrenceManifest);
  console.log(`[prompts] manifest re-registered (${reg.blueprintCount ?? '?'} blueprints)`);
}

for (const doc of CORPUS) {
  const pod = fleet.domains[doc.domain];
  if (!pod) {
    console.warn(`[prompts] no pod for ${doc.domain}, skipping`);
    continue;
  }
  const prompt = blueprints[`concurrence-${doc.domain}`]!.systemPrompt;
  const deployment = deploymentOf(pod.workspaceId);

  // 1. The row the pod actually reads.
  const cred = parseCred(harvestDatabaseUrl(deployment));
  const client = new pg.Client({ host: DB_HOST, port: DB_PORT, ...cred });
  try {
    await client.connect();
  } catch (err) {
    if ((err as { code?: string }).code === 'ECONNREFUSED') {
      throw new Error(
        `Cannot reach Postgres at ${DB_HOST}:${DB_PORT}. Start the proxy first:\n` +
          `  cloud-sql-proxy --gcloud-auth --port ${DB_PORT} roundtable-public:us-central1:roundtable-db`,
      );
    }
    throw err;
  }
  const result = await client.query('UPDATE workspaces SET system_prompt = $1 WHERE id = $2', [
    prompt,
    pod.workspaceId,
  ]);
  await client.end();

  // 2. Mirror to Firestore so the control-plane view stays consistent.
  await firestore
    .collection('organizations').doc(ORG_ID)
    .collection('workspaces').doc(pod.workspaceId)
    .set({ system_prompt: prompt, systemPrompt: prompt }, { merge: true });

  // 3. Refresh the env seed for future re-provisions (rolls the pod, which is
  //    harmless — the row above is what the prompt path reads).
  execFileSync('kubectl', ['-n', NAMESPACE, 'set', 'env', `deploy/${deployment}`, `SYSTEM_PROMPT=${prompt}`]);

  console.log(
    `[prompts] ${doc.domain}: row ${result.rowCount === 1 ? 'updated' : 'NOT FOUND'} (${prompt.length} chars), firestore mirrored, env re-seeded`,
  );
}

execFileSync('kubectl', ['-n', NAMESPACE, 'rollout', 'status', 'deploy', '--timeout=300s'], { stdio: 'inherit' });
console.log('[prompts] done');
