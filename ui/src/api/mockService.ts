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
  ProxyStatusResponse,
  ProxyStartPayload,
  ProxyStopPayload,
  Finding,
  FindingDetailResponse,
  FindingTransitionPayload,
  EvidenceBinding,
  FindingEvidenceBindPayload,
  CoverageEntry,
  CoverageGap,
  SitemapNode,
  SitemapResponse,
  ProjectCoverageResponse,
  RecordCoveragePayload,
  AuthProfile,
  AuthSessionStatus,
  AuthDetection,
  AuthLoginPayload,
  CreateAuthProfilePayload,
  ToolRunPayload,
  ToolRunResponse,
  ToolCallItem,
  ProviderCreatePayload,
  ProviderHealthResponse,
  ProviderCalibrateResponse,
  Hypothesis,
  HypothesisCreatePayload,
  HypothesisTransitionPayload,
  SessionReport,
  SaveSessionReportResponse,
  SavedReportItem,
  ReportExportFormat,
  ReportExportResponse,
  SandboxStatus,
  RoleModelSummary,
  SessionRunPayload,
  SessionRunResponse,
  ModelRole,
  OastStatusResponse,
  OastStartPayload,
  OastToken,
  OastTokenCreatePayload,
  OastEvent,
  ProjectArchiveItem,
  CreateArchivePayload,
  CreateArchiveResponse,
} from './types';
import { initialMockProjects, mockRecentActivity, mockProviders } from './mockData';
import { ApiError } from './client';

export type MockServiceMode = 'healthy' | 'empty' | 'error' | 'partial' | 'disconnected';

let currentMode: MockServiceMode = 'healthy';
let activeProjects: ProjectSummary[] = [...initialMockProjects];
let activeProviders: ProviderItem[] = [...mockProviders];

export const initialMockAuthProfiles: AuthProfile[] = [
  {
    id: 'auth_admin_01',
    label: 'Primary Admin Account',
    identity: 'admin@acme.example.com',
    role: 'administrator',
    tenant: 'acme-corp',
    kind: 'credentials',
    adapter: 'http_form',
    persistence: 'session_only',
    targetPatterns: ['https://api.example.com/*', 'https://app.example.com/*'],
    loginUrl: 'https://app.example.com/login',
    verifyUrl: 'https://api.example.com/v1/me',
    verifyIndicator: 'user_id',
    usernameField: 'email',
    passwordField: 'password',
    maintainCookies: ['session_id', 'csrf_token'],
    timeout: 30,
    verifyTls: true,
    headless: false,
    session: {
      profileId: 'auth_admin_01',
      projectId: 'prj_demo',
      status: 'active',
      adapter: 'http_form',
      verifiedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      hasCookies: true,
      hasStorageState: false,
    },
  },
  {
    id: 'auth_operator_02',
    label: 'OAuth SSO Operator',
    identity: 'sec-analyst@security-firm.example',
    role: 'auditor',
    tenant: 'partner-tenant',
    kind: 'oauth',
    adapter: 'browser',
    persistence: 'none',
    targetPatterns: ['https://auth.example.com/*', 'https://app.example.com/*'],
    loginUrl: 'https://auth.example.com/oauth2/authorize',
    verifyUrl: 'https://app.example.com/dashboard',
    verifyIndicator: 'Logout',
    timeout: 300,
    verifyTls: true,
    headless: false,
    session: {
      profileId: 'auth_operator_02',
      projectId: 'prj_demo',
      status: 'needs_verification',
      adapter: 'browser',
      hasCookies: true,
      hasStorageState: true,
      warning: 'Session verification expired after 8 hours.',
    },
  },
];

let mockAuthProfiles: AuthProfile[] = JSON.parse(JSON.stringify(initialMockAuthProfiles));

export const initialMockAuthDetection: AuthDetection = {
  mechanisms: ['form_login', 'oauth2_pkce', 'bearer_tokens'],
  botProtection: {
    detected: true,
    vendor: 'Cloudflare Turnstile',
    confidence: 0.92,
    signals: ['challenges.cloudflare.com iframe detected', 'cf_clearance cookie checked'],
  },
  loginCandidates: [
    {
      url: 'https://app.example.com/login',
      method: 'POST',
      fields: [
        { name: 'username', type: 'text', value: '' },
        { name: 'password', type: 'password', value: '' },
        { name: '_csrf', type: 'hidden', value: 'tok_csrf_992' },
      ],
      passwordField: 'password',
      usernameField: 'username',
      csrfField: '_csrf',
      hasCaptcha: true,
      hasOAuth: false,
    },
    {
      url: 'https://auth.example.com/oauth2/auth',
      method: 'GET',
      fields: [],
      passwordField: '',
      usernameField: '',
      csrfField: '',
      hasCaptcha: false,
      hasOAuth: true,
    },
  ],
  recommendedAdapter: 'browser',
  warnings: [
    'Bot protection (Cloudflare Turnstile) detected on login page. Browser adapter is strongly recommended.',
    'Automated CAPTCHA bypass is not supported; operator interactive login required.',
  ],
};

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
  {
    id: 'evd_control_baseline',
    kind: 'evidence',
    summary: 'GET /v1/users/usr_42 baseline request for unprivileged user.',
    artifactId: 'ART-002',
    hash: 'sha256:1a82c4490f234bc567de99104bcde1234567890abcdef1234567890abcdef123',
    hypothesisId: 'hyp_01',
    taskId: 'tsk_idor_01',
    promoted: 1,
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  },
  {
    id: 'evd_verification_diff',
    kind: 'evidence',
    summary: 'Verification replay differential confirming tenant isolation failure.',
    artifactId: 'ART-003',
    hash: 'sha256:bb99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbb',
    hypothesisId: 'hyp_01',
    taskId: 'tsk_idor_01',
    promoted: 1,
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
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
  keyPath: 'C:/Users/XYLA/.chainsaw/ca.key',
  installed: false,
  instructions: 'Install Chainsaw CA into your Trusted Root Certification Authorities store or import ca.crt into your browser settings.',
};

const initialMockProxyStatus: ProxyStatusResponse = {
  running: false,
  projectId: 'prj_demo',
  host: '127.0.0.1',
  port: 8080,
  proxyUrl: 'http://127.0.0.1:8080',
  caPath: 'C:/Users/XYLA/.chainsaw/ca.crt',
  captured: 6,
  verifyUpstream: true,
};

// ── Milestone 4 Mock Findings Fixtures ─────────────────────────

