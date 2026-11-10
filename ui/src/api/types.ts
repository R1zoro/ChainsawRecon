/**
 * Strict TypeScript API types derived directly from
 * Research/frontend/api-contract.md
 * 
 * Rules:
 * - Zero `any` types
 * - Strict discriminated unions and error envelopes
 */

export type SessionStatus = 'running' | 'paused' | 'blocked' | 'completed' | 'failed' | 'idle';
export type ScanMode = 'mapping' | 'recon' | 'attack' | 'assistant' | 'auto';
export type ScopeStatus = 'ok' | 'empty' | 'invalid';
export type ActivityKind = 'finding' | 'scope' | 'session' | 'hypothesis' | 'verification';
export type SandboxStatus = 'native' | 'docker' | 'unavailable';
export type AuthKind = 'none' | 'credentials' | 'manual_handover' | 'saved_session' | 'oauth' | 'api_token';
export type AuthPersistence = 'none' | 'session_only' | 'credentials';
export type ModelRole = 'orchestrator' | 'recon' | 'operator' | 'validator' | 'reporter';
export type MockServiceMode = 'healthy' | 'empty' | 'error' | 'partial' | 'disconnected';

export interface BudgetUsed {
  modelCalls: number;
  toolCalls: number;
  wallSeconds: number;
}

export interface BudgetAllocation {
  modelCalls: number;
  toolCalls: number;
  wallSeconds: number;
  used: BudgetUsed;
}

export interface ActiveSessionSummary {
  id: string;
  projectId: string;
  title: string;
  status: SessionStatus;
  mode: ScanMode;
  elapsedSeconds: number;
  lastEventSummary: string;
  lastEventAt: string;
  budget?: BudgetAllocation;
  blockingReason?: string;
  requiredAction?: string;
  provider?: string;
  model?: string;
  targets?: string[];
}

export interface ProjectCoverage {
  applications: number;
  services: number;
  routes: number;
  inputs: number;
  identities: number;
  staleAssets: number;
  technologies?: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  scopeStatus: ScopeStatus;
  scopeHash?: string;
  targets: string[];
  sessionCount: number;
  openFindings: number;
  coverage?: ProjectCoverage;
  activeSession?: ActiveSessionSummary | null;
}

export interface RecentActivityItem {
  id: string;
  projectId: string;
  projectName: string;
  summary: string;
  ts: string;
  kind: ActivityKind;
  targetUrl?: string;
}

export interface ProvidersHealthCounts {
  healthy: number;
  degraded: number;
  unavailable: number;
}

export interface ToolPacksHealthCounts {
  installed: number;
  total: number;
}

export interface AuthProfilesHealthCounts {
  active: number;
  expired: number;
}

export interface EnvironmentHealth {
  providers: ProvidersHealthCounts;
  toolPacks: ToolPacksHealthCounts;
  authProfiles: AuthProfilesHealthCounts;
  sandbox: SandboxStatus;
  warnings?: string[];
}

export interface GlobalSettings {
  theme: string;
  density: 'comfortable' | 'compact';
  telemetryEnabled: boolean;
}

export interface HomeDataResponse {
  recentProjects: ProjectSummary[];
  recentActivity: RecentActivityItem[];
  activeSession?: ActiveSessionSummary | null;
  environment: EnvironmentHealth;
  globalSettings?: GlobalSettings;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: number | string | null;
}

export interface ApiErrorDetails {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  request_id: string;
  retryable?: boolean;
}

export interface ApiErrorEnvelope {
  error: ApiErrorDetails;
}

export interface ModelOption {
  id: string;
  name: string;
  providerId: string;
  contextWindow: number;
  maxOutput: number;
  available: boolean;
}

export interface ProviderItem {
  id: string;
  name: string;
  type: 'openai-compatible' | 'browser' | 'cli';
  status: 'healthy' | 'degraded' | 'unavailable';
  models: ModelOption[];
}

export interface AuthProfileConfig {
  id: string;
  label: string;
  identity: string;
  kind: AuthKind;
  persistence: AuthPersistence;
  targetPatterns?: string[];
  loginUrl?: string;
  verifyUrl?: string;
  verifyIndicator?: string;
  maintainCookies?: string[];
}

export interface ScopeInputPayload {
  programName?: string;
  allowedDomains?: string[];
  excludedDomains?: string[];
  allowedUrls?: string[];
  notes?: string;
  rateLimits?: Record<string, unknown>;
}

export interface AuthProfilePayload {
  id?: string;
  label: string;
  identity: string;
  role?: string;
  tenant?: string;
  kind: string;
  persistence: AuthPersistence;
  targetPatterns?: string[];
  loginUrl?: string;
  verifyUrl?: string;
  verifyIndicator?: string;
  maintainCookies?: string[];
}

export interface ProjectCreatePayload {
  path: string;
  name: string;
  targets?: string[];
  rawScope?: string;
  scope?: ScopeInputPayload;
  authProfiles?: AuthProfilePayload[];
  roles?: Record<string, string>;
  phases?: string[];
}

