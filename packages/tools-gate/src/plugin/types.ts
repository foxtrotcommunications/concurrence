// Plugin infrastructure types for @concurrence/tools-gate. Mirrors the shape
// roundtable-core expects from its application plugins (tools-plaid,
// tools-world): a tool registry, a capability registry, a per-workspace
// config resolved from the environment, and optional application hooks.

/** Which registrar a pod gets: a policy authority, or the ledger auditor. */
export type PodDomainType = 'domain' | 'auditor';

/** A tool the workspace's own model can see and call. */
export interface ToolDefinition {
  description: string;
  parameters?: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface ToolRegistry {
  register(name: string, tool: ToolDefinition): void;
}

/** A capability other workspaces invoke over A2A (op: "capability"). */
export type CapabilityHandler = (
  input: Record<string, unknown>,
  ctx: CapabilityContext,
) => Promise<unknown> | unknown;

export interface CapabilityContext {
  workspaceId: string;
  domainType: PodDomainType;
}

export interface CapabilityRegistry {
  register(name: string, handler: CapabilityHandler): void;
}

/** Resolved per-workspace configuration (env + workspace identity). */
export interface GatePluginConfig {
  domainType: PodDomainType;
  workspaceId: string;
  /** For 'domain' pods: which policy domain this pod is the authority for. */
  policyDomain?: string;
}

// ─── Application hooks (parallel to core's appHooks boundary) ────────────────

export type ActivityDescriptor = (step: string, target?: string) => string | undefined;

export interface AppHooks {
  registerActivityDescriptor?: (fn: ActivityDescriptor) => void;
  registerSystemPromptSections?: (fn: () => string) => void;
}
