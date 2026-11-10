import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  FolderPlus, ArrowLeft, ArrowRight, CheckCircle2, Shield, 
  Key, Cpu, FileCheck, AlertTriangle, Plus, Trash2, 
  Layers, Lock, Sparkles, AlertCircle 
} from 'lucide-react';
import { TopMenuBar } from '../../components/TopMenuBar';
import { Footer } from '../../components/Footer';
import { pickFolder } from '../../lib/nativeDialog';
import { parseAndClassifyScope } from './scopeClassifier';
import { fetchJson } from '../../api/client';
import { 
  AuthProfileConfig, 
  AuthKind, 
  AuthPersistence, 
  HomeDataResponse, 
  Paginated, 
  ProviderItem, 
  ProjectCreatePayload, 
  ProjectSummary 
} from '../../api/types';

interface WizardState {
  name: string;
  folderPath: string;
  rawScope: string;
  authProfiles: AuthProfileConfig[];
  phases: {
    passive: boolean;
    validation: boolean;
    crawl: boolean;
    controlled_testing: boolean;
  };
  roles: {
    orchestrator: string;
    recon: string;
    operator: string;
    validator: string;
    reporter: string;
  };
}

export const EngagementWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Load environment to check providers for Step 5 Provider Gate
  const { data: homeData } = useQuery({
    queryKey: ['homeData'],
    queryFn: () => fetchJson<HomeDataResponse>('/home'),
  });

  // Load configured providers and models
  const { data: providersData } = useQuery({
    queryKey: ['providers'],
    queryFn: () => fetchJson<Paginated<ProviderItem>>('/providers'),
  });

  const availableModels = providersData?.items?.flatMap((p) => p.models).filter((m) => m.available) || [];

  const [wizardData, setWizardData] = useState<WizardState>({
    name: '',
    folderPath: '',
    rawScope: 'https://app.example.com\nhttps://api.example.com\n*.internal.example.com\n!admin.staging.example.com',
    authProfiles: [
      {
        id: 'auth_1',
        label: 'Admin Session Lane',
        identity: 'tenant_admin@example.com',
        kind: 'credentials',
        persistence: 'session_only',
      },
    ],
    phases: {
      passive: true,
      validation: true,
      crawl: true,
      controlled_testing: false,
    },
    roles: {
      orchestrator: '',
      recon: '',
      operator: '',
      validator: '',
      reporter: '',
    },
  });

  // Automatically initialize roles once availableModels is loaded if roles are unset
  useEffect(() => {
    if (availableModels.length > 0 && !wizardData.roles.orchestrator) {
      const defaultModel = availableModels[0].id;
      setWizardData((prev) => ({
        ...prev,
        roles: {
          orchestrator: defaultModel,
          recon: availableModels.find((m) => m.id.includes('qwen') || m.id.includes('14b'))?.id || defaultModel,
          operator: defaultModel,
          validator: defaultModel,
          reporter: availableModels.find((m) => m.id.includes('flash') || m.id.includes('4b'))?.id || defaultModel,
        },
      }));
    }
  }, [availableModels, wizardData.roles.orchestrator]);

  const [validationError, setValidationError] = useState<string | null>(null);

  const scopeAnalysis = parseAndClassifyScope(wizardData.rawScope);

  // Provider gate check: locked when data is loaded and providers count is 0
  const providersCount = (homeData?.environment.providers.healthy ?? 0) + (homeData?.environment.providers.degraded ?? 0);
  const isProviderGateLocked = homeData ? providersCount === 0 : false;

  const handleBrowseFolder = async () => {
    const selected = await pickFolder('Select Workspace Folder');
    if (selected) {
      setWizardData((prev) => ({ ...prev, folderPath: selected }));
      if (!wizardData.name) {
        const folderName = selected.split('/').filter(Boolean).pop() || '';
        setWizardData((prev) => ({ ...prev, name: folderName }));
      }
    }
  };

  const handleAddAuthProfile = () => {
    const newProfile: AuthProfileConfig = {
      id: `auth_${Date.now()}`,
      label: `Role Profile ${wizardData.authProfiles.length + 1}`,
      identity: 'user@target.com',
      kind: 'saved_session',
      persistence: 'session_only',
    };
    setWizardData((prev) => ({
      ...prev,
      authProfiles: [...prev.authProfiles, newProfile],
    }));
  };

  const handleRemoveAuthProfile = (id: string) => {
    setWizardData((prev) => ({
      ...prev,
      authProfiles: prev.authProfiles.filter((p) => p.id !== id),
    }));
  };

  const handleUpdateAuthProfile = (id: string, updates: Partial<AuthProfileConfig>) => {
    setWizardData((prev) => ({
      ...prev,
      authProfiles: prev.authProfiles.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
  };

  const validateStep = (step: number): boolean => {
    setValidationError(null);

    if (step === 1) {
      if (!wizardData.name.trim()) {
        setValidationError('Engagement name is required.');
        return false;
      }
      if (!wizardData.folderPath.trim()) {
        setValidationError('Workspace folder path is required. Click Browse to select a folder.');
        return false;
      }
    }

    if (step === 2) {
      if (scopeAnalysis.inScope.length === 0) {
        setValidationError('At least one in-scope target (URL, domain, wildcard, or CIDR) is required.');
        return false;
      }
      if (scopeAnalysis.conflicts.length > 0) {
        setValidationError(`Scope conflict detected: [${scopeAnalysis.conflicts.join(', ')}] cannot be both in-scope and out-of-scope.`);
        return false;
      }
    }

    if (step === 5) {
      if (isProviderGateLocked) {
        setValidationError('Cannot proceed: Connect at least one healthy model provider first.');
        return false;
      }
    }

    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, 6));
    }
  };

  const handleBack = () => {
    setValidationError(null);
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleFinish = async () => {
    const inScopeTargets = scopeAnalysis.inScope.map((s) => s.normalized);
    const allowedDomains = scopeAnalysis.inScope.filter((s) => s.type === 'fqdn' || s.type === 'wildcard').map((s) => s.normalized);
    const allowedUrls = scopeAnalysis.inScope.filter((s) => s.type === 'url').map((s) => s.normalized);
    const excludedDomains = scopeAnalysis.outOfScope.map((s) => s.normalized);
    const enabledPhases = Object.entries(wizardData.phases).filter(([_, enabled]) => enabled).map(([phase]) => phase);

    const fullPayload: ProjectCreatePayload = {
      name: wizardData.name,
      path: wizardData.folderPath,
      targets: inScopeTargets,
      rawScope: wizardData.rawScope,
      scope: {
        programName: wizardData.name,
        allowedDomains,
        allowedUrls,
        excludedDomains,
      },
      authProfiles: wizardData.authProfiles.map((p) => ({
        id: p.id,
        label: p.label,
        identity: p.identity,
        kind: p.kind,
        persistence: p.persistence,
        targetPatterns: p.targetPatterns || [],
        loginUrl: p.loginUrl,
        verifyUrl: p.verifyUrl,
        verifyIndicator: p.verifyIndicator,
        maintainCookies: p.maintainCookies || [],
      })),
      roles: wizardData.roles,
      phases: enabledPhases,
    };

    await fetchJson<ProjectSummary>('/projects', {
      method: 'POST',
      body: JSON.stringify(fullPayload),
    });

    queryClient.invalidateQueries({ queryKey: ['homeData'] });
    navigate('/');
  };

  const steps = [
    { num: 1, title: 'Name & Folder', icon: <FolderPlus className="w-3.5 h-3.5" /> },
    { num: 2, title: 'Scope', icon: <Shield className="w-3.5 h-3.5" /> },
    { num: 3, title: 'Auth Profiles', icon: <Key className="w-3.5 h-3.5" /> },
    { num: 4, title: 'Phases', icon: <Layers className="w-3.5 h-3.5" /> },
    { num: 5, title: 'Model Roles', icon: <Cpu className="w-3.5 h-3.5" /> },
    { num: 6, title: 'Review', icon: <FileCheck className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col font-sans selection:bg-accent/20 selection:text-accent">
      <TopMenuBar />

      {/* Wizard Header Bar */}
      <div className="border-b border-border bg-surface/60 py-4 px-6">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="p-1.5 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
              title="Return to Ready State"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-sm font-semibold text-text tracking-tight flex items-center gap-2">
                <span>New Engagement Setup Wizard</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">
                  Step {currentStep} of 6
                </span>
              </h1>
              <p className="text-[11px] text-text-muted">Define target scope, auth persistence, phases, and model routing.</p>
            </div>
          </div>

          <button
            onClick={() => navigate('/')}
            className="text-xs text-text-muted hover:text-text px-2.5 py-1 rounded border border-border hover:bg-surface-2 transition-colors font-mono"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Stepper Progress */}
      <div className="border-b border-border bg-bg/80 py-3 px-6">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between gap-2 overflow-x-auto">
          {steps.map((s) => {
            const isCompleted = s.num < currentStep;
            const isCurrent = s.num === currentStep;

            return (
              <div
                key={s.num}
                onClick={() => {
                  if (isCompleted) setCurrentStep(s.num);
                }}
                className={`flex items-center gap-2 px-3 py-1 rounded text-xs transition-colors shrink-0 ${
                  isCurrent
                    ? 'bg-surface-2 text-text font-medium border border-border'
                    : isCompleted
                    ? 'text-accent cursor-pointer hover:bg-surface/60'
                    : 'text-text-muted/60 cursor-not-allowed'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[10px] ${
                    isCurrent
                      ? 'bg-accent text-[#0D1015] font-bold'
                      : isCompleted
                      ? 'bg-accent/20 text-accent'
                      : 'bg-surface-2 text-text-muted'
                  }`}
                >
                  {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.num}
                </div>
                <span>{s.title}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Step Content */}
      <main className="flex-1 max-w-[800px] w-full mx-auto px-6 py-8">
        {validationError && (
          <div className="mb-6 p-3 rounded bg-danger/10 border border-danger/40 text-danger text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        {/* STEP 1: Name & Folder */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-text">Name & Workspace Folder</h2>
              <p className="text-xs text-text-muted">
                Each engagement represents an isolated security testing workspace with dedicated knowledge graphs and journals.
              </p>
            </div>

            <div className="p-5 rounded-lg border border-border bg-surface space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono text-text-muted block">Engagement Name</label>
                <input
                  type="text"
                  value={wizardData.name}
                  onChange={(e) => setWizardData({ ...wizardData, name: e.target.value })}
                  placeholder="e.g. Acme API Assessment"
                  className="w-full px-3 py-2 bg-bg border border-border rounded text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-mono text-text-muted block">Workspace Folder Location</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={wizardData.folderPath}
                    onChange={(e) => setWizardData({ ...wizardData, folderPath: e.target.value })}
                    placeholder="Click Browse to select folder..."
                    className="flex-1 px-3 py-2 bg-bg border border-border rounded text-text font-mono text-xs placeholder:text-text-muted/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleBrowseFolder}
                    className="px-4 py-2 bg-surface-2 hover:bg-surface-2/80 border border-border text-text rounded text-xs font-medium transition-colors"
                  >
                    Browse...
                  </button>
                </div>
              </div>

              {wizardData.folderPath && (
                <div className="p-3 rounded bg-bg/80 border border-border text-[11px] space-y-1 text-text-muted font-mono">
                  <span className="text-accent font-semibold block">Workspace Scaffolding:</span>
                  <span>Will initialize <code className="text-text">.chainsaw/</code> state directory and engagement stores.</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: Scope Parsing & Classification */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-text">Scope & Target Boundaries</h2>
              <p className="text-xs text-text-muted">
                Paste targets, wildcards, or CIDRs. Prefix out-of-scope items with <code className="text-danger font-mono font-bold">!</code>.
              </p>
            </div>

            {/* Quick Template Presets */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-text-muted">Presets:</span>
              <button
                type="button"
                onClick={() => setWizardData({
                  ...wizardData,
                  rawScope: 'https://example.com/api\nhttps://auth.example.com\n*.example.com\n!admin.staging.example.com\n!192.168.1.0/24'
                })}
                className="px-2 py-1 text-[11px] font-mono rounded bg-surface border border-border hover:bg-surface-2 transition-colors"
              >
                HackerOne Format
              </button>
              <button
                type="button"
                onClick={() => setWizardData({
                  ...wizardData,
                  rawScope: 'https://target.corp.internal\n10.10.10.0/24'
                })}
                className="px-2 py-1 text-[11px] font-mono rounded bg-surface border border-border hover:bg-surface-2 transition-colors"
              >
                Internal Network
              </button>
            </div>

            <div className="p-5 rounded-lg border border-border bg-surface space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono text-text-muted block">Target List (one per line)</label>
                <textarea
                  rows={6}
                  value={wizardData.rawScope}
                  onChange={(e) => setWizardData({ ...wizardData, rawScope: e.target.value })}
                  placeholder="https://app.example.com&#10;api.example.com&#10;*.corp.example.com&#10;!internal-admin.example.com"
                  className="w-full px-3 py-2 bg-bg border border-border rounded text-text font-mono text-xs placeholder:text-text-muted/60 focus:outline-none focus:border-accent resize-none"
                />
              </div>

              {/* Real-Time Scope Classification Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
                <div className="p-2 rounded bg-bg border border-border">
                  <span className="text-[10px] text-text-muted block">In-Scope Targets</span>
                  <span className="text-success font-semibold text-sm">{scopeAnalysis.inScope.length}</span>
                </div>
                <div className="p-2 rounded bg-bg border border-border">
                  <span className="text-[10px] text-text-muted block">Out-Of-Scope</span>
                  <span className="text-danger font-semibold text-sm">{scopeAnalysis.outOfScope.length}</span>
                </div>
                <div className="p-2 rounded bg-bg border border-border">
                  <span className="text-[10px] text-text-muted block">Deduplicated</span>
                  <span className="text-text font-semibold text-sm">{scopeAnalysis.duplicates.length}</span>
                </div>
                <div className="p-2 rounded bg-bg border border-border">
                  <span className="text-[10px] text-text-muted block">Conflicts</span>
                  <span className={`font-semibold text-sm ${scopeAnalysis.conflicts.length > 0 ? 'text-danger' : 'text-text'}`}>
                    {scopeAnalysis.conflicts.length}
                  </span>
                </div>
              </div>

              {scopeAnalysis.conflicts.length > 0 && (
                <div className="p-2.5 rounded bg-danger/10 border border-danger/40 text-danger text-[11px] font-mono">
                  Conflict detected: [{scopeAnalysis.conflicts.join(', ')}] is defined as both in-scope and out-of-scope.
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: Auth Profiles */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <h2 className="text-base font-semibold text-text">Auth Profiles & Session Lanes</h2>
                <p className="text-xs text-text-muted">
                  Configure target identities for side-by-side authorization & IDOR testing.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddAuthProfile}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-2 text-text hover:bg-surface-2/80 border border-border text-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Profile</span>
              </button>
            </div>

            <div className="space-y-3">
              {wizardData.authProfiles.map((profile, idx) => (
                <div key={profile.id} className="p-4 rounded-lg border border-border bg-surface space-y-3">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/60">
                    <span className="text-xs font-semibold text-text flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-accent" />
                      Profile #{idx + 1}
                    </span>
                    {wizardData.authProfiles.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveAuthProfile(profile.id)}
                        className="p-1 text-text-muted hover:text-danger rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-text-muted block">Profile Label</label>
                      <input
                        type="text"
                        value={profile.label}
                        onChange={(e) => handleUpdateAuthProfile(profile.id, { label: e.target.value })}
                        className="w-full px-2.5 py-1.5 bg-bg border border-border rounded text-text text-xs focus:outline-none focus:border-accent"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-text-muted block">Identity / Role / Tenant</label>
                      <input
                        type="text"
                        value={profile.identity}
                        onChange={(e) => handleUpdateAuthProfile(profile.id, { identity: e.target.value })}
                        className="w-full px-2.5 py-1.5 bg-bg border border-border rounded text-text font-mono text-xs focus:outline-none focus:border-accent"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-text-muted block">Authentication Kind</label>
                      <select
                        value={profile.kind}
                        onChange={(e) => handleUpdateAuthProfile(profile.id, { kind: e.target.value as AuthKind })}
                        className="w-full px-2.5 py-1.5 bg-bg border border-border rounded text-text font-mono text-xs focus:outline-none focus:border-accent"
                      >
                        <option value="saved_session">Saved Browser Session</option>
                        <option value="credentials">Username & Password</option>
                        <option value="oauth">OAuth / SSO Token</option>
                        <option value="api_token">Bearer / API Token</option>
                        <option value="manual_handover">Manual Handover</option>
                        <option value="none">Unauthenticated Lane</option>
                      </select>
                    </div>

                    {/* MANDATORY PERSISTENCE SELECTOR: Aligned to backend contract ('none' | 'session_only' | 'credentials') */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-accent block">Credential Persistence Mode</label>
                      <select
                        value={profile.persistence}
                        onChange={(e) => handleUpdateAuthProfile(profile.id, { persistence: e.target.value as AuthPersistence })}
                        className="w-full px-2.5 py-1.5 bg-bg border border-accent/40 rounded text-text font-mono text-xs focus:outline-none focus:border-accent"
                      >
                        <option value="none">Don't save (in-memory only)</option>
                        <option value="session_only">Save session only (cookies/tokens)</option>
                        <option value="credentials">Save credentials (encrypted vault)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 text-[11px] font-mono">
                    <span className="text-text-muted/60 text-[10px]">No raw credentials rendered or logged in plaintext</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 4: Scan Phases & Policy */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-text">Testing Phases & Permitted Actions</h2>
              <p className="text-xs text-text-muted">
                Select which assessment phases the autonomous agent is permitted to execute.
              </p>
            </div>

            <div className="p-5 rounded-lg border border-border bg-surface space-y-3 font-sans text-xs">
              {[
                {
                  id: 'passive',
                  title: 'Passive Reconnaissance & Technology Mapping',
                  desc: 'Port scanning, HTTP probing, technology stack detection. Zero intrusive payloads.',
                },
                {
                  id: 'validation',
                  title: 'Independent Finding Validation (7-Question Gate)',
                  desc: 'Replay observed claims with differential control tests to eliminate false positives.',
                },
                {
                  id: 'crawl',
                  title: 'Deep Web Crawling & Endpoint Discovery',
                  desc: 'Headless browser spidering, form parameter extraction, API route enumeration.',
                },
                {
                  id: 'controlled_testing',
                  title: 'Controlled Active Vulnerability Hunting',
                  desc: 'IDOR sweeps, SSRF probes, SQL injection, and authorization boundary validation.',
                },
              ].map((phase) => (
                <label
                  key={phase.id}
                  className="flex items-start gap-3 p-3 rounded bg-bg/80 border border-border hover:border-accent/40 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={wizardData.phases[phase.id as keyof typeof wizardData.phases]}
                    onChange={(e) =>
                      setWizardData({
                        ...wizardData,
                        phases: {
                          ...wizardData.phases,
                          [phase.id]: e.target.checked,
                        },
                      })
                    }
                    className="mt-1 rounded border-border text-accent focus:ring-accent"
                  />
                  <div className="space-y-0.5">
                    <span className="font-semibold text-text block">{phase.title}</span>
                    <span className="text-[11px] text-text-muted block">{phase.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* STEP 5: Model Roles & Provider Gate (Canonical 5 Roles) */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-text">Model Role Assignment & Provider Gate</h2>
              <p className="text-xs text-text-muted">
                Assign configured models to the 5 canonical agent roles. Any configured model can serve any role.
              </p>
            </div>

            {/* PROVIDER GATE: Mandatory check */}
            {isProviderGateLocked && (
              <div className="p-4 rounded-lg bg-danger/10 border border-danger/40 text-danger space-y-2">
                <div className="flex items-center gap-2 font-semibold text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Connect a model provider first</span>
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  No active model providers (Ollama, Groq, or OpenAI-compatible) were detected. You must configure at least one provider before creating this engagement.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/models')}
                  className="inline-flex items-center gap-1 text-xs font-mono text-accent hover:underline"
                >
                  Configure Models & Providers &rarr;
                </button>
              </div>
            )}

            <div className="p-5 rounded-lg border border-border bg-surface space-y-4">
              {/* Presets */}
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <span className="text-[11px] font-mono text-text-muted">Shortcuts:</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!wizardData.roles.orchestrator}
                    onClick={() =>
                      setWizardData({
                        ...wizardData,
                        roles: {
                          orchestrator: wizardData.roles.orchestrator,
                          recon: wizardData.roles.orchestrator,
                          operator: wizardData.roles.orchestrator,
                          validator: wizardData.roles.orchestrator,
                          reporter: wizardData.roles.orchestrator,
                        },
                      })
                    }
                    className="px-2.5 py-1 text-[11px] font-mono rounded bg-surface-2 border border-border hover:bg-surface-2/80 transition-colors disabled:opacity-40"
                  >
                    Same as Orchestrator
                  </button>
                  <button
                    type="button"
                    disabled={availableModels.length === 0}
                    onClick={() => {
                      if (availableModels.length === 0) return;
                      const soloModel = availableModels[0].id;
                      setWizardData({
                        ...wizardData,
                        roles: {
                          orchestrator: soloModel,
                          recon: soloModel,
                          operator: soloModel,
                          validator: soloModel,
                          reporter: soloModel,
                        },
                      });
                    }}
                    className="px-2.5 py-1 text-[11px] font-mono rounded bg-accent/15 border border-accent/40 text-accent hover:bg-accent/20 transition-colors flex items-center gap-1 disabled:opacity-40"
                  >
                    <Sparkles className="w-3 h-3" />
                    Solo Preset
                  </button>
                </div>
              </div>

              {/* Canonical 5 Roles Dropdown Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
                {[
                  { id: 'orchestrator', label: 'Orchestrator (Planner / Supervisor)' },
                  { id: 'recon', label: 'Reconnaissance (Surface Mapping)' },
                  { id: 'operator', label: 'Operator (Tool & Action Execution)' },
                  { id: 'validator', label: 'Validator (Vulnerability Verification)' },
                  { id: 'reporter', label: 'Reporter (Findings & Documentation)' },
                ].map((role) => (
                  <div key={role.id} className="space-y-1">
                    <label className="text-[10px] text-text-muted uppercase tracking-wider block">
                      {role.label}
                    </label>
                    <select
                      value={wizardData.roles[role.id as keyof typeof wizardData.roles]}
                      onChange={(e) =>
                        setWizardData({
                          ...wizardData,
                          roles: {
                            ...wizardData.roles,
                            [role.id]: e.target.value,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-bg border border-border rounded text-text font-mono text-xs focus:outline-none focus:border-accent"
                    >
                      {availableModels.length === 0 && (
                        <option value="">No configured models available</option>
                      )}
                      {availableModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP 6: Review & Launch */}
        {currentStep === 6 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-text">Review Engagement Specifications</h2>
              <p className="text-xs text-text-muted">
                Confirm your configuration before creating the engagement workspace.
              </p>
            </div>

            <div className="p-5 rounded-lg border border-border bg-surface space-y-4 font-mono text-xs">
              <div className="space-y-2 pb-3 border-b border-border/60">
                <div className="flex justify-between">
                  <span className="text-text-muted">Engagement:</span>
                  <strong className="text-text font-semibold font-sans">{wizardData.name}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Workspace Path:</span>
                  <span className="text-text truncate max-w-xs">{wizardData.folderPath}</span>
                </div>
              </div>

              <div className="space-y-2 pb-3 border-b border-border/60">
                <div className="flex justify-between">
                  <span className="text-text-muted">In-Scope Targets:</span>
                  <span className="text-success font-semibold">{scopeAnalysis.inScope.length} items</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Out-Of-Scope:</span>
                  <span className="text-danger">{scopeAnalysis.outOfScope.length} excluded</span>
                </div>
              </div>

              <div className="space-y-2 pb-3 border-b border-border/60">
                <div className="flex justify-between">
                  <span className="text-text-muted">Auth Profiles:</span>
                  <span className="text-text">{wizardData.authProfiles.length} configured</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Persistence Modes:</span>
                  <span className="text-text-muted">
                    {wizardData.authProfiles.map((p) => p.persistence.replace(/_/g, ' ')).join(', ')}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-text-muted">Orchestrator Model:</span>
                  <span className="text-accent">{wizardData.roles.orchestrator || 'Default'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Active Phases:</span>
                  <span className="text-text">
                    {Object.entries(wizardData.phases)
                      .filter(([, v]) => v)
                      .map(([k]) => k)
                      .join(', ')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between pt-6 border-t border-border mt-8">
          <button
            type="button"
            disabled={currentStep === 1}
            onClick={handleBack}
            className="flex items-center gap-1.5 px-4 py-2 rounded bg-surface-2 text-text hover:bg-surface-2/80 border border-border text-xs transition-colors disabled:opacity-40"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          {currentStep < 6 ? (
            <button
              type="button"
              disabled={currentStep === 5 && isProviderGateLocked}
              onClick={handleNext}
              className="flex items-center gap-1.5 px-4 py-2 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors shadow-sm disabled:opacity-40"
            >
              <span>Next Step</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              className="flex items-center gap-1.5 px-5 py-2 rounded bg-success text-white hover:bg-success/90 font-medium text-xs transition-colors shadow-sm"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Create Engagement</span>
            </button>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
};
