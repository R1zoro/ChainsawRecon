import { 
  HomeDataResponse, 
  ProjectSummary, 
  ProviderItem, 
  ProjectCreatePayload, 
  ActiveSessionSummary, 
  JournalEvent, 
  JournalResponse,
  Paginated,
  TaskItem,
  ApprovalItem,
  EvidenceItem,
  ProjectScopeResponse,
  SessionContextResponse,
  AppEntity,
  AppEdge,
  AppGraphResponse,
  EntityDetailResponse,
  NoteItem,
  AppModelSummary,
  CapturedRequest,
  RequestDetailResponse,
  ReplayPayload,
  ReplayResult,
  ResponseCompareResponse,
  CreateEvidencePayload,
  CaStatusResponse,
} from './types';
import { initialMockProjects, mockRecentActivity, mockProviders } from './mockData';
import { ApiError } from './client';

export type MockServiceMode = 'healthy' | 'empty' | 'error' | 'partial' | 'disconnected';

let currentMode: MockServiceMode = 'healthy';
let activeProjects: ProjectSummary[] = [...initialMockProjects];

const initialMockApprovals: ApprovalItem[] = [
  {
    id: 'appr_01',
    taskId: 'tsk_idor_01',
    kind: 'intrusive',
    title: 'Run Active IDOR Payload Sweep',
    detail: 'Attempt automated parameter tampering on /v1/users/{id} for cross-tenant accounts.',
    risk: 'high',
    status: 'pending',
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    expiresAt: null,
  },
];

