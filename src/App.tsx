import { useEffect, useRef, useState } from 'react';
import { createGate, fetchGate, fetchHealth, runGate } from './api';
import type { GateRecord, RequirementState } from './types';

const SAMPLE =
  'Mobile app 4.2: adds product analytics events, a new third-party payment SDK, and a schema migration for saved carts.';

const DOMAIN_LABEL: Record<string, string> = {
  security: 'Security',
  licensing: 'Licensing',
  'data-governance': 'Data Governance',
  sre: 'SRE',
};

type Phase = 'compose' | 'generating' | 'ready' | 'running' | 'done';

export default function App() {
  const [release, setRelease] = useState(SAMPLE);
  const [phase, setPhase] = useState<Phase>('compose');
  const [gateId, setGateId] = useState<string | null>(null);
  const [record, setRecord] = useState<GateRecord | null>(null);
  const [feed, setFeed] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'fake' | 'pods'>('fake');
  const [quirk, setQuirk] = useState(false);
  const [podsAvailable, setPodsAvailable] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    fetchHealth().then((h) => setPodsAvailable(h.pods)).catch(() => {});
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [feed]);

  const stopPolling = () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const generate = async () => {
    setPhase('generating');
    setError('');
    setFeed([]);
    setSummary('');
    setRecord(null);
    try {
      const { gate } = await createGate(release);
      setGateId(gate.gateId);
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
    setFeed([]);
    pollRef.current = window.setInterval(() => {
      fetchGate(gateId).then(setRecord).catch(() => {});
    }, 1500);
    await runGate(gateId, mode, quirk ? 'confabulate' : '', {
      onLog: (line) => setFeed((f) => [...f, line]),
      onDone: (rec, text) => {
        stopPolling();
        setRecord(rec);
        setSummary(text);
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
    setFeed([]);
    setSummary('');
    setError('');
  };

  return (
    <div className="wrap">
      <header>
        <div>
          <span className="eyebrow">Release-readiness fleet</span>
          <h1>Concurrence</h1>
        </div>
        <p className="thesis">
          The model is never asked “should we ship?” — it routes questions to their owners; <em>code tallies the receipts</em>.
        </p>
      </header>

      <section className="composer">
        <label htmlFor="release">Release under review</label>
        <textarea
          id="release"
          value={release}
          onChange={(e) => setRelease(e.target.value)}
          rows={4}
          disabled={phase === 'generating' || phase === 'running'}
        />
        <div className="controls">
          <button onClick={generate} disabled={phase === 'generating' || phase === 'running' || !release.trim()}>
            {phase === 'generating' ? 'Generating gate…' : gateId ? 'Regenerate gate' : 'Generate gate'}
          </button>
          {gateId && phase !== 'generating' && (
            <>
              <div className="mode">
                <label className={mode === 'fake' ? 'on' : ''}>
                  <input type="radio" checked={mode === 'fake'} onChange={() => setMode('fake')} /> Simulated fleet
                </label>
                <label className={mode === 'pods' ? 'on' : ''} title={podsAvailable ? '' : 'fleet.json not loaded on server'}>
                  <input type="radio" checked={mode === 'pods'} disabled={!podsAvailable} onChange={() => setMode('pods')} /> Live pods
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
              <button className="ghost" onClick={reset}>New release</button>
            </>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {record && (
        <section className="board">
          <div className={`banner ${record.decision === 'SHIP' ? 'ship' : 'hold'}`}>
            <span className="decision">{record.decision}</span>
            <span className="counts">
              {record.counts.credited} credited · {record.counts.failed} failed · {record.counts.pending} pending ·{' '}
              {record.counts.rejectedAttempts} rejected attempt{record.counts.rejectedAttempts === 1 ? '' : 's'}
            </span>
          </div>
          <div className="cards">
            {record.requirements.map((r) => (
              <RequirementCard key={r.requirement.id} r={r} />
            ))}
          </div>
        </section>
      )}

      {(feed.length > 0 || phase === 'running') && (
        <section className="feedwrap">
          <h2>Routing feed</h2>
          <div className="feed" ref={feedRef}>
            {feed.map((line, i) => (
              <FeedLine key={i} line={line} />
            ))}
            {phase === 'running' && <div className="line pending-line">⋯ fleet working</div>}
          </div>
        </section>
      )}

      {summary && (
        <section className="summary">
          <h2>Orchestrator report <span className="disclaim">(reporting only — the decision above came from the ledger)</span></h2>
          <pre>{summary}</pre>
        </section>
      )}
    </div>
  );
}

function RequirementCard({ r }: { r: RequirementState }) {
  return (
    <div className={`card ${r.status}`}>
      <div className="cardtop">
        <span className={`pill ${r.requirement.ownerDomain}`}>{DOMAIN_LABEL[r.requirement.ownerDomain] ?? r.requirement.ownerDomain}</span>
        <span className={`status ${r.status}`}>{r.status}</span>
      </div>
      <p className="label">{r.requirement.label}</p>
      {r.citation && (
        <p className="citation">📎 {r.citation.docTitle} § {r.citation.sectionHeading}</p>
      )}
      {r.status === 'failed' && r.verdict && <p className="failwhy">{r.verdict.rationale}</p>}
      {r.attempts.map((a, i) => (
        <p key={i} className="attempt">
          ⛔ {a.reason === 'misdirected'
            ? `${DOMAIN_LABEL[a.verdict.fromDomain] ?? a.verdict.fromDomain} answered — not the owner. Ask ${DOMAIN_LABEL[a.askInstead ?? ''] ?? a.askInstead}.`
            : a.reason === 'no_citation'
              ? 'verdict discarded: no receipt'
              : 'verdict discarded: citation does not resolve'}
        </p>
      ))}
    </div>
  );
}

function FeedLine({ line }: { line: string }) {
  const refused = line.includes('"recorded":false');
  const call = line.startsWith('→');
  const short = line.length > 300 ? `${line.slice(0, 300)}…` : line;
  return <div className={`line ${refused ? 'refused' : call ? 'call' : 'reply'}`}>{short}</div>;
}
