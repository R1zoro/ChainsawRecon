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
  AuthProfile,
  AuthDetection,
  AuthSessionStatus,
  ToolRunResponse,
  ProviderItem,
  ProviderHealthResponse,
  ProviderCalibrateResponse,
  OastStatusResponse,
  OastToken,
  OastEvent,
  SessionReport,
  SaveSessionReportResponse,
  ReportExportResponse,
  SavedReportItem,
  ProjectArchiveItem,
  CreateArchiveResponse,
} from '../api/types';

describe('Frontend API Contract & Fixture Conformance', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
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

    it('POST /workbench/ca generates CA and returns available status', async () => {
      const genRes = await fetchJson<CaStatusResponse>('/workbench/ca', {
        method: 'POST',
      });
      expect(genRes).toBeDefined();
      expect(genRes.available).toBe(true);
      expect(genRes.path).toContain('ca.crt');
      expect(genRes.instructions).toBeDefined();
    });

    it('GET /workbench/proxy/status returns proxy status schema', async () => {
      const status = await fetchJson<any>('/workbench/proxy/status?projectId=prj_demo');
      expect(status).toBeDefined();
      expect(typeof status.running).toBe('boolean');
      expect(status.projectId).toBe('prj_demo');
      expect(typeof status.captured).toBe('number');
    });

    it('POST /workbench/proxy/start and POST /workbench/proxy/stop manage proxy lifecycle', async () => {
      const startRes = await fetchJson<any>('/workbench/proxy/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'prj_demo', port: 8080, verifyUpstream: true }),
      });
      expect(startRes).toBeDefined();
      expect(startRes.running).toBe(true);
      expect(startRes.proxyUrl).toBe('http://127.0.0.1:8080');

      const stopRes = await fetchJson<any>('/workbench/proxy/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'prj_demo' }),
      });
      expect(stopRes).toBeDefined();
      expect(stopRes.running).toBe(false);
    });
  });

  // ── Milestone 4: Findings Contract Tests ───────────────────────
  describe('Milestone 4: Security Findings Endpoints', () => {
    it('GET /findings returns paginated finding items with schema invariants', async () => {
      const res = await fetchJson<Paginated<any>>('/findings?projectId=prj_demo');
      expect(res).toBeDefined();
      expect(Array.isArray(res.items)).toBe(true);
      expect(res.total).toBeGreaterThanOrEqual(1);

      const finding = res.items[0];
      expect(typeof finding.id).toBe('string');
      expect(typeof finding.title).toBe('string');
      expect(typeof finding.vrt).toBe('string');
      expect(['critical', 'high', 'medium', 'low', 'info']).toContain(finding.severity);
      expect(['candidate', 'validated', 'rejected', 'observed', 'suspected', 'experiment_planned', 'reproduced', 'deferred', 'blocked']).toContain(finding.state);
      expect(typeof finding.asset).toBe('string');
      expect(Array.isArray(finding.evidenceIds)).toBe(true);
      expect(finding.gate).toBeDefined();
      expect(Array.isArray(finding.gate.questions)).toBe(true);
    });

    it('GET /findings/{id} returns finding detail and linked evidence array', async () => {
      const res = await fetchJson<{ finding: any; evidence: any[] }>('/findings/fnd_demo_01');
      expect(res).toBeDefined();
      expect(res.finding).toBeDefined();
      expect(res.finding.id).toBe('fnd_demo_01');
      expect(Array.isArray(res.evidence)).toBe(true);
      expect(res.finding.securityQuestion).toBeDefined();
      expect(res.finding.impact).toBeDefined();
      expect(res.finding.remediation).toBeDefined();
      expect(res.finding.lineage).toBeDefined();
    });

    it('POST /findings/{id}/transition validates finding with recorded evidence', async () => {
      const res = await fetchJson<any>('/findings/fnd_demo_01/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: 'validated',
          reason: 'Independent verification confirmed by lead auditor',
        }),
      });

      expect(res).toBeDefined();
      expect(res.state).toBe('validated');
      expect(res.lineage.validatedBy).toBeDefined();
    });

    it('POST /findings/{id}/transition refuses promotion to validated when zero evidence is attached', async () => {
      try {
        await fetchJson<any>('/findings/fnd_demo_03/transition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: 'validated',
            reason: 'Premature validation without evidence',
          }),
        });
        expect.fail('Should have refused validation without evidence');
      } catch (err: unknown) {
        expect(isApiError(err)).toBe(true);
        if (isApiError(err)) {
          expect(err.message).toContain('at least one recorded evidence id');
        }
      }
    });

    it('POST /findings/{id}/transition refuses reject transition when reason is empty', async () => {
      try {
        await fetchJson<any>('/findings/fnd_demo_01/transition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: 'rejected',
            reason: '   ', // whitespace only
          }),
        });
        expect.fail('Should have refused rejection without reason');
      } catch (err: unknown) {
        expect(isApiError(err)).toBe(true);
        if (isApiError(err)) {
          expect(err.message).toContain('requires a non-empty reason');
        }
      }
    });

    it('POST /findings/{id}/transition transitions to rejected with valid reason', async () => {
      const res = await fetchJson<any>('/findings/fnd_demo_01/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: 'rejected',
          reason: 'Asset is out of engagement scope',
        }),
      });

      expect(res).toBeDefined();
      expect(res.state).toBe('rejected');
    });

    it('GET /findings/{id} returns evidenceBindings and evidenceVersion', async () => {
      const res = await fetchJson<{ finding: any; evidence: any[]; evidenceBindings: any[] }>('/findings/fnd_demo_01');
      expect(res.finding).toBeDefined();
      expect(typeof res.finding.evidenceVersion).toBe('number');
      expect(Array.isArray(res.evidenceBindings)).toBe(true);
      expect(res.evidenceBindings.length).toBeGreaterThan(0);
      expect(res.evidenceBindings[0].role).toBe('proof');
    });

    it('POST /findings/{id}/evidence binds evidence with role and note, incrementing evidenceVersion', async () => {
      const initial = await fetchJson<{ finding: any }>('/findings/fnd_demo_01');
      const prevVersion = initial.finding.evidenceVersion ?? 0;

      const bindRes = await fetchJson<{ items: any[]; total: number }>('/findings/fnd_demo_01/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evidenceId: 'evd_control_baseline',
          role: 'baseline',
          note: 'Baseline comparison payload',
          position: 1,
        }),
      });

      expect(bindRes.items).toBeDefined();
      const boundItem = bindRes.items.find((item: any) => item.evidenceId === 'evd_control_baseline');
      expect(boundItem).toBeDefined();
      expect(boundItem.role).toBe('baseline');
      expect(boundItem.note).toBe('Baseline comparison payload');

      const updated = await fetchJson<{ finding: any }>('/findings/fnd_demo_01');
      expect(updated.finding.evidenceVersion).toBe(prevVersion + 1);
    });

    it('POST /findings/{id}/evidence rejects unrecorded evidenceId with BAD_REQUEST', async () => {
      try {
        await fetchJson('/findings/fnd_demo_01/evidence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            evidenceId: 'unrecorded_fake_id_999',
            role: 'supporting',
          }),
        });
        expect.fail('Should have rejected unrecorded evidence');
      } catch (err: unknown) {
        expect(isApiError(err)).toBe(true);
        if (isApiError(err)) {
          expect(err.message).toContain('evidence not recorded');
        }
      }
    });

    it('POST /findings/{id}/evidence/order reorders evidence and updates positions', async () => {
      // First bind a second evidence item so we have 2 items to reorder
      await fetchJson('/findings/fnd_demo_01/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evidenceId: 'evd_control_baseline',
          role: 'baseline',
          position: 1,
        }),
      });

      const initial = await fetchJson<{ finding: any }>('/findings/fnd_demo_01');
      const prevVersion = initial.finding.evidenceVersion ?? 0;

      const reorderRes = await fetchJson<{ items: any[] }>('/findings/fnd_demo_01/evidence/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evidenceIds: ['evd_control_baseline', 'evd_idor_payload'],
        }),
      });

      expect(reorderRes.items[0].evidenceId).toBe('evd_control_baseline');
      expect(reorderRes.items[0].position).toBe(0);
      expect(reorderRes.items[1].evidenceId).toBe('evd_idor_payload');
      expect(reorderRes.items[1].position).toBe(1);

      const updated = await fetchJson<{ finding: any }>('/findings/fnd_demo_01');
      expect(updated.finding.evidenceVersion).toBe(prevVersion + 1);
    });

    it('DELETE /findings/{id}/evidence/{evidenceId} unbinds evidence and updates finding', async () => {
      // First bind evd_control_baseline so we can unbind it
      await fetchJson('/findings/fnd_demo_01/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evidenceId: 'evd_control_baseline',
          role: 'baseline',
          position: 1,
        }),
      });

      const initial = await fetchJson<{ finding: any }>('/findings/fnd_demo_01');
      const prevVersion = initial.finding.evidenceVersion ?? 0;

      const deleteRes = await fetchJson<{ items: any[] }>('/findings/fnd_demo_01/evidence/evd_control_baseline', {
        method: 'DELETE',
      });

      expect(deleteRes.items.some((item: any) => item.evidenceId === 'evd_control_baseline')).toBe(false);

      const updated = await fetchJson<{ finding: any }>('/findings/fnd_demo_01');
      expect(updated.finding.evidenceVersion).toBe(prevVersion + 1);
      expect(updated.finding.evidenceIds).not.toContain('evd_control_baseline');
    });
  });

  // ── Milestone 2.5: Coverage-Aware Sitemap (Atlas) Contract ──────
  describe('Milestone 2.5: Coverage-Aware Sitemap (Atlas) Contract', () => {
    const projectId = 'prj_demo';

    it('GET /projects/:id/app-model/sitemap returns hierarchical tree, stats, and coverage summary', async () => {
      const sitemap = await fetchJson<any>(`/projects/${projectId}/app-model/sitemap`);
      expect(sitemap).toBeDefined();
      expect(Array.isArray(sitemap.roots)).toBe(true);
      expect(sitemap.roots.length).toBeGreaterThan(0);

      // Hierarchical structure: Application -> Service -> Route -> Input
      const rootAppNode = sitemap.roots[0];
      expect(rootAppNode.entity.kind).toBe('application');
      expect(Array.isArray(rootAppNode.children)).toBe(true);

      const serviceNode = rootAppNode.children[0];
      expect(serviceNode.entity.kind).toBe('service');
      expect(Array.isArray(serviceNode.children)).toBe(true);

      const routeNode = serviceNode.children.find((c: any) => c.entity.kind === 'route');
      expect(routeNode).toBeDefined();
      expect(routeNode.entity.coverage).toBeDefined();
      expect(typeof routeNode.entity.coverage.tested).toBe('boolean');
      expect(typeof routeNode.entity.coverage.outcomes).toBe('object');

      // Side entities check
      expect(sitemap.sideEntities).toBeDefined();
      expect(Array.isArray(sitemap.sideEntities.identities)).toBe(true);
      expect(Array.isArray(sitemap.sideEntities.technologies)).toBe(true);
      expect(Array.isArray(sitemap.sideEntities.flows)).toBe(true);
      expect(Array.isArray(sitemap.sideEntities.findings)).toBe(true);

      // Coverage Ribbon Stats
      expect(sitemap.stats).toBeDefined();
      expect(typeof sitemap.stats.inScope).toBe('number');
      expect(typeof sitemap.stats.tested).toBe('number');
      expect(typeof sitemap.stats.untested).toBe('number');
      expect(typeof sitemap.stats.findings).toBe('number');
      expect(typeof sitemap.stats.coverageGaps).toBe('number');

      // Summary
      expect(sitemap.coverage).toBeDefined();
      expect(typeof sitemap.coverage.entries).toBe('number');
      expect(Array.isArray(sitemap.coverage.gaps)).toBe(true);
    });

    it('GET /projects/:id/app-model/coverage returns coverage entries, stats, and verification gaps', async () => {
      const cov = await fetchJson<any>(`/projects/${projectId}/app-model/coverage`);
      expect(cov).toBeDefined();
      expect(Array.isArray(cov.entries)).toBe(true);
      expect(typeof cov.tested).toBe('number');
      expect(typeof cov.outcomes).toBe('object');
      expect(Array.isArray(cov.gaps)).toBe(true);

      // Gaps verification check (absence of evidence on no_issue_found constitutes a gap)
      const missingEvidenceGap = cov.gaps.find((g: any) => g.kind === 'missing_evidence');
      expect(missingEvidenceGap).toBeDefined();
      expect(missingEvidenceGap.entityId).toBeDefined();
    });

    it('POST /projects/:id/app-model/entities/:id/coverage records new coverage entry and validates fields', async () => {
      const payload = {
        riskArea: 'idor',
        outcome: 'no_issue_found',
        surface: 'GET /v1/users/{id}',
        evidenceId: 'evd_test_contract_01',
        reason: 'Verified tenant-isolation barrier returns 403 on foreign tenant ID',
        worker: 'contract_tester',
      };

      const res = await fetchJson<any>(`/projects/${projectId}/app-model/entities/rot_users_id/coverage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res).toBeDefined();
      expect(res.id).toBeDefined();
      expect(res.entityId).toBe('rot_users_id');
      expect(res.riskArea).toBe('idor');
      expect(res.outcome).toBe('no_issue_found');
      expect(res.evidenceId).toBe('evd_test_contract_01');

      // Verify validation: invalid outcome throws 400
      try {
        await fetchJson<any>(`/projects/${projectId}/app-model/entities/rot_users_id/coverage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            riskArea: 'sqli',
            outcome: 'invalid_outcome_choice',
          }),
        });
        expect.fail('Should have rejected invalid coverage outcome');
      } catch (err: unknown) {
        expect(isApiError(err)).toBe(true);
        if (isApiError(err)) {
          expect(err.message).toContain('coverage outcome must be one of');
        }
      }

      // Verify validation: missing riskArea throws 400
      try {
        await fetchJson<any>(`/projects/${projectId}/app-model/entities/rot_users_id/coverage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            riskArea: '   ',
            outcome: 'no_issue_found',
          }),
        });
        expect.fail('Should have rejected missing riskArea');
      } catch (err: unknown) {
        expect(isApiError(err)).toBe(true);
        if (isApiError(err)) {
          expect(err.message).toContain('riskArea is required');
        }
      }
    });
  });

  describe('Milestone 5: Auth Profiles, Tool Agent & Web UI Provider Contract Tests', () => {
    const projectId = 'prj_demo';
    const sessionId = 'ses_active_01';

    it('POST /projects/:id/auth/detect returns AuthDetection contract', async () => {
      const res = await fetchJson<AuthDetection>(`/projects/${projectId}/auth/detect`, {
        method: 'POST',
      });
      expect(res).toBeDefined();
      expect(Array.isArray(res.mechanisms)).toBe(true);
      expect(res.botProtection).toBeDefined();
      expect(typeof res.botProtection.detected).toBe('boolean');
      expect(Array.isArray(res.loginCandidates)).toBe(true);
      expect(['auto', 'http_form', 'http_json', 'browser', 'headers', 'operator']).toContain(
        res.recommendedAdapter
      );
    });

    it('GET & POST /projects/:id/auth/profiles conform to AuthProfile schema', async () => {
      const listRes = await fetchJson<Paginated<AuthProfile>>(`/projects/${projectId}/auth/profiles`);
      expect(listRes).toBeDefined();
      expect(Array.isArray(listRes.items)).toBe(true);

      const created = await fetchJson<AuthProfile>(`/projects/${projectId}/auth/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Contract Test Profile',
          identity: 'test@example.com',
          role: 'analyst',
          tenant: 't_contract',
          adapter: 'http_form',
          persistence: 'session_only',
        }),
      });

      expect(created.id).toBeDefined();
      expect(created.label).toBe('Contract Test Profile');
      expect(created.adapter).toBe('http_form');
      expect(created.session).toBeDefined();
      expect(created.session.status).toBe('none');
    });

    it('POST login, GET session, POST verify, and POST logout cycle correctly', async () => {
      // 1. Login
      const loginRes = await fetchJson<AuthSessionStatus>(
        `/projects/${projectId}/auth/profiles/auth_admin_01/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'admin',
            password: 'secretpassword',
            adapter: 'http_form',
          }),
        }
      );
      expect(loginRes.status).toBe('active');
      expect(loginRes.profileId).toBe('auth_admin_01');

      // 2. Fetch session
      const sessionRes = await fetchJson<AuthSessionStatus>(
        `/projects/${projectId}/auth/profiles/auth_admin_01/session`
      );
      expect(sessionRes.status).toBe('active');

      // 3. Verify session
      const verifyRes = await fetchJson<AuthSessionStatus & { reason?: string }>(
        `/projects/${projectId}/auth/profiles/auth_admin_01/verify`,
        { method: 'POST' }
      );
      expect(verifyRes.status).toBe('active');
      expect(verifyRes.reason).toBeDefined();

      // 4. Logout
      const logoutRes = await fetchJson<{ profileId: string; status: string }>(
        `/projects/${projectId}/auth/profiles/auth_admin_01/logout`,
        { method: 'POST' }
      );
      expect(logoutRes.status).toBe('none');
    });

    it('DELETE /projects/:id/auth/profiles/:profileId removes the profile', async () => {
      const created = await fetchJson<AuthProfile>(`/projects/${projectId}/auth/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'To Delete Profile' }),
      });

      await fetchJson(`/projects/${projectId}/auth/profiles/${created.id}`, {
        method: 'DELETE',
      });

      const listAfter = await fetchJson<Paginated<AuthProfile>>(`/projects/${projectId}/auth/profiles`);
      expect(listAfter.items.some((p) => p.id === created.id)).toBe(false);
    });

    it('POST /sessions/:id/tool-run executes tool agent and returns ToolRunResponse', async () => {
      const res = await fetchJson<ToolRunResponse>(`/sessions/${sessionId}/tool-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Replay target and verify boundaries',
          maxSteps: 8,
          noiseProfile: 'balanced',
        }),
      });

      expect(res.sessionId).toBe(sessionId);
      expect(res.status).toBe('completed');
      expect(typeof res.finalText).toBe('string');
      expect(res.steps).toBeGreaterThan(0);
      expect(Array.isArray(res.toolCalls)).toBe(true);
      expect(res.toolCalls[0].name).toBeDefined();
    });

    it('POST /providers creates a Web UI provider and tests health and calibration', async () => {
      const newProvider = await fetchJson<ProviderItem>('/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'ChatGPT Contract Web',
          type: 'webui',
          engine: 'ChatGPT',
          baseUrl: 'https://chatgpt.com',
          profileDir: '~/.chainsaw/webui/profiles/contract',
          headless: false,
        }),
      });

      expect(newProvider.id).toBeDefined();
      expect(newProvider.name).toBe('ChatGPT Contract Web');
      expect(newProvider.type).toBe('webui');

      // Health check
      const health = await fetchJson<ProviderHealthResponse>(`/providers/${newProvider.id}/health`);
      expect(health.ok).toBe(true);
      expect(health.loggedIn).toBe(true);

      // Calibrate check
      const calibrate = await fetchJson<ProviderCalibrateResponse>(
        `/providers/${newProvider.id}/calibrate`,
        { method: 'POST' }
      );
      expect(calibrate.counts).toBeDefined();
      expect(typeof calibrate.hasPassword).toBe('boolean');
    });

    it('OAST endpoints conform to schema: status, start, tokens, events, stop', async () => {
      // 1. GET /projects/:id/oast/status
      const status = await fetchJson<OastStatusResponse>(`/projects/${projectId}/oast/status`);
      expect(status.projectId).toBe(projectId);
      expect(typeof status.running).toBe('boolean');

      // 2. POST /projects/:id/oast/start
      const startRes = await fetchJson<OastStatusResponse>(`/projects/${projectId}/oast/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '127.0.0.1', port: 0, dnsPort: 0, dnsDomain: 'oast.local' }),
      });
      expect(startRes.running).toBe(true);
      expect(startRes.url).toBeDefined();
      expect(startRes.dnsDomain).toBe('oast.local');
      expect(typeof startRes.dnsPort).toBe('number');

      // 3. POST /projects/:id/oast/tokens
      const token = await fetchJson<OastToken>(`/projects/${projectId}/oast/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'SSRF Verification Token' }),
      });
      expect(token.token).toBeDefined();
      expect(token.url).toContain(token.token);
      expect(token.dnsName).toBeDefined();
      expect(token.dnsName).toContain(token.token);
      expect(token.dnsName).toContain('oast.local');
      expect(token.note).toBe('SSRF Verification Token');
      expect(typeof token.hits).toBe('number');

      // 4. GET /projects/:id/oast/tokens
      const tokensList = await fetchJson<Paginated<OastToken>>(`/projects/${projectId}/oast/tokens`);
      expect(Array.isArray(tokensList.items)).toBe(true);
      expect(tokensList.items.some((t) => t.token === token.token)).toBe(true);

      // 5. GET /projects/:id/oast/events
      const eventsList = await fetchJson<Paginated<OastEvent>>(`/projects/${projectId}/oast/events`);
      expect(Array.isArray(eventsList.items)).toBe(true);

      // 6. POST /projects/:id/oast/stop
      const stopRes = await fetchJson<OastStatusResponse>(`/projects/${projectId}/oast/stop`, {
        method: 'POST',
      });
      expect(stopRes.running).toBe(false);

      // 7. Verify creating token while stopped returns CONFLICT (409)
      try {
        await fetchJson<OastToken>(`/projects/${projectId}/oast/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: 'Should fail' }),
        });
        expect.unreachable('Should have thrown CONFLICT');
      } catch (err) {
        expect(isApiError(err)).toBe(true);
        if (isApiError(err)) {
          expect(err.code).toBe('CONFLICT');
        }
      }
    });
  });

  // ── Milestone 6: Reports & Export Endpoints Contract ─────────────
  describe('Milestone 6: Reports & Export Endpoints Contract', () => {
    const sessionId = 'ses_demo_01';

    it('GET /sessions/:id/report returns structured session assessment report', async () => {
      const report = await fetchJson<SessionReport>(`/sessions/${sessionId}/report`);
      expect(report).toBeDefined();
      expect(report.projectId).toBeDefined();
      expect(report.sessionId).toBe(sessionId);
      expect(report.markdown).toBeDefined();
      expect(Array.isArray(report.findings)).toBe(true);
      expect(report.coverage).toBeDefined();
      expect(Array.isArray(report.coverage.gaps)).toBe(true);
    });

    it('GET /sessions/:id/report/export exports report in markdown, html, and json formats', async () => {
      // 1. Markdown
      const mdRes = await fetchJson<ReportExportResponse>(`/sessions/${sessionId}/report/export?format=markdown`);
      expect(mdRes.format).toBe('markdown');
      expect(mdRes.contentType).toContain('text/markdown');
      expect(mdRes.content).toContain('Security Assessment');

      // 2. HTML
      const htmlRes = await fetchJson<ReportExportResponse>(`/sessions/${sessionId}/report/export?format=html`);
      expect(htmlRes.format).toBe('html');
      expect(htmlRes.contentType).toContain('text/html');
      expect(htmlRes.content).toContain('<!doctype html>');
      expect(htmlRes.content).toContain('Security Assessment');

      // 3. JSON
      const jsonRes = await fetchJson<ReportExportResponse>(`/sessions/${sessionId}/report/export?format=json`);
      expect(jsonRes.format).toBe('json');
      expect(jsonRes.contentType).toContain('application/json');
      const parsed = JSON.parse(jsonRes.content);
      expect(parsed.sessionId).toBe(sessionId);
      expect(Array.isArray(parsed.findings)).toBe(true);
    });

    it('GET /sessions/:id/report/export rejects unsupported format (e.g. pdf)', async () => {
      try {
        await fetchJson(`/sessions/${sessionId}/report/export?format=pdf`);
        expect.unreachable('Should have rejected format=pdf');
      } catch (err) {
        expect(isApiError(err)).toBe(true);
        if (isApiError(err)) {
          expect(err.message).toContain('format must be markdown, html, or json');
        }
      }
    });

    it('POST /sessions/:id/reports saves report and GET downloads the saved file', async () => {
      const saved = await fetchJson<SaveSessionReportResponse>(`/sessions/${sessionId}/reports`, {
        method: 'POST',
      });
      expect(saved.artifactId).toBeDefined();
      expect(saved.artifactId).toContain('.chainsaw/artifacts/report-');

      const reportsList = await fetchJson<Paginated<SavedReportItem>>(`/sessions/${sessionId}/reports`);
      expect(reportsList.items.length).toBeGreaterThan(0);
      const latest = reportsList.items[0];

      const downloaded = await fetchJson<{ filename: string; content: string; contentType: string }>(
        `/sessions/${sessionId}/reports/${latest.name}`
      );
      expect(downloaded.filename).toBe(latest.name);
      expect(downloaded.contentType).toContain('text/markdown');
      expect(downloaded.content).toBeDefined();
    });
  });

  // ── Milestone 8: Project Archives Contract ──────────────────
  describe('Milestone 8: Project Archives Contract', () => {
    const projectId = 'prj_demo';

    it('GET /projects/:id/archives conforms to paginated ProjectArchiveItem schema', async () => {
      const data = await fetchJson<Paginated<ProjectArchiveItem>>(`/projects/${projectId}/archives`);
      expect(data).toHaveProperty('items');
      expect(data).toHaveProperty('total');
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThan(0);

      const archive = data.items[0];
      expect(archive.name).toMatch(/^archive-.*\.zip$/);
      expect(typeof archive.path).toBe('string');
      expect(typeof archive.sizeBytes).toBe('number');
      expect(typeof archive.createdAt).toBe('string');
    });

    it('POST /projects/:id/archive creates archive and returns sha256 and fileCount', async () => {
      const created = await fetchJson<CreateArchiveResponse>(`/projects/${projectId}/archive`, {
        method: 'POST',
        body: JSON.stringify({ includeWorkspace: true }),
      });
      expect(created.projectId).toBe(projectId);
      expect(created.name).toMatch(/^archive-.*\.zip$/);
      expect(created.includeWorkspace).toBe(true);
      expect(created.fileCount).toBeGreaterThan(0);
      expect(created.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(typeof created.sizeBytes).toBe('number');
      expect(typeof created.createdAt).toBe('string');

      // Verify it appears in the archives list
      const list = await fetchJson<Paginated<ProjectArchiveItem>>(`/projects/${projectId}/archives`);
      expect(list.items.some((a) => a.name === created.name)).toBe(true);
    });

    it('GET /projects/:id/archives/:filename downloads archive artifact', async () => {
      const list = await fetchJson<Paginated<ProjectArchiveItem>>(`/projects/${projectId}/archives`);
      const target = list.items[0];
      const blob = await fetchJson<Blob>(`/projects/${projectId}/archives/${target.name}`);
      expect(blob).toBeDefined();
    });
  });
});
