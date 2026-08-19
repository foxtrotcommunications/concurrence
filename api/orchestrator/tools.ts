import { FunctionTool } from '@google/adk';
import { Type, type Schema } from '@google/genai';
import type { CoverageLedger, Verdict } from '@concurrence/tools-gate';
import type { FleetClient } from './fleetClient.ts';

/**
 * The orchestrator's tools. The model decides which domain to consult and
 * when; every consequential operation goes through the CoverageLedger, so
 * the model cannot credit a requirement, forge a receipt, or render SHIP.
 *
 * Handlers are exported bare so tests can drive them without a model.
 */

export interface GateToolContext {
  ledger: CoverageLedger;
  fleet: FleetClient;
  gateId: string;
  release: string;
}

export const listRequirements = async (ctx: GateToolContext) => {
  const state = await ctx.ledger.getState(ctx.gateId);
  if (!state) return { error: `unknown gate ${ctx.gateId}` };
  return {
    requirements: Object.values(state.requirements).map((r) => ({
      id: r.requirement.id,
      label: r.requirement.label,
      ownerDomain: r.requirement.ownerDomain,
      status: r.status,
      rejectedAttempts: r.attempts.length,
    })),
  };
};

export const consultDomain = async (
  ctx: GateToolContext,
  args: { domain: string; requirementId: string },
) => {
  const state = await ctx.ledger.getState(ctx.gateId);
  const reqState = state?.requirements[args.requirementId];
  if (!reqState) return { error: `unknown requirement ${args.requirementId}` };
  const response = await ctx.fleet.consultDomain(args.domain, reqState.requirement, ctx.release);
  return { domain: args.domain, requirementId: args.requirementId, ...response };
};

export const recordVerdict = async (ctx: GateToolContext, verdict: Verdict) => {
  const result = await ctx.ledger.recordVerdict(ctx.gateId, verdict);
  if (result.recorded) {
    return { recorded: true as const, requirementId: verdict.requirementId, status: result.state.status };
  }
  return {
    recorded: false as const,
    requirementId: verdict.requirementId,
    reason: result.reason,
    ...(result.askInstead ? { askInstead: result.askInstead } : {}),
    hint:
      result.reason === 'misdirected'
        ? `Only ${result.askInstead} can verdict this requirement. Consult them instead.`
        : result.reason === 'no_citation' || result.reason === 'unresolvable_citation'
          ? 'A pass needs a citation that resolves in the owner corpus. Re-consult the owner for a proper receipt.'
          : 'Check the requirement id against list_requirements.',
  };
};

export const renderGate = async (ctx: GateToolContext) => {
  const record = await ctx.ledger.renderGate(ctx.gateId);
  return {
    decision: record.decision,
    counts: record.counts,
    requirements: record.requirements.map((r) => ({
      id: r.requirement.id,
      ownerDomain: r.requirement.ownerDomain,
      status: r.status,
      citation: r.citation ? `${r.citation.docTitle} § ${r.citation.sectionHeading}` : null,
    })),
  };
};

const citationSchema: Schema = {
  type: Type.OBJECT,
  description: 'Receipt into the owning domain policy corpus, exactly as the domain returned it.',
  properties: {
    docId: { type: Type.STRING },
    sectionId: { type: Type.STRING },
  },
  required: ['docId', 'sectionId'],
};

export function createGateTools(ctx: GateToolContext): FunctionTool<Schema>[] {
  return [
    new FunctionTool<Schema>({
      name: 'list_requirements',
      description: 'List every requirement on the gate with its owner domain and current status.',
      parameters: { type: Type.OBJECT, properties: {} },
      execute: () => listRequirements(ctx),
    }),
    new FunctionTool<Schema>({
      name: 'consult_domain',
      description:
        'Ask a domain authority to review one requirement against its policy. Returns its outcome, rationale, and citation if it can provide one.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          domain: { type: Type.STRING, description: 'Domain to consult.' },
          requirementId: { type: Type.STRING },
        },
        required: ['domain', 'requirementId'],
      },
      execute: (input) => consultDomain(ctx, input as { domain: string; requirementId: string }),
    }),
    new FunctionTool<Schema>({
      name: 'record_verdict',
      description:
        'Submit a domain verdict to the coverage ledger. The ledger enforces ownership and citations; a refusal explains what to do instead.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          requirementId: { type: Type.STRING },
          fromDomain: { type: Type.STRING, description: 'The domain that issued this verdict.' },
          outcome: { type: Type.STRING, enum: ['pass', 'fail'] },
          rationale: { type: Type.STRING },
          citation: citationSchema,
        },
        required: ['requirementId', 'fromDomain', 'outcome', 'rationale'],
      },
      execute: (input) => recordVerdict(ctx, input as Verdict),
    }),
    new FunctionTool<Schema>({
      name: 'render_gate',
      description:
        'Render the final gate decision from ledger state. SHIP only when every requirement is credited; this tool is the only source of the decision.',
      parameters: { type: Type.OBJECT, properties: {} },
      execute: () => renderGate(ctx),
    }),
  ];
}