const initialMockEvidence: EvidenceItem[] = [
  {
    id: 'evd_idor_payload',
    kind: 'evidence',
    summary: 'GET /v1/users/usr_100 returned 200 with tenant_beta data.',
    artifactId: 'ART-001',
    hash: 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
    hypothesisId: 'hyp_01',
    taskId: 'tsk_idor_01',
    promoted: 1,
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
];

const initialMockTasks: TaskItem[] = [
  {
    id: 'tsk_idor_01',
    kind: 'sweep',
    title: 'IDOR verification sweep',
    status: 'leased',
    target: 'https://api.example.com/v1/users',
    risk: 'read-only',
    objective: 'Test authorization boundary for cross-tenant data leakage',
    attempts: 1,
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  },
];

let mockApprovals: ApprovalItem[] = JSON.parse(JSON.stringify(initialMockApprovals));
let mockEvidence: EvidenceItem[] = JSON.parse(JSON.stringify(initialMockEvidence));
let mockTasks: TaskItem[] = JSON.parse(JSON.stringify(initialMockTasks));

// ── Milestone 2 Mock App Model Fixtures ──────────────────────────

const initialMockEntities: AppEntity[] = [
  {
    id: 'app_acme',
    projectId: 'prj_demo',
    kind: 'application',
    name: 'Acme Cloud Platform',
    revision: 1,
    confidence: 'confirmed',
    firstSeen: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['application', 'core', 'saas'],
    meta: {
      domains: ['example.com', 'api.example.com', 'app.example.com'],
      environment: 'production',
    },
  },
  {
    id: 'srv_api',
    projectId: 'prj_demo',
    kind: 'service',
    name: 'api.example.com',
    revision: 1,
    confidence: 'confirmed',
    firstSeen: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['service', 'api', 'gateway'],
    meta: {
      host: 'api.example.com',
      port: 443,
      tls: true,
      url: 'https://api.example.com',
    },
  },
  {
    id: 'srv_app',
    projectId: 'prj_demo',
    kind: 'service',
    name: 'app.example.com',
    revision: 1,
    confidence: 'confirmed',
    firstSeen: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['service', 'frontend'],
    meta: {
      host: 'app.example.com',
      port: 443,
      tls: true,
      url: 'https://app.example.com',
    },
  },
  {
    id: 'rot_users_me',
    projectId: 'prj_demo',
    kind: 'route',
    name: 'GET /v1/users/me',
    revision: 2,
    confidence: 'observed',
    firstSeen: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['route', 'authz', 'profile'],
    meta: {
      method: 'GET',
      path: '/v1/users/me',
      host: 'api.example.com',
      authBoundary: true,
      statusCodes: [200, 401],
      contentTypes: ['application/json'],
    },
  },
  {
    id: 'rot_auth_login',
    projectId: 'prj_demo',
    kind: 'route',
    name: 'POST /v1/auth/login',
    revision: 1,
    confidence: 'confirmed',
    firstSeen: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['route', 'auth', 'public'],
    meta: {
      method: 'POST',
      path: '/v1/auth/login',
      host: 'api.example.com',
      authBoundary: false,
      statusCodes: [200, 400, 401, 429],
      contentTypes: ['application/json'],
    },
  },
  {
    id: 'rot_users_id',
    projectId: 'prj_demo',
    kind: 'route',
    name: 'GET /v1/users/{id}',
    revision: 3,
    confidence: 'observed',
    firstSeen: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['route', 'idor', 'privileged'],
    meta: {
      method: 'GET',
      path: '/v1/users/{id}',
      host: 'api.example.com',
      authBoundary: true,
      statusCodes: [200, 403, 404],
      contentTypes: ['application/json'],
    },
  },
  {
    id: 'rot_billing_invoices',
    projectId: 'prj_demo',
    kind: 'route',
    name: 'GET /v1/billing/invoices',
    revision: 1,
    confidence: 'observed',
    firstSeen: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['route', 'financial'],
    meta: {
      method: 'GET',
      path: '/v1/billing/invoices',
      host: 'api.example.com',
      authBoundary: true,
      statusCodes: [200, 403],
      contentTypes: ['application/json'],
    },
  },
  {
    id: 'rot_legacy_export',
    projectId: 'prj_demo',
    kind: 'route',
    name: 'POST /v1/export/dump',
    revision: 1,
    confidence: 'tentative',
    firstSeen: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
    stale: true,
    tags: ['route', 'legacy', 'deprecated'],
    meta: {
      method: 'POST',
      path: '/v1/export/dump',
      host: 'api.example.com',
      authBoundary: true,
      statusCodes: [410, 500],
      contentTypes: ['application/octet-stream'],
    },
  },
  {
    id: 'inp_user_id',
    projectId: 'prj_demo',
    kind: 'input',
    name: 'id',
    revision: 1,
    confidence: 'observed',
    firstSeen: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['input', 'path'],
    meta: {
      routeId: 'rot_users_id',
      location: 'path',
      type: 'string',
      example: 'usr_99',
    },
  },
  {
    id: 'inp_tenant_header',
    projectId: 'prj_demo',
    kind: 'input',
    name: 'X-Tenant-ID',
    revision: 1,
    confidence: 'observed',
    firstSeen: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['input', 'header'],
    meta: {
      routeId: 'rot_users_id',
      location: 'header',
      type: 'string',
      example: 'ten_alpha',
    },
  },
  {
    id: 'inp_login_creds',
    projectId: 'prj_demo',
    kind: 'input',
    name: 'credentials',
    revision: 1,
    confidence: 'confirmed',
    firstSeen: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['input', 'body'],
    meta: {
      routeId: 'rot_auth_login',
      location: 'body',
      type: 'object',
      example: '{"username":"user@example.com","password":"***"}',
    },
  },
  {
    id: 'idn_admin',
    projectId: 'prj_demo',
    kind: 'identity',
    name: 'admin@acme.internal',
    revision: 1,
    confidence: 'confirmed',
    firstSeen: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['identity', 'admin', 'privileged'],
    meta: {
      role: 'admin',
      tenant: 'system',
      mechanism: 'session_cookie',
    },
  },
  {
    id: 'idn_member_alpha',
    projectId: 'prj_demo',
    kind: 'identity',
    name: 'alice@tenant-alpha.com',
    revision: 1,
    confidence: 'confirmed',
    firstSeen: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['identity', 'member', 'tenant_alpha'],
    meta: {
      role: 'member',
      tenant: 'ten_alpha',
      mechanism: 'bearer_token',
    },
  },
  {
    id: 'tech_fastapi',
    projectId: 'prj_demo',
    kind: 'technology',
    name: 'FastAPI',
    revision: 1,
    confidence: 'observed',
    firstSeen: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['technology', 'framework', 'python'],
    meta: {
      category: 'web_framework',
      version: '0.115.4',
    },
  },
  {
    id: 'tech_postgres',
    projectId: 'prj_demo',
    kind: 'technology',
    name: 'PostgreSQL',
    revision: 1,
    confidence: 'observed',
    firstSeen: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['technology', 'database', 'sql'],
    meta: {
      category: 'database',
      version: '16.2',
    },
  },
  {
    id: 'fnd_idor_candidate',
    projectId: 'prj_demo',
    kind: 'finding',
    name: 'Broken Object Level Authorization (IDOR) on /v1/users/{id}',
    revision: 1,
    confidence: 'tentative',
    firstSeen: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    stale: false,
    tags: ['finding', 'idor', 'high'],
    meta: {
      severity: 'high',
      state: 'candidate',
      asset: 'rot_users_id',
      cvss: 8.6,
    },
  },
];

const initialMockEdges: AppEdge[] = [
  {
    id: 'edg_app_srv_api',
    sourceId: 'app_acme',
    targetId: 'srv_api',
    relation: 'exposes',
    confidence: 'confirmed',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_app_srv_app',
    sourceId: 'app_acme',
    targetId: 'srv_app',
    relation: 'exposes',
    confidence: 'confirmed',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_srv_rot_users_me',
    sourceId: 'srv_api',
    targetId: 'rot_users_me',
    relation: 'serves',
    confidence: 'observed',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_srv_rot_auth_login',
    sourceId: 'srv_api',
    targetId: 'rot_auth_login',
    relation: 'serves',
    confidence: 'confirmed',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_srv_rot_users_id',
    sourceId: 'srv_api',
    targetId: 'rot_users_id',
    relation: 'serves',
    confidence: 'observed',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_srv_rot_billing',
    sourceId: 'srv_api',
    targetId: 'rot_billing_invoices',
    relation: 'serves',
    confidence: 'observed',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_srv_rot_legacy',
    sourceId: 'srv_api',
    targetId: 'rot_legacy_export',
    relation: 'serves',
    confidence: 'tentative',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_rot_inp_id',
    sourceId: 'rot_users_id',
    targetId: 'inp_user_id',
    relation: 'accepts',
    confidence: 'observed',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_rot_inp_tenant',
    sourceId: 'rot_users_id',
    targetId: 'inp_tenant_header',
    relation: 'accepts',
    confidence: 'observed',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_rot_inp_creds',
    sourceId: 'rot_auth_login',
    targetId: 'inp_login_creds',
    relation: 'accepts',
    confidence: 'confirmed',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_idn_admin_billing',
    sourceId: 'idn_admin',
    targetId: 'rot_billing_invoices',
    relation: 'authenticates',
    confidence: 'confirmed',
    trustBoundary: true,
    meta: {},
  },
  {
    id: 'edg_idn_alpha_users_me',
    sourceId: 'idn_member_alpha',
    targetId: 'rot_users_me',
    relation: 'authenticates',
    confidence: 'confirmed',
    trustBoundary: true,
    meta: {},
  },
  {
    id: 'edg_idn_alpha_users_id',
    sourceId: 'idn_member_alpha',
    targetId: 'rot_users_id',
    relation: 'authenticates',
    confidence: 'confirmed',
    trustBoundary: true,
    meta: {},
  },
  {
    id: 'edg_app_tech_fastapi',
    sourceId: 'app_acme',
    targetId: 'tech_fastapi',
    relation: 'implements',
    confidence: 'observed',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_app_tech_postgres',
    sourceId: 'app_acme',
    targetId: 'tech_postgres',
    relation: 'implements',
    confidence: 'observed',
    trustBoundary: false,
    meta: {},
  },
  {
    id: 'edg_fnd_rot_users_id',
    sourceId: 'fnd_idor_candidate',
    targetId: 'rot_users_id',
    relation: 'affects',
    confidence: 'tentative',
    trustBoundary: false,
    meta: {},
  },
];

const initialMockNotes: Record<string, NoteItem[]> = {
  rot_users_id: [
    {
      id: 1,
      entityId: 'rot_users_id',
      content: 'Observed response returned 200 with tenant_beta data when logged in as tenant_alpha member.',
      createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    },
  ],
};

let mockEntities: AppEntity[] = JSON.parse(JSON.stringify(initialMockEntities));
let mockEdges: AppEdge[] = JSON.parse(JSON.stringify(initialMockEdges));
let mockNotes: Record<string, NoteItem[]> = JSON.parse(JSON.stringify(initialMockNotes));


const initialMockJournalEvents: Record<string, JournalEvent[]> = {
  ses_demo_01: [
    {
      seq: 1,
      ts: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      sessionId: 'ses_demo_01',
      type: 'session/created',
      actor: 'system',
      turn: 1,
      step: 1,
      refs: {},
      data: { title: 'Acme API authz sweep', mode: 'attack' },
      visibility: 'public',
    },
    {
      seq: 2,
      ts: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
      sessionId: 'ses_demo_01',
      type: 'decision',
      actor: 'orchestrator',
      turn: 1,
      step: 2,
      refs: {},
      data: {
        selectedTaskId: 'tsk_idor_01',
        rationale: 'Initial surface mapping for https://api.example.com',
        nextAction: 'Enumerate authorization endpoints',
        alternatives: ['Passive port sweep', 'Directory fuzzing'],
      },
      visibility: 'public',
    },
    {
      seq: 3,
      ts: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      sessionId: 'ses_demo_01',
      type: 'action/result',
      actor: 'operator',
      turn: 1,
      step: 3,
      refs: { target: 'https://api.example.com/v1/users' },
      data: {
        method: 'GET',
        endpoint: '/v1/users/me',
        tool: 'http_request',
        status: 200,
      },
      visibility: 'public',
    },
    {
      seq: 4,
      ts: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      sessionId: 'ses_demo_01',
      type: 'observation',
      actor: 'operator',
      turn: 1,
      step: 4,
      refs: {},
      data: {
        statement: 'User profile endpoint returned 200 with tenant_alpha identity.',
        status: 200,
        snippet: '{"id":"usr_99","role":"member","tenantId":"ten_alpha"}',
      },
      visibility: 'public',
    },
    {
      seq: 5,
      ts: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      sessionId: 'ses_demo_01',
      type: 'message/user',
      actor: 'operator',
      turn: 2,
      step: 1,
      refs: {},
      data: {
        content: 'Check for BOLA / IDOR on user profile endpoints.',
      },
      visibility: 'public',
    },
    {
      seq: 6,
      ts: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      sessionId: 'ses_demo_01',
      type: 'evidence/recorded',
      actor: 'validator',
      turn: 2,
      step: 2,
      refs: { findingId: 'fnd_idor_01' },
      data: {
        artifactId: 'ART-001',
        evidenceId: 'evd_idor_payload',
        summary: 'GET /v1/users/usr_100 returned 200 with tenant_beta data.',
        hash: 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
      },
      visibility: 'public',
    },
    {
      seq: 7,
      ts: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
      sessionId: 'ses_demo_01',
      type: 'finding/candidate',
      actor: 'validator',
      turn: 2,
      step: 3,
      refs: { findingId: 'fnd_idor_01' },
      data: {
        id: 'fnd_idor_01',
        title: 'Broken Object Level Authorization (IDOR) on /v1/users/{id}',
        severity: 'high',
        state: 'candidate',
      },
      visibility: 'public',
    },
    {
      seq: 8,
      ts: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      sessionId: 'ses_demo_01',
      type: 'approval/requested',
      actor: 'orchestrator',
      turn: 2,
      step: 4,
      refs: { approvalId: 'appr_01' },
      data: {
        id: 'appr_01',
        title: 'Run Active IDOR Payload Sweep',
        detail: 'Attempt automated parameter tampering on /v1/users/{id} for cross-tenant accounts.',
        risk: 'high',
        status: 'pending',
      },
      visibility: 'public',
    },
    {
      seq: 9,
      ts: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      sessionId: 'ses_demo_01',
      type: 'task/leased',
      actor: 'orchestrator',
      turn: 2,
      step: 5,
      refs: { taskId: 'tsk_idor_01' },
      data: {
        taskId: 'tsk_idor_01',
        title: 'IDOR verification sweep',
        status: 'leased',
        target: 'https://api.example.com/v1/users',
      },
      visibility: 'public',
    },
  ],
};

let mockJournalEvents: Record<string, JournalEvent[]> = {
  ses_demo_01: [...initialMockJournalEvents.ses_demo_01],
};

// ── Milestone 3 Mock Workbench Fixtures ─────────────────────────

const initialMockCapturedRequests: CapturedRequest[] = [
  {
    id: 'req_demo_01',
    method: 'GET',
    url: 'https://api.example.com/api/v1/invoices/102',
    host: 'api.example.com',
    path: '/api/v1/invoices/102',
    status: 200,
    requestHeaders: {
      accept: 'application/json',
      cookie: '«redacted»',
      authorization: '«redacted»',
      'user-agent': 'ChainsawRecon/2.0',
    },
    requestBodyPreview: '',
    responseHeaders: {
      'content-type': 'application/json',
      'set-cookie': '«redacted»',
      'x-request-id': 'req_edge_0192',
    },
    responseBodyPreview: '{"id":102,"tenant":"tenant-b","total":4200,"customer":"Globex"}',
    sizeBytes: 184,
    durationMs: 184,
    authContext: 'session:tenant-a',
    tags: ['api', 'object-id', 'idor-suspect'],
    capturedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    inScope: true,
  },
  {
    id: 'req_demo_02',
    method: 'POST',
    url: 'https://api.example.com/api/v1/invoices/102/refund',
    host: 'api.example.com',
    path: '/api/v1/invoices/102/refund',
    status: 403,
    requestHeaders: {
      'content-type': 'application/json',
      cookie: '«redacted»',
      authorization: '«redacted»',
    },
    requestBodyPreview: '{"amount":100}',
    responseHeaders: {
      'content-type': 'application/json',
    },
    responseBodyPreview: '{"error":"forbidden","message":"Cross-tenant refund denied"}',
    sizeBytes: 96,
    durationMs: 142,
    authContext: 'session:tenant-a',
    tags: ['api', 'state-changing', 'authz-denied'],
    capturedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    inScope: true,
  },
  {
    id: 'req_demo_03',
    method: 'DELETE',
    url: 'https://api.example.com/api/v1/users/42',
    host: 'api.example.com',
    path: '/api/v1/users/42',
    status: 204,
    requestHeaders: {
      authorization: '«redacted»',
      'x-requested-with': 'XMLHttpRequest',
    },
    requestBodyPreview: '',
    responseHeaders: {
      'content-length': '0',
    },
    responseBodyPreview: '',
    sizeBytes: 0,
    durationMs: 210,
    authContext: 'session:admin',
    tags: ['api', 'destructive', 'admin-action'],
    capturedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    inScope: true,
  },
  {
    id: 'req_demo_04',
    method: 'GET',
    url: 'https://external-thirdparty.com/callback',
    host: 'external-thirdparty.com',
    path: '/callback',
    status: 302,
    requestHeaders: {
      accept: 'text/html',
      cookie: '«redacted»',
    },
    requestBodyPreview: '',
    responseHeaders: {
      location: 'https://api.example.com/oauth/return',
    },
    responseBodyPreview: '',
    sizeBytes: 0,
    durationMs: 95,
    authContext: 'unauthenticated',
    tags: ['third-party', 'oauth'],
    capturedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    inScope: false,
  },
  {
    id: 'req_demo_05',
    method: 'PUT',
    url: 'https://api.example.com/api/v1/settings/security',
    host: 'api.example.com',
    path: '/api/v1/settings/security',
    status: 200,
    requestHeaders: {
      'content-type': 'application/json',
      authorization: '«redacted»',
    },
    requestBodyPreview: '{"mfa_required":true,"session_timeout":3600}',
    responseHeaders: {
      'content-type': 'application/json',
    },
    responseBodyPreview: '{"status":"updated","mfa_required":true}',
    sizeBytes: 112,
    durationMs: 165,
    authContext: 'session:admin',
    tags: ['settings', 'state-changing'],
    capturedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    inScope: true,
  },
  {
    id: 'req_demo_06',
    method: 'GET',
    url: 'https://api.example.com/api/v1/users/me',
    host: 'api.example.com',
    path: '/api/v1/users/me',
    status: 200,
    requestHeaders: {
      accept: 'application/json',
      cookie: '«redacted»',
      authorization: '«redacted»',
    },
    requestBodyPreview: '',
    responseHeaders: {
      'content-type': 'application/json',
    },
    responseBodyPreview: '{"id":"usr_100","name":"Alice Admin","role":"analyst"}',
    sizeBytes: 156,
    durationMs: 120,
    authContext: 'session:tenant-a',
    tags: ['api', 'session', 'user-info'],
    capturedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    inScope: true,
  },
];

const initialMockRequestDetails: Record<string, RequestDetailResponse> = {
  req_demo_01: {
    requestId: 'req_demo_01',
    request: initialMockCapturedRequests[0],
    rawRequest: 'GET /api/v1/invoices/102 HTTP/1.1\r\nHost: api.example.com\r\nAccept: application/json\r\nCookie: «redacted»\r\nAuthorization: «redacted»\r\nUser-Agent: ChainsawRecon/2.0\r\n\r\n',
    rawResponse: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nSet-Cookie: «redacted»\r\nX-Request-Id: req_edge_0192\r\n\r\n{"id":102,"tenant":"tenant-b","total":4200,"customer":"Globex"}',
    truncated: false,
  },
  req_demo_02: {
    requestId: 'req_demo_02',
    request: initialMockCapturedRequests[1],
    rawRequest: 'POST /api/v1/invoices/102/refund HTTP/1.1\r\nHost: api.example.com\r\nContent-Type: application/json\r\nCookie: «redacted»\r\nAuthorization: «redacted»\r\n\r\n{"amount":100}',
    rawResponse: 'HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\n\r\n{"error":"forbidden","message":"Cross-tenant refund denied"}',
    truncated: false,
  },
  req_demo_03: {
    requestId: 'req_demo_03',
    request: initialMockCapturedRequests[2],
    rawRequest: 'DELETE /api/v1/users/42 HTTP/1.1\r\nHost: api.example.com\r\nAuthorization: «redacted»\r\nX-Requested-With: XMLHttpRequest\r\n\r\n',
    rawResponse: 'HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n',
    truncated: false,
  },
  req_demo_04: {
    requestId: 'req_demo_04',
    request: initialMockCapturedRequests[3],
    rawRequest: 'GET /callback HTTP/1.1\r\nHost: external-thirdparty.com\r\nAccept: text/html\r\nCookie: «redacted»\r\n\r\n',
    rawResponse: 'HTTP/1.1 302 Found\r\nLocation: https://api.example.com/oauth/return\r\n\r\n',
    truncated: false,
  },
  req_demo_05: {
    requestId: 'req_demo_05',
    request: initialMockCapturedRequests[4],
    rawRequest: 'PUT /api/v1/settings/security HTTP/1.1\r\nHost: api.example.com\r\nContent-Type: application/json\r\nAuthorization: «redacted»\r\n\r\n{"mfa_required":true,"session_timeout":3600}',
    rawResponse: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"status":"updated","mfa_required":true}',
    truncated: false,
  },
  req_demo_06: {
    requestId: 'req_demo_06',
    request: initialMockCapturedRequests[5],
    rawRequest: 'GET /api/v1/users/me HTTP/1.1\r\nHost: api.example.com\r\nAccept: application/json\r\nCookie: «redacted»\r\nAuthorization: «redacted»\r\n\r\n',
    rawResponse: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"id":"usr_100","name":"Alice Admin","role":"analyst"}',
    truncated: false,
  },
};