const initialMockFindings: Finding[] = [
  {
    id: 'fnd_demo_01',
    projectId: 'prj_demo',
    sessionId: 'ses_demo_01',
    title: 'Cross-tenant invoice read',
    severity: 'high',
    vrt: 'P2.2 IDOR',
    state: 'candidate',
    asset: 'https://api.example.com/api/v1/invoices/102',
    entityId: 'rte_invoice',
    hypothesisId: 'hyp_demo_01',
    evidenceIds: ['evd_idor_payload'],
    evidenceVersion: 1,
    securityQuestion: 'Can an unprivileged tenant read invoices belonging to another customer organization without authorization?',
    impact: 'A malicious tenant can harvest confidential billing data, customer addresses, and tax identifiers of competitor tenants.',
    remediation: 'Enforce tenant isolation checks on the database query layer. Reject object IDs not belonging to the authenticated tenant context.',
    reproduction: [
      {
        step: 1,
        description: 'Authenticate as Tenant Alpha user via /api/v1/auth/login.',
        expected: 'Receives Tenant Alpha session token.'
      },
      {
        step: 2,
        description: 'Issue GET /api/v1/invoices/102 (belonging to Tenant Beta).',
        expected: 'HTTP 403 Forbidden or 404 Not Found.',
        actual: 'HTTP 200 OK with complete billing records of Tenant Beta.'
      }
    ],
    gate: {
      passed: false,
      questions: [
        { id: 1, passed: true, reason: 'Asset is in scope.' },
        { id: 2, passed: true, reason: 'Exact request/response pair captured.' },
        { id: 3, passed: true, reason: 'Cross-tenant data returned.' },
        { id: 4, passed: true, reason: 'Not an auth gate; session A is valid.' },
        { id: 5, passed: true, reason: 'Tenant isolation is core.' },
        { id: 6, passed: true, reason: 'High severity by VRT.' },
        { id: 7, passed: false, reason: 'Independent reproduction pending.' }
      ]
    },
    lineage: {
      hypothesisId: 'hyp_demo_01',
      taskId: 'tsk_idor_01',
      sessionId: 'ses_demo_01',
      discoveredBy: 'Recon Module',
    },
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
  {
    id: 'fnd_demo_02',
    projectId: 'prj_demo',
    sessionId: 'ses_demo_02',
    title: 'Reflected XSS in search endpoint',
    severity: 'medium',
    vrt: 'P2 Cross-Site Scripting (Reflected)',
    state: 'rejected',
    asset: 'https://app.example.com/search?q=',
    entityId: 'rte_search',
    hypothesisId: 'hyp_demo_02',
    evidenceIds: ['evd_idor_payload'],
    evidenceVersion: 1,
    securityQuestion: 'Does the search parameter execute unescaped JavaScript in client browser context?',
    impact: 'No impact observed in testing; output is strictly escaped before DOM insertion.',
    remediation: 'None required. Contextual sanitization verified.',
    reproduction: 'Injected <script>alert(1)</script> in query string parameter q. Response entity-escaped payload to &lt;script&gt;.',
    gate: {
      passed: false,
      questions: [
        { id: 1, passed: true, reason: 'Asset is in scope.' },
        { id: 2, passed: true, reason: 'Request/response captured.' },
        { id: 3, passed: false, reason: 'Payload was HTML-escaped.' },
        { id: 4, passed: true, reason: 'Not an auth gate.' },
        { id: 5, passed: true, reason: 'Search is user-facing.' },
        { id: 6, passed: true, reason: 'Medium by VRT.' },
        { id: 7, passed: true, reason: 'Evidence complete.' }
      ]
    },
    lineage: {
      hypothesisId: 'hyp_demo_02',
      sessionId: 'ses_demo_02',
      discoveredBy: 'Active Probe',
      validatedBy: 'Security Lead',
      validatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    },
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fnd_demo_03',
    projectId: 'prj_demo',
    sessionId: 'ses_demo_01',
    title: 'Candidate finding with zero recorded evidence',
    severity: 'critical',
    vrt: 'P1 Broken Authentication',
    state: 'candidate',
    asset: 'https://api.example.com/api/v1/auth/internal-bypass',
    evidenceIds: [],
    evidenceVersion: 0,
    securityQuestion: 'Does an internal bypass header allow authentication skipping?',
    impact: 'Potential full authentication bypass for administrative interfaces.',
    remediation: 'Remove internal debug headers in production edge routing.',
    reproduction: 'Send header X-Chainsaw-Internal: admin to /api/v1/auth/internal-bypass.',
    gate: {
      passed: false,
      questions: [
        { id: 1, passed: true, reason: 'Asset is in scope.' },
        { id: 2, passed: false, reason: 'No evidence artifacts recorded yet.' },
        { id: 3, passed: false, reason: 'Bypass unconfirmed.' },
        { id: 4, passed: false, reason: 'Pending reproduction.' },
        { id: 5, passed: true, reason: 'Critical boundary.' },
        { id: 6, passed: true, reason: 'P1 classification.' },
        { id: 7, passed: false, reason: 'Verification incomplete.' }
      ]
    },
    lineage: {
      sessionId: 'ses_demo_01',
      discoveredBy: 'Passive Observation',
    },
    createdAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
  },
  {
    id: 'fnd_demo_04',
    projectId: 'prj_demo',
    sessionId: 'ses_demo_01',
    title: 'Admin role escalation via weak JWT signature verification',
    severity: 'critical',
    vrt: 'P1 Privilege Escalation',
    state: 'validated',
    asset: 'https://api.example.com/api/v1/admin/privileges',
    entityId: 'rte_admin',
    evidenceIds: ['evd_idor_payload'],
    evidenceVersion: 2,
    securityQuestion: 'Can a user forge an HS256 JWT using public RS256 key to gain admin privileges?',
    impact: 'Attackers can achieve full superuser administrative privileges over all customer accounts and settings.',
    remediation: 'Enforce asymmetric RS256 verification and explicitly reject symmetric algorithm substitutions (alg: none or HS256).',
    reproduction: 'Sign JWT with server public key using HS256 algorithm and pass in Authorization header to /api/v1/admin/privileges.',
    gate: {
      passed: true,
      questions: [
        { id: 1, passed: true, reason: 'Target is strictly in scope.' },
        { id: 2, passed: true, reason: 'Cryptographic exploit trace recorded with full wire capture.' },
        { id: 3, passed: true, reason: 'Admin dashboard returned 200 with root privileges.' },
        { id: 4, passed: true, reason: 'Independent verification confirmed.' },
        { id: 5, passed: true, reason: 'Critical tenant impact.' },
        { id: 6, passed: true, reason: 'Severity aligned with CVSS 9.8.' },
        { id: 7, passed: true, reason: 'Independent reviewer accepted.' }
      ]
    },
    lineage: {
      hypothesisId: 'hyp_demo_03',
      taskId: 'tsk_idor_01',
      sessionId: 'ses_demo_01',
      discoveredBy: 'Security Agent',
      validatedBy: 'Validator Lead',
      validatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    },
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  }
];

const initialMockCoverageEntries: CoverageEntry[] = [
  {
    id: 1,
    entityId: 'rot_users_id',
    surface: 'GET /api/v1/users/{id}',
    riskArea: 'idor',
    outcome: 'reported',
    evidenceId: 'evd_demo_01',
    reason: 'Cross-tenant IDOR confirmed on invoice read',
    worker: 'operator',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 2,
    entityId: 'rot_auth_login',
    surface: 'POST /api/v1/auth/login',
    riskArea: 'auth_bypass',
    outcome: 'no_issue_found',
    evidenceId: 'evd_demo_02',
    reason: 'Credential bruteforce throttled and JWT tokens cryptographically signed',
    worker: 'validator',
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 3,
    entityId: 'rot_billing_invoices',
    surface: 'GET /v1/billing/invoices',
    riskArea: 'idor',
    outcome: 'no_issue_found',
    evidenceId: null,
    reason: 'Negative verification executed without supporting evidence artifact',
    worker: 'recon',
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 4,
    entityId: 'inp_user_id',
    surface: '{id}',
    riskArea: 'sqli',
    outcome: 'no_issue_found',
    evidenceId: null,
    reason: 'ORM parameter binding verified',
    worker: 'operator',
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
];

export const initialMockHypotheses: Hypothesis[] = [
  {
    id: 'hyp_demo_01',
    sessionId: 'ses_demo_01',
    title: 'Cross-tenant read on invoice endpoints',
    securityQuestion: 'Can an unprivileged tenant read invoices belonging to another customer organization without authorization?',
    surface: 'GET /api/v1/invoices/{id}',
    state: 'supported',
    confidence: 'candidate',
    requiredEvidence: ['candidate_response', 'baseline_response'],
    findingCount: 1,
    evidenceCount: 1,
    linkedFindings: ['fnd_demo_01'],
    linkedEvidence: ['evd_idor_payload'],
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    reasons: [
      { state: 'suspected', reason: 'Initial telemetry flagged sequential invoice IDs', timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
      { state: 'supported', reason: 'Wire evidence evd_idor_payload confirmed cross-tenant disclosure', timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
    ]
  },
  {
    id: 'hyp_demo_02',
    sessionId: 'ses_demo_01',
    title: 'Reflected script execution in search query',
    securityQuestion: 'Does the search parameter execute unescaped JavaScript in client browser context?',
    surface: 'GET /search?q=',
    state: 'rejected',
    confidence: 'candidate',
    requiredEvidence: ['reflection_probe', 'dom_sink_trace'],
    findingCount: 1,
    evidenceCount: 1,
    linkedFindings: ['fnd_demo_02'],
    linkedEvidence: ['evd_idor_payload'],
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    reasons: [
      { state: 'suspected', reason: 'User input reflected in HTML body', timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() },
      { state: 'rejected', reason: 'HTML entity encoding is active and verified; no execution possible', timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
    ]
  },
  {
    id: 'hyp_demo_03',
    sessionId: 'ses_demo_01',
    title: 'JWT algorithm confusion for admin role escalation',
    securityQuestion: 'Can an attacker forge an HS256 JWT using public RS256 key to gain admin privileges?',
    surface: 'POST /api/v1/admin/privileges',
    state: 'supported',
    confidence: 'validated',
    requiredEvidence: ['forged_jwt_token', 'admin_endpoint_200'],
    findingCount: 1,
    evidenceCount: 1,
    linkedFindings: ['fnd_demo_04'],
    linkedEvidence: ['evd_idor_payload'],
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    reasons: [
      { state: 'suspected', reason: 'Public key exposed via JWKS and backend accepts HS256', timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() },
      { state: 'supported', reason: 'Cryptographic proof validated against root admin dashboard', timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    ]
  },
  {
    id: 'hyp_demo_04',
    sessionId: 'ses_demo_01',
    title: 'SSRF via webhook destination callback',
    securityQuestion: 'Can an attacker supply internal RFC1918 IPs to pivot into internal cloud metadata?',
    surface: 'POST /api/v1/webhooks',
    state: 'deferred',
    confidence: 'candidate',
    requiredEvidence: ['out_of_band_dns', 'internal_ip_probe'],
    findingCount: 0,
    evidenceCount: 0,
    linkedFindings: [],
    linkedEvidence: [],
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    reasons: [
      { state: 'suspected', reason: 'Webhook URL parameter takes arbitrary protocol/host', timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
      { state: 'deferred', reason: 'Requires DNS callback server outside local sandbox', timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    ]
  }
];

export const initialMockSavedReports: SavedReportItem[] = [
  {
    artifactId: '.chainsaw/artifacts/report-20261118-142000.md',
    name: 'report-20261118-142000.md',
    createdAt: '2026-11-18T14:20:00.000Z'
  }
];

export const initialMockEvidenceBindings: Record<string, EvidenceBinding[]> = {
  fnd_demo_01: [
    {
      findingId: 'fnd_demo_01',
      evidenceId: 'evd_idor_payload',
      role: 'proof',
      note: 'Replay confirms cross-tenant data leaked in HTTP response body.',
      position: 0,
      createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    },
  ],
  fnd_demo_02: [
    {
      findingId: 'fnd_demo_02',
      evidenceId: 'evd_idor_payload',
      role: 'control',
      note: 'Control attempt verified sanitization.',
      position: 0,
      createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    },
  ],
  fnd_demo_03: [],
  fnd_demo_04: [
    {
      findingId: 'fnd_demo_04',
      evidenceId: 'evd_idor_payload',
      role: 'proof',
      note: 'JWT signature weakness proof.',
      position: 0,
      createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    },
  ],
};

let mockCapturedRequests: CapturedRequest[] = JSON.parse(JSON.stringify(initialMockCapturedRequests));
let mockRequestDetails: Record<string, RequestDetailResponse> = JSON.parse(JSON.stringify(initialMockRequestDetails));
let mockCaStatus: CaStatusResponse = JSON.parse(JSON.stringify(initialMockCaStatus));
let mockProxyStatus: ProxyStatusResponse = JSON.parse(JSON.stringify(initialMockProxyStatus));
let mockFindings: Finding[] = JSON.parse(JSON.stringify(initialMockFindings));
let mockEvidenceBindings: Record<string, EvidenceBinding[]> = JSON.parse(JSON.stringify(initialMockEvidenceBindings));
let mockCoverageEntries: CoverageEntry[] = JSON.parse(JSON.stringify(initialMockCoverageEntries));
let mockHypotheses: Hypothesis[] = JSON.parse(JSON.stringify(initialMockHypotheses));
let mockSavedReports: SavedReportItem[] = JSON.parse(JSON.stringify(initialMockSavedReports));

export const initialMockSandboxStatus: SandboxStatus = {
  name: 'windows-restricted-low-integrity',
  strength: 'native',
  available: true,
  workspace: 'C:\\Projects\\BugBounty\\ChainsawRecon\\.chainsaw\\workspace',
  network: true,
  filesystemWriteConfined: true,
  restrictedToken: true,
  integrityLevel: 'low',
  readsConfined: false,
  networkConfined: false,
};

let mockSandboxStatus: SandboxStatus = JSON.parse(JSON.stringify(initialMockSandboxStatus));

export const initialMockOastTokens: Record<string, OastToken[]> = {
  prj_demo: [
    {
      token: 'oast_9f83a21b44c01d9e22fa',
      projectId: 'prj_demo',
      url: 'http://127.0.0.1:45678/t/oast_9f83a21b44c01d9e22fa',
      dnsName: 'oast_9f83a21b44c01d9e22fa.oast.local',
      note: 'Blind SSRF in PDF invoice export',
      createdAt: '2026-11-18T10:00:00Z',
      hits: 2,
    },
    {
      token: 'oast_1c7b8e4390f142ab5501',
      projectId: 'prj_demo',
      url: 'http://127.0.0.1:45678/t/oast_1c7b8e4390f142ab5501',
      dnsName: 'oast_1c7b8e4390f142ab5501.oast.local',
      note: 'Out-of-band XXE in XML parser',
      createdAt: '2026-11-18T11:15:00Z',
      hits: 0,
    },
  ],
};

export const initialMockOastEvents: Record<string, OastEvent[]> = {
  prj_demo: [
    {
      id: 1,
      token: 'oast_9f83a21b44c01d9e22fa',
      method: 'GET',
      path: '/t/oast_9f83a21b44c01d9e22fa',
      query: 'id=102&debug=true',
      headers: {
        'host': '127.0.0.1:45678',
        'user-agent': 'wkhtmltopdf/0.12.6',
        'authorization': '«redacted»',
        'cookie': '«redacted»',
        'x-originating-ip': '10.0.4.12',
      },
      body: '',
      remote: '10.0.4.12:54322',
      createdAt: '2026-11-18T10:05:22Z',
    },
    {
      id: 2,
      token: 'oast_9f83a21b44c01d9e22fa',
      method: 'POST',
      path: '/t/oast_9f83a21b44c01d9e22fa/webhook',
      query: '',
      headers: {
        'host': '127.0.0.1:45678',
        'user-agent': 'Java/11.0.18',
        'content-type': 'application/json',
        'authorization': '«redacted»',
      },
      body: '{"event":"internal_ping","service":"render-worker-2"}',
      remote: '10.0.4.15:59810',
      createdAt: '2026-11-18T10:06:45Z',
    },
    {
      id: 3,
      token: 'oast_9f83a21b44c01d9e22fa',
      method: 'DNS',
      path: 'oast_9f83a21b44c01d9e22fa.oast.local',
      query: '1',
      headers: {},
      body: '',
      remote: '10.0.4.12:53123',
      createdAt: '2026-11-18T10:07:10Z',
    },
  ],
};

let mockOastStatus: Record<string, OastStatusResponse> = {
  prj_demo: {
    running: true,
    projectId: 'prj_demo',
    host: '127.0.0.1',
    port: 45678,
    url: 'http://127.0.0.1:45678',
    dnsPort: 53535,
    dnsDomain: 'oast.local',
    tokenCount: 2,
    eventCount: 3,
  },
};

let mockOastTokens: Record<string, OastToken[]> = JSON.parse(JSON.stringify(initialMockOastTokens));
let mockOastEvents: Record<string, OastEvent[]> = JSON.parse(JSON.stringify(initialMockOastEvents));

export function setMockOastStatus(projectId: string, status: Partial<OastStatusResponse>) {
  mockOastStatus[projectId] = { ...(mockOastStatus[projectId] || { running: false, projectId }), ...status };
}

export function setMockOastTokens(projectId: string, tokens: OastToken[]) {
  mockOastTokens[projectId] = [...tokens];
}

export function setMockOastEvents(projectId: string, events: OastEvent[]) {
  mockOastEvents[projectId] = [...events];
}

export function setMockSandboxStatus(status: Partial<SandboxStatus>) {
  mockSandboxStatus = { ...mockSandboxStatus, ...status };
}

export const initialMockProjectArchives: Record<string, ProjectArchiveItem[]> = {
  prj_demo: [
    {
      name: 'archive-20261118T140000Z.zip',
      path: 'C:/labs/acme-api/.chainsaw/archives/archive-20261118T140000Z.zip',
      sizeBytes: 845210,
      createdAt: '2026-11-18T14:00:00Z',
    },
  ],
};

let mockProjectArchives: Record<string, ProjectArchiveItem[]> = JSON.parse(
  JSON.stringify(initialMockProjectArchives)
);

export function setMockServiceMode(mode: MockServiceMode) {
  currentMode = mode;
}

export function getMockServiceMode(): MockServiceMode {
  return currentMode;
}

export function resetMockData() {
  activeProjects = JSON.parse(JSON.stringify(initialMockProjects));
  activeProviders = JSON.parse(JSON.stringify(mockProviders));
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
  mockProxyStatus = JSON.parse(JSON.stringify(initialMockProxyStatus));
  mockFindings = JSON.parse(JSON.stringify(initialMockFindings));
  mockEvidenceBindings = JSON.parse(JSON.stringify(initialMockEvidenceBindings));
  mockCoverageEntries = JSON.parse(JSON.stringify(initialMockCoverageEntries));
  mockAuthProfiles = JSON.parse(JSON.stringify(initialMockAuthProfiles));
  mockHypotheses = JSON.parse(JSON.stringify(initialMockHypotheses));
  mockSavedReports = JSON.parse(JSON.stringify(initialMockSavedReports));
  mockSandboxStatus = JSON.parse(JSON.stringify(initialMockSandboxStatus));
  mockOastStatus = {
    prj_demo: {
      running: true,
      projectId: 'prj_demo',
      host: '127.0.0.1',
      port: 45678,
      url: 'http://127.0.0.1:45678',
      dnsPort: 53535,
      dnsDomain: 'oast.local',
      tokenCount: 2,
      eventCount: 3,
    },
  };
  mockOastTokens = JSON.parse(JSON.stringify(initialMockOastTokens));
  mockOastEvents = JSON.parse(JSON.stringify(initialMockOastEvents));
  mockProjectArchives = JSON.parse(JSON.stringify(initialMockProjectArchives));
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
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to load inference providers',
      request_id: 'req_providers_err',
    });
  }
  const items = currentMode === 'empty' ? [] : activeProviders;
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

export async function generateCa(): Promise<CaStatusResponse> {
  await new Promise((res) => setTimeout(res, 50));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'CA_GENERATION_FAILED',
      message: 'Failed to write CA certificate',
      request_id: 'req_ca_gen_err',
    });
  }
  mockCaStatus = {
    available: true,
    path: 'C:/Users/XYLA/.chainsaw/ca.crt',
    keyPath: 'C:/Users/XYLA/.chainsaw/ca.key',
    installed: false,
    instructions: 'Install Chainsaw CA into your Trusted Root Certification Authorities store or import ca.crt into your browser settings.',
  };
  return mockCaStatus;
}

export async function fetchProxyStatus(projectId?: string): Promise<ProxyStatusResponse> {
  await new Promise((res) => setTimeout(res, 30));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'PROXY_STATUS_FAILED',
      message: 'Backend proxy service unreachable',
      request_id: 'req_proxy_status_err',
    });
  }
  return {
    ...mockProxyStatus,
    projectId: projectId || mockProxyStatus.projectId,
    captured: mockCapturedRequests.length,
  };
}

