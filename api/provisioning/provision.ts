// Provision the Concurrence fleet on Roundtable from the blueprints.
//
//   ROUNDTABLE_API_KEY=<org-admin-key> npm run provision
//
// Per pod: create → PATCH {a2aServerEnabled, toolsEnabled} → deploy-pin →
// wait running. The PATCH must land before the first bring-up because the
// A2A env block is only injected at initial k8s provisioning (LF postmortem);
// deploy both pins the image and brings the pod up, so a separate start is
// not only redundant but racy (deploy is refused while status is 'starting').
// Idempotent: existing workspaces are reused by name.
//
// The pods only carry Concurrence tools if the core image was built with the
// @concurrence/tools-gate plugin baked in — publish + bake before running.

import { CORPUS } from '@concurrence/tools-gate';
import { concurrenceManifest } from '../application/manifest.js';
import { DOMAIN_TOOLS } from '../services/domain-constants.js';
import { DOMAIN_AI_MODEL, DOMAIN_AI_PROVIDER } from '../services/domain-constants.js';
import { ControlPlaneClient, type WorkspaceRef } from '../services/roundtable.js';

const IMAGE =
  process.env['CONCURRENCE_IMAGE'] ||
  'us-central1-docker.pkg.dev/roundtable-public/roundtable/roundtable-core:concurrence';

const READY = new Set(['running', 'standby']);

export interface PodRef {
  workspaceId: string;
  workspaceUrl: string;
  a2aApiKey: string;
}

export interface FleetDirectory {
  auditor: PodRef;
  domains: Record<string, PodRef>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitReady(cp: ControlPlaneClient, wsId: string, label: string): Promise<WorkspaceRef> {
  for (let i = 0; i < 90; i++) {
    const info = await cp.getWorkspace(wsId);
    if (info.status && READY.has(info.status)) return info;
    if (info.status === 'error') throw new Error(`${label} entered error state`);
    if (i % 6 === 0) console.log(`[provision]   waiting on ${label} (${info.status ?? '?'})…`);
    await sleep(5000);
  }
  throw new Error(`${label} not ready after 450s`);
}

async function provisionPod(
  cp: ControlPlaneClient,
  existing: Map<string, WorkspaceRef>,
  name: string,
  template: string,
  toolsEnabled: string[],
): Promise<WorkspaceRef> {
  let ws = existing.get(name);
  if (ws) {
    console.log(`[provision] reusing ${name} → ${ws.id} (${ws.status ?? '?'})`);
    if (!ws.status || !READY.has(ws.status)) ws = await waitReady(cp, ws.id, name);
  } else {
    ws = await cp.createWorkspace({
      name,
      template,
      provider: DOMAIN_AI_PROVIDER,
      model: DOMAIN_AI_MODEL,
    });
    await cp.patchWorkspace(ws.id, { a2aServerEnabled: true, toolsEnabled });
    // START (not deploy) must do the initial bring-up: only the start path's
    // provisioning injects the A2A env block. Deploy afterward pins the image.
    await cp.startWorkspace(ws.id);
    ws = await waitReady(cp, ws.id, name);
  }
  await cp.deploy(ws.id, IMAGE);
  const info = await waitReady(cp, ws.id, name);
  console.log(`[provision] ${name} → ${info.id} (${info.url ?? 'no url yet'})`);
  return info;
}

export async function provisionFleet(apiKey: string): Promise<FleetDirectory> {
  const cp = new ControlPlaneClient(apiKey);

  console.log('[provision] registering application manifest…');
  const reg = await cp.registerApplication('concurrence', concurrenceManifest);
  console.log(`[provision] registered ${reg.blueprintCount ?? '?'} blueprints`);

  const existing = new Map<string, WorkspaceRef>();
  for (const ws of await cp.listWorkspaces()) {
    if ((ws as WorkspaceRef & { name?: string }).name) {
      existing.set((ws as WorkspaceRef & { name?: string }).name!, ws);
    }
  }

  const toRef = (ws: WorkspaceRef): PodRef => ({
    workspaceId: ws.id,
    workspaceUrl: ws.url ?? '',
    a2aApiKey: ws.a2aApiKey ?? '',
  });

  const auditor = await provisionPod(cp, existing, 'Auditor', 'concurrence-auditor', DOMAIN_TOOLS.auditor);

  const domains: Record<string, PodRef> = {};
  for (const doc of CORPUS) {
    const ws = await provisionPod(
      cp,
      existing,
      doc.domain === 'sre' ? 'SRE' : doc.domain,
      `concurrence-${doc.domain}`,
      DOMAIN_TOOLS.domain,
    );
    domains[doc.domain] = toRef(ws);
  }

  const directory: FleetDirectory = { auditor: toRef(auditor), domains };
  console.log('[provision] fleet directory:\n' + JSON.stringify(directory, null, 2));
  return directory;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const apiKey = process.env['ROUNDTABLE_API_KEY'];
  if (!apiKey) {
    console.error('ROUNDTABLE_API_KEY is required');
    process.exit(1);
  }
  provisionFleet(apiKey).catch((err) => {
    console.error('[provision] failed:', err);
    process.exit(1);
  });
}