const initialMockCaStatus: CaStatusResponse = {
  available: true,
  path: 'C:/Users/XYLA/.chainsaw/ca.crt',
  installed: true,
  instructions: 'Install Chainsaw CA into your Trusted Root Certification Authorities store or import ca.crt into your browser settings.',
};

let mockCapturedRequests: CapturedRequest[] = JSON.parse(JSON.stringify(initialMockCapturedRequests));
let mockRequestDetails: Record<string, RequestDetailResponse> = JSON.parse(JSON.stringify(initialMockRequestDetails));
let mockCaStatus: CaStatusResponse = JSON.parse(JSON.stringify(initialMockCaStatus));

export function setMockServiceMode(mode: MockServiceMode) {
  currentMode = mode;
}

export function getMockServiceMode(): MockServiceMode {
  return currentMode;
}

export function resetMockData() {
  activeProjects = JSON.parse(JSON.stringify(initialMockProjects));
  mockApprovals = JSON.parse(JSON.stringify(initialMockApprovals));
  mockEvidence = JSON.parse(JSON.stringify(initialMockEvidence));
  mockTasks = JSON.parse(JSON.stringify(initialMockTasks));
  mockJournalEvents = JSON.parse(JSON.stringify(initialMockJournalEvents));
  mockEntities = JSON.parse(JSON.stringify(initialMockEntities));
  mockEdges = JSON.parse(JSON.stringify(initialMockEdges));
  mockNotes = JSON.parse(JSON.stringify(initialMockNotes));
  mockCapturedRequests = JSON.parse(JSON.stringify(initialMockCapturedRequests));
  mockRequestDetails = JSON.parse(JSON.stringify(initialMockRequestDetails));
  mockCaStatus = JSON.parse(JSON.stringify(initialMockCaStatus));
  currentMode = 'healthy';
}