export async function startProxy(payload: ProxyStartPayload): Promise<ProxyStatusResponse> {
  await new Promise((res) => setTimeout(res, 50));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: "cannot start proxy: [Errno 10048] error while attempting to bind on address ('127.0.0.1', 8080): only one usage of each socket address is normally permitted",
      request_id: 'req_proxy_start_err',
    });
  }
  const host = payload.host || '127.0.0.1';
  const port = payload.port || 8080;
  mockProxyStatus = {
    running: true,
    projectId: payload.projectId,
    host,
    port,
    proxyUrl: `http://${host}:${port}`,
    caPath: mockCaStatus.available ? mockCaStatus.path : null,
    captured: mockCapturedRequests.length,
    verifyUpstream: payload.verifyUpstream !== undefined ? payload.verifyUpstream : true,
  };
  return mockProxyStatus;
}

export async function stopProxy(payload: ProxyStopPayload): Promise<ProxyStatusResponse> {
  await new Promise((res) => setTimeout(res, 50));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'cannot stop proxy: proxy not found',
      request_id: 'req_proxy_stop_err',
    });
  }
  mockProxyStatus = {
    ...mockProxyStatus,
    running: false,
    projectId: payload.projectId || mockProxyStatus.projectId,
  };
  return mockProxyStatus;
}

export function setMockCaStatus(override: Partial<CaStatusResponse>) {
  mockCaStatus = { ...mockCaStatus, ...override };
}

export function setMockProxyStatus(override: Partial<ProxyStatusResponse>) {
  mockProxyStatus = { ...mockProxyStatus, ...override };
}

// ── Milestone 4: Findings Mock Handlers ─────────────────────────

