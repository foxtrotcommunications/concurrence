import type { AgentEvent } from './api';

/**
 * Turn raw tool traffic into a line a non-technical reader can follow.
 *
 * The raw trace stays available underneath — this is the narration layer,
 * not a replacement. Anything we can't confidently phrase returns null and
 * simply doesn't appear in the narration.
 */

export type Tone = 'info' | 'good' | 'bad' | 'refused';

export interface FeedLine {
  text: string;
  tone: Tone;
}

export const DOMAIN_LABEL: Record<string, string> = {
  security: 'Security',
  licensing: 'Licensing',
  'data-governance': 'Data Governance',
  sre: 'SRE',
};

const domainName = (d: unknown): string =>
  typeof d === 'string' ? (DOMAIN_LABEL[d] ?? d) : 'a domain';

const REASON_TEXT: Record<string, string> = {
  misdirected: 'wrong authority — not this requirement’s owner',
  no_citation: 'no receipt attached',
  unresolvable_citation: 'receipt does not resolve in that authority’s policy',
  unknown_requirement: 'unknown requirement',
};

export function narrate(
  event: AgentEvent,
  labelOf: (requirementId: string) => string | undefined,
): FeedLine | null {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const label = (id: unknown) =>
    typeof id === 'string' ? (labelOf(id) ?? id) : 'a requirement';

  if (event.kind === 'call') {
    switch (event.name) {
      case 'list_requirements':
        return { text: 'Reading the gate', tone: 'info' };
      case 'consult_domain':
        return {
          text: `Asking ${domainName(p['domain'])} about “${label(p['requirementId'])}”`,
          tone: 'info',
        };
      case 'render_gate':
        return { text: 'Asking the ledger for the decision', tone: 'info' };
      default:
        return null; // record_verdict call is noise; its result is the interesting half
    }
  }

  if (event.name === 'consult_domain') {
    const who = domainName(p['domain']);
    switch (p['outcome']) {
      case 'pass': {
        const citation = p['citation'] as { sectionId?: string } | undefined;
        return citation?.sectionId
          ? { text: `${who} concurs, citing “${citation.sectionId}”`, tone: 'good' }
          : { text: `${who} says it passes — but attached no receipt`, tone: 'refused' };
      }
      case 'fail':
        return { text: `${who} blocks it: ${String(p['rationale'] ?? '')}`, tone: 'bad' };
      case 'decline':
        return { text: `${who} declines — outside its policy`, tone: 'refused' };
      default:
        return null;
    }
  }

  if (event.name === 'record_verdict') {
    if (p['recorded'] === true) {
      return p['status'] === 'failed'
        ? { text: `Ledger recorded: BLOCKED`, tone: 'bad' }
        : { text: `Ledger recorded: CONCURRED`, tone: 'good' };
    }
    const reason = String(p['reason'] ?? '');
    const askInstead = p['askInstead'];
    const suffix =
      reason === 'misdirected' && typeof askInstead === 'string'
        ? ` — ${domainName(askInstead)} owns it`
        : '';
    return {
      text: `Ledger REFUSED the verdict: ${REASON_TEXT[reason] ?? reason}${suffix}`,
      tone: 'refused',
    };
  }

  if (event.name === 'render_gate') {
    const decision = String(p['decision'] ?? '');
    return {
      text: `Ledger decision: ${decision}`,
      tone: decision === 'SHIP' ? 'good' : 'bad',
    };
  }

  return null;
}

/** Compact one-line rendering of the underlying tool traffic. */
export const rawLine = (event: AgentEvent): string =>
  `${event.kind === 'call' ? '→' : '←'} ${event.name}: ${JSON.stringify(event.payload)}`;

export type Consistency = { state: 'ok' | 'mismatch' | 'unstated'; text: string };

/**
 * Check the model's prose against the ledger record. The claim "the decision
 * came from the ledger" is worth more as a check than as a caption.
 */
export function checkConsistency(summary: string, decision: 'SHIP' | 'HOLD'): Consistency {
  const mentions = (word: string) => new RegExp(`\\b${word}\\b`, 'i').test(summary);
  const other = decision === 'SHIP' ? 'HOLD' : 'SHIP';
  if (mentions(decision) && !mentions(other)) {
    return { state: 'ok', text: `checked — matches the ledger’s ${decision}` };
  }
  if (mentions(other) && !mentions(decision)) {
    return { state: 'mismatch', text: `contradicts the ledger, which rendered ${decision}` };
  }
  return { state: 'unstated', text: 'no single decision stated in the summary' };
}
