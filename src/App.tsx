import { useEffect, useMemo, useRef, useState } from 'react';
import { createGate, fetchGate, fetchHealth, runGate, type AgentEvent } from './api';
import { checkConsistency, DOMAIN_LABEL, narrate, rawLine, type FeedLine } from './feed';
import type { GateRecord, RequirementState } from './types';

const SAMPLE =
  'Mobile app 4.2: adds product analytics events, a new third-party payment SDK, and a schema migration for saved carts.';

/** Ledger state names are internal; these are what a reader sees. */
const STATUS_LABEL: Record<RequirementState['status'], string> = {
  credited: 'concurred',
  failed: 'blocked',
  pending: 'awaiting',
};

const REJECTION_TEXT: Record<string, string> = {
  no_citation: 'a pass was claimed with nothing to back it. The ledger discarded the verdict.',
  unresolvable_citation:
    'the citation did not resolve in this authority’s own policy. The ledger discarded the verdict.',
};

type Phase = 'compose' | 'generating' | 'ready' | 'running' | 'done';

export default function App() {
  const [release, setRelease] = useState(SAMPLE);
  const [phase, setPhase] = useState<Phase>('compose');
  const [gateId, setGateId] = useState<string | null>(null);
  const [record, setRecord] = useState<GateRecord | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'fake' | 'pods'>('fake');
  /** Which fleet produced the verdicts currently on the board. */
  const [ranWith, setRanWith] = useState<'fake' | 'pods' | null>(null);
  const [quirk, setQuirk] = useState(false);
  const [podsAvailable, setPodsAvailable] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    fetchHealth().then((h) => setPodsAvailable(h.pods)).catch(() => {});
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [events]);

  const labelOf = useMemo(() => {
    const map = new Map((record?.requirements ?? []).map((r) => [r.requirement.id, r.requirement.label]));
    return (id: string) => map.get(id);
  }, [record]);

  const narration = useMemo(
    () => events.map((e) => narrate(e, labelOf)).filter((l): l is FeedLine => l !== null),
    [events, labelOf],
  );

  const stopPolling = () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const generate = async () => {
    setPhase('generating');
    setError('');
    setEvents([]);
    setSummary('');
    setRecord(null);
    try {
      const { gate } = await createGate(release);
      setGateId(gate.gateId);
      setRanWith(null);
      setRecord(await fetchGate(gate.gateId));
      setPhase('ready');
    } catch (err) {
      setError((err as Error).message);
      setPhase('compose');
    }
  };

  const run = async () => {
    if (!gateId) return;
    setPhase('running');
    setError('');
    setEvents([]);
    setSummary('');
    setRanWith(null);
    pollRef.current = window.setInterval(() => {
      fetchGate(gateId).then(setRecord).catch(() => {});
    }, 1500);
    await runGate(gateId, mode, quirk ? 'confabulate' : '', {
      onLog: (event) => setEvents((prev) => [...prev, event]),
      onDone: (rec, text) => {
        stopPolling();
        setRecord(rec);
        setSummary(text);
        setRanWith(mode);
        setPhase('done');
      },
      onError: (message) => {
        stopPolling();
        setError(message);
        setPhase('ready');
      },
    });
    stopPolling();
  };

  const reset = () => {
    stopPolling();
    setPhase('compose');
    setGateId(null);
    setRecord(null);
    setEvents([]);
    setSummary('');
    setError('');
  };

  const busy = phase === 'generating' || phase === 'running';

  return (
    <div className="wrap">
      <header>
        <div>
          <span className="eyebrow">Release-readiness fleet</span>
          <h1>Concurrence</h1>
        </div>
        <p className="thesis">
          The model is never asked “should we ship?” — it routes questions to their owners;{' '}
          <em>code tallies the receipts</em>.
        </p>
      </header>

      <section className="composer">
        <label htmlFor="release">Release under review</label>
        <textarea
          id="release"
          value={release}
          onChange={(e) => setRelease(e.target.value)}
          rows={4}
          disabled={busy}
        />
        <div className="controls">
          <button onClick={generate} disabled={busy || !release.trim()}>
            {phase === 'generating' ? 'Generating gate…' : gateId ? 'Regenerate gate' : 'Generate gate'}
          </button>
          {gateId && phase !== 'generating' && (
            <>
              <div className="mode">
                <label className={mode === 'fake' ? 'on' : ''}>
                  <input type="radio" checked={mode === 'fake'} onChange={() => setMode('fake')} /> Simulated
                  fleet <span className="hint">instant</span>
                </label>
                <label
                  className={mode === 'pods' ? 'on' : ''}
                  title={podsAvailable ? 'Consults the real pods over A2A' : 'No fleet directory on the server'}
                >
                  <input
                    type="radio"
                    checked={mode === 'pods'}
                    disabled={!podsAvailable}
                    onChange={() => setMode('pods')}
                  />{' '}
                  Live fleet <span className="hint">5 pods on GKE</span>
                </label>
                {mode === 'fake' && (
                  <label className="quirk">
                    <input type="checkbox" checked={quirk} onChange={(e) => setQuirk(e.target.checked)} /> stage a
                    confabulation
                  </label>
                )}
              </div>
              <button className="primary" onClick={run} disabled={phase === 'running'}>
                {phase === 'running' ? 'Fleet working…' : 'Run the gate'}
              </button>
              <button className="ghost" onClick={reset}>
                New release
              </button>
            </>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {record && <Board record={record} ranWith={ranWith} />}

      {(narration.length > 0 || phase === 'running') && (
        <section className="panel">
          <h2>Routing</h2>
          <div className="feed" ref={feedRef}>
            {narration.map((line, i) => (
              <p key={i} className={`narr ${line.tone}`}>
                {line.text}
              </p>
            ))}
            {phase === 'running' && <p className="narr working">the fleet is working…</p>}
          </div>
          {events.length > 0 && (
            <details className="trace">
              <summary>Agent trace · {events.length} tool calls</summary>
              <pre>{events.map(rawLine).join('\n')}</pre>
            </details>
          )}
        </section>
      )}

      {summary && record && <Report summary={summary} record={record} />}
    </div>
  );
}

function Board({ record, ranWith }: { record: GateRecord; ranWith: 'fake' | 'pods' | null }) {
  const { counts, decision, requirements } = record;
  const untouched = counts.pending === requirements.length;
  const blocked = requirements.filter((r) => r.status !== 'credited').length;

  return (
    <section className="board">
      {ranWith && (
        <p className={`provenance ${ranWith}`}>
          verdicts produced by{' '}
          <strong>{ranWith === 'pods' ? 'the live fleet — 5 pods on GKE, over A2A' : 'the simulated fleet'}</strong>
        </p>
      )}
      <div className={`banner ${decision === 'SHIP' ? 'ship' : 'hold'}`}>
        <div className="bannermain">
          <span className="decision">{decision}</span>
          <span className="tally">
            {untouched
              ? 'awaiting review — nothing ships until every owner concurs'
              : decision === 'SHIP'
                ? `concurrence achieved — ${counts.credited} of ${requirements.length} authorities concurred, each with a receipt`
                : counts.pending > 0
                  ? `in review — ${counts.credited} concurred, ${counts.failed} blocked, ${counts.pending} still with their owners`
                  : `${blocked} of ${requirements.length} requirement${blocked === 1 ? '' : 's'} not concurred`}
          </span>
        </div>
        <span className="counts">
          {counts.credited} concurred · {counts.failed} blocked · {counts.pending} awaiting ·{' '}
          {counts.rejectedAttempts} refused verdict{counts.rejectedAttempts === 1 ? '' : 's'}
        </span>
      </div>
      <div className="cards">
        {requirements.map((r) => (
          <Card key={r.requirement.id} r={r} />
        ))}
      </div>
    </section>
  );
}

function Card({ r }: { r: RequirementState }) {
  const flagged = r.attempts.length > 0;
  return (
    <article className={`card ${r.status}${flagged ? ' flagged' : ''}`}>
      <div className="cardtop">
        <span className="pill">{DOMAIN_LABEL[r.requirement.ownerDomain] ?? r.requirement.ownerDomain}</span>
        <span className={`status ${r.status}`}>{STATUS_LABEL[r.status]}</span>
      </div>
      <p className="label">{r.requirement.label}</p>
      {r.citation && (
        <p className="citation">
          <span className="receipt">receipt</span> {r.citation.docTitle} § {r.citation.sectionHeading}
        </p>
      )}
      {r.status === 'failed' && r.verdict && <p className="failwhy">{r.verdict.rationale}</p>}
      {r.attempts.map((a, i) => (
        <p key={i} className="attempt">
          <strong>
            {a.reason === 'misdirected' ? 'wrong authority' : 'no receipt'}
          </strong>
          {a.reason === 'misdirected'
            ? ` — ${DOMAIN_LABEL[a.verdict.fromDomain] ?? a.verdict.fromDomain} tried to certify this. ${
                DOMAIN_LABEL[a.askInstead ?? ''] ?? a.askInstead
              } owns it.`
            : ` — ${REJECTION_TEXT[a.reason] ?? 'verdict discarded'}`}
        </p>
      ))}
    </article>
  );
}

function Report({ summary, record }: { summary: string; record: GateRecord }) {
  const consistency = checkConsistency(summary, record.decision);
  return (
    <section className="panel report">
      <h2>
        Orchestrator summary <span className="disclaim">model output · not authoritative</span>
      </h2>
      <p className={`consistency ${consistency.state}`}>
        {consistency.state === 'ok' ? '✓' : consistency.state === 'mismatch' ? '⚠' : '·'} {consistency.text}
      </p>
      <details>
        <summary>Read what the orchestrator wrote</summary>
        <pre>{summary.trim()}</pre>
      </details>
    </section>
  );
}
