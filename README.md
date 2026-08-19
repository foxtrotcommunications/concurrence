# Concurrence

**A release-readiness fleet where the model is never asked "should we ship?" — no such prompt exists.**

Domain-authority agents (Security, Licensing, Data Governance, SRE) each hold their own policy corpus and nothing else. An orchestrator routes each gate requirement to its owner; a deterministic coverage ledger collects each authority's independent, cited agreement — its *concurrence* — and only code can render the SHIP decision.

Three code-enforced gates:

| Gate | Rule |
| --- | --- |
| **Ownership** | Only the owning domain's verdict is ever recorded. Anyone else's opinion becomes a `misdirected` attempt in the audit trail — surfaced, never credited. |
| **Citation** | A pass must carry a receipt: a `(docId, sectionId)` citation that code resolves inside the owner's *own* corpus. Confident vibes without receipts are refused. |
| **Completeness** | `SHIP` renders only when every requirement is credited. The model can route questions; it cannot approve a release. |

## Status

Under active development for the All Things Agentic Hackathon (submission period Aug 3 – Aug 31, 2026). Currently implemented: the deterministic core (`packages/tools-gate` — coverage ledger, citation resolver, gate types) with a full unit-test suite and zero LLM dependencies.

```bash
npm install
npm test
npm run typecheck
```

## Disclosure

All code in this repository was written during the hackathon submission period. Concurrence runs its agent fleet on [Roundtable](https://github.com/foxtrotcommunications), a pre-existing Apache-2.0 multi-agent workspace platform by the same author, disclosed here per the hackathon rules on pre-existing work. The deterministic ledger, citation resolver, orchestrator, generator, and UI are new work in this repository.

## License

Apache-2.0