export interface JournalEvent {
  seq: number;
  ts: string;
  sessionId: string;
  type: string;
  actor: string;
  turn?: number | null;
  step?: number | null;
  refs?: Record<string, string>;
  data?: Record<string, unknown> | unknown;
  visibility?: string;
}

export interface JournalResponse extends Paginated<JournalEvent> {
  lastSeq: number;
  verified: boolean;
}

export interface JournalStreamFrame {
  kind: 'journal';
  sessionId: string;
  event: JournalEvent;
}

export type TaskStatus = 
  | 'proposed' 
  | 'ready' 
  | 'leased' 
  | 'started' 
  | 'attempted' 
  | 'observed' 
  | 'completed' 
  | 'blocked' 
  | 'deferred' 
  | 'failed';

export interface TaskItem {
  id: string;
  kind: string;
  title: string;
  status: TaskStatus;
  risk?: string;
  target?: string;
  objective?: string;
  doneWhen?: string;
  allowedTools?: string[];
  dependencies?: string[];
  evidenceRequired?: string[];
  basisIds?: string[];
  createdAt?: string;
  updatedAt?: string;
  attempts?: number;
  lastError?: string;
}

export type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical';
export type ApprovalStatus = 'pending' | 'granted' | 'denied' | 'expired';

export interface ApprovalItem {
  id: string;
  taskId?: string;
  kind: string;
  title: string;
  detail: string;
  risk: ApprovalRisk;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt?: string | null;
}

export interface EvidenceItem {
  id: string;
  kind: string;
  summary: string;
  artifactId?: string;
  hash?: string;
  hypothesisId?: string;
  taskId?: string;
  promoted?: boolean | number;
  createdAt: string;
}

export interface ProjectScopeResponse {
  scopeJson: Record<string, unknown>;
  hash: string | null;
  valid: boolean | null;
}

export interface RoleContextItem {
  role: ModelRole;
  modelId: string;
  budgetTokens: number;
  usedTokens: number;
  compressionRatio?: number;
  fit: boolean;
  warnings: string[];
  sections?: Array<{ name: string; tokens: number; content?: string }>;
}

export interface SessionContextResponse {
  roles: RoleContextItem[];
}

// ── Milestone 2: Application Model Types ─────────────────────────

export type AppEntityKind =
  | 'application'
  | 'service'
  | 'route'
  | 'input'
  | 'identity'
  | 'entity'
  | 'flow'
  | 'technology'
  | 'finding';

export type EntityConfidence = 'observed' | 'tentative' | 'confirmed';

export interface AppEntity {
  id: string;
  projectId: string;
  kind: AppEntityKind;
  name: string;
  revision: number;
  confidence: EntityConfidence;
  firstSeen: string;
  lastSeen: string;
  stale: boolean;
  tags: string[];
  meta: Record<string, unknown>;
}

export interface AppEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  confidence: string;
  trustBoundary: boolean;
  meta: Record<string, unknown>;
}

export interface AppGraphResponse {
  entities: AppEntity[];
  edges: AppEdge[];
  truncated: boolean;
  totalEntities: number;
}

export interface NoteItem {
  id: number;
  entityId: string;
  content: string;
  createdAt: string;
}

export interface EntityDetailResponse {
  entity: AppEntity;
  edges: AppEdge[];
  notes: NoteItem[];
}

export interface AppModelSummary {
  projectId: string;
  counts: Record<string, number>;
  staleAssets: number;
  edges: number;
}

// ── Milestone 3: Native HTTP Workbench Types ────────────────────

export interface CapturedRequest {
  id: string;
  method: string;
  url: string;
  host: string;
  path: string;
  status: number;
  requestHeaders: Record<string, string>; // redacted
  requestBodyPreview: string;
  responseHeaders: Record<string, string>; // redacted
  responseBodyPreview: string;
  sizeBytes: number;
  durationMs: number;
  authContext: string;
  tags: string[];
  capturedAt: string;
  inScope: boolean;
}

export interface RequestDetailResponse {
  requestId: string;
  request: CapturedRequest;
  rawRequest: string;       // redacted
  rawResponse: string;      // redacted
  truncated: boolean;
}

export interface ReplayPayload {
  requestId: string;
  patch?: {
    query?: Record<string, string>;
    path?: string;
    header?: Record<string, string>;
    cookie?: Record<string, string>;
    form?: Record<string, string>;
    json?: unknown;
  };
  sessionId?: string;
}

export interface ReplayResult {
  request: CapturedRequest;
  response: {
    status: number;
    headers: Record<string, string>;
    body: string;
    rawResponse: string;
    durationMs: number;
    sizeBytes: number;
  };
  scope: {
    allowed: boolean;
    reason: string;
  };
  evidenceId?: string;
}

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNum?: number;
}

export interface ResponseCompareResponse {
  statusChanged: boolean;
  baselineStatus: number;
  candidateStatus: number;
  headersDiff: DiffLine[];
  bodyDiff: DiffLine[];
  summary: string;
}

export interface CreateEvidencePayload {
  requestId: string;
  responseId: string;
  hypothesisId?: string;
  taskId?: string;
  note?: string;
}

export interface CaStatusResponse {
  available: boolean;
  path?: string;
  installed?: boolean;
  instructions: string;
}


