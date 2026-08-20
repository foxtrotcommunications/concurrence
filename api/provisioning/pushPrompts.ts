// Push the current blueprints to the LIVE fleet.
//
//   npm run push:prompts
//
// Blueprint text is baked into each pod's SYSTEM_PROMPT env at provision
// time, so editing blueprints.ts does not reach running pods. This script
// re-registers the application manifest (so future provisions are correct)
// and patches SYSTEM_PROMPT on each running deployment via kubectl, which
// rolls the pod — and, with imagePullPolicy Always, also picks up the
// latest :concurrence image.
//
// Requires cluster access (kubectl context on roundtable-standard) and
// ROUNDTABLE_API_KEY for the manifest upsert.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { CORPUS } from '@concurrence/tools-gate';
import { buildBlueprints } from '../application/blueprints.js';
import { concurrenceManifest } from '../application/manifest.js';
import { ControlPlaneClient } from '../services/roundtable.js';
import type { FleetDirectory } from './provision.js';

const NAMESPACE = 'rt-concurrence';

const fleet = JSON.parse(
  readFileSync(process.env['CONCURRENCE_FLEET_FILE'] ?? 'fleet.json', 'utf8'),
) as FleetDirectory;

const apiKey = process.env['ROUNDTABLE_API_KEY'];
if (apiKey) {
  const cp = new ControlPlaneClient(apiKey);
  const reg = await cp.registerApplication('concurrence', concurrenceManifest);
  console.log(`[prompts] manifest re-registered (${reg.blueprintCount ?? '?'} blueprints)`);
} else {
  console.log('[prompts] ROUNDTABLE_API_KEY not set — skipping manifest upsert, patching pods only');
}

const blueprints = buildBlueprints();
const deploymentOf = (workspaceId: string) => `rt-ws-${workspaceId.slice(0, 12).toLowerCase()}`;

for (const doc of CORPUS) {
  const pod = fleet.domains[doc.domain];
  if (!pod) {
    console.warn(`[prompts] no pod for ${doc.domain}, skipping`);
    continue;
  }
  const prompt = blueprints[`concurrence-${doc.domain}`]!.systemPrompt;
  // execFileSync passes the prompt as a single argv entry — no shell quoting.
  execFileSync('kubectl', [
    '-n', NAMESPACE,
    'set', 'env', `deploy/${deploymentOf(pod.workspaceId)}`,
    `SYSTEM_PROMPT=${prompt}`,
  ]);
  console.log(`[prompts] ${doc.domain} → ${deploymentOf(pod.workspaceId)} updated (${prompt.length} chars)`);
}

execFileSync('kubectl', ['-n', NAMESPACE, 'rollout', 'status', 'deploy', '--timeout=300s'], {
  stdio: 'inherit',
});
console.log('[prompts] fleet rolled');
