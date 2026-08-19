# Concurrence — Devpost submission

**Category:** The Fortified Enterprise Fleet
**Try it:** https://concurrence-1007343673363.us-central1.run.app
**Code:** https://github.com/foxtrotcommunications/concurrence

**Tagline:** A release-readiness agent fleet where the model is never asked "should we ship?" — no such prompt exists in the system.

---

## Inspiration

Every organization with a release process has the same quiet failure. The checklist lives in a wiki. The authority to answer it lives in five different people's heads. And releases go out because *somebody* said it was fine — often somebody with no standing to say so. An engineer waves off a licensing question. A confident "yeah, that's covered" gets recorded as though it were a policy review.

Pointing a single LLM assistant at this makes it worse. One model with one context answers *everything* with the same confidence. There is no structural notion of who was entitled to answer, and no way to distinguish a reviewed claim from a plausible-sounding one. We wanted to find out what the architecture looks like when you stop trying to make the model more careful and start making the *system* incapable of accepting an unqualified answer.

## What it does

Concurrence turns a free-text release description into a gate: a checklist where each requirement is owned by exactly one domain authority. Four authorities — Security, Licensing, Data Governance, and SRE — run as independent agents, each holding **only its own** policy corpus. An orchestrator routes each requirement to its owner. A deterministic coverage ledger records the verdicts, and only the ledger can render a decision.

The name is the mechanic: the gate opens when every authority has independently concurred, with a citation.

Three gates are enforced in code, not in a prompt:

- **Ownership** — a verdict on a requirement is recorded only if it came from that requirement's owning domain. Anyone else's verdict becomes a `misdirected` attempt: visible in the audit trail, never credited.
- **Citation** — a `pass` must carry a citation that code resolves to a real section *inside the owner's own corpus*. No citation, or one that doesn't resolve, and the verdict is discarded no matter how confident it sounded.
- **Completeness** — `SHIP` renders only when every requirement is credited. The orchestrator has four tools and not one of them emits a decision.

An owner's `fail` is deliberately asymmetric: it needs no citation, because a fail can only *block* a release. Proof is required in the direction where being wrong is expensive.

Three things you can watch in the live demo:

**The release description is the evidence.** A vague description ("adds analytics, a payment SDK, and a cart migration") returns **HOLD** — every domain fails its requirement for insufficient evidence. Describe the same release *with* its compliance facts and it returns **SHIP**, with a citation on every requirement. The fleet does not ship on vibes.

**The wrong expert gets no credit.** Route a licensing question to SRE and it declines — it has no licensing policy to reason from. Submit its verdict anyway and the ledger marks it `misdirected` and names the owner. The requirement stays red.

**Confabulation is caught by code, not by a better prompt.** Tick "stage a confabulation" and Security returns "This is fine — I am confident it complies with our policy," with no citation. The ledger discards it, the card reads **verdict discarded: no receipt**, and that rejection stays in the audit trail even after the agent recovers with a real citation.

## How we built it

**Gemini 3.5 Flash on Vertex AI** does three jobs: generating the gate from a release description, driving the orchestrator's agent loop, and the policy reasoning inside every domain pod.

**Google's Agent Development Kit** (TypeScript) is the orchestrator — an `LlmAgent` with four `FunctionTool`s: `list_requirements`, `consult_domain`, `record_verdict`, and `render_gate`. The **GenAI SDK** handles gate generation, with a deterministic parse-and-repair pass behind it (slugified ids, unknown owners remapped and reported, a hard cap) so malformed model output degrades instead of failing.

The five-agent fleet runs as workspaces on **GKE**, communicating over A2A. Each domain pod's system prompt is *rendered from the policy corpus*, so the text a pod reasons from and the text the citation resolver validates against come from one source. A test asserts that no pod's prompt contains another domain's sections — the knowledge asymmetry is provisioned, not requested. The Chinese Wall is enforced at the data layer too: a citation whose document belongs to another domain fails to resolve, so a pod cannot receipt against policy it doesn't own even if it somehow learned the section id.

The coverage ledger persists to **Firestore**, one document per gate, behind a storage seam that swaps to an in-memory store for tests. The dashboard and orchestrator run as a single **Cloud Run** service (React + Vite front end, Express API) that streams the orchestrator's routing feed to the browser over SSE. **Cloud Build**, **Artifact Registry**, and **Secret Manager** round out the stack — the fleet's A2A keys are injected as a secret rather than baked into an image layer.

