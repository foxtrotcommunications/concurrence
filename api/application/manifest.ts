import type { ApplicationManifest } from './types.js';
import { buildBlueprints } from './blueprints.js';

/**
 * The Concurrence application manifest: one auditor plus one pod per policy
 * domain, all served by the @concurrence/tools-gate plugin baked into the
 * roundtable-core:concurrence image.
 */
export const concurrenceManifest: ApplicationManifest = {
  id: 'concurrence',
  name: 'Concurrence',
  version: '0.1.0',
  plugin: { package: '@concurrence/tools-gate' },
  blueprints: buildBlueprints(),
};
