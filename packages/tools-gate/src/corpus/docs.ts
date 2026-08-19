import type { PolicyDoc } from './types.js';

/**
 * The canonical policy corpora. Each document belongs to exactly one domain;
 * a domain pod's blueprint carries only its own documents, and the citation
 * resolver refuses receipts that cross this boundary.
 *
 * Section ids are load-bearing: they are the sectionId half of every
 * citation, so renaming one invalidates receipts against it.
 */

export const DOMAINS = ['security', 'licensing', 'data-governance', 'sre'] as const;
export type KnownDomain = (typeof DOMAINS)[number];

export const CORPUS: PolicyDoc[] = [
  {
    docId: 'sec-policy',
    domain: 'security',
    title: 'Application Security Policy',
    sections: [
      {
        id: 'deps-cve',
        heading: 'Dependency and CVE review',
        body: 'Every new or upgraded third-party dependency must pass an automated CVE scan before release. Findings of severity High or Critical block the release until patched, pinned to a safe version, or granted a written exception by the security owner.',
      },
      {
        id: 'secrets',
        heading: 'Secrets handling',
        body: 'No credentials, API keys, or tokens may appear in source, build artifacts, or logs. New integrations must read secrets from the managed secret store at runtime. A release that adds a new secret must document its rotation owner and schedule.',
      },
      {
        id: 'authn-changes',
        heading: 'Authentication and session changes',
        body: 'Any change to authentication flows, session lifetime, or token validation requires an updated threat model note and a review of the affected trust boundaries before it ships.',
      },
      {
        id: 'third-party-endpoints',
        heading: 'New external endpoints',
        body: 'A release that introduces traffic to a new external endpoint must record the endpoint, the data sent to it, and its transport security. Plaintext transport is prohibited.',
      },
    ],
  },
  {
    docId: 'lic-matrix',
    domain: 'licensing',
    title: 'Third-Party License Policy',
    sections: [
      {
        id: 'copyleft',
        heading: 'Copyleft licenses',
        body: 'AGPL-licensed code may not be included in any distributed binary or container image. GPL and LGPL components require legal review before inclusion; dynamic linking exceptions must be documented per component.',
      },
      {
        id: 'permissive',
        heading: 'Permissive licenses',
        body: 'MIT, BSD, Apache-2.0, and ISC components are approved for all uses provided their attribution requirements are met in the distributed notices file.',
      },
      {
        id: 'sdk-terms',
        heading: 'Commercial SDK terms',
        body: 'A commercial SDK may only ship if its terms permit redistribution in our deployment model, and its telemetry behavior is documented. SDKs whose terms prohibit benchmarking or require usage reporting need sign-off recorded before release.',
      },
      {
        id: 'notices',
        heading: 'Attribution notices',
        body: 'The release artifact must include an up-to-date third-party notices file covering every bundled component and its license text where the license requires it.',
      },
    ],
  },
  {
    docId: 'data-gov',
    domain: 'data-governance',
    title: 'Data Governance Standard',
    sections: [
      {
        id: 'new-collection',
        heading: 'New data collection',
        body: 'A release that begins collecting a new category of user data must classify it against the data inventory, record its purpose, and confirm the privacy notice covers it before the collection is enabled.',
      },
      {
        id: 'pii-handling',
        heading: 'PII handling',
        body: 'Personally identifiable information must not be written to logs, analytics events, or crash reports. New analytics instrumentation must be reviewed for identifier leakage before release.',
      },
      {
        id: 'retention',
        heading: 'Retention and deletion',
        body: 'Every new data store or event stream must have a retention period assigned from the retention schedule and a deletion path that honors user erasure requests within the committed window.',
      },
      {
        id: 'cross-border',
        heading: 'Cross-border transfer',
        body: 'User data may only be processed in approved regions. A release that adds a processor or changes where data is processed requires an updated transfer record.',
      },
    ],
  },
  {
    docId: 'sre-runbook',
    domain: 'sre',
    title: 'Release Operations Standard',
    sections: [
      {
        id: 'rollback',
        heading: 'Rollback plan',
        body: 'Every release must have a tested rollback path: either a one-step revert to the previous artifact or a documented migration-reversal procedure. Schema migrations must be backward-compatible for one release cycle.',
      },
      {
        id: 'capacity',
        heading: 'Capacity and load',
        body: 'A release expected to change traffic patterns or resource consumption must record a capacity estimate and confirm headroom against current limits and quotas.',
      },
      {
        id: 'observability',
        heading: 'Observability',
        body: 'New user-facing functionality must emit health signals sufficient to detect failure: at minimum an error-rate metric and an alert routed to the on-call rotation before launch.',
      },
      {
        id: 'oncall',
        heading: 'On-call readiness',
        body: 'The on-call rotation must be briefed on the release contents, and the runbook updated with new failure modes and their mitigations, before the rollout begins.',
      },
    ],
  },
];
