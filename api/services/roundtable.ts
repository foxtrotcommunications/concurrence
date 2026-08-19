// Roundtable control-plane client (provisioning) + A2A message helper.
// The control plane is REST with Bearer auth; pods speak A2A JSON-RPC with an
// x-api-key.

const ROUNDTABLE_API_URL =
  process.env['ROUNDTABLE_API_URL'] || 'https://roundtable.foxtrotcommunications.net';

export interface WorkspaceRef {
  id: string;
  url?: string;
  a2aApiKey?: string;
  status?: string;
}

export class ControlPlaneClient {
  constructor(private readonly apiKey: string) {}

  private async fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${ROUNDTABLE_API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`Roundtable API ${res.status} on ${path}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  /** Upsert the application manifest so `template: 'concurrence-*'` resolves. */
  registerApplication(appId: string, manifest: unknown): Promise<{ blueprintCount?: number }> {
    return this.fetchJson(`/api/applications/${appId}`, {
      method: 'PUT',
      body: JSON.stringify(manifest),
    });
  }

  createWorkspace(data: {
    name: string;
    template: string;
    provider?: string;
    model?: string;
  }): Promise<WorkspaceRef> {
    return this.fetchJson('/api/workspaces', { method: 'POST', body: JSON.stringify(data) });
  }

  /**
   * Configure the workspace BEFORE start. Setting a2aServerEnabled here is
   * load-bearing: the A2A env block is only injected at provision time, so
   * patching after start leaves /a2a unmounted (learned the hard way on LF).
   */
  patchWorkspace(wsId: string, body: Record<string, unknown>): Promise<WorkspaceRef> {
    return this.fetchJson(`/api/workspaces/${wsId}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  startWorkspace(wsId: string): Promise<WorkspaceRef> {
    return this.fetchJson(`/api/workspaces/${wsId}/start`, { method: 'POST' });
  }

  listWorkspaces(): Promise<WorkspaceRef[]> {
    return this.fetchJson('/api/workspaces');
  }

  /** Pin a workspace to a specific image tag (never :latest). */
  deploy(wsId: string, imageTag: string): Promise<{ image: string }> {
    return this.fetchJson(`/api/workspaces/${wsId}/deploy`, {
      method: 'POST',
      body: JSON.stringify({ imageTag }),
    });
  }

  getWorkspace(wsId: string): Promise<WorkspaceRef> {
    return this.fetchJson(`/api/workspaces/${wsId}`);
  }
}

// ─── A2A message/send ────────────────────────────────────────────────────────

export interface A2aArtifact {
  name: string;
  parts?: Array<{ type: string; text?: string; data?: unknown }>;
}

export interface A2aResult {
  text: string;
  artifacts: A2aArtifact[];
}

export async function sendA2aMessage(
  workspaceUrl: string,
  a2aApiKey: string,
  message: string,
): Promise<A2aResult> {
  const res = await fetch(`${workspaceUrl}/a2a`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': a2aApiKey },
    signal: AbortSignal.timeout(300_000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `cg-${Date.now().toString(36)}`,
      method: 'message/send',
      params: { message: { role: 'user', parts: [{ type: 'text', text: message }] } },
    }),
  });
  if (!res.ok) throw new Error(`A2A ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { result?: { artifacts?: A2aArtifact[] } };
  const artifacts = data.result?.artifacts ?? [];
  return { text: extractResponseText(artifacts), artifacts };
}

/** Concatenated text of the `response` artifact (pure, unit-tested). */
export function extractResponseText(artifacts: A2aArtifact[]): string {
  const response = artifacts.find((a) => a.name === 'response');
  return (response?.parts ?? [])
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
}
