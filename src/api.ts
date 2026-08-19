import type { Gate, GateRecord } from './types';

export async function createGate(release: string): Promise<{ gate: Gate; repairs: string[] }> {
  const res = await fetch('/api/gate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ release }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
  return res.json();
}

export async function fetchGate(gateId: string): Promise<GateRecord> {
  const res = await fetch(`/api/gate/${gateId}`);
  if (!res.ok) throw new Error('unknown gate');
  return res.json();
}

export async function fetchHealth(): Promise<{ ok: boolean; pods: boolean }> {
  const res = await fetch('/api/health');
  return res.json();
}

export interface RunHandlers {
  onLog: (line: string) => void;
  onDone: (record: GateRecord, summary: string) => void;
  onError: (message: string) => void;
}

/** Consume the run SSE stream (fetch-based; EventSource is GET-only anyway but we want error bodies). */
export async function runGate(gateId: string, mode: string, quirk: string, handlers: RunHandlers): Promise<void> {
  const res = await fetch(`/api/gate/${gateId}/run?mode=${mode}&quirk=${quirk}`);
  if (!res.ok || !res.body) {
    handlers.onError((await res.json().catch(() => ({ error: `HTTP ${res.status}` }))).error);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || !data) continue;
      const payload = JSON.parse(data);
      if (event === 'log') handlers.onLog(payload.line);
      else if (event === 'done') handlers.onDone(payload.record, payload.summary);
      else if (event === 'error') handlers.onError(payload.message);
    }
  }
}