export async function fetchFindings(params?: {
  projectId?: string;
  sessionId?: string;
  state?: string;
  severity?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<Paginated<Finding>> {
  await new Promise((res) => setTimeout(res, 40));

  if (currentMode === 'disconnected') {
    throw new Error('NETWORK_DISCONNECTED');
  }

  if (currentMode === 'error') {
    throw new ApiError({
      code: 'FINDINGS_UNAVAILABLE',
      message: 'Failed to retrieve project findings.',
      request_id: 'req_fnd_err_01',
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

  let items = [...mockFindings];

  if (params?.projectId) {
    items = items.filter((f) => f.projectId === params.projectId);
  }

  if (params?.sessionId) {
    items = items.filter((f) => f.sessionId === params.sessionId);
  }

  if (params?.state && params.state !== 'ALL') {
    items = items.filter((f) => f.state.toLowerCase() === params.state!.toLowerCase());
  }

  if (params?.severity && params.severity !== 'ALL') {
    items = items.filter((f) => f.severity.toLowerCase() === params.severity!.toLowerCase());
  }

  if (params?.q) {
    const qLower = params.q.toLowerCase();
    items = items.filter(
      (f) =>
        f.title.toLowerCase().includes(qLower) ||
        f.asset.toLowerCase().includes(qLower) ||
        f.vrt.toLowerCase().includes(qLower) ||
        f.id.toLowerCase().includes(qLower)
    );
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

export async function fetchFindingDetail(findingId: string): Promise<FindingDetailResponse> {
  await new Promise((res) => setTimeout(res, 40));

  if (currentMode === 'disconnected') {
    throw new Error('NETWORK_DISCONNECTED');
  }

  if (currentMode === 'error') {
    throw new ApiError({
      code: 'FINDING_NOT_FOUND',
      message: `Finding ${findingId} could not be retrieved.`,
      request_id: 'req_fnd_err_02',
    });
  }

  const finding = mockFindings.find((f) => f.id === findingId);
  if (!finding) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `Finding not found: ${findingId}`,
      request_id: 'req_fnd_404',
    });
  }

  const bindings = [...(mockEvidenceBindings[findingId] || [])].sort((a, b) => a.position - b.position);
  const evidenceIds = new Set([...(finding.evidenceIds || []), ...bindings.map((b) => b.evidenceId)]);
  const linkedEvidence = mockEvidence.filter((e) => evidenceIds.has(e.id));

  return {
    finding: { ...finding },
    evidence: linkedEvidence,
    evidenceBindings: bindings,
  };
}

export async function fetchFindingEvidence(findingId: string): Promise<Paginated<EvidenceBinding>> {
  await new Promise((res) => setTimeout(res, 30));
  if (currentMode === 'disconnected') {
    throw new Error('NETWORK_DISCONNECTED');
  }

  const finding = mockFindings.find((f) => f.id === findingId);
  if (!finding) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `finding not found: ${findingId}`,
      request_id: 'req_fevd_404',
    });
  }

  const bindings = [...(mockEvidenceBindings[findingId] || [])].sort((a, b) => a.position - b.position);
  return {
    items: bindings,
    total: bindings.length,
    limit: 200,
    offset: 0,
    next: null,
  };
}

export async function bindFindingEvidence(
  findingId: string,
  payload: FindingEvidenceBindPayload
): Promise<Paginated<EvidenceBinding>> {
  await new Promise((res) => setTimeout(res, 30));
  if (currentMode === 'disconnected') {
    throw new Error('NETWORK_DISCONNECTED');
  }

  const finding = mockFindings.find((f) => f.id === findingId);
  if (!finding) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `finding not found: ${findingId}`,
      request_id: 'req_bind_404',
    });
  }

  const evidenceItem = mockEvidence.find((e) => e.id === payload.evidenceId);
  if (!evidenceItem) {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: `evidence not recorded: ${payload.evidenceId}`,
      request_id: 'req_bind_400',
    });
  }

  if (!mockEvidenceBindings[findingId]) {
    mockEvidenceBindings[findingId] = [];
  }

  const existingIdx = mockEvidenceBindings[findingId].findIndex((b) => b.evidenceId === payload.evidenceId);
  const position = typeof payload.position === 'number' ? payload.position : mockEvidenceBindings[findingId].length;
  const newBinding: EvidenceBinding = {
    findingId,
    evidenceId: payload.evidenceId,
    role: payload.role || 'supporting',
    note: payload.note || '',
    position,
    createdAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    mockEvidenceBindings[findingId][existingIdx] = newBinding;
  } else {
    mockEvidenceBindings[findingId].push(newBinding);
  }

  mockEvidenceBindings[findingId].sort((a, b) => a.position - b.position);

  if (!finding.evidenceIds) {
    finding.evidenceIds = [];
  }
  if (!finding.evidenceIds.includes(payload.evidenceId)) {
    finding.evidenceIds.push(payload.evidenceId);
  }
  finding.evidenceVersion = (finding.evidenceVersion ?? 0) + 1;
  finding.updatedAt = new Date().toISOString();

  return {
    items: [...mockEvidenceBindings[findingId]],
    total: mockEvidenceBindings[findingId].length,
    limit: 200,
    offset: 0,
    next: null,
  };
}

export async function unbindFindingEvidence(
  findingId: string,
  evidenceId: string
): Promise<Paginated<EvidenceBinding>> {
  await new Promise((res) => setTimeout(res, 30));
  if (currentMode === 'disconnected') {
    throw new Error('NETWORK_DISCONNECTED');
  }

  const finding = mockFindings.find((f) => f.id === findingId);
  if (!finding) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `finding not found: ${findingId}`,
      request_id: 'req_unbind_404',
    });
  }

  if (mockEvidenceBindings[findingId]) {
    mockEvidenceBindings[findingId] = mockEvidenceBindings[findingId].filter((b) => b.evidenceId !== evidenceId);
  }

  if (finding.evidenceIds) {
    finding.evidenceIds = finding.evidenceIds.filter((id) => id !== evidenceId);
  }
  finding.evidenceVersion = (finding.evidenceVersion ?? 0) + 1;
  finding.updatedAt = new Date().toISOString();

  const bindings = mockEvidenceBindings[findingId] || [];
  return {
    items: [...bindings],
    total: bindings.length,
    limit: 200,
    offset: 0,
    next: null,
  };
}

export async function reorderFindingEvidence(
  findingId: string,
  evidenceIds: string[]
): Promise<Paginated<EvidenceBinding>> {
  await new Promise((res) => setTimeout(res, 30));
  if (currentMode === 'disconnected') {
    throw new Error('NETWORK_DISCONNECTED');
  }

  const finding = mockFindings.find((f) => f.id === findingId);
  if (!finding) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `finding not found: ${findingId}`,
      request_id: 'req_reorder_404',
    });
  }

  const currentBindings = mockEvidenceBindings[findingId] || [];
  const bindingMap = new Map(currentBindings.map((b) => [b.evidenceId, b]));

  const reordered: EvidenceBinding[] = [];
  evidenceIds.forEach((id, idx) => {
    const b = bindingMap.get(id);
    if (b) {
      b.position = idx;
      reordered.push(b);
      bindingMap.delete(id);
    }
  });

  let nextPos = reordered.length;
  bindingMap.forEach((b) => {
    b.position = nextPos++;
    reordered.push(b);
  });

  mockEvidenceBindings[findingId] = reordered;
  finding.evidenceIds = reordered.map((b) => b.evidenceId);
  finding.evidenceVersion = (finding.evidenceVersion ?? 0) + 1;
  finding.updatedAt = new Date().toISOString();

  return {
    items: [...reordered],
    total: reordered.length,
    limit: 200,
    offset: 0,
    next: null,
  };
}

export async function transitionFinding(
  findingId: string,
  payload: FindingTransitionPayload
): Promise<Finding> {
  await new Promise((res) => setTimeout(res, 50));

  if (currentMode === 'disconnected') {
    throw new Error('NETWORK_DISCONNECTED');
  }

  const index = mockFindings.findIndex((f) => f.id === findingId);
  if (index === -1) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `Finding not found: ${findingId}`,
      request_id: 'req_fnd_trans_404',
    });
  }

  const targetState = payload.state;
  if (!['candidate', 'validated', 'rejected'].includes(targetState)) {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'Finding state must be candidate, validated, or rejected',
      request_id: 'req_fnd_trans_invalid',
    });
  }

  const current = mockFindings[index];
  const linkedEvidence = payload.evidenceIds || payload.evidence_ids || current.evidenceIds || [];

  if (targetState === 'validated') {
    // Validated requires recorded evidence
    if (linkedEvidence.length === 0) {
      throw new ApiError({
        code: 'BAD_REQUEST',
        message: 'A validated finding requires at least one recorded evidence id',
        request_id: 'req_fnd_no_evidence',
      });
    }
  }

  if (targetState === 'rejected') {
    if (!payload.reason || !payload.reason.trim()) {
      throw new ApiError({
        code: 'BAD_REQUEST',
        message: 'Rejecting a finding requires a non-empty reason',
        request_id: 'req_fnd_no_reason',
      });
    }
  }

  const updated: Finding = {
    ...current,
    state: targetState as Finding['state'],
    evidenceIds: linkedEvidence,
    lineage: {
      ...current.lineage,
      ...(targetState === 'validated'
        ? {
            validatedBy: 'Operator',
            validatedAt: new Date().toISOString(),
          }
        : {}),
    },
    updatedAt: new Date().toISOString(),
  };

  mockFindings[index] = updated;
  return updated;
}

// ── Milestone 2.5: Coverage & Sitemap Mock Handlers (Atlas) ──────

