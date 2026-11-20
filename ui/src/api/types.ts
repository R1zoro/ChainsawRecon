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
export type EnvironmentSandboxStatus = 'native' | 'docker' | 'unavailable';
export type AuthKind = 'none' | 'credentials' | 'manual_handover' | 'saved_session' | 'oauth' | 'api_token';
export type AuthPersistence = 'none' | 'session_only' | 'credentials';
export type AuthAdapter = 'auto' | 'http_form' | 'http_json' | 'browser' | 'headers' | 'operator';
export type AuthSessionState = 'none' | 'active' | 'needs_verification' | 'failed' | 'expired' | 'authenticating';
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

export interface ProjectArchiveItem {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

export interface CreateArchivePayload {
  includeWorkspace?: boolean;
}

export interface CreateArchiveResponse {
  projectId: string;
  name: string;
  path: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  includeWorkspace: boolean;
  fileCount: number;
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
  sandbox: EnvironmentSandboxStatus;
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
  providerId?: string;
  contextWindow?: number;
  maxOutput?: number;
  available?: boolean;
}

export type ProviderType = 'openai-compatible' | 'browser' | 'cli' | 'webui' | 'ollama' | 'groq' | 'mock';

export interface ProviderItem {
  id: string;
  name: string;
  type: ProviderType;
  status: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  models: ModelOption[];
  engine?: string;
  baseUrl?: string;
  apiKeyRef?: string;
  reliability?: string;
  profileDir?: string;
  headless?: boolean;
  selectors?: Record<string, unknown>;
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
  projectId?: string;
  patch?: {
    query?: Record<string, string>;
    path?: string;
    url?: string;
    method?: string;
    header?: Record<string, string>;
    cookie?: Record<string, string>;
    form?: Record<string, string>;
    json?: unknown;
  };
  sessionId?: string;
  justification?: string;
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
  path?: string | null;
  keyPath?: string | null;
  installed?: boolean;
  instructions: string;
}

export interface ProxyStatusResponse {
  running: boolean;
  projectId: string;
  host?: string;
  port?: number;
  proxyUrl?: string;
  caPath?: string | null;
  captured?: number;
  verifyUpstream?: boolean;
}

export interface ProxyStartPayload {
  projectId: string;
  host?: string;
  port?: number;
  verifyUpstream?: boolean;
}

export interface ProxyStopPayload {
  projectId: string;
}

// ── Milestone 4: Findings Types ─────────────────────────────────

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type FindingState =
  | 'candidate'
  | 'validated'
  | 'rejected'
  | 'observed'
  | 'suspected'
  | 'experiment_planned'
  | 'reproduced'
  | 'deferred'
  | 'blocked';

export interface GateQuestion {
  id: number;
  passed: boolean;
  reason: string;
}

export interface FindingGate {
  passed: boolean;
  questions: GateQuestion[];
}

export interface FindingReproductionStep {
  step: number;
  description: string;
  requestId?: string;
  expected?: string;
  actual?: string;
}

export interface Finding {
  id: string;
  projectId: string;
  sessionId: string;
  title: string;
  severity: FindingSeverity;
  vrt: string;
  state: FindingState;
  asset: string;
  entityId?: string;
  hypothesisId?: string;
  evidenceIds: string[];
  evidenceVersion?: number;
  gate?: FindingGate;
  securityQuestion?: string;
  impact?: string;
  remediation?: string;
  reproduction?: string | FindingReproductionStep[];
  lineage?: {
    hypothesisId?: string;
    taskId?: string;
    sessionId?: string;
    discoveredBy?: string;
    validatedBy?: string;
    validatedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export type EvidenceBindingRole = 'baseline' | 'proof' | 'control' | 'verification' | 'supporting';

export interface EvidenceBinding {
  findingId: string;
  evidenceId: string;
  role: EvidenceBindingRole;
  note: string;
  position: number;
  createdAt?: string;
}

export interface FindingDetailResponse {
  finding: Finding;
  evidence: EvidenceItem[];
  evidenceBindings?: EvidenceBinding[];
}

export interface FindingEvidenceBindPayload {
  evidenceId: string;
  role: EvidenceBindingRole;
  note?: string;
  position?: number;
}

export interface FindingEvidenceOrderPayload {
  evidenceIds: string[];
}

export interface FindingTransitionPayload {
  state: string;
  reason: string;
  evidence_ids?: string[];
  evidenceIds?: string[];
}

// ── Milestone 2.5: Coverage & Sitemap Types (Atlas) ─────────────

export type CoverageOutcome =
  | 'reported'
  | 'no_issue_found'
  | 'ruled_out'
  | 'not_applicable'
  | 'needs_follow_up';

export interface CoverageEntry {
  id: string | number;
  entityId: string;
  surface: string;
  riskArea: string;
  outcome: CoverageOutcome;
  evidenceId?: string | null;
  reason?: string;
  worker?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CoverageGap {
  kind?: string;
  id?: string | number;
  entityId: string;
  surface?: string;
  riskArea: string;
  outcome?: string;
  evidenceId?: string | null;
  reason?: string;
  worker?: string;
}

export interface SitemapNode {
  entity: AppEntity & {
    coverage?: {
      tested: boolean;
      outcomes: Record<string, number>;
      lastTestedAt: string | null;
      entries: CoverageEntry[];
    };
    findingCount?: number;
  };
  children: SitemapNode[];
}

export interface SitemapStats {
  applications: number;
  services: number;
  routes: number;
  inputs: number;
  inScope: number;
  tested: number;
  untested: number;
  findings: number;
  coverageEntries: number;
  coverageGaps: number;
}

export interface SitemapResponse {
  roots: SitemapNode[];
  sideEntities: {
    identities: AppEntity[];
    technologies: AppEntity[];
    flows: AppEntity[];
    findings: AppEntity[];
  };
  stats: SitemapStats;
  coverage: {
    entries: number;
    tested: number;
    outcomes: Record<string, number>;
    gaps: CoverageGap[];
  };
  truncated: boolean;
}

export interface ProjectCoverageResponse {
  entries: CoverageEntry[];
  tested: number;
  outcomes: Record<string, number>;
  gaps: CoverageGap[];
}

export interface RecordCoveragePayload {
  riskArea: string;
  outcome: CoverageOutcome;
  surface?: string;
  evidenceId?: string;
  reason?: string;
  worker?: string;
}

// ── Milestone 5: Auth Profiles & Tool Agent Types ─────────────────

export interface AuthSessionStatus {
  profileId: string;
  projectId: string;
  status: AuthSessionState;
  adapter?: string;
  verifiedAt?: string;
  expiresAt?: string;
  expired?: boolean;
  hasCookies: boolean;
  hasStorageState: boolean;
  warning?: string;
  keychainProtected?: boolean;
}

export interface AuthProfile {
  id: string;
  label: string;
  identity: string;
  role: string;
  tenant: string;
  kind: string;
  adapter: AuthAdapter;
  persistence: AuthPersistence;
  targetPatterns: string[];
  loginUrl: string;
  verifyUrl: string;
  verifyIndicator: string;
  maintainCookies?: string[];
  usernameField?: string;
  passwordField?: string;
  extraFields?: Record<string, string>;
  selectors?: Record<string, string[]>;
  timeout?: number;
  verifyTls?: boolean;
  headless?: boolean;
  useKeychain?: boolean;
  session: AuthSessionStatus;
}

export interface AuthDetectionCandidateField {
  name: string;
  type: string;
  value: string;
}

export interface AuthDetectionCandidate {
  url: string;
  method: string;
  fields: AuthDetectionCandidateField[];
  passwordField: string;
  usernameField: string;
  csrfField: string;
  hasCaptcha: boolean;
  hasOAuth: boolean;
}

export interface AuthDetection {
  mechanisms: string[];
  botProtection: {
    detected: boolean;
    vendor: string;
    confidence: number;
    signals: string[];
  };
  loginCandidates: AuthDetectionCandidate[];
  recommendedAdapter: AuthAdapter;
  warnings: string[];
}

export interface AuthLoginPayload {
  username?: string;
  password?: string;
  adapter?: AuthAdapter;
  loginTimeout?: number;
}

export interface CreateAuthProfilePayload {
  id?: string;
  label: string;
  identity?: string;
  role?: string;
  tenant?: string;
  kind?: string;
  adapter?: AuthAdapter;
  persistence?: AuthPersistence;
  targetPatterns?: string[];
  loginUrl?: string;
  verifyUrl?: string;
  verifyIndicator?: string;
  usernameField?: string;
  passwordField?: string;
  extraFields?: Record<string, string>;
  selectors?: Record<string, string[]>;
  timeout?: number;
  verifyTls?: boolean;
  headless?: boolean;
}

// ── Milestone 5: Tool Agent Run ──────────────────────────────────

export type NoiseProfile = 'off' | 'quiet' | 'balanced' | 'aggressive';

export type SandboxBackendName =
  | 'bwrap'
  | 'seatbelt'
  | 'windows-restricted-low-integrity'
  | 'unavailable'
  | string;
export type SandboxStrength = 'native' | 'partial' | 'none';

export interface SandboxStatus {
  name: SandboxBackendName;
  strength: SandboxStrength;
  available: boolean;
  workspace: string;
  network: boolean;
  filesystemWriteConfined?: boolean;
  restrictedToken?: boolean;
  integrityLevel?: string;
  readsConfined?: boolean;
  networkConfined?: boolean;
}

export interface ToolRunPayload {
  prompt: string;
  maxSteps?: number;
  providerId?: string;
  model?: string;
  noiseProfile?: NoiseProfile;
  authProfileId?: string;
  allowShell?: boolean;
}

export interface ToolCallItem {
  name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  evidenceId?: string;
  error?: string;
}

export interface ToolRunResponse {
  sessionId: string;
  model: string;
  taskId: string;
  status: 'completed' | 'failed' | 'paused' | 'running' | 'blocked';
  finalText: string;
  steps: number;
  toolCalls: ToolCallItem[];
}

export interface RoleModelConfig {
  providerId: string;
  model: string;
}

export interface RoleModelSummary {
  providerId: string;
  modelId: string;
}

export interface SessionRunPayload {
  maxSteps?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  providerId?: string;
  model?: string;
  noiseProfile?: NoiseProfile;
  roles?: Record<string, RoleModelConfig | string>;
}

export interface SessionRunResponse {
  sessionId: string;
  model: string;
  steps: number;
  finished: boolean;
  reason: string;
  roles: Record<string, RoleModelSummary>;
  ticks?: unknown[];
  executions?: unknown[];
}

// ── Milestone 5: Providers & Web UI Settings ─────────────────────

export type WebUiEngine = 'ChatGPT' | 'DeepSeek' | 'Custom';

export interface ProviderCreatePayload {
  name: string;
  type: string;
  engine?: string;
  baseUrl?: string;
  apiKeyRef?: string;
  models?: ModelOption[];
  status?: string;
  reliability?: string;
  profileDir?: string;
  headless?: boolean;
  selectors?: Record<string, unknown>;
}

export interface ProviderHealthResponse {
  ok: boolean;
  loggedIn: boolean;
  engine?: string;
  url?: string;
  model?: string;
}

export interface ProviderCalibrateResponse {
  title?: string;
  url?: string;
  hasPassword?: boolean;
  counts?: Record<string, Array<{ selector: string; count: number }>>;
}

// ── Milestone 6: Hypotheses & Reports ────────────────────────────

export type HypothesisState = 'suspected' | 'supported' | 'rejected' | 'deferred' | 'blocked';
export type HypothesisConfidence = 'candidate' | 'low' | 'medium' | 'high' | 'validated';

export interface Hypothesis {
  id: string;
  sessionId: string;
  title: string;
  securityQuestion: string;
  surface: string;
  state: HypothesisState;
  confidence: HypothesisConfidence;
  requiredEvidence: string[];
  findingCount?: number;
  evidenceCount?: number;
  linkedFindings?: string[];
  linkedEvidence?: string[];
  createdAt: string;
  updatedAt?: string;
  reasons?: Array<{ state: string; reason: string; timestamp: string }>;
}

export interface HypothesisCreatePayload {
  title: string;
  securityQuestion: string;
  surface?: string;
  state?: HypothesisState;
  confidence?: HypothesisConfidence;
  requiredEvidence?: string[];
}

export interface HypothesisTransitionPayload {
  state: HypothesisState;
  reason: string;
}

export interface SessionReportCoverage {
  entries: number;
  tested: number;
  outcomes: Record<string, number>;
  gaps: Array<Record<string, unknown> | string>;
}

export interface SessionReport {
  projectId: string;
  sessionId: string;
  generatedAt: string;
  includeCandidates: boolean;
  markdown: string;
  findings: Finding[];
  hypotheses: Hypothesis[];
  evidence: EvidenceItem[];
  coverage: SessionReportCoverage;
  appModel?: Record<string, unknown>;
}

export interface SaveSessionReportResponse {
  sessionId: string;
  artifactId: string;
  generatedAt: string;
  findingCount: number;
}

export interface SavedReportItem {
  artifactId: string;
  name: string;
  createdAt: string;
}

export type ReportExportFormat = 'markdown' | 'html' | 'json';

export interface ReportExportResponse {
  format: ReportExportFormat;
  contentType: string;
  content: string;
}

// ── Milestone 7: OAST Callback Server Types ───────────────────────

export interface OastStatusResponse {
  running: boolean;
  projectId: string;
  host?: string;
  port?: number;
  url?: string;
  dnsPort?: number;
  dnsDomain?: string;
  tokenCount?: number;
  eventCount?: number;
}

export interface OastStartPayload {
  host?: string;
  port?: number;
  dnsPort?: number;
  dnsDomain?: string;
}

export interface OastToken {
  token: string;
  projectId: string;
  url: string;
  dnsName?: string;
  note: string;
  createdAt: string;
  hits: number;
}

export interface OastTokenCreatePayload {
  note?: string;
}

export interface OastEvent {
  id: number | string;
  token: string;
  method: string;
  path: string;
  query?: string;
  headers: Record<string, string>;
  body: string;
  remote: string;
  createdAt: string;
}





