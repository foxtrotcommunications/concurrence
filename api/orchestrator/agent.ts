import { InMemoryRunner, LlmAgent, isFinalResponse } from '@google/adk';
import type { GateRecord } from '@concurrence/tools-gate';
import { GCP_LOCATION, GCP_PROJECT, TEXT_MODEL } from '../services/vertex.ts';
import { createGateTools, type GateToolContext } from './tools.ts';

const INSTRUCTION = `You are the Concurrence gate orchestrator. A release gate has been opened with a set of requirements, each owned by exactly one domain authority.

Your job, for every requirement:
1. consult_domain with the requirement's OWNER domain (from list_requirements).
2. record_verdict with exactly what the domain returned — its outcome, rationale, and citation verbatim. Never invent or alter a citation, and never record a verdict no domain gave you.
3. If the ledger refuses a verdict, follow the hint it returns: re-consult the owner, or route to the domain it names. If a domain declines, consult the domain it points to instead.
4. A 'fail' outcome is a legitimate result — record it as-is and move on; do not retry a fail.

When every requirement has been resolved, call render_gate and write a short report of what it returned: one line per requirement (owner, outcome, and for a block, what the domain said is missing), then the outcome stated as "Ledger decision: SHIP" or "Ledger decision: HOLD", exactly matching what render_gate returned. You do not decide anything — the ledger does; never state a decision render_gate did not return.`;

/** One tool call or tool result, structured so callers can render it however they like. */
export interface AgentEvent {
  kind: 'call' | 'result';
  name: string;
  payload: unknown;
}

export interface GateRunResult {
  record: GateRecord;
  transcript: string[];
  finalText: string;
}

/** ADK reads Vertex config from env; mirror our vertex.ts defaults. */
export function ensureAdkEnv(): void {
  process.env['GOOGLE_GENAI_USE_VERTEXAI'] ??= 'true';
  process.env['GOOGLE_CLOUD_PROJECT'] ??= GCP_PROJECT;
  process.env['GOOGLE_CLOUD_LOCATION'] ??= GCP_LOCATION;
}

export function buildGateAgent(ctx: GateToolContext): LlmAgent {
  return new LlmAgent({
    name: 'concurrence_orchestrator',
    description: 'Routes gate requirements to their owning domain authorities and records verdicts.',
    model: TEXT_MODEL,
    instruction: INSTRUCTION,
    tools: createGateTools(ctx),
  });
}

/**
 * Drive the agent over an already-opened gate, then read the authoritative
 * record straight from the ledger — the agent's prose is reporting, never
 * the decision.
 */
export async function runGate(
  ctx: GateToolContext,
  onEvent?: (event: AgentEvent) => void,
): Promise<GateRunResult> {
  ensureAdkEnv();
  const runner = new InMemoryRunner({ agent: buildGateAgent(ctx) });
  const transcript: string[] = [];
  let finalText = '';
  const emit = (event: AgentEvent) => {
    const arrow = event.kind === 'call' ? '→' : '←';
    transcript.push(`${arrow} ${event.name}: ${JSON.stringify(event.payload)}`);
    onEvent?.(event);
  };

  for await (const event of runner.runEphemeral({
    userId: 'concurrence',
    newMessage: {
      parts: [{ text: `Work the gate for this release:\n${ctx.release}\nStart with list_requirements.` }],
    },
  })) {
    for (const part of event.content?.parts ?? []) {
      if (part.functionCall) {
        emit({ kind: 'call', name: part.functionCall.name ?? 'tool', payload: part.functionCall.args });
      } else if (part.functionResponse) {
        emit({
          kind: 'result',
          name: part.functionResponse.name ?? 'tool',
          payload: part.functionResponse.response,
        });
      } else if (part.text && isFinalResponse(event)) {
        finalText += part.text;
      }
    }
  }

  const record = await ctx.ledger.renderGate(ctx.gateId);
  return { record, transcript, finalText };
}