export async function fetchHomeData(): Promise<HomeDataResponse> {
  // Simulate network latency (80ms)
  await new Promise((res) => setTimeout(res, 80));

  if (currentMode === 'disconnected') {
    throw new Error('NETWORK_DISCONNECTED');
  }

  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not connect to project store index.',
      request_id: 'req_err_7829a1b',
      retryable: true,
    });
  }

  if (currentMode === 'empty') {
    return {
      recentProjects: [],
      recentActivity: [],
      activeSession: null,
      environment: {
        providers: { healthy: 0, degraded: 0, unavailable: 0 },
        toolPacks: { installed: 0, total: 5 },
        authProfiles: { active: 0, expired: 0 },
        sandbox: 'native',
        warnings: [
          'No model provider configured. Add one in Models.',
          'No tool packs installed. Install them in Tools.',
        ],
      },
      globalSettings: {
        theme: 'dark',
        density: 'comfortable',
        telemetryEnabled: false,
      },
    };
  }

  if (currentMode === 'partial') {
    return {
      recentProjects: activeProjects,
      recentActivity: [],
      activeSession: null,
      environment: {
        providers: { healthy: 0, degraded: 0, unavailable: 1 },
        toolPacks: { installed: 0, total: 0 },
        authProfiles: { active: 0, expired: 0 },
        sandbox: 'unavailable',
        warnings: ['Failed to query environment daemon status.'],
      },
    };
  }

  return {
    recentProjects: activeProjects,
    recentActivity: mockRecentActivity,
    activeSession: activeProjects[0]?.activeSession || null,
    environment: {
      providers: { healthy: 2, degraded: 1, unavailable: 0 },
      toolPacks: { installed: 3, total: 5 },
      authProfiles: { active: 2, expired: 1 },
      sandbox: 'native',
      warnings: [
        'ChatGPT Web provider degraded — session cookie expires in 4 hours',
        '2 tool packs missing (clairvoyance, inql) — install in Tools',
      ],
    },
    globalSettings: {
      theme: 'dark',
      density: 'comfortable',
      telemetryEnabled: false,
    },
  };
}