The deterministic core is deliberately testable without a model: 52 tests cover the three gates, the citation resolver, the corpus invariants, the plugin registrars, and the generator's repair pass, with zero LLM calls.

## Data sources

**No external data sources.** The four policy corpora are synthetic documents written for this project — plausible, generic policies covering dependency and CVE review, license compatibility, PII and retention, and release operations. Every citation resolves into them. No real company data, customer data, or third-party feed is used anywhere.

## Challenges we ran into

**Making refusals teach.** The first orchestrator recorded a refusal and stalled. Returning an actionable hint alongside the refusal — "Only licensing can verdict this requirement. Consult them instead." — let recovery emerge without any prompt describing the gates. The agent learns the rules by hitting them, which is a much better property than being told about them.

**A phantom dependency that survived every local test.** The ADK package worked locally for days while missing from the manifest, resolved from a parent directory's `node_modules` after a stray install. Everything passed; the container died at boot. Deploying is the only test that catches this, and we now audit every external import against the manifest.

**Provisioning order is load-bearing.** A pod's A2A environment block is only injected during its *initial* bring-up, so enabling the flag afterward leaves the endpoint unmounted. We hit this, fixed it by hand once, then moved the fix into the provisioner — which is what makes the spin-up instructions in the README honest rather than aspirational.

**Regional endpoints don't serve the model.** `gemini-3.5-flash` comes from Vertex's global endpoint; regional locations return 404. An hour of confusion, one line of config.

## Accomplishments we're proud of

The central claim is testable offline: you can clone the repo, run `npm test` with no cloud credentials, and prove that the gates hold — that no code path credits an unowned verdict or an uncited pass. The model's cooperation is not load-bearing.

And it works on real infrastructure in both directions. A bare release description produces HOLD, with every domain refusing for insufficient evidence; the same release described with its compliance facts produces SHIP, every requirement carrying a citation that points at the section actually governing the claim.

## What we learned

**Structural ignorance beats instructed ignorance.** "Only answer questions about your own area" is a request a model can talk itself out of. Giving a pod only its own corpus makes an out-of-domain answer unciteable, and the citation gate rejects it regardless of how the pod behaved.

**The generator writes better checklists than we did.** Our hand-written requirements were generic. Generated ones — "the new endpoint `api.payflow.example` is recorded with its transport security" — are specific enough that a domain can actually verify them.

**The citation gate proves provenance, not relevance.** It verifies that a receipt resolves to a real section of the owner's own corpus; it does not verify that the section is the *right* one. We found this the honest way — a weak keyword heuristic in the simulated fleet cited "Rollback plan" for an observability requirement and the ledger credited it, because the citation was genuine. That's the correct division: provenance is mechanically checkable, relevance is a judgment, and the receipt is precisely what lets a human audit that judgment instead of taking it on faith.

**Agents are for interpretation; code is for adjudication.** The deterministic half of Concurrence *is* a rules engine, on purpose. The agents do the two things rules can't: turn a free-text release into owned requirements, and interpret free-text policy against a specific change. Drawing that line explicitly is the design.

## What's next

Ingesting real policy documents instead of synthetic corpora, with section-level anchors generated at import. Putting the Auditor pod on the live critical path so the ledger is addressed as a fleet service rather than running in the orchestrator's process. A human sign-off tier for requirements that policy says a person must approve — the ledger already has the shape for it, since a credited verdict is just an owner plus a receipt.

## Disclosure

All code in this repository was written during the submission period (August 3–31, 2026).

Concurrence runs its agent fleet on Roundtable, a pre-existing multi-agent workspace platform by the same author, disclosed here per the rules on pre-existing work. Roundtable provides workspace provisioning, the A2A transport, and the plugin host. Everything specific to this project is new work in this repository: the coverage ledger and its three gates, the citation resolver, the policy corpora, the gate generator, the ADK orchestrator and its tools, the plugin, the provisioner, and the dashboard.

This is one of two independent submissions by this entrant. The other, Lingua Franca, is a language-learning game in the Collaborative Partner category. They share no code and address different problems; both are built on the same underlying platform, which is disclosed in each.

---

## Built With

`typescript` · `google-adk` · `gemini` · `vertex-ai` · `google-cloud` · `cloud-run` · `firestore` · `gke` · `cloud-build` · `secret-manager` · `a2a` · `react` · `vite` · `express` · `node.js` · `vitest`
