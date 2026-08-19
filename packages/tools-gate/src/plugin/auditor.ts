// Auditor registrar — the single writer of gate state, as Pendragon's
// demographics pod is the single owner of household memory. Other pods and
// the orchestrator reach the ledger only through these capabilities; the
// three deterministic gates (ownership, citation, completeness) live in
// CoverageLedger and are enforced on every write.

import type { Gate, Verdict } from '../types.js';
import { ledgerFor } from './store.js';
import type { CapabilityRegistry, GatePluginConfig, ToolRegistry } from './types.js';

export const AUDITOR_CAPS = ['gate.open', 'gate.record', 'gate.render', 'gate.state'] as const;

export function registerAuditorCapabilities(
  registry: CapabilityRegistry,
  _config: GatePluginConfig,
): void {
  registry.register('gate.open', (input, ctx) => ledgerFor(ctx.workspaceId).openGate(input as unknown as Gate));

  registry.register('gate.record', (input, ctx) => {
    const gateId = String(input['gateId']);
    return ledgerFor(ctx.workspaceId).recordVerdict(gateId, input['verdict'] as Verdict);
  });

  registry.register('gate.render', (input, ctx) =>
    ledgerFor(ctx.workspaceId).renderGate(String(input['gateId'])),
  );

  registry.register('gate.state', (input, ctx) =>
    ledgerFor(ctx.workspaceId).getState(String(input['gateId'])),
  );
}

export function registerAuditorTools(registry: ToolRegistry, config: GatePluginConfig): void {
  // The auditor's own model can inspect but never mutate: reads go through
  // renderGate, and there is deliberately no write tool on this surface.
  registry.register('gate_status', {
    description:
      'Render the current state of a gate from the deterministic ledger: per-requirement status, ' +
      'citations, rejected attempts, and the decision. Read-only.',
    handler: (args) => ledgerFor(config.workspaceId).renderGate(String(args['gateId'])),
  });
}