export async function fetchAppModelCoverage(
  _projectId?: string
): Promise<ProjectCoverageResponse> {
  await new Promise((res) => setTimeout(res, 40));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'COVERAGE_UNAVAILABLE',
      message: 'Failed to retrieve project coverage ledger.',
      request_id: 'req_cov_err',
    });
  }

  const outcomes: Record<string, number> = {};
  const gaps: CoverageGap[] = [];

  mockCoverageEntries.forEach((entry) => {
    outcomes[entry.outcome] = (outcomes[entry.outcome] || 0) + 1;
    if (entry.outcome === 'needs_follow_up') {
      gaps.push({ kind: 'needs_follow_up', ...entry });
    } else if (entry.outcome === 'no_issue_found' && !entry.evidenceId) {
      gaps.push({ kind: 'missing_evidence', ...entry });
    } else if (['ruled_out', 'not_applicable'].includes(entry.outcome) && !entry.reason) {
      gaps.push({ kind: 'missing_reason', ...entry });
    }
  });

  const testedEntityIds = new Set(mockCoverageEntries.map((e) => e.entityId));

  return {
    entries: [...mockCoverageEntries],
    tested: testedEntityIds.size,
    outcomes,
    gaps,
  };
}

export async function fetchAppModelSitemap(
  projectId?: string,
  maxNodes: number = 2000
): Promise<SitemapResponse> {
  await new Promise((res) => setTimeout(res, 60));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'SITEMAP_UNAVAILABLE',
      message: 'Failed to retrieve application sitemap.',
      request_id: 'req_sitemap_err',
    });
  }

  if (currentMode === 'empty') {
    return {
      roots: [],
      sideEntities: { identities: [], technologies: [], flows: [], findings: [] },
      stats: {
        applications: 0,
        services: 0,
        routes: 0,
        inputs: 0,
        inScope: 0,
        tested: 0,
        untested: 0,
        findings: 0,
        coverageEntries: 0,
        coverageGaps: 0,
      },
      coverage: { entries: 0, tested: 0, outcomes: {}, gaps: [] },
      truncated: false,
    };
  }

  const entities = mockEntities.filter((e) => !projectId || e.projectId === projectId || e.projectId === 'prj_demo');
  const byId = new Map<string, AppEntity>();
  entities.forEach((e) => byId.set(e.id, e));

  // Build children map based on ('application', 'service'), ('service', 'route'), ('route', 'input')
  const childrenMap = new Map<string, string[]>();
  const parents = new Set<string>();

  mockEdges.forEach((edge) => {
    const source = byId.get(edge.sourceId);
    const target = byId.get(edge.targetId);
    if (!source || !target) return;

    const validChild =
      (source.kind === 'application' && target.kind === 'service') ||
      (source.kind === 'service' && target.kind === 'route') ||
      (source.kind === 'route' && target.kind === 'input');

    if (validChild) {
      const list = childrenMap.get(edge.sourceId) || [];
      list.push(edge.targetId);
      childrenMap.set(edge.sourceId, list);
      parents.add(edge.targetId);
    }
  });

  // Calculate coverage for entity
  const getEntityCoverage = (entityId: string) => {
    const entries = mockCoverageEntries.filter((e) => e.entityId === entityId);
    const outcomes: Record<string, number> = {};
    let lastTestedAt: string | null = null;
    entries.forEach((entry) => {
      outcomes[entry.outcome] = (outcomes[entry.outcome] || 0) + 1;
      if (!lastTestedAt || entry.updatedAt > lastTestedAt) {
        lastTestedAt = entry.updatedAt;
      }
    });
    return {
      tested: entries.length > 0,
      outcomes,
      lastTestedAt,
      entries,
    };
  };

  // Calculate finding count for entity
  const getFindingCount = (entity: AppEntity) => {
    return mockFindings.filter((f) => {
      if (f.entityId && f.entityId === entity.id) return true;
      if (f.asset === entity.id) return true;
      if (f.asset === entity.name) return true;
      if (entity.meta?.url && f.asset === entity.meta.url) return true;
      if (entity.meta?.path && typeof f.asset === 'string' && f.asset.includes(String(entity.meta.path))) return true;
      return false;
    }).length;
  };

  const buildNode = (entityId: string, seen: Set<string>): SitemapNode => {
    const entity = byId.get(entityId)!;
    const coverage = getEntityCoverage(entityId);
    const findingCount = getFindingCount(entity);

    if (seen.has(entityId)) {
      return {
        entity: { ...entity, coverage, findingCount },
        children: [],
      };
    }
    const nextSeen = new Set(seen);
    nextSeen.add(entityId);

    const childIds = childrenMap.get(entityId) || [];
    const children = childIds
      .map((cId) => buildNode(cId, nextSeen))
      .sort((a, b) => a.entity.name.localeCompare(b.entity.name));

    return {
      entity: { ...entity, coverage, findingCount },
      children,
    };
  };

  // Find root applications
  let rootEntities = entities.filter((e) => e.kind === 'application' && !parents.has(e.id));
  if (rootEntities.length === 0) {
    rootEntities = entities.filter((e) => ['service', 'route'].includes(e.kind) && !parents.has(e.id));
  }

  const roots = rootEntities.map((r) => buildNode(r.id, new Set()));

  const flatten = (nodes: SitemapNode[]): (AppEntity & { coverage?: any })[] => {
    const list: (AppEntity & { coverage?: any })[] = [];
    nodes.forEach((n) => {
      list.push(n.entity);
      list.push(...flatten(n.children));
    });
    return list;
  };

  const flat = flatten(roots);
  const coverageSummary = await fetchAppModelCoverage(projectId);
  const findings = entities.filter((e) => e.kind === 'finding');
  const scoped = flat.filter((e) => ['service', 'route', 'input'].includes(e.kind));
  const tested = scoped.filter((e) => e.coverage?.tested);

  return {
    roots,
    sideEntities: {
      identities: entities.filter((e) => e.kind === 'identity'),
      technologies: entities.filter((e) => e.kind === 'technology'),
      flows: entities.filter((e) => e.kind === 'flow'),
      findings,
    },
    stats: {
      applications: flat.filter((e) => e.kind === 'application').length,
      services: flat.filter((e) => e.kind === 'service').length,
      routes: flat.filter((e) => e.kind === 'route').length,
      inputs: flat.filter((e) => e.kind === 'input').length,
      inScope: scoped.length,
      tested: tested.length,
      untested: Math.max(0, scoped.length - tested.length),
      findings: findings.length || 1,
      coverageEntries: coverageSummary.entries.length,
      coverageGaps: coverageSummary.gaps.length,
    },
    coverage: {
      entries: coverageSummary.entries.length,
      tested: coverageSummary.tested,
      outcomes: coverageSummary.outcomes,
      gaps: coverageSummary.gaps,
    },
    truncated: flat.length >= maxNodes,
  };
}

export async function recordAppModelCoverage(
  _projectId: string,
  entityId: string,
  payload: RecordCoveragePayload
): Promise<CoverageEntry> {
  await new Promise((res) => setTimeout(res, 50));

  const validOutcomes = ['reported', 'no_issue_found', 'ruled_out', 'not_applicable', 'needs_follow_up'];
  if (!validOutcomes.includes(payload.outcome)) {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: `coverage outcome must be one of ${validOutcomes.join(', ')}`,
      request_id: 'req_cov_invalid_outcome',
    });
  }

  if (!payload.riskArea || !payload.riskArea.trim()) {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'riskArea is required',
      request_id: 'req_cov_no_risk',
    });
  }

  const existingIdx = mockCoverageEntries.findIndex(
    (e) => e.entityId === entityId && e.riskArea.toLowerCase() === payload.riskArea.toLowerCase()
  );

  const now = new Date().toISOString();
  if (existingIdx !== -1) {
    const existing = mockCoverageEntries[existingIdx];
    const updated: CoverageEntry = {
      ...existing,
      outcome: payload.outcome,
      surface: payload.surface || existing.surface,
      evidenceId: payload.evidenceId !== undefined ? payload.evidenceId : existing.evidenceId,
      reason: payload.reason !== undefined ? payload.reason : existing.reason,
      worker: payload.worker || existing.worker,
      updatedAt: now,
    };
    mockCoverageEntries[existingIdx] = updated;
    return updated;
  }

  const newEntry: CoverageEntry = {
    id: mockCoverageEntries.length + 1,
    entityId,
    surface: payload.surface || entityId,
    riskArea: payload.riskArea.toLowerCase(),
    outcome: payload.outcome,
    evidenceId: payload.evidenceId || null,
    reason: payload.reason || '',
    worker: payload.worker || 'operator',
    createdAt: now,
    updatedAt: now,
  };

  mockCoverageEntries.push(newEntry);
  return newEntry;
}

// ── Milestone 5: Auth Profiles Mock Handlers ──────────────────

export async function fetchAuthProfiles(_projectId: string): Promise<Paginated<AuthProfile>> {
  await new Promise((res) => setTimeout(res, 40));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to load auth profiles',
      request_id: 'req_auth_profiles_err',
    });
  }
  const items = currentMode === 'empty' ? [] : mockAuthProfiles;
  return {
    items,
    total: items.length,
    limit: 200,
    offset: 0,
    next: null,
  };
}

export async function detectAuth(_projectId: string): Promise<AuthDetection> {
  await new Promise((res) => setTimeout(res, 80));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to detect authentication mechanisms',
      request_id: 'req_detect_auth_err',
    });
  }
  return initialMockAuthDetection;
}