export async function fetchProjects(): Promise<Paginated<ProjectSummary>> {
  await new Promise((res) => setTimeout(res, 50));
  const items = currentMode === 'empty' ? [] : activeProjects;
  return {
    items,
    total: items.length,
    limit: 200,
    offset: 0,
    next: null,
  };
}

export async function fetchProject(projectId: string): Promise<ProjectSummary> {
  await new Promise((res) => setTimeout(res, 30));
  const p = activeProjects.find((x) => x.id === projectId);
  if (p) return p;
  return activeProjects[0] || {
    id: projectId,
    name: 'Acme API',
    path: 'C:/labs/acme-api',
    createdAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    scopeStatus: 'ok',
    targets: ['https://api.example.com'],
    sessionCount: 1,
    openFindings: 1,
  };
}

export async function fetchProviders(): Promise<Paginated<ProviderItem>> {
  await new Promise((res) => setTimeout(res, 50));
  const items = currentMode === 'empty' ? [] : mockProviders;
  return {
    items,
    total: items.length,
    limit: 200,
    offset: 0,
    next: null,
  };
}

export async function createProject(payload: ProjectCreatePayload): Promise<ProjectSummary> {
  await new Promise((res) => setTimeout(res, 100));

  const targets = payload.targets || [];
  const newProject: ProjectSummary = {
    id: `prj_${Math.random().toString(36).substring(2, 9)}`,
    name: payload.name,
    path: payload.path,
    createdAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    scopeStatus: 'ok',
    targets,
    sessionCount: 0,
    openFindings: 0,
    coverage: {
      applications: 1,
      services: targets.length || 1,
      routes: 0,
      inputs: 0,
      identities: (payload.authProfiles || []).length || 1,
      staleAssets: 0,
    },
    activeSession: null,
  };

  activeProjects = [newProject, ...activeProjects];
  return newProject;
}

export async function openProject(path: string): Promise<ProjectSummary> {
  await new Promise((res) => setTimeout(res, 80));

  const existing = activeProjects.find((p) => p.path.toLowerCase() === path.toLowerCase());
  if (existing) {
    existing.lastOpenedAt = new Date().toISOString();
    return existing;
  }

  const folderName = path.split('/').filter(Boolean).pop() || 'Imported Workspace';
  const newProject: ProjectSummary = {
    id: `prj_${Math.random().toString(36).substring(2, 9)}`,
    name: folderName,
    path,
    createdAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    scopeStatus: 'ok',
    targets: [`https://${folderName.toLowerCase().replace(/[^a-z0-9]/g, '')}.example.com`],
    sessionCount: 0,
    openFindings: 0,
    coverage: {
      applications: 1,
      services: 1,
      routes: 0,
      inputs: 0,
      identities: 0,
      staleAssets: 0,
    },
    activeSession: null,
  };

  activeProjects = [newProject, ...activeProjects];
  return newProject;
}

export async function removeProject(id: string): Promise<void> {
  await new Promise((res) => setTimeout(res, 80));
  activeProjects = activeProjects.filter((p) => p.id !== id);
}

export async function archiveProject(id: string): Promise<void> {
  await new Promise((res) => setTimeout(res, 50));
  const project = activeProjects.find((p) => p.id === id);
  if (project) {
    project.scopeStatus = 'empty';
  }
}

export async function fetchSession(sessionId: string): Promise<ActiveSessionSummary> {
  await new Promise((res) => setTimeout(res, 50));
  for (const p of activeProjects) {
    if (p.activeSession && p.activeSession.id === sessionId) {
      return p.activeSession;
    }
  }
  return {
    id: sessionId,
    projectId: activeProjects[0]?.id || 'prj_demo',
    title: 'Acme API authz sweep',
    status: 'running',
    mode: 'attack',
    targets: ['https://api.example.com'],
    elapsedSeconds: 720,
    lastEventSummary: 'action/result',
    lastEventAt: new Date().toISOString(),
    budget: {
      modelCalls: 400,
      toolCalls: 800,
      wallSeconds: 7200,
      used: { modelCalls: 37, toolCalls: 64, wallSeconds: 720 },
    },
  };
}

export async function updateSessionStatus(sessionId: string, status: string): Promise<ActiveSessionSummary> {
  await new Promise((res) => setTimeout(res, 50));
  const session = await fetchSession(sessionId);
  session.status = status as ActiveSessionSummary['status'];
  return session;
}

export async function fetchJournal(sessionId: string, afterSeq = 0): Promise<JournalResponse> {
  await new Promise((res) => setTimeout(res, 50));
  if (currentMode === 'empty') {
    return {
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
      next: null,
      lastSeq: 0,
      verified: true,
    };
  }
  const events = mockJournalEvents[sessionId] || mockJournalEvents['ses_demo_01'] || [];
  const filtered = events.filter((e) => e.seq > afterSeq);
  return {
    items: filtered,
    total: events.length,
    limit: 100,
    offset: 0,
    next: null,
    lastSeq: events.length > 0 ? events[events.length - 1].seq : 0,
    verified: true,
  };
}

export async function postMessage(sessionId: string, content: string): Promise<{ seq: number; status: string }> {
  await new Promise((res) => setTimeout(res, 80));
  const events = mockJournalEvents[sessionId] || [];
  const newSeq = (events.length > 0 ? events[events.length - 1].seq : 0) + 1;
  const newEvent: JournalEvent = {
    seq: newSeq,
    ts: new Date().toISOString(),
    sessionId,
    type: 'message/user',
    actor: 'operator',
    turn: 2,
    step: 1,
    refs: {},
    data: { content },
    visibility: 'public',
  };
  if (!mockJournalEvents[sessionId]) {
    mockJournalEvents[sessionId] = [...(mockJournalEvents['ses_demo_01'] || [])];
  }
  mockJournalEvents[sessionId].push(newEvent);
  return { seq: newSeq, status: 'queued' };
}

export async function fetchTasks(): Promise<Paginated<TaskItem>> {
  await new Promise((res) => setTimeout(res, 30));
  if (currentMode === 'empty') {
    return { items: [], total: 0, limit: 100, offset: 0, next: null };
  }
  return { items: mockTasks, total: mockTasks.length, limit: 100, offset: 0, next: null };
}

