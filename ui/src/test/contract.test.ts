import { describe, it, expect, beforeEach } from 'vitest';
import { mockHomeData } from '../api/mockData';
import { 
  fetchHomeData, 
  setMockServiceMode, 
  createProject, 
  removeProject, 
  resetMockData,
} from '../api/mockService';
import { fetchJson, isApiError } from '../api/client';
import { ChainsawEventClient } from '../api/events';
import { parseAndClassifyScope } from '../features/engagement-wizard/scopeClassifier';
import { 
  Paginated, 
  AppEntity, 
  AppGraphResponse, 
  EntityDetailResponse, 
  NoteItem, 
  AppModelSummary,
  CapturedRequest,
  RequestDetailResponse,
  ReplayResult,
  ResponseCompareResponse,
  CaStatusResponse,
} from '../api/types';

describe('Frontend API Contract & Fixture Conformance', () => {
  beforeEach(() => {
    resetMockData();
  });

  it('GET /home mock fixture conforms strictly to HomeDataResponse schema', async () => {
    setMockServiceMode('healthy');
    const data = await fetchHomeData();

    // Verify root structure
    expect(data).toHaveProperty('recentProjects');
    expect(data).toHaveProperty('recentActivity');
    expect(data).toHaveProperty('environment');
    expect(Array.isArray(data.recentProjects)).toBe(true);
    expect(Array.isArray(data.recentActivity)).toBe(true);

    // Verify project summary properties
    const project = data.recentProjects[0];
    expect(project).toBeDefined();
    expect(typeof project.id).toBe('string');
    expect(typeof project.name).toBe('string');
    expect(typeof project.path).toBe('string');
    expect(typeof project.createdAt).toBe('string');
    expect(typeof project.sessionCount).toBe('number');
    expect(typeof project.openFindings).toBe('number');
    expect(['ok', 'empty', 'invalid']).toContain(project.scopeStatus);

    // Verify environment health properties
    expect(data.environment.providers).toHaveProperty('healthy');
    expect(data.environment.providers).toHaveProperty('degraded');
    expect(data.environment.providers).toHaveProperty('unavailable');
    expect(data.environment.toolPacks).toHaveProperty('installed');
    expect(data.environment.toolPacks).toHaveProperty('total');
    expect(['native', 'docker', 'unavailable']).toContain(data.environment.sandbox);
  });

  it('Active session banner adheres to strict schema when session is active', () => {
    const activeSession = mockHomeData.activeSession;
    expect(activeSession).toBeDefined();
    if (activeSession) {
      expect(typeof activeSession.id).toBe('string');
      expect(typeof activeSession.projectId).toBe('string');
      expect(typeof activeSession.title).toBe('string');
      expect(['running', 'paused', 'blocked', 'completed', 'failed']).toContain(activeSession.status);
      expect(typeof activeSession.elapsedSeconds).toBe('number');
      expect(typeof activeSession.lastEventSummary).toBe('string');
      expect(activeSession.budget).toBeDefined();
    }
  });

  it('Handles empty state with correct zero-project structure', async () => {
    setMockServiceMode('empty');
    const emptyData = await fetchHomeData();
    expect(emptyData.recentProjects.length).toBe(0);
    expect(emptyData.recentActivity.length).toBe(0);
    expect(emptyData.activeSession).toBeNull();
    expect(emptyData.environment.warnings?.length).toBeGreaterThan(0);
    setMockServiceMode('healthy');
  });

  it('Handles structured API error envelope and isApiError type guard', async () => {
    setMockServiceMode('error');
    try {
      await fetchHomeData();
      expect.fail('Should have thrown an error');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Object);
      const isTyped = isApiError(err);
      expect(isTyped).toBe(true);
    } finally {
      setMockServiceMode('healthy');
    }
  });

  it('Performs mock mutations and persists across fetch calls', async () => {
    const initial = await fetchHomeData();
    const countBefore = initial.recentProjects.length;

    // Create new project
    const created = await createProject({
      name: 'Dynamic Assessment Lab',
      path: 'C:/labs/dynamic-lab',
      targets: ['https://dynamic.example.com'],
    });
    expect(created.name).toBe('Dynamic Assessment Lab');

    const updated = await fetchHomeData();
    expect(updated.recentProjects.length).toBe(countBefore + 1);
    expect(updated.recentProjects[0].name).toBe('Dynamic Assessment Lab');

    // Remove project
    await removeProject(created.id);
    const afterRemoval = await fetchHomeData();
    expect(afterRemoval.recentProjects.length).toBe(countBefore);
  });

  it('WebSocket client initializes and tracks sequence', () => {
    const client = new ChainsawEventClient('ws://127.0.0.1:8765/api/v1/stream');
    expect(client.getState()).toBe('disconnected');
    expect(client.getLastSeq()).toBe(0);
  });

  it('Scope classifier accurately categorizes targets and flags conflicts', () => {
    const raw = `
      https://app.example.com/api
      api.example.com
      *.internal.corp
      192.168.1.100
      10.0.0.0/24
      !staging.example.com
      !api.example.com
    `;

    const result = parseAndClassifyScope(raw);
    expect(result.inScope.length).toBe(5);
    expect(result.outOfScope.length).toBe(2);
    expect(result.conflicts).toContain('api.example.com');
  });

  it('verifies no feature files directly import mockService', () => {
    const fs = require('fs');
    const path = require('path');

    function scanDir(dir: string, fileList: string[] = []): string[] {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath, fileList);
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          fileList.push(fullPath);
        }
      }
      return fileList;
    }

    const featuresDir = path.resolve(__dirname, '../features');
    const files = scanDir(featuresDir);

    const violatingFiles: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes("from '../../api/mockService'") || 
          content.includes("from '../api/mockService'") ||
          content.includes('from "./mockService"') ||
          content.includes("from '@/api/mockService'")) {
        violatingFiles.push(file);
      }
    }

    expect(violatingFiles).toEqual([]);
  });

  describe('Milestone 2: Application Model Contract Tests', () => {
    const projectId = 'prj_demo';

    it('GET /projects/:id/app-model conforms to Paginated<AppEntity> schema', async () => {
      const res = await fetchJson<Paginated<AppEntity>>(`/projects/${projectId}/app-model`);
      expect(res).toBeDefined();
      expect(Array.isArray(res.items)).toBe(true);
      expect(typeof res.total).toBe('number');
      expect(res.total).toBeGreaterThan(0);
      expect(typeof res.limit).toBe('number');
      expect(typeof res.offset).toBe('number');

      // Verify individual AppEntity schema
      const entity = res.items[0];
      expect(typeof entity.id).toBe('string');
      expect(typeof entity.projectId).toBe('string');
      expect(['application', 'service', 'route', 'input', 'identity', 'technology', 'finding']).toContain(entity.kind);
      expect(typeof entity.name).toBe('string');
      expect(['observed', 'tentative', 'confirmed']).toContain(entity.confidence);
      expect(typeof entity.stale).toBe('boolean');
      expect(typeof entity.lastSeen).toBe('string');
      expect(typeof entity.meta).toBe('object');
    });

    it('GET /projects/:id/app-model respects filter query params (kind, stale)', async () => {
      // Filter by kind
      const routeRes = await fetchJson<Paginated<AppEntity>>(`/projects/${projectId}/app-model?kind=route`);
      expect(routeRes.items.length).toBeGreaterThan(0);
      expect(routeRes.items.every(item => item.kind === 'route')).toBe(true);

      // Filter by stale
      const staleRes = await fetchJson<Paginated<AppEntity>>(`/projects/${projectId}/app-model?stale=true`);
      expect(staleRes.items.length).toBeGreaterThan(0);
      expect(staleRes.items.every(item => item.stale === true)).toBe(true);
    });

    it('GET /projects/:id/app-model/graph returns nodes, edges, and truncation info', async () => {
      const graphRes = await fetchJson<AppGraphResponse>(`/projects/${projectId}/app-model/graph`);
      expect(graphRes).toBeDefined();
      expect(Array.isArray(graphRes.entities)).toBe(true);
      expect(Array.isArray(graphRes.edges)).toBe(true);
      expect(typeof graphRes.truncated).toBe('boolean');
      expect(typeof graphRes.totalEntities).toBe('number');

      // Root application check
      const rootApp = graphRes.entities.find(e => e.kind === 'application');
      expect(rootApp).toBeDefined();

      // Edge schema check
      const edge = graphRes.edges[0];
      expect(typeof edge.id).toBe('string');
      expect(typeof edge.sourceId).toBe('string');
      expect(typeof edge.targetId).toBe('string');
      expect(typeof edge.relation).toBe('string');
      expect(typeof edge.trustBoundary).toBe('boolean');

      // Test truncation cap
      const truncatedRes = await fetchJson<AppGraphResponse>(`/projects/${projectId}/app-model/graph?maxNodes=3`);
      expect(truncatedRes.entities.length).toBeLessThanOrEqual(3);
      expect(truncatedRes.truncated).toBe(true);
      expect(truncatedRes.totalEntities).toBeGreaterThan(3);
    });

    it('GET /projects/:id/app-model/entities/:id returns entity detail with edges and notes', async () => {
      const detail = await fetchJson<EntityDetailResponse>(`/projects/${projectId}/app-model/entities/rot_users_me`);
      expect(detail).toBeDefined();
      expect(detail.entity.id).toBe('rot_users_me');
      expect(detail.entity.kind).toBe('route');
      expect(Array.isArray(detail.edges)).toBe(true);
      expect(detail.edges.length).toBeGreaterThan(0);
      expect(Array.isArray(detail.notes)).toBe(true);
    });

    it('POST /projects/:id/app-model/entities/:id/note adds note and persists', async () => {
      const noteContent = 'Verified that GET /v1/users/me checks session cookie correctly.';
      const createdNote = await fetchJson<NoteItem>(`/projects/${projectId}/app-model/entities/rot_users_me/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: noteContent }),
      });

      expect(createdNote).toBeDefined();
      expect(typeof createdNote.id).toBe('number');
      expect(createdNote.content).toBe(noteContent);
      expect(typeof createdNote.createdAt).toBe('string');

      // Re-fetch entity detail and verify note is present
      const detailAfter = await fetchJson<EntityDetailResponse>(`/projects/${projectId}/app-model/entities/rot_users_me`);
      const found = detailAfter.notes.find(n => n.id === createdNote.id);
      expect(found).toBeDefined();
      expect(found?.content).toBe(noteContent);
    });

    it('GET /projects/:id/app-model/export returns summary metrics and graph topology', async () => {
      const exportData = await fetchJson<{ summary: AppModelSummary; graph: AppGraphResponse }>(
        `/projects/${projectId}/app-model/export`
      );
      expect(exportData).toBeDefined();
      expect(exportData.summary).toBeDefined();
      expect(typeof exportData.summary.counts).toBe('object');
      expect(typeof exportData.summary.staleAssets).toBe('number');
      expect(typeof exportData.summary.edges).toBe('number');
      expect(typeof exportData.summary.counts['application']).toBe('number');
      expect(typeof exportData.summary.counts['route']).toBe('number');

      expect(exportData.graph).toBeDefined();
      expect(Array.isArray(exportData.graph.entities)).toBe(true);
      expect(Array.isArray(exportData.graph.edges)).toBe(true);
    });
  });

  describe('Milestone 3: Native HTTP Workbench Contract Tests', () => {
    it('GET /workbench/history conforms to Paginated<CapturedRequest> schema', async () => {
      const res = await fetchJson<Paginated<CapturedRequest>>('/workbench/history?projectId=prj_demo');
      expect(res).toBeDefined();
      expect(Array.isArray(res.items)).toBe(true);
      expect(res.total).toBeGreaterThan(0);
      expect(typeof res.limit).toBe('number');
      expect(typeof res.offset).toBe('number');

      const req = res.items[0];
      expect(typeof req.id).toBe('string');
      expect(typeof req.method).toBe('string');
      expect(typeof req.url).toBe('string');
      expect(typeof req.host).toBe('string');
      expect(typeof req.path).toBe('string');
      expect(typeof req.status).toBe('number');
      expect(typeof req.requestHeaders).toBe('object');
      expect(typeof req.responseHeaders).toBe('object');
      expect(typeof req.sizeBytes).toBe('number');
      expect(typeof req.durationMs).toBe('number');
      expect(typeof req.authContext).toBe('string');
      expect(Array.isArray(req.tags)).toBe(true);
      expect(typeof req.capturedAt).toBe('string');
      expect(typeof req.inScope).toBe('boolean');
    });

    it('GET /workbench/history supports method and scope filters', async () => {
      const postRes = await fetchJson<Paginated<CapturedRequest>>('/workbench/history?method=POST');
      expect(postRes.items.every((r) => r.method === 'POST')).toBe(true);

      const inScopeRes = await fetchJson<Paginated<CapturedRequest>>('/workbench/history?inScopeOnly=true');
      expect(inScopeRes.items.every((r) => r.inScope === true)).toBe(true);
    });

    it('GET /workbench/requests/:id returns full detail with raw wire format', async () => {
      const detail = await fetchJson<RequestDetailResponse>('/workbench/requests/req_demo_01');
      expect(detail).toBeDefined();
      expect(detail.requestId).toBe('req_demo_01');
      expect(detail.request).toBeDefined();
      expect(typeof detail.rawRequest).toBe('string');
      expect(detail.rawRequest).toContain('HTTP/1.1');
      expect(typeof detail.rawResponse).toBe('string');
      expect(typeof detail.truncated).toBe('boolean');
    });

    it('POST /workbench/replay executes mutation and returns response with scope status', async () => {
      const replayRes = await fetchJson<ReplayResult>('/workbench/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req_demo_01',
          patch: {
            path: '/api/v1/invoices/102?tenant=beta',
            header: { 'x-tampered': 'true' },
          },
        }),
      });

      expect(replayRes).toBeDefined();
      expect(replayRes.request).toBeDefined();
      expect(replayRes.response).toBeDefined();
      expect(typeof replayRes.response.status).toBe('number');
      expect(typeof replayRes.response.durationMs).toBe('number');
      expect(replayRes.scope.allowed).toBe(true);
    });

    it('POST /workbench/compare calculates differential lines', async () => {
      const diffRes = await fetchJson<ResponseCompareResponse>('/workbench/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baselineId: 'req_demo_01',
          candidateId: 'req_demo_02',
        }),
      });

      expect(diffRes).toBeDefined();
      expect(typeof diffRes.statusChanged).toBe('boolean');
      expect(typeof diffRes.baselineStatus).toBe('number');
      expect(typeof diffRes.candidateStatus).toBe('number');
      expect(Array.isArray(diffRes.headersDiff)).toBe(true);
      expect(Array.isArray(diffRes.bodyDiff)).toBe(true);
      expect(typeof diffRes.summary).toBe('string');
    });

    it('POST /workbench/evidence saves new evidence item', async () => {
      const evRes = await fetchJson<{ id: string; kind: string; summary: string }>('/workbench/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req_demo_01',
          responseId: 'resp_req_demo_01',
          hypothesisId: 'hyp_01',
          note: 'IDOR proof captured in workbench',
        }),
      });

      expect(evRes).toBeDefined();
      expect(typeof evRes.id).toBe('string');
      expect(evRes.kind).toBe('evidence');
      expect(evRes.summary).toContain('IDOR proof');
    });

    it('POST /workbench/import validates format and returns import ID', async () => {
      const impRes = await fetchJson<{ importId: string; count: number }>('/workbench/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'har',
          path: 'C:/captures/test.har',
        }),
      });

      expect(impRes).toBeDefined();
      expect(typeof impRes.importId).toBe('string');
      expect(typeof impRes.count).toBe('number');
    });

    it('GET /workbench/ca returns Proxy CA status and instructions', async () => {
      const caRes = await fetchJson<CaStatusResponse>('/workbench/ca');
      expect(caRes).toBeDefined();
      expect(typeof caRes.available).toBe('boolean');
      expect(typeof caRes.path).toBe('string');
      expect(typeof caRes.instructions).toBe('string');
    });
  });
});