export async function createAuthProfile(
  projectId: string,
  payload: CreateAuthProfilePayload
): Promise<AuthProfile> {
  await new Promise((res) => setTimeout(res, 50));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'Failed to save auth profile',
      request_id: 'req_save_auth_err',
    });
  }
  const id = payload.id || `auth_${Math.random().toString(36).substring(2, 8)}`;
  const profile: AuthProfile = {
    id,
    label: payload.label,
    identity: payload.identity || '',
    role: payload.role || '',
    tenant: payload.tenant || '',
    kind: payload.kind || 'credentials',
    adapter: payload.adapter || 'auto',
    persistence: payload.persistence || 'session_only',
    targetPatterns: payload.targetPatterns || [],
    loginUrl: payload.loginUrl || '',
    verifyUrl: payload.verifyUrl || '',
    verifyIndicator: payload.verifyIndicator || '',
    usernameField: payload.usernameField,
    passwordField: payload.passwordField,
    extraFields: payload.extraFields,
    selectors: payload.selectors,
    timeout: payload.timeout || 30,
    verifyTls: payload.verifyTls !== undefined ? payload.verifyTls : true,
    headless: payload.headless || false,
    session: {
      profileId: id,
      projectId,
      status: 'none',
      adapter: payload.adapter || 'auto',
      hasCookies: false,
      hasStorageState: false,
    },
  };

  mockAuthProfiles.unshift(profile);
  return profile;
}

export async function deleteAuthProfile(_projectId: string, profileId: string): Promise<void> {
  await new Promise((res) => setTimeout(res, 30));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `Auth profile not found: ${profileId}`,
      request_id: 'req_del_auth_err',
    });
  }
  mockAuthProfiles = mockAuthProfiles.filter((p) => p.id !== profileId);
}

export async function loginAuthProfile(
  projectId: string,
  profileId: string,
  payload: AuthLoginPayload
): Promise<AuthSessionStatus> {
  await new Promise((res) => setTimeout(res, 60));
  const profile = mockAuthProfiles.find((p) => p.id === profileId);
  if (!profile) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `Auth profile not found: ${profileId}`,
      request_id: 'req_login_not_found',
    });
  }

  const adapter = payload.adapter || profile.adapter;

  if (payload.password === 'wrong' || payload.username === 'invalid') {
    profile.session = {
      profileId,
      projectId,
      status: 'failed',
      adapter,
      hasCookies: false,
      hasStorageState: false,
      warning: 'Invalid username or password supplied',
    };
    return profile.session;
  }

  profile.session = {
    profileId,
    projectId,
    status: 'active',
    adapter,
    verifiedAt: new Date().toISOString(),
    hasCookies: true,
    hasStorageState: adapter === 'browser',
    warning: undefined,
  };
  return profile.session;
}

export async function fetchAuthProfileSession(
  _projectId: string,
  profileId: string
): Promise<AuthSessionStatus> {
  await new Promise((res) => setTimeout(res, 30));
  const profile = mockAuthProfiles.find((p) => p.id === profileId);
  if (!profile) {
    return {
      profileId,
      projectId: 'prj_demo',
      status: 'none',
      hasCookies: false,
      hasStorageState: false,
    };
  }
  return profile.session;
}

export async function verifyAuthProfile(
  _projectId: string,
  profileId: string
): Promise<AuthSessionStatus & { reason?: string }> {
  await new Promise((res) => setTimeout(res, 50));
  const profile = mockAuthProfiles.find((p) => p.id === profileId);
  if (!profile) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `no session for auth profile ${profileId}`,
      request_id: 'req_verify_not_found',
    });
  }

  const now = new Date().toISOString();
  profile.session.status = 'active';
  profile.session.verifiedAt = now;
  profile.session.warning = undefined;

  return {
    ...profile.session,
    reason: 'Verification indicator matched on target verification URL.',
  };
}

export async function logoutAuthProfile(
  _projectId: string,
  profileId: string
): Promise<{ profileId: string; status: string }> {
  await new Promise((res) => setTimeout(res, 30));
  const profile = mockAuthProfiles.find((p) => p.id === profileId);
  if (profile) {
    profile.session = {
      profileId,
      projectId: profile.session.projectId,
      status: 'none',
      hasCookies: false,
      hasStorageState: false,
    };
  }
  return { profileId, status: 'none' };
}

export async function renewAuthProfile(
  _projectId: string,
  profileId: string
): Promise<AuthSessionStatus> {
  await new Promise((res) => setTimeout(res, 50));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to renew auth profile',
      request_id: 'req_renew_internal_err',
    });
  }

  const profile = mockAuthProfiles.find((p) => p.id === profileId);
  if (!profile) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `no session for auth profile ${profileId}`,
      request_id: 'req_renew_not_found',
    });
  }

  // Conflict if persistence !== 'credentials' or if specifically flagged for conflict
  if (profile.persistence !== 'credentials') {
    throw new ApiError({
      code: 'CONFLICT',
      message: 'CONFLICT: renew requires a profile with persistence=credentials and stored credentials',
      request_id: 'req_renew_conflict_no_creds',
    });
  }

  if (profile.session?.warning?.includes('operator') || profile.session?.status === 'failed') {
    throw new ApiError({
      code: 'CONFLICT',
      message: 'CONFLICT: operator login required for 2FA/CAPTCHA challenge',
      request_id: 'req_renew_conflict_operator',
    });
  }

  const now = new Date().toISOString();
  profile.session.status = 'active';
  profile.session.expired = false;
  profile.session.expiresAt = new Date(Date.now() + 86400000).toISOString();
  profile.session.verifiedAt = now;
  profile.session.warning = undefined;

  return { ...profile.session };
}

export function setMockAuthProfiles(profiles: AuthProfile[]) {
  mockAuthProfiles = [...profiles];
}

// ── Milestone 5: Session Run with Role Routing ───────────────────

export async function runSession(
  sessionId: string,
  payload: SessionRunPayload
): Promise<SessionRunResponse> {
  await new Promise((res) => setTimeout(res, 60));

  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Runner failure during session execution',
      request_id: 'req_run_internal_err',
    });
  }

  // Check unknown provider client/backend validation
  const knownProviderIds = new Set(activeProviders.map((p) => p.id));
  if (payload.providerId && !knownProviderIds.has(payload.providerId)) {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: `Unknown provider '${payload.providerId}'`,
      request_id: 'req_run_unknown_prov',
    });
  }

  if (payload.roles) {
    for (const [roleName, roleVal] of Object.entries(payload.roles)) {
      const pId = typeof roleVal === 'string' 
        ? (roleVal.includes('::') ? roleVal.split('::')[0] : roleVal.includes('/') ? roleVal.split('/')[0] : payload.providerId)
        : roleVal.providerId;
      if (pId && !knownProviderIds.has(pId)) {
        throw new ApiError({
          code: 'BAD_REQUEST',
          message: `Unknown provider '${pId}' for role '${roleName}'`,
          request_id: 'req_run_role_unknown_prov',
        });
      }
    }
  }

  const defaultProvId = payload.providerId || (activeProviders[0]?.id || 'prv_ollama');
  const defaultModelId = payload.model || (activeProviders[0]?.models?.[0]?.id || 'qwen3:14b');

  const effectiveRoles: Record<string, RoleModelSummary> = {};
  const standardRoles: ModelRole[] = ['orchestrator', 'operator', 'recon', 'validator', 'reporter'];

  for (const role of standardRoles) {
    const custom = payload.roles?.[role];
    if (custom) {
      if (typeof custom === 'string') {
        if (custom.includes('::')) {
          const [p, m] = custom.split('::');
          effectiveRoles[role] = { providerId: p, modelId: m };
        } else if (custom.includes('/')) {
          const [p, m] = custom.split('/');
          effectiveRoles[role] = { providerId: p, modelId: m };
        } else {
          effectiveRoles[role] = { providerId: defaultProvId, modelId: custom };
        }
      } else {
        effectiveRoles[role] = {
          providerId: custom.providerId || defaultProvId,
          modelId: custom.model || defaultModelId,
        };
      }
    } else {
      effectiveRoles[role] = {
        providerId: defaultProvId,
        modelId: defaultModelId,
      };
    }
  }

  return {
    sessionId,
    model: defaultModelId,
    steps: payload.maxSteps || 10,
    finished: true,
    reason: 'goal_completed',
    roles: effectiveRoles,
  };
}

// ── Milestone 5: Tool Agent Run Mock Handlers ─────────────────

export async function toolRunSession(
  sessionId: string,
  payload: ToolRunPayload
): Promise<ToolRunResponse> {
  await new Promise((res) => setTimeout(res, 120));

  if (!payload.prompt || !payload.prompt.trim()) {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'Prompt cannot be empty',
      request_id: 'req_tool_run_empty',
    });
  }

  if (currentMode === 'error') {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'no provider configured; add one before running a tool session',
      request_id: 'req_tool_run_no_provider',
    });
  }

  if (payload.authProfileId === 'auth_invalid_session') {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: `no active session for auth profile ${payload.authProfileId}`,
      request_id: 'req_tool_run_no_auth',
    });
  }

  const toolCalls: ToolCallItem[] = [
    {
      name: 'workbench.search',
      arguments: { q: 'invoices', method: 'GET' },
      result: { ok: true, count: 2, flows: ['req_01', 'req_02'] },
    },
    {
      name: 'http.replay',
      arguments: {
        requestId: 'req_01',
        patch: { query: { tenant: 'tenant_b' } },
        justification: 'Test cross-tenant invoice boundary',
      },
      result: {
        ok: true,
        response: { status: 403, headers: { 'content-type': 'application/json' } },
        evidenceId: 'evd_invoice_boundary_403',
        scope: { allowed: true },
      },
      evidenceId: 'evd_invoice_boundary_403',
    },
  ];

  if (payload.allowShell) {
    toolCalls.push({
      name: 'shell.exec',
      arguments: {
        command: 'curl -s -i https://api.example.com/api/v1/invoices/102',
        cwd: '.',
        timeout: 30,
      },
      result: {
        ok: true,
        exitCode: 0,
        stdout: 'HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\n\r\n{"error":"tenant_mismatch"}',
        stderr: '',
        timedOut: false,
        truncated: false,
        evidenceId: 'evd_shell_output_01',
        sandbox: {
          name: mockSandboxStatus.name,
          strength: mockSandboxStatus.strength,
          available: mockSandboxStatus.available,
          workspace: mockSandboxStatus.workspace,
          network: mockSandboxStatus.network,
        },
      },
      evidenceId: 'evd_shell_output_01',
    });
  }

  toolCalls.push({
    name: 'evidence.record',
    arguments: {
      requestId: 'req_01',
      note: 'Confirmed 403 Forbidden response on cross-tenant invoice read',
    },
    result: { ok: true, evidence: { id: 'evd_invoice_boundary_403' } },
    evidenceId: 'evd_invoice_boundary_403',
  });

  return {
    sessionId,
    model: payload.model || 'qwen3:14b',
    taskId: `tsk_tool_${Math.random().toString(36).substring(2, 8)}`,
    status: 'completed',
    finalText: `Completed task for prompt: "${payload.prompt}". Replayed scoped requests and recorded evidence.`,
    steps: toolCalls.length,
    toolCalls,
  };
}