export async function fetchApprovals(): Promise<Paginated<ApprovalItem>> {
  await new Promise((res) => setTimeout(res, 30));
  if (currentMode === 'empty') {
    return { items: [], total: 0, limit: 100, offset: 0, next: null };
  }
  return { items: mockApprovals, total: mockApprovals.length, limit: 100, offset: 0, next: null };
}

export async function grantApproval(sessionId: string, approvalId: string, reason: string): Promise<ApprovalItem> {
  await new Promise((res) => setTimeout(res, 50));
  const appr = mockApprovals.find((a) => a.id === approvalId);
  if (appr) {
    appr.status = 'granted';
  }
  const events = mockJournalEvents[sessionId] || [];
  const newSeq = (events.length > 0 ? events[events.length - 1].seq : 0) + 1;
  const grantEvt: JournalEvent = {
    seq: newSeq,
    ts: new Date().toISOString(),
    sessionId,
    type: 'approval/granted',
    actor: 'operator',
    turn: 3,
    step: 1,
    refs: { approvalId },
    data: { approvalId, reason, status: 'granted' },
    visibility: 'public',
  };
  if (!mockJournalEvents[sessionId]) {
    mockJournalEvents[sessionId] = [...(mockJournalEvents['ses_demo_01'] || [])];
  }
  mockJournalEvents[sessionId].push(grantEvt);

  return appr || {
    id: approvalId,
    kind: 'intrusive',
    title: 'Approval Granted',
    detail: reason,
    risk: 'high',
    status: 'granted',
    createdAt: new Date().toISOString(),
  };
}

export async function denyApproval(sessionId: string, approvalId: string, reason: string): Promise<ApprovalItem> {
  await new Promise((res) => setTimeout(res, 50));
  const appr = mockApprovals.find((a) => a.id === approvalId);
  if (appr) {
    appr.status = 'denied';
  }
  const events = mockJournalEvents[sessionId] || [];
  const newSeq = (events.length > 0 ? events[events.length - 1].seq : 0) + 1;
  const denyEvt: JournalEvent = {
    seq: newSeq,
    ts: new Date().toISOString(),
    sessionId,
    type: 'approval/denied',
    actor: 'operator',
    turn: 3,
    step: 1,
    refs: { approvalId },
    data: { approvalId, reason, status: 'denied' },
    visibility: 'public',
  };
  if (!mockJournalEvents[sessionId]) {
    mockJournalEvents[sessionId] = [...(mockJournalEvents['ses_demo_01'] || [])];
  }
  mockJournalEvents[sessionId].push(denyEvt);

  return appr || {
    id: approvalId,
    kind: 'intrusive',
    title: 'Approval Denied',
    detail: reason,
    risk: 'high',
    status: 'denied',
    createdAt: new Date().toISOString(),
  };
}

export async function fetchEvidence(): Promise<Paginated<EvidenceItem>> {
  await new Promise((res) => setTimeout(res, 30));
  if (currentMode === 'empty') {
    return { items: [], total: 0, limit: 100, offset: 0, next: null };
  }
  return { items: mockEvidence, total: mockEvidence.length, limit: 100, offset: 0, next: null };
}

export async function fetchScope(projectId: string): Promise<ProjectScopeResponse> {
  await new Promise((res) => setTimeout(res, 30));
  if (currentMode === 'empty') {
    return {
      scopeJson: {},
      hash: null,
      valid: null,
    };
  }
  return {
    scopeJson: { programName: projectId },
    hash: 'sha256:scope',
    valid: true,
  };
}

export async function fetchContext(): Promise<SessionContextResponse> {
  await new Promise((res) => setTimeout(res, 30));
  return {
    roles: [
      {
        role: 'orchestrator',
        modelId: 'deepseek-v4-pro',
        budgetTokens: 64000,
        usedTokens: 0,
        compressionRatio: 1.0,
        fit: true,
        warnings: ['No context has been assembled yet.'],
      },
      {
        role: 'recon',
        modelId: 'qwen3:14b',
        budgetTokens: 32768,
        usedTokens: 0,
        compressionRatio: 1.0,
        fit: true,
        warnings: ['No context has been assembled yet.'],
      },
      {
        role: 'operator',
        modelId: 'deepseek-v4-pro',
        budgetTokens: 64000,
        usedTokens: 0,
        compressionRatio: 1.0,
        fit: true,
        warnings: ['No context has been assembled yet.'],
      },
      {
        role: 'validator',
        modelId: 'deepseek-v4-pro',
        budgetTokens: 64000,
        usedTokens: 0,
        compressionRatio: 1.0,
        fit: true,
        warnings: ['No context has been assembled yet.'],
      },
      {
        role: 'reporter',
        modelId: 'deepseek-v4-flash',
        budgetTokens: 32768,
        usedTokens: 0,
        compressionRatio: 1.0,
        fit: true,
        warnings: ['No context has been assembled yet.'],
      },
    ],
  };
}

// ── Milestone 2 App Model Mock Methods ────────────────────────────

export interface AppModelListOptions {
  kind?: string;
  q?: string;
  stale?: boolean;
  limit?: number;
  offset?: number;
}

export interface AppModelGraphOptions {
  rootId?: string;
  depth?: number;
  maxNodes?: number;
}

export async function fetchAppModel(
  projectId: string,
  options: AppModelListOptions = {}
): Promise<Paginated<AppEntity> & { stale: boolean }> {
  await new Promise((res) => setTimeout(res, 40));

  if (currentMode === 'empty') {
    return {
      items: [],
      total: 0,
      limit: options.limit || 100,
      offset: options.offset || 0,
      next: null,
      stale: false,
    };
  }

  let filtered = mockEntities.filter((e) => e.projectId === projectId || projectId === 'prj_demo');

  if (options.kind) {
    filtered = filtered.filter((e) => e.kind === options.kind);
  }
  if (options.q) {
    const qLower = options.q.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.name.toLowerCase().includes(qLower) ||
        e.tags.some((t) => t.toLowerCase().includes(qLower)) ||
        JSON.stringify(e.meta).toLowerCase().includes(qLower)
    );
  }
  if (options.stale) {
    filtered = filtered.filter((e) => e.stale);
  }

  const offset = options.offset || 0;
  const limit = options.limit || 100;
  const paged = filtered.slice(offset, offset + limit);

  return {
    items: paged,
    total: filtered.length,
    limit,
    offset,
    next: offset + limit < filtered.length ? `?offset=${offset + limit}` : null,
    stale: Boolean(options.stale),
  };
}

