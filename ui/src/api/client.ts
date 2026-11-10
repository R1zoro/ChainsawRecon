import { ApiErrorEnvelope, ApiErrorDetails } from './types';
import * as mockService from './mockService';

export class ApiError extends Error {
  code: string;
  details?: Record<string, unknown>;
  request_id: string;
  retryable?: boolean;

  constructor(error: ApiErrorDetails) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.details = error.details;
    this.request_id = error.request_id;
    this.retryable = error.retryable;
  }
}

export function isApiError(err: unknown): err is ApiError {
  if (err instanceof ApiError) return true;
  if (typeof err === 'object' && err !== null) {
    if ('code' in err && 'request_id' in err) return true;
    if ('error' in err && typeof (err as Record<string, unknown>).error === 'object') {
      const inner = (err as Record<string, unknown>).error as Record<string, unknown>;
      if ('code' in inner && 'request_id' in inner) return true;
    }
  }
  return false;
}

export function generateRequestId(): string {
  return 'req_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8765/api/v1';

// Production and default dev MUST be false; mocks only activate when explicitly requested
const USE_MOCKS = import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS === 'true';

export function setMockServiceMode(mode: mockService.MockServiceMode): void {
  mockService.setMockServiceMode(mode);
}

export function getMockServiceMode(): mockService.MockServiceMode {
  return mockService.getMockServiceMode();
}

export async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const requestId = generateRequestId();
  const method = (options.method || 'GET').toUpperCase();

  // If in mock mode, route supported endpoints to mockService
  if (USE_MOCKS) {
    const urlPath = path.split('?')[0];

    if (urlPath === '/home' && method === 'GET') {
      return mockService.fetchHomeData() as unknown as T;
    }
    if (urlPath === '/projects' && method === 'GET') {
      return mockService.fetchProjects() as unknown as T;
    }
    if (urlPath === '/projects' && method === 'POST') {
      const body = JSON.parse((options.body as string) || '{}');
      return mockService.createProject(body) as unknown as T;
    }
    if (urlPath === '/projects/open' && method === 'POST') {
      const body = JSON.parse((options.body as string) || '{}');
      return mockService.openProject(body.path) as unknown as T;
    }
    if (urlPath.startsWith('/projects/') && method === 'DELETE') {
      const id = urlPath.split('/')[2];
      return mockService.removeProject(id) as unknown as T;
    }
    if (urlPath === '/providers' && method === 'GET') {
      return mockService.fetchProviders() as unknown as T;
    }
    if (urlPath.startsWith('/sessions/') && urlPath.endsWith('/journal') && method === 'GET') {
      const parts = urlPath.split('/');
      const sessionId = parts[2];
      const search = path.includes('?') ? path.slice(path.indexOf('?')) : '';
      const params = new URLSearchParams(search);
      const afterSeq = parseInt(params.get('afterSeq') || '0', 10);
      return mockService.fetchJournal(sessionId, afterSeq) as unknown as T;
    }
    if (urlPath.startsWith('/sessions/') && urlPath.endsWith('/messages') && method === 'POST') {
      const parts = urlPath.split('/');
      const sessionId = parts[2];
      const body = JSON.parse((options.body as string) || '{}');
      return mockService.postMessage(sessionId, body.content) as unknown as T;
    }
    if (urlPath.includes('/approvals/') && urlPath.endsWith('/grant') && method === 'POST') {
      const parts = urlPath.split('/');
      const sessionId = parts[2];
      const approvalId = parts[4];
      const body = JSON.parse((options.body as string) || '{}');
      return mockService.grantApproval(sessionId, approvalId, body.reason || '') as unknown as T;
    }
    if (urlPath.includes('/approvals/') && urlPath.endsWith('/deny') && method === 'POST') {
      const parts = urlPath.split('/');
      const sessionId = parts[2];
      const approvalId = parts[4];
      const body = JSON.parse((options.body as string) || '{}');
      return mockService.denyApproval(sessionId, approvalId, body.reason || '') as unknown as T;
    }
    if (urlPath.startsWith('/sessions/') && method === 'POST') {
      const parts = urlPath.split('/');
      const sessionId = parts[2];
      const action = parts[3]; // start, pause, resume, stop
      const targetStatus = action === 'pause' ? 'paused' : action === 'stop' ? 'completed' : 'running';
      return mockService.updateSessionStatus(sessionId, targetStatus) as unknown as T;
    }
    if (urlPath.startsWith('/sessions/') && urlPath.endsWith('/evidence') && method === 'GET') {
      return mockService.fetchEvidence() as unknown as T;
    }
    if (urlPath.includes('/app-model/entities/') && urlPath.endsWith('/note') && method === 'POST') {
      const parts = urlPath.split('/');
      const projectId = parts[2];
      const entityId = parts[5];
      const body = JSON.parse((options.body as string) || '{}');
      return mockService.addEntityNote(projectId, entityId, body.content || '') as unknown as T;
    }
    if (urlPath.includes('/app-model/entities/') && method === 'GET') {
      const parts = urlPath.split('/');
      const projectId = parts[2];
      const entityId = parts[5];
      return mockService.fetchEntityDetail(projectId, entityId) as unknown as T;
    }
    if (urlPath.includes('/app-model/graph') && method === 'GET') {
      const parts = urlPath.split('/');
      const projectId = parts[2];
      const search = path.includes('?') ? path.slice(path.indexOf('?')) : '';
      const params = new URLSearchParams(search);
      const rootId = params.get('rootId') || undefined;
      const depth = params.has('depth') ? parseInt(params.get('depth')!, 10) : undefined;
      const maxNodes = params.has('maxNodes') ? parseInt(params.get('maxNodes')!, 10) : undefined;
      return mockService.fetchAppModelGraph(projectId, { rootId, depth, maxNodes }) as unknown as T;
    }
    if (urlPath.includes('/app-model/export') && method === 'GET') {
      const parts = urlPath.split('/');
      const projectId = parts[2];
      return mockService.fetchAppModelExport(projectId) as unknown as T;
    }
    if (urlPath.endsWith('/app-model') && method === 'GET') {
      const parts = urlPath.split('/');
      const projectId = parts[2];
      const search = path.includes('?') ? path.slice(path.indexOf('?')) : '';
      const params = new URLSearchParams(search);
      const kind = params.get('kind') || undefined;
      const q = params.get('q') || undefined;
      const stale = params.get('stale') === 'true' ? true : undefined;
      const limit = params.has('limit') ? parseInt(params.get('limit')!, 10) : undefined;
      const offset = params.has('offset') ? parseInt(params.get('offset')!, 10) : undefined;
      return mockService.fetchAppModel(projectId, { kind, q, stale, limit, offset }) as unknown as T;
    }
    if (urlPath.startsWith('/projects/') && urlPath.endsWith('/scope') && method === 'GET') {
      const parts = urlPath.split('/');
      const projectId = parts[2];
      return mockService.fetchScope(projectId) as unknown as T;
    }
    // ── Milestone 3: Workbench Routes ───────────────────────────
    if (urlPath === '/workbench/history' && method === 'GET') {
      const search = path.includes('?') ? path.slice(path.indexOf('?')) : '';
      const params = new URLSearchParams(search);
      const projectId = params.get('projectId') || undefined;
      const q = params.get('q') || undefined;
      const host = params.get('host') || undefined;
      const reqMethod = params.get('method') || undefined;
      const status = params.get('status') || undefined;
      const contentType = params.get('contentType') || undefined;
      const auth = params.get('auth') || undefined;
      const tag = params.get('tag') || undefined;
      const inScopeOnly = params.get('inScopeOnly') === 'true';
      const limit = params.has('limit') ? parseInt(params.get('limit')!, 10) : undefined;
      const offset = params.has('offset') ? parseInt(params.get('offset')!, 10) : undefined;
      return mockService.fetchWorkbenchHistory(projectId, {
        q, host, method: reqMethod, status, contentType, auth, tag, inScopeOnly, limit, offset
      }) as unknown as T;
    }
    if (urlPath.startsWith('/workbench/requests/') && method === 'GET') {
      const parts = urlPath.split('/');
      const requestId = parts[3];
      return mockService.fetchRequestDetail(requestId) as unknown as T;
    }
    if (urlPath === '/workbench/replay' && method === 'POST') {
      const body = JSON.parse((options.body as string) || '{}');
      return mockService.replayRequest(body) as unknown as T;
    }
    if (urlPath === '/workbench/compare' && method === 'POST') {
      const body = JSON.parse((options.body as string) || '{}');
      return mockService.compareResponses(body.baselineId, body.candidateId) as unknown as T;
    }
    if (urlPath === '/workbench/evidence' && method === 'POST') {
      const body = JSON.parse((options.body as string) || '{}');
      return mockService.createWorkbenchEvidence(body) as unknown as T;
    }
    if (urlPath === '/workbench/import' && method === 'POST') {
      const body = JSON.parse((options.body as string) || '{}');
      return mockService.importHar(body.format, body.path) as unknown as T;
    }
    if (urlPath === '/workbench/export' && method === 'GET') {
      const search = path.includes('?') ? path.slice(path.indexOf('?')) : '';
      const params = new URLSearchParams(search);
      const projectId = params.get('projectId') || 'prj_demo';
      const format = (params.get('format') as 'har' | 'jsonl') || 'har';
      return mockService.fetchWorkbenchExport(projectId, format) as unknown as T;
    }
    if (urlPath === '/workbench/ca' && method === 'GET') {
      return mockService.fetchCaStatus() as unknown as T;
    }
    if (urlPath.startsWith('/projects/') && method === 'GET') {
      const parts = urlPath.split('/');
      const projectId = parts[2];
      return mockService.fetchProject(projectId) as unknown as T;
    }
    if (urlPath.startsWith('/sessions/') && urlPath.endsWith('/tasks') && method === 'GET') {
      return mockService.fetchTasks() as unknown as T;
    }
    if (urlPath.startsWith('/sessions/') && urlPath.endsWith('/approvals') && method === 'GET') {
      return mockService.fetchApprovals() as unknown as T;
    }
    if (urlPath.startsWith('/sessions/') && urlPath.endsWith('/context') && method === 'GET') {
      return mockService.fetchContext() as unknown as T;
    }
    if (urlPath.startsWith('/sessions/') && method === 'GET') {
      const parts = urlPath.split('/');
      const sessionId = parts[2];
      return mockService.fetchSession(sessionId) as unknown as T;
    }
  }

  // Real backend HTTP fetch
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : '/' + path}`;
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  headers.set('X-Request-Id', requestId);

  // Send idempotency key on mutating requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!headers.has('X-Idempotency-Key')) {
      headers.set('X-Idempotency-Key', generateRequestId());
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: 'same-origin',
    });
  } catch (err: unknown) {
    const errorDetails: ApiErrorDetails = {
      code: 'NETWORK_DISCONNECTED',
      message: err instanceof Error ? err.message : 'Failed to connect to local ChainsawRecon backend.',
      request_id: requestId,
      retryable: true,
    };
    throw new ApiError(errorDetails);
  }

  if (!response.ok) {
    let errorEnvelope: ApiErrorEnvelope | null = null;
    try {
      errorEnvelope = await response.json();
    } catch {
      // Ignore JSON parse error on non-JSON response
    }

    if (errorEnvelope?.error) {
      throw new ApiError(errorEnvelope.error);
    }

    const fallbackError: ApiErrorDetails = {
      code: `HTTP_${response.status}`,
      message: response.statusText || `Request failed with HTTP status ${response.status}`,
      request_id: requestId,
      retryable: response.status >= 500,
    };
    throw new ApiError(fallbackError);
  }

  return response.json();
}