export async function fetchSandboxStatus(_projectId: string): Promise<SandboxStatus> {
  await new Promise((res) => setTimeout(res, 20));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to query sandbox status',
      request_id: 'req_sandbox_err',
    });
  }
  return mockSandboxStatus;
}

// ── Milestone 5: Providers & Web UI Mock Handlers ─────────────

export async function createProvider(payload: ProviderCreatePayload): Promise<ProviderItem> {
  await new Promise((res) => setTimeout(res, 50));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'Failed to create provider',
      request_id: 'req_create_provider_err',
    });
  }

  const id = `prv_${Math.random().toString(36).substring(2, 8)}`;
  const provider: ProviderItem = {
    id,
    name: payload.name,
    type: payload.type as any,
    engine: payload.engine,
    baseUrl: payload.baseUrl,
    apiKeyRef: payload.apiKeyRef,
    models: payload.models || [
      {
        id: payload.engine ? `${payload.engine.toLowerCase()}-web` : 'custom-model',
        name: payload.name,
        providerId: id,
        contextWindow: 32768,
        maxOutput: 8192,
        available: true,
      },
    ],
    status: 'healthy',
    reliability: payload.reliability || 'stable',
    profileDir: payload.profileDir,
    headless: payload.headless,
    selectors: payload.selectors,
  };

  activeProviders.push(provider);
  return provider;
}

export async function fetchProviderHealth(providerId: string): Promise<ProviderHealthResponse> {
  await new Promise((res) => setTimeout(res, 50));
  const provider = activeProviders.find((p) => p.id === providerId);
  if (!provider) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `provider not found: ${providerId}`,
      request_id: 'req_health_not_found',
    });
  }

  return {
    ok: true,
    loggedIn: true,
    engine: provider.engine || provider.name,
    url: provider.baseUrl || 'https://chatgpt.com',
    model: provider.models?.[0]?.id || 'gpt-4o',
  };
}

export async function calibrateProvider(providerId: string): Promise<ProviderCalibrateResponse> {
  await new Promise((res) => setTimeout(res, 60));
  const provider = activeProviders.find((p) => p.id === providerId);
  if (!provider) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `provider not found: ${providerId}`,
      request_id: 'req_calibrate_not_found',
    });
  }

  return {
    title: provider.engine || provider.name,
    url: provider.baseUrl || 'https://chatgpt.com',
    hasPassword: false,
    counts: {
      input: [{ selector: '#prompt-textarea', count: 1 }],
      send: [{ selector: "button[data-testid='send-button']", count: 1 }],
      assistant: [{ selector: "[data-message-author-role='assistant']", count: 2 }],
      login: [{ selector: "a[href*='login']", count: 0 }],
      challenge: [{ selector: "iframe[src*='challenges']", count: 0 }],
    },
  };
}

// ── Milestone 6: Hypotheses & Reports Mock Handlers ───────────

export async function fetchHypotheses(sessionId: string): Promise<Paginated<Hypothesis>> {
  await new Promise((res) => setTimeout(res, 40));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to load hypotheses',
      request_id: 'req_hyp_err',
    });
  }
  const items = currentMode === 'empty' ? [] : mockHypotheses.filter(
    (h) => !sessionId || h.sessionId === sessionId || h.sessionId === 'ses_demo_01'
  );
  return {
    items,
    total: items.length,
    limit: 200,
    offset: 0,
    next: null,
  };
}

export async function createHypothesis(
  sessionId: string,
  payload: HypothesisCreatePayload
): Promise<Hypothesis> {
  await new Promise((res) => setTimeout(res, 50));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'Failed to create hypothesis',
      request_id: 'req_hyp_create_err',
    });
  }
  if (!payload.title || !payload.title.trim()) {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'Hypothesis title is required',
      request_id: 'req_hyp_no_title',
    });
  }
  if (!payload.securityQuestion || !payload.securityQuestion.trim()) {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'Hypothesis securityQuestion is required',
      request_id: 'req_hyp_no_question',
    });
  }

  const id = `hyp_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();
  const hypothesis: Hypothesis = {
    id,
    sessionId: sessionId || 'ses_demo_01',
    title: payload.title.trim(),
    securityQuestion: payload.securityQuestion.trim(),
    surface: payload.surface || '',
    state: payload.state || 'suspected',
    confidence: payload.confidence || 'candidate',
    requiredEvidence: payload.requiredEvidence || [],
    findingCount: 0,
    evidenceCount: 0,
    linkedFindings: [],
    linkedEvidence: [],
    createdAt: now,
    updatedAt: now,
    reasons: [
      {
        state: payload.state || 'suspected',
        reason: 'Initial formulation',
        timestamp: now,
      },
    ],
  };

  mockHypotheses.unshift(hypothesis);
  return hypothesis;
}

export async function transitionHypothesis(
  _sessionId: string,
  hypothesisId: string,
  payload: HypothesisTransitionPayload
): Promise<Hypothesis> {
  await new Promise((res) => setTimeout(res, 50));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to transition hypothesis',
      request_id: 'req_hyp_transition_err',
    });
  }
  if (!payload.reason || !payload.reason.trim()) {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'A reason is mandatory when transitioning a hypothesis.',
      request_id: 'req_hyp_no_reason',
    });
  }

  const hypothesis = mockHypotheses.find((h) => h.id === hypothesisId);
  if (!hypothesis) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: `Hypothesis not found: ${hypothesisId}`,
      request_id: 'req_hyp_not_found',
    });
  }

  const now = new Date().toISOString();
  hypothesis.state = payload.state;
  hypothesis.updatedAt = now;
  if (!hypothesis.reasons) hypothesis.reasons = [];
  hypothesis.reasons.push({
    state: payload.state,
    reason: payload.reason.trim(),
    timestamp: now,
  });

  return hypothesis;
}

export async function fetchSessionReport(
  sessionId: string,
  includeCandidates = false
): Promise<SessionReport> {
  await new Promise((res) => setTimeout(res, 60));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to generate session report',
      request_id: 'req_report_err',
    });
  }

  const findings = currentMode === 'empty' ? [] : mockFindings.filter(
    (f) => f.state === 'validated' || (includeCandidates && f.state === 'candidate')
  );
  const hypotheses = currentMode === 'empty' ? [] : mockHypotheses.filter(
    (h) => !sessionId || h.sessionId === sessionId || h.sessionId === 'ses_demo_01'
  );
  const coverageGaps = [
    { kind: 'route', surface: '/api/v1/billing/export', riskArea: 'Authorization / BOLA' },
    { kind: 'route', surface: '/api/v1/auth/exchange', riskArea: 'Timing Differential' }
  ];

  const lines: string[] = [
    '# Democorp Platform — Security Assessment',
    '',
    `**Session:** Alpha Recon (\`${sessionId || 'ses_demo_01'}\`)`,
    `**Generated:** ${new Date().toISOString()}`,
    '**Scope:** api.example.com, app.example.com',
    `**Candidate Inclusion:** ${includeCandidates ? 'Yes (Candidate findings included)' : 'No (Validated findings only)'}`,
    '',
    '## Executive Summary',
    '',
    `- Validated findings: ${mockFindings.filter((f) => f.state === 'validated').length}`,
    `- Candidate findings: ${mockFindings.filter((f) => f.state === 'candidate').length}`,
    `- Hypotheses tested: ${hypotheses.length}`,
    `- Coverage gaps: ${coverageGaps.length}`,
    '',
    '## Findings',
    '',
  ];

  if (findings.length === 0) {
    lines.push('No findings match the current report criteria.');
  } else {
    lines.push('| Severity | Finding | Asset | State | Evidence |');
    lines.push('|---|---|---|---|---|');
    for (const f of findings) {
      lines.push(`| ${f.severity.toUpperCase()} | ${f.title} | ${f.asset} | ${f.state} | ${f.evidenceIds.length} |`);
    }
    lines.push('');
    findings.forEach((f, idx) => {
      lines.push(`### ${idx + 1}. ${f.title}`);
      lines.push('');
      lines.push(`- **Severity:** ${f.severity}`);
      lines.push(`- **State:** ${f.state}`);
      lines.push(`- **Asset:** ${f.asset}`);
      lines.push(`- **Security Question:** ${f.securityQuestion || '—'}`);
      lines.push(`- **Impact:** ${f.impact || '—'}`);
      lines.push(`- **Remediation:** ${f.remediation || '—'}`);
      if (f.evidenceIds.length > 0) {
        lines.push(`- **Recorded Evidence IDs:** ${f.evidenceIds.map((e) => `\`${e}\``).join(', ')}`);
      }
      lines.push('');
    });
  }

  lines.push('## Hypotheses');
  lines.push('');
  if (hypotheses.length === 0) {
    lines.push('No hypotheses recorded for this session.');
  } else {
    for (const h of hypotheses) {
      lines.push(`- **${h.title}** (\`${h.state}\`) — Question: ${h.securityQuestion} [Surface: \`${h.surface}\`]`);
    }
  }
  lines.push('');

  lines.push('## Coverage & Completeness');
  lines.push('');
  lines.push('Absence of findings is not proof of clean scope. Coverage gaps indicate unexplored or incomplete attack surfaces.');
  lines.push('');
  if (coverageGaps.length > 0) {
    lines.push('### Open Coverage Gaps');
    lines.push('');
    for (const gap of coverageGaps) {
      lines.push(`- ${gap.kind}: \`${gap.surface}\` (${gap.riskArea})`);
    }
  }

  return {
    projectId: 'prj_demo',
    sessionId: sessionId || 'ses_demo_01',
    generatedAt: new Date().toISOString(),
    includeCandidates,
    markdown: lines.join('\n'),
    findings,
    hypotheses,
    evidence: mockEvidence,
    coverage: {
      entries: mockCoverageEntries.length,
      tested: mockCoverageEntries.length,
      outcomes: { reported: 1, ruled_out: 1, needs_follow_up: 1 },
      gaps: coverageGaps,
    },
    appModel: {
      entities: mockEntities.length,
      edges: mockEdges.length,
    },
  };
}