export async function fetchAppModelGraph(
  projectId: string,
  options: AppModelGraphOptions = {}
): Promise<AppGraphResponse> {
  await new Promise((res) => setTimeout(res, 50));

  if (currentMode === 'empty') {
    return {
      entities: [],
      edges: [],
      truncated: false,
      totalEntities: 0,
    };
  }

  let entities = mockEntities.filter((e) => e.projectId === projectId || projectId === 'prj_demo');
  let edges = [...mockEdges];
  const maxNodes = options.maxNodes || 300;

  if (options.rootId) {
    const selected = new Set<string>([options.rootId]);
    let frontier = new Set<string>([options.rootId]);
    const depth = options.depth || 2;

    for (let i = 0; i < depth; i++) {
      const nextFrontier = new Set<string>();
      for (const edge of edges) {
        if (frontier.has(edge.sourceId)) nextFrontier.add(edge.targetId);
        if (frontier.has(edge.targetId)) nextFrontier.add(edge.sourceId);
      }
      nextFrontier.forEach((id) => selected.add(id));
      frontier = nextFrontier;
    }

    entities = entities.filter((e) => selected.has(e.id));
    edges = edges.filter((edg) => selected.has(edg.sourceId) && selected.has(edg.targetId));
  }

  const truncated = entities.length > maxNodes;
  const returnedEntities = truncated ? entities.slice(0, maxNodes) : entities;
  const returnedEntityIds = new Set(returnedEntities.map((e) => e.id));
  const returnedEdges = edges.filter((edg) => returnedEntityIds.has(edg.sourceId) && returnedEntityIds.has(edg.targetId));

  return {
    entities: returnedEntities,
    edges: returnedEdges,
    truncated,
    totalEntities: entities.length,
  };
}

export async function fetchEntityDetail(_projectId: string, entityId: string): Promise<EntityDetailResponse> {
  await new Promise((res) => setTimeout(res, 40));

  const entity = mockEntities.find((e) => e.id === entityId);
  if (!entity) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `Entity not found: ${entityId}`,
      request_id: 'req_mock_404',
    });
  }

  const connectedEdges = mockEdges.filter((edg) => edg.sourceId === entityId || edg.targetId === entityId);
  const notes = mockNotes[entityId] || [];

  return {
    entity,
    edges: connectedEdges,
    notes,
  };
}

export async function addEntityNote(_projectId: string, entityId: string, content: string): Promise<NoteItem> {
  await new Promise((res) => setTimeout(res, 50));

  const entity = mockEntities.find((e) => e.id === entityId);
  if (!entity) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `Entity not found: ${entityId}`,
      request_id: 'req_mock_404',
    });
  }

  const newId = (mockNotes[entityId]?.length || 0) + 1;
  const newNote: NoteItem = {
    id: newId,
    entityId,
    content,
    createdAt: new Date().toISOString(),
  };

  if (!mockNotes[entityId]) {
    mockNotes[entityId] = [];
  }
  mockNotes[entityId].unshift(newNote);

  return newNote;
}

export async function fetchAppModelExport(projectId: string): Promise<{ summary: AppModelSummary; graph: AppGraphResponse }> {
  await new Promise((res) => setTimeout(res, 50));

  const entities = mockEntities.filter((e) => e.projectId === projectId || projectId === 'prj_demo');
  const counts: Record<string, number> = {};
  for (const e of entities) {
    counts[e.kind] = (counts[e.kind] || 0) + 1;
  }

  const summary: AppModelSummary = {
    projectId,
    counts,
    staleAssets: entities.filter((e) => e.stale).length,
    edges: mockEdges.length,
  };

  const graph = await fetchAppModelGraph(projectId, { maxNodes: 2000 });
  return { summary, graph };
}

// ── Milestone 3: Workbench Mock Handlers ─────────────────────────

export async function fetchWorkbenchHistory(
  _projectId?: string,
  params?: {
    q?: string;
    host?: string;
    method?: string;
    status?: string;
    contentType?: string;
    auth?: string;
    tag?: string;
    inScopeOnly?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<Paginated<CapturedRequest>> {
  await new Promise((res) => setTimeout(res, 50));

  if (currentMode === 'disconnected') {
    throw new Error('NETWORK_DISCONNECTED');
  }

  if (currentMode === 'error') {
    throw new ApiError({
      code: 'WORKBENCH_UNAVAILABLE',
      message: 'Failed to retrieve workbench traffic history.',
      request_id: 'req_wb_err_01',
    });
  }

  if (currentMode === 'empty') {
    return {
      items: [],
      total: 0,
      limit: params?.limit || 50,
      offset: params?.offset || 0,
      next: null,
    };
  }

  let items = [...mockCapturedRequests];

  if (params?.q) {
    const qLower = params.q.toLowerCase();
    items = items.filter(
      (req) =>
        req.url.toLowerCase().includes(qLower) ||
        req.host.toLowerCase().includes(qLower) ||
        req.path.toLowerCase().includes(qLower) ||
        req.tags.some((t) => t.toLowerCase().includes(qLower))
    );
  }

  if (params?.host) {
    const hLower = params.host.toLowerCase();
    items = items.filter((req) => req.host.toLowerCase().includes(hLower));
  }

  if (params?.method && params.method !== 'ALL') {
    const mUpper = params.method.toUpperCase();
    items = items.filter((req) => req.method.toUpperCase() === mUpper);
  }

  if (params?.status && params.status !== 'ALL') {
    if (params.status === '2xx') {
      items = items.filter((req) => req.status >= 200 && req.status < 300);
    } else if (params.status === '3xx') {
      items = items.filter((req) => req.status >= 300 && req.status < 400);
    } else if (params.status === '4xx') {
      items = items.filter((req) => req.status >= 400 && req.status < 500);
    } else if (params.status === '5xx') {
      items = items.filter((req) => req.status >= 500 && req.status < 600);
    } else {
      const code = parseInt(params.status, 10);
      if (!isNaN(code)) {
        items = items.filter((req) => req.status === code);
      }
    }
  }

  if (params?.auth && params.auth !== 'ALL') {
    items = items.filter((req) => req.authContext === params.auth);
  }

  if (params?.tag && params.tag !== 'ALL') {
    items = items.filter((req) => req.tags.includes(params.tag!));
  }

  if (params?.inScopeOnly) {
    items = items.filter((req) => req.inScope === true);
  }

  const offset = params?.offset || 0;
  const limit = params?.limit || 50;
  const paginatedItems = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? offset + limit : null;

  return {
    items: paginatedItems,
    total: items.length,
    limit,
    offset,
    next,
  };
}

export async function fetchRequestDetail(requestId: string): Promise<RequestDetailResponse> {
  await new Promise((res) => setTimeout(res, 50));

  if (currentMode === 'error') {
    throw new ApiError({
      code: 'REQUEST_NOT_FOUND',
      message: `Failed to load details for request ${requestId}`,
      request_id: 'req_wb_detail_err',
    });
  }

  if (mockRequestDetails[requestId]) {
    return mockRequestDetails[requestId];
  }

  const req = mockCapturedRequests.find((r) => r.id === requestId);
  if (!req) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `Request not found: ${requestId}`,
      request_id: 'req_wb_404',
    });
  }

  const detail: RequestDetailResponse = {
    requestId: req.id,
    request: req,
    rawRequest: `${req.method} ${req.path} HTTP/1.1\r\nHost: ${req.host}\r\nAccept: application/json\r\nAuthorization: «redacted»\r\n\r\n${req.requestBodyPreview}`,
    rawResponse: `HTTP/1.1 ${req.status} OK\r\nContent-Type: application/json\r\n\r\n${req.responseBodyPreview}`,
    truncated: false,
  };

  mockRequestDetails[requestId] = detail;
  return detail;
}

