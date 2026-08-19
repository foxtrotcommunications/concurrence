import { describe, expect, it } from 'vitest';
import { CORPUS } from '@concurrence/tools-gate';
import { parseDomainReply } from '../orchestrator/fleetClient.a2a.ts';
import { buildBlueprints } from './blueprints.ts';
import { concurrenceManifest } from './manifest.ts';

describe('blueprints', () => {
  const blueprints = buildBlueprints();

  it('renders one blueprint per domain plus the auditor', () => {
    expect(Object.keys(blueprints).sort()).toEqual([
      'concurrence-auditor',
      'concurrence-data-governance',
      'concurrence-licensing',
      'concurrence-security',
      'concurrence-sre',
    ]);
  });

  it('a domain blueprint embeds ONLY its own corpus', () => {
    for (const doc of CORPUS) {
      const prompt = blueprints[`concurrence-${doc.domain}`]!.systemPrompt;
      expect(prompt).toContain(`docId: ${doc.docId}`);
      for (const other of CORPUS.filter((d) => d.docId !== doc.docId)) {
        expect(prompt).not.toContain(`docId: ${other.docId}`);
        for (const section of other.sections) {
          expect(prompt).not.toContain(section.body.slice(0, 60));
        }
      }
    }
  });

  it('every section id a pod could cite appears verbatim in its prompt', () => {
    for (const doc of CORPUS) {
      const prompt = blueprints[`concurrence-${doc.domain}`]!.systemPrompt;
      for (const section of doc.sections) expect(prompt).toContain(`sectionId: ${section.id}`);
    }
  });

  it('the manifest pins the plugin package and carries all blueprints', () => {
    expect(concurrenceManifest.plugin?.package).toBe('@concurrence/tools-gate');
    expect(Object.keys(concurrenceManifest.blueprints)).toHaveLength(5);
  });
});

describe('parseDomainReply', () => {
  it('parses a bare verdict JSON', () => {
    expect(
      parseDomainReply('{"outcome":"pass","rationale":"ok","citation":{"docId":"d","sectionId":"s"}}'),
    ).toEqual({ outcome: 'pass', rationale: 'ok', citation: { docId: 'd', sectionId: 's' } });
  });

  it('parses a fenced or prose-wrapped verdict', () => {
    expect(parseDomainReply('Sure!\n```json\n{"outcome":"fail","rationale":"missing plan"}\n```').outcome).toBe('fail');
    expect(parseDomainReply('Here you go: {"outcome":"decline","rationale":"not mine"} thanks').outcome).toBe('decline');
  });

  it('degrades garbage and invalid outcomes to a decline', () => {
    expect(parseDomainReply('I cannot help with that').outcome).toBe('decline');
    expect(parseDomainReply('{"outcome":"maybe"}').outcome).toBe('decline');
  });

  it('drops malformed citations instead of forwarding them', () => {
    const parsed = parseDomainReply('{"outcome":"pass","rationale":"ok","citation":{"docId":42}}');
    expect(parsed.citation).toBeUndefined();
  });
});
