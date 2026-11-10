import { HomeDataResponse, ProjectSummary, RecentActivityItem, ProviderItem } from './types';

export const initialMockProjects: ProjectSummary[] = [
  {
    id: "prj_demo",
    name: "Acme API",
    path: "C:/labs/acme-api",
    createdAt: "2026-11-01T09:00:00Z",
    lastOpenedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(), // 12m ago
    scopeStatus: "ok",
    scopeHash: "sha256:demo-scope",
    targets: ["https://app.example.com", "https://api.example.com"],
    sessionCount: 2,
    openFindings: 1,
    coverage: {
      applications: 1,
      services: 3,
      routes: 42,
      inputs: 18,
      identities: 2,
      staleAssets: 4
    },
    activeSession: {
      id: "ses_demo_01",
      projectId: "prj_demo",
      title: "Acme API authz sweep",
      status: "running",
      mode: "attack",
      targets: ["https://api.example.com"],
      elapsedSeconds: 720,
      lastEventSummary: "task/leased",
      lastEventAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2m ago
      budget: {
        modelCalls: 400,
        toolCalls: 800,
        wallSeconds: 7200,
        used: { modelCalls: 37, toolCalls: 64, wallSeconds: 720 }
      }
    }
  },
  {
    id: "prj_internal_qa",
    name: "Internal QA & Staging",
    path: "C:/labs/internal-qa",
    createdAt: "2026-10-15T10:00:00Z",
    lastOpenedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2d ago
    scopeStatus: "ok",
    scopeHash: "sha256:qa-scope",
    targets: ["https://staging-auth.corp.internal", "https://api.staging.internal"],
    sessionCount: 5,
    openFindings: 0,
    coverage: {
      applications: 2,
      services: 5,
      routes: 89,
      inputs: 34,
      identities: 4,
      staleAssets: 0
    },
    activeSession: null
  },
  {
    id: "prj_juice_shop",
    name: "Lab: Juice Shop Benchmark",
    path: "C:/labs/juice-shop",
    createdAt: "2026-10-01T08:00:00Z",
    lastOpenedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 1w ago
    scopeStatus: "empty",
    scopeHash: "sha256:lab-scope",
    targets: ["http://localhost:3000"],
    sessionCount: 1,
    openFindings: 3,
    coverage: {
      applications: 1,
      services: 1,
      routes: 28,
      inputs: 12,
      identities: 1,
      staleAssets: 1
    },
    activeSession: null
  }
];

export const mockProviders: ProviderItem[] = [
  {
    id: "prv_ollama",
    name: "Local Ollama",
    type: "openai-compatible",
    status: "healthy",
    models: [
      { id: "qwen3:4b", name: "Qwen3 4B", providerId: "prv_ollama", contextWindow: 8192, maxOutput: 2048, available: true },
      { id: "qwen3:14b", name: "Qwen3 14B", providerId: "prv_ollama", contextWindow: 32768, maxOutput: 4096, available: true }
    ]
  },
  {
    id: "prv_chatgpt_web",
    name: "ChatGPT Web",
    type: "browser",
    status: "degraded",
    models: [
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol (Web)", providerId: "prv_chatgpt_web", contextWindow: 32768, maxOutput: 8192, available: true }
    ]
  },
  {
    id: "prv_deepseek_api",
    name: "DeepSeek API",
    type: "openai-compatible",
    status: "healthy",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", providerId: "prv_deepseek_api", contextWindow: 128000, maxOutput: 8192, available: true },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", providerId: "prv_deepseek_api", contextWindow: 128000, maxOutput: 8192, available: true }
    ]
  }
];

export const mockRecentActivity: RecentActivityItem[] = [
  {
    id: "evt_001",
    projectId: "prj_demo",
    projectName: "Acme API",
    summary: "Cross-tenant invoice read reached reproduction",
    ts: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    kind: "finding",
    targetUrl: "https://api.example.com/v1/invoices"
  },
  {
    id: "evt_002",
    projectId: "prj_internal_qa",
    projectName: "Internal QA & Staging",
    summary: "Scope updated: added 3 staging subdomains",
    ts: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    kind: "scope"
  },
  {
    id: "evt_003",
    projectId: "prj_juice_shop",
    projectName: "Lab: Juice Shop Benchmark",
    summary: "Run completed with 3 validated findings",
    ts: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    kind: "session"
  }
];

export const mockHomeData: HomeDataResponse = {
  recentProjects: initialMockProjects,
  recentActivity: mockRecentActivity,
  activeSession: initialMockProjects[0].activeSession,
  environment: {
    providers: {
      healthy: 2,
      degraded: 1,
      unavailable: 0
    },
    toolPacks: {
      installed: 3,
      total: 5
    },
    authProfiles: {
      active: 2,
      expired: 1
    },
    sandbox: "native",
    warnings: [
      "ChatGPT Web provider degraded — session cookie expires in 4 hours",
      "2 tool packs missing (clairvoyance, inql) — install in Tools"
    ]
  },
  globalSettings: {
    theme: "dark",
    density: "comfortable",
    telemetryEnabled: false
  }
};