export async function replayRequest(payload: ReplayPayload): Promise<ReplayResult> {
  await new Promise((res) => setTimeout(res, 75));

  if (currentMode === 'error') {
    throw new ApiError({
      code: 'REPLAY_FAILED',
      message: 'Failed to execute HTTP replay.',
      request_id: 'req_wb_replay_err',
    });
  }

  const original = mockCapturedRequests.find((r) => r.id === payload.requestId);
  const targetHost = original ? original.host : 'api.example.com';
  const targetPath = payload.patch?.path || (original ? original.path : '/api/v1/resource');
  const targetUrl = `https://${targetHost}${targetPath}`;

  // Scope Enforcement Check
  if (original && !original.inScope) {
    return {
      request: original,
      response: {
        status: 0,
        headers: {},
        body: 'Transmission blocked: Target is outside authorized engagement scope.',
        rawResponse: '',
        durationMs: 0,
        sizeBytes: 0,
      },
      scope: {
        allowed: false,
        reason: 'Target host is outside authorized engagement scope.',
      },
    };
  }

  const newId = `req_replay_${Date.now()}`;
  const status = targetPath.includes('denied') ? 403 : 200;
  const body = status === 403 
    ? '{"error":"forbidden","message":"Tampered token rejected"}'
    : (original ? original.responseBodyPreview : '{"status":"ok"}');

  const replayedRequest: CapturedRequest = {
    id: newId,
    method: original?.method || 'GET',
    url: targetUrl,
    host: targetHost,
    path: targetPath,
    status,
    requestHeaders: {
      ...(original?.requestHeaders || {}),
      ...(payload.patch?.header || {}),
      cookie: '«redacted»',
      authorization: '«redacted»',
    },
    requestBodyPreview: typeof payload.patch?.json === 'object' 
      ? JSON.stringify(payload.patch?.json) 
      : (original?.requestBodyPreview || ''),
    responseHeaders: {
      'content-type': 'application/json',
      'x-chainsaw-replay': 'true',
    },
    responseBodyPreview: body,
    sizeBytes: body.length,
    durationMs: Math.floor(Math.random() * 80) + 110,
    authContext: original?.authContext || 'session:manual',
    tags: ['replayed', ...(original?.tags || [])],
    capturedAt: new Date().toISOString(),
    inScope: true,
  };

  mockCapturedRequests.unshift(replayedRequest);
  mockRequestDetails[newId] = {
    requestId: newId,
    request: replayedRequest,
    rawRequest: `${replayedRequest.method} ${replayedRequest.path} HTTP/1.1\r\nHost: ${targetHost}\r\n\r\n${replayedRequest.requestBodyPreview}`,
    rawResponse: `HTTP/1.1 ${status} OK\r\nContent-Type: application/json\r\n\r\n${body}`,
    truncated: false,
  };

  return {
    request: replayedRequest,
    response: {
      status,
      headers: replayedRequest.responseHeaders,
      body,
      rawResponse: mockRequestDetails[newId].rawResponse,
      durationMs: replayedRequest.durationMs,
      sizeBytes: replayedRequest.sizeBytes,
    },
    scope: {
      allowed: true,
      reason: 'Target is in-scope.',
    },
  };
}

export async function compareResponses(
  baselineId: string,
  candidateId: string
): Promise<ResponseCompareResponse> {
  await new Promise((res) => setTimeout(res, 60));

  const baselineReq = mockCapturedRequests.find((r) => r.id === baselineId);
  const candidateReq = mockCapturedRequests.find((r) => r.id === candidateId);

  const baselineStatus = baselineReq?.status || 200;
  const candidateStatus = candidateReq?.status || 403;
  const statusChanged = baselineStatus !== candidateStatus;

  return {
    statusChanged,
    baselineStatus,
    candidateStatus,
    headersDiff: [
      { type: 'unchanged', content: 'content-type: application/json' },
      { type: 'removed', content: 'set-cookie: «redacted»' },
      { type: 'added', content: 'x-chainsaw-replay: true' },
    ],
    bodyDiff: [
      { type: 'removed', content: baselineReq?.responseBodyPreview || '{"id":102,"tenant":"tenant-b"}' },
      { type: 'added', content: candidateReq?.responseBodyPreview || '{"error":"forbidden"}' },
    ],
    summary: statusChanged
      ? `HTTP status changed from ${baselineStatus} to ${candidateStatus}. Access control boundary effectively enforced or bypassed.`
      : `HTTP status remained ${baselineStatus}. Minor payload or timing variations observed.`,
  };
}

export async function createWorkbenchEvidence(payload: CreateEvidencePayload): Promise<EvidenceItem> {
  await new Promise((res) => setTimeout(res, 50));

  const req = mockCapturedRequests.find((r) => r.id === payload.requestId);
  const newEvidence: EvidenceItem = {
    id: `evd_${Date.now()}`,
    kind: 'evidence',
    summary: payload.note || `Captured HTTP ${req?.method || 'GET'} ${req?.path || ''} [${req?.status || 200}]`,
    artifactId: `ART-WB-${Date.now().toString().slice(-4)}`,
    hash: 'sha256:' + Math.random().toString(16).substring(2, 18),
    hypothesisId: payload.hypothesisId || 'hyp_01',
    taskId: payload.taskId,
    promoted: 1,
    createdAt: new Date().toISOString(),
  };

  mockEvidence.unshift(newEvidence);
  return newEvidence;
}

export async function importHar(_format: string, path: string): Promise<{ importId: string; count: number }> {
  await new Promise((res) => setTimeout(res, 80));

  return {
    importId: `imp_${Date.now()}`,
    count: path.includes('empty') ? 0 : 4,
  };
}

export async function fetchWorkbenchExport(
  _projectId: string,
  _format: 'har' | 'jsonl' = 'har'
): Promise<{ format: string; count: number; data: unknown }> {
  await new Promise((res) => setTimeout(res, 50));

  return {
    format: _format,
    count: mockCapturedRequests.length,
    data: {
      log: {
        version: '1.2',
        creator: { name: 'ChainsawRecon', version: '2.0.0' },
        entries: mockCapturedRequests.map((r) => ({
          request: { method: r.method, url: r.url },
          response: { status: r.status },
        })),
      },
    },
  };
}

export async function fetchCaStatus(): Promise<CaStatusResponse> {
  await new Promise((res) => setTimeout(res, 40));
  return mockCaStatus;
}


