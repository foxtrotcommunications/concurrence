// Plugin entry point for @concurrence/tools-gate. This is what
// roundtable-core calls to register gate tools and capabilities into a
// workspace based on its domain type. Mirrors the shape of
// @pendragon/tools-plaid and @lingua-franca/tools-world.

import { DOMAINS } from '../corpus/docs.js';
import { AUDITOR_CAPS, registerAuditorCapabilities, registerAuditorTools } from './auditor.js';
import { DOMAIN_POD_CAPS, registerDomainCapabilities, registerDomainTools } from './domain.js';
import type {
  AppHooks,
  CapabilityRegistry,
  GatePluginConfig,
  PodDomainType,
  ToolRegistry,
} from './types.js';

const DOMAIN_REGISTRARS: Record<
  PodDomainType,
  {
    tools: (registry: ToolRegistry, config: GatePluginConfig) => void;
    capabilities: (registry: CapabilityRegistry, config: GatePluginConfig) => void;
  }
> = {
  domain: { tools: registerDomainTools, capabilities: registerDomainCapabilities },
  auditor: { tools: registerAuditorTools, capabilities: registerAuditorCapabilities },
};

const DOMAIN_CAPS: Record<PodDomainType, string[]> = {
  domain: [...DOMAIN_POD_CAPS],
  auditor: [...AUDITOR_CAPS],
};

// No external service ops — kept for interface parity with core.
const DOMAIN_ALLOWED_OPS: Record<PodDomainType, string[]> = {
  domain: [],
  auditor: [],
};

export const concurrenceGate = {
  name: 'concurrence-gate' as const,
  version: '0.1.0',

  register(
    toolRegistry: ToolRegistry,
    capabilityRegistry: CapabilityRegistry,
    config: GatePluginConfig,
  ): void {
    const registrar = DOMAIN_REGISTRARS[config.domainType];
    if (!registrar) {
      console.warn(`[concurrence-gate] No registrar for domain type: ${config.domainType}`);
      return;
    }
    registrar.tools(toolRegistry, config);
    registrar.capabilities(capabilityRegistry, config);
    console.log(
      `[concurrence-gate] Registered tools + capabilities for domain type: ${config.domainType}` +
        (config.policyDomain ? ` (policy domain: ${config.policyDomain})` : ''),
    );
  },

  getAllowedOps(domainType: PodDomainType): string[] {
    return DOMAIN_ALLOWED_OPS[domainType] ?? [];
  },

  getCapabilities(domainType: PodDomainType): string[] {
    return DOMAIN_CAPS[domainType] ?? [];
  },
};

export function registerFromEnv(
  toolRegistry: ToolRegistry,
  capabilityRegistry: CapabilityRegistry,
  hooks?: AppHooks,
): void {
  // App hooks first, before any early return; older cores pass no hooks and
  // fall back to generic labels.
  if (hooks) {
    try {
      hooks.registerActivityDescriptor?.((step, target) =>
        step === 'capability' && target
          ? `checking the coverage ledger (${target})`
          : step === 'consult'
            ? 'consulting a policy authority'
            : undefined,
      );
      console.log('[concurrence-gate] Registered activity descriptor');
    } catch (err) {
      console.warn(`[concurrence-gate] App hook registration failed: ${(err as Error)?.message}`);
    }
  }

  const config = configFromEnv();
  concurrenceGate.register(toolRegistry, capabilityRegistry, config);
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): GatePluginConfig {
  const workspaceId = env['WS_ID'] || env['WORKSPACE_ID'] || 'default';
  const domainType = resolveDomainType(env);
  if (domainType === 'auditor') return { domainType, workspaceId };
  return { domainType, workspaceId, policyDomain: resolvePolicyDomain(env) };
}

function resolveDomainType(env: NodeJS.ProcessEnv): PodDomainType {
  const explicit = (env['DOMAIN_TYPE'] || env['CONCURRENCE_DOMAIN_TYPE'] || '').toLowerCase();
  if (explicit === 'auditor') return 'auditor';
  if (explicit === 'domain') return 'domain';
  // Workspace-name heuristic fallback, like tools-plaid.
  const wsName = (env['WS_NAME'] || '').toLowerCase();
  return wsName.includes('auditor') ? 'auditor' : 'domain';
}

function resolvePolicyDomain(env: NodeJS.ProcessEnv): string {
  const explicit = (env['CONCURRENCE_DOMAIN'] || '').toLowerCase();
  if ((DOMAINS as readonly string[]).includes(explicit)) return explicit;
  const wsName = (env['WS_NAME'] || '').toLowerCase().replace(/\s+/g, '-');
  return (DOMAINS as readonly string[]).find((d) => wsName.includes(d)) ?? 'security';
}