export async function saveSessionReport(
  sessionId: string,
  includeCandidates = false
): Promise<SaveSessionReportResponse> {
  await new Promise((res) => setTimeout(res, 60));
  const report = await fetchSessionReport(sessionId, includeCandidates);
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const filename = `report-${timestamp}.md`;
  const artifactId = `.chainsaw/artifacts/${filename}`;
  mockSavedReports.unshift({
    artifactId,
    name: filename,
    createdAt: new Date().toISOString(),
  });
  return {
    sessionId: sessionId || 'ses_demo_01',
    artifactId,
    generatedAt: report.generatedAt,
    findingCount: report.findings.length,
  };
}

export async function listSessionReports(_sessionId?: string): Promise<Paginated<SavedReportItem>> {
  await new Promise((res) => setTimeout(res, 40));
  const items = currentMode === 'empty' ? [] : mockSavedReports;
  return {
    items,
    total: items.length,
    limit: 100,
    offset: 0,
    next: null,
  };
}

export async function exportSessionReport(
  sessionId: string,
  format: ReportExportFormat = 'markdown',
  includeCandidates = false
): Promise<ReportExportResponse> {
  await new Promise((res) => setTimeout(res, 40));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to export session report',
      request_id: 'req_export_err',
    });
  }

  const report = await fetchSessionReport(sessionId, includeCandidates);

  if (format === 'json') {
    return {
      format: 'json',
      contentType: 'application/json',
      content: JSON.stringify(report, null, 2),
    };
  }

  if (format === 'html') {
    const htmlContent = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${report.projectId} — ${report.sessionId}</title>
<style>
  body { font-family: sans-serif; max-width: 980px; margin: 2rem auto; padding: 0 1rem; }
  pre { background: #f8fafc; border: 1px solid #e5e7eb; padding: 1rem; overflow: auto; }
</style>
</head>
<body>
<h1>${report.projectId} — Security Assessment Report</h1>
<pre>${report.markdown}</pre>
</body>
</html>`;
    return {
      format: 'html',
      contentType: 'text/html',
      content: htmlContent,
    };
  }

  if (format !== 'markdown' && (format as string) !== 'md') {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'format must be markdown, html, or json',
      request_id: 'req_export_400',
    });
  }

  return {
    format: 'markdown',
    contentType: 'text/markdown',
    content: report.markdown,
  };
}

export async function downloadSessionReport(
  _sessionId: string,
  filename: string
): Promise<{ filename: string; contentType: string; content: string }> {
  await new Promise((res) => setTimeout(res, 30));
  if (!filename.startsWith('report-') || !filename.endsWith('.md')) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: 'report not found',
      request_id: 'req_dl_404',
    });
  }

  const item = mockSavedReports.find((r) => r.name === filename || r.artifactId.endsWith(filename));
  if (!item) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: 'report not found',
      request_id: 'req_dl_404',
    });
  }

  return {
    filename,
    contentType: 'text/markdown',
    content: `# Security Assessment Report — ${filename}\n\nArtifact: ${item.artifactId}\nCreated: ${item.createdAt}\n\nCross-tenant read confirmed.`,
  };
}

// ── Milestone 7: OAST Mock Endpoints ──────────────────────────────

export async function fetchOastStatus(projectId: string): Promise<OastStatusResponse> {
  await new Promise((res) => setTimeout(res, 30));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to fetch OAST status',
      request_id: 'req_oast_status_err',
    });
  }
  return mockOastStatus[projectId] || { running: false, projectId };
}

export async function startOastServer(
  projectId: string,
  payload?: OastStartPayload
): Promise<OastStatusResponse> {
  await new Promise((res) => setTimeout(res, 50));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'BAD_REQUEST',
      message: 'cannot start OAST: Address already in use',
      request_id: 'req_oast_start_err',
    });
  }
  const host = payload?.host || '127.0.0.1';
  const port = payload?.port && payload.port !== 0 ? payload.port : 45678;
  const dnsPort = payload?.dnsPort && payload.dnsPort !== 0 ? payload.dnsPort : 53535;
  const dnsDomain = payload?.dnsDomain?.trim() || 'oast.local';
  const tokens = mockOastTokens[projectId] || [];
  const events = mockOastEvents[projectId] || [];

  const status: OastStatusResponse = {
    running: true,
    projectId,
    host,
    port,
    url: `http://${host}:${port}`,
    dnsPort,
    dnsDomain,
    tokenCount: tokens.length,
    eventCount: events.length,
  };
  mockOastStatus[projectId] = status;
  return status;
}

export async function stopOastServer(projectId: string): Promise<OastStatusResponse> {
  await new Promise((res) => setTimeout(res, 40));
  const status: OastStatusResponse = {
    running: false,
    projectId,
  };
  mockOastStatus[projectId] = status;
  return status;
}

export async function createOastToken(
  projectId: string,
  payload?: OastTokenCreatePayload
): Promise<OastToken> {
  await new Promise((res) => setTimeout(res, 40));
  const current = mockOastStatus[projectId];
  if (!current?.running) {
    throw new ApiError({
      code: 'CONFLICT',
      message: 'CONFLICT: start OAST before creating tokens',
      request_id: 'req_oast_token_conflict',
    });
  }
  const token = 'oast_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
  const host = current.host || '127.0.0.1';
  const port = current.port || 45678;
  const dnsDomain = current.dnsDomain || 'oast.local';
  const dnsName = `${token}.${dnsDomain}`;
  const newToken: OastToken = {
    token,
    projectId,
    url: `http://${host}:${port}/t/${token}`,
    dnsName,
    note: payload?.note?.trim() || 'New out-of-band interaction token',
    createdAt: new Date().toISOString(),
    hits: 0,
  };
  if (!mockOastTokens[projectId]) {
    mockOastTokens[projectId] = [];
  }
  mockOastTokens[projectId].unshift(newToken);
  if (mockOastStatus[projectId]) {
    mockOastStatus[projectId].tokenCount = mockOastTokens[projectId].length;
  }
  return newToken;
}

export async function fetchOastTokens(projectId: string): Promise<Paginated<OastToken>> {
  await new Promise((res) => setTimeout(res, 40));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to fetch OAST tokens',
      request_id: 'req_oast_tokens_err',
    });
  }
  const items = currentMode === 'empty' ? [] : (mockOastTokens[projectId] || []);
  return {
    items,
    total: items.length,
    limit: 200,
    offset: 0,
    next: null,
  };
}

export async function fetchOastEvents(
  projectId: string,
  token?: string
): Promise<Paginated<OastEvent>> {
  await new Promise((res) => setTimeout(res, 40));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to fetch OAST events',
      request_id: 'req_oast_events_err',
    });
  }
  let events = currentMode === 'empty' ? [] : (mockOastEvents[projectId] || []);
  if (token) {
    events = events.filter((e) => e.token === token);
  }
  return {
    items: events,
    total: events.length,
    limit: 500,
    offset: 0,
    next: null,
  };
}

export async function listProjectArchives(projectId: string): Promise<Paginated<ProjectArchiveItem>> {
  await new Promise((res) => setTimeout(res, 40));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to list project archives',
      request_id: 'req_arch_list_err',
    });
  }
  if (currentMode === 'empty') {
    return { items: [], total: 0, limit: 100, offset: 0, next: null };
  }
  const items = mockProjectArchives[projectId] || [];
  return {
    items,
    total: items.length,
    limit: 100,
    offset: 0,
    next: null,
  };
}

export async function createProjectArchive(
  projectId: string,
  payload: CreateArchivePayload
): Promise<CreateArchiveResponse> {
  await new Promise((res) => setTimeout(res, 80));
  if (currentMode === 'error') {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'Failed to create project archive',
      request_id: 'req_arch_create_err',
    });
  }
  const now = new Date().toISOString();
  const stamp = now.replace(/\D/g, '').slice(0, 15) + 'Z';
  const name = `archive-${stamp}.zip`;
  const sizeBytes = payload.includeWorkspace ? 4850200 : 942300;
  const fileCount = payload.includeWorkspace ? 84 : 32;
  const sha256 = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const path = `C:/labs/acme-api/.chainsaw/archives/${name}`;

  const archiveItem: ProjectArchiveItem = {
    name,
    path,
    sizeBytes,
    createdAt: now,
  };

  if (!mockProjectArchives[projectId]) {
    mockProjectArchives[projectId] = [];
  }
  mockProjectArchives[projectId].unshift(archiveItem);

  return {
    projectId,
    name,
    path,
    sizeBytes,
    sha256,
    createdAt: now,
    includeWorkspace: Boolean(payload.includeWorkspace),
    fileCount,
  };
}

export async function downloadProjectArchive(
  _projectId: string,
  _filename: string
): Promise<Blob> {
  await new Promise((res) => setTimeout(res, 40));
  return new Blob(['PK\x03\x04mock-zip-content'], { type: 'application/zip' });
}




