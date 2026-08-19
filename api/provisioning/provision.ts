// Provision the Concurrence fleet on Roundtable from the blueprints.
//
//   ROUNDTABLE_API_KEY=<org-admin-key> npm run provision
//
// Per pod, the order is load-bearing (LF postmortem): create → PATCH
// {a2aServerEnabled, toolsEnabled} → start → deploy-pin. The A2A env block is
// only injected when the flag is set before provisioning brings the pod up.
//
// The pods only carry Concurrence tools if the core image was built with the
// @concurrence/tools-gate plugin baked in — publish + bake before running.

import { CORPUS } from '@concurrence/tools-gate';
import { concurrenceManifest } from '../application/manifest.js';
import { DOMAIN_TOOLS } from '../services/domain-constants.js';
import { ControlPlaneClient, type WorkspaceRef } from '../services/roundtable.js';

const IMAGE =
  process.env['CONCURRENCE_IMAGE'] ||
  'us-central1-docker.pkg.dev/roundtable-public/roundtable/roundtable-core:concurrence';

export interface PodRef {
  workspaceId: string;
  workspaceUrl: string;
  a2aApiKey: string;
}

export interface FleetDirectory {
  auditor: PodRef;
  domains: Record<string, PodRef>;
}

async function provisionPod(
  cp: ControlPlaneClient,
  name: string,
  template: string,
  toolsEnabled: string[],
): Promise<WorkspaceRef> {
  const ws = await cp.createWorkspace({ name, template });
  await cp.patchWorkspace(ws.id, { a2aServerEnabled: true, toolsEnabled });
  await cp.startWorkspace(ws.id);
  await cp.deploy(ws.id, IMAGE);
  const info = await cp.getWorkspace(ws.id);
  console.log(`[provision] ${name} → ${info.id} (${info.url ?? 'no url yet'})`);
  return info;
}

export async function provisionFleet(apiKey: string): Promise<FleetDirectory> {
  const cp = new ControlPlaneClient(apiKey);

  console.log('[provision] registering application manifest…');
  const reg = await cp.registerApplication('concurrence', concurrenceManifest);
  console.log(`[provision] registered ${reg.blueprintCount ?? '?'} blueprints`);

  const toRef = (ws: WorkspaceRef): PodRef => ({
    workspaceId: ws.id,
    workspaceUrl: ws.url ?? '',
    a2aApiKey: ws.a2aApiKey ?? '',
  });

  const auditor = await provisionPod(cp, 'Auditor', 'concurrence-auditor', DOMAIN_TOOLS.auditor);

  const domains: Record<string, PodRef> = {};
  for (const doc of CORPUS) {
    const ws = await provisionPod(
      cp,
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
