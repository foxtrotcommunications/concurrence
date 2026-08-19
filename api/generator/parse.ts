import type { Domain, Gate, Requirement } from '@concurrence/tools-gate';

/**
 * Deterministic half of the gate generator: turn model output into a valid
 * Gate or throw. The model proposes; this repairs and enforces.
 *
 * Repairs applied, in order:
 *  - ids are slugified; empty/duplicate ids are re-derived from the label
 *  - an unknown ownerDomain is remapped to the first known domain (and the
 *    repair is reported, so callers can log it)
 *  - requirements beyond MAX_REQUIREMENTS are dropped from the tail
 *
 * Not repaired (throws): unparseable JSON, no requirements, or a result
 * where a domain in `mustCover` ends up owning nothing.
 */

export const MAX_REQUIREMENTS = 10;

export interface ParseResult {
  gate: Gate;
  repairs: string[];
}

interface RawRequirement {
  id?: unknown;
  label?: unknown;
  ownerDomain?: unknown;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

export function parseGeneratedGate(
  raw: string,
  opts: { gateId: string; release: string; knownDomains: Domain[]; mustCover?: Domain[] },
): ParseResult {
  const { gateId, release, knownDomains } = opts;
  if (knownDomains.length === 0) throw new Error('knownDomains must not be empty');
  const fallbackDomain = knownDomains[0]!;
  const repairs: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error('generator output is not valid JSON');
  }
  const rawRequirements = (parsed as { requirements?: unknown }).requirements;
  if (!Array.isArray(rawRequirements) || rawRequirements.length === 0) {
    throw new Error('generator output has no requirements');
  }

  const seenIds = new Set<string>();
  const requirements: Requirement[] = [];
  for (const item of rawRequirements as RawRequirement[]) {
    if (requirements.length >= MAX_REQUIREMENTS) {
      repairs.push(`dropped requirements beyond the first ${MAX_REQUIREMENTS}`);
      break;
    }
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) {
      repairs.push('dropped a requirement with no label');
      continue;
    }

    let id = typeof item.id === 'string' ? slugify(item.id) : '';
    if (!id) id = slugify(label);
    if (!id || seenIds.has(id)) {
      const base = id || 'req';
      let n = 2;
      while (seenIds.has(`${base}-${n}`)) n++;
      repairs.push(`re-derived duplicate/empty id as ${base}-${n}`);
      id = `${base}-${n}`;
    }
    seenIds.add(id);

    let ownerDomain = typeof item.ownerDomain === 'string' ? item.ownerDomain.trim() : '';
    if (!knownDomains.includes(ownerDomain)) {
      repairs.push(`remapped unknown owner "${ownerDomain}" to ${fallbackDomain} (${id})`);
      ownerDomain = fallbackDomain;
    }

    requirements.push({ id, label, ownerDomain });
  }

  if (requirements.length === 0) throw new Error('no valid requirements after repair');

  for (const domain of opts.mustCover ?? []) {
    if (!requirements.some((r) => r.ownerDomain === domain)) {
      throw new Error(`generated gate leaves domain uncovered: ${domain}`);
    }
  }

  return { gate: { gateId, release, requirements }, repairs };
}

/** Tolerate models that wrap JSON in a code fence despite instructions. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? raw).trim();
}
