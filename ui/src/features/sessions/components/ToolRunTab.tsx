import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  Bot, Play, RotateCw, AlertCircle, CheckCircle, 
  Terminal, ChevronDown, ChevronRight, ExternalLink, EyeOff, Wrench,
  AlertTriangle, Copy, Check
} from 'lucide-react';
import { fetchJson, isApiError } from '../../../api/client';
import { 
  Paginated, 
  ProviderItem, 
  AuthProfile, 
  NoiseProfile, 
  ToolCallItem,
  ToolRunPayload, 
  ToolRunResponse,
  SandboxStatus
} from '../../../api/types';

interface ToolRunTabProps {
  sessionId: string;
  projectId: string;
  defaultProviderId?: string;
  defaultModel?: string;
  onToolRunComplete?: () => void;
}

// Redact sensitive keys from tool argument displays
function redactArguments(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactArguments);

  const redacted: Record<string, unknown> = {};
  const sensitiveKeys = ['password', 'token', 'secret', 'authorization', 'cookie', 'key', 'apiKey'];

  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (sensitiveKeys.some((s) => k.toLowerCase().includes(s))) {
      redacted[k] = '«redacted»';
    } else if (typeof v === 'object' && v !== null) {
      redacted[k] = redactArguments(v);
    } else {
      redacted[k] = v;
    }
  }
  return redacted;
}

export const ToolRunTab: React.FC<ToolRunTabProps> = ({
  sessionId,
  projectId,
  defaultProviderId = '',
  defaultModel = '',
  onToolRunComplete,
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Form State
  const [prompt, setPrompt] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState(defaultProviderId);
  const [selectedModel, setSelectedModel] = useState(defaultModel);
  const [maxSteps, setMaxSteps] = useState(12);
  const [noiseProfile, setNoiseProfile] = useState<NoiseProfile>('balanced');
  const [selectedAuthProfileId, setSelectedAuthProfileId] = useState('');
  const [allowShell, setAllowShell] = useState(false);

  // Execution State
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [result, setResult] = useState<ToolRunResponse | null>(null);
  const [expandedCalls, setExpandedCalls] = useState<Record<number, boolean>>({});
  const [expandedStdout, setExpandedStdout] = useState<Record<number, boolean>>({});
  const [expandedStderr, setExpandedStderr] = useState<Record<number, boolean>>({});
  const [copiedStdout, setCopiedStdout] = useState<Record<number, boolean>>({});
  const [copiedStderr, setCopiedStderr] = useState<Record<number, boolean>>({});

  // 1. Fetch Providers
  const { data: providersData } = useQuery({
    queryKey: ['providers'],
    queryFn: () => fetchJson<Paginated<ProviderItem>>('/providers'),
  });

  const providers = providersData?.items || [];

  // Update selected provider & model when providers load
  useEffect(() => {
    if (!selectedProviderId && providers.length > 0) {
      const defaultP = providers[0];
      setSelectedProviderId(defaultP.id);
      if (!selectedModel && defaultP.models && defaultP.models.length > 0) {
        setSelectedModel(defaultP.models[0].id);
      }
    }
  }, [providers, selectedProviderId, selectedModel]);

  // 2. Fetch Auth Profiles for Project
  const { data: authProfilesData } = useQuery({
    queryKey: ['authProfiles', projectId],
    queryFn: () => fetchJson<Paginated<AuthProfile>>(`/projects/${projectId}/auth/profiles`),
    enabled: Boolean(projectId),
  });

  const allAuthProfiles = authProfilesData?.items || [];
  const activeAuthProfiles = allAuthProfiles.filter((p) => p.session?.status === 'active');

  // 3. Fetch Sandbox Status
  const { data: sandboxStatus } = useQuery<SandboxStatus>({
    queryKey: ['sandboxStatus', projectId],
    queryFn: () => fetchJson<SandboxStatus>(`/projects/${projectId}/sandbox/status`),
    enabled: Boolean(projectId),
  });

  const toggleCallExpand = (index: number) => {
    setExpandedCalls((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const toggleStdout = (index: number) => {
    setExpandedStdout((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const toggleStderr = (index: number) => {
    setExpandedStderr((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleCopyStdout = (index: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedStdout((prev) => ({ ...prev, [index]: true }));
    setTimeout(() => {
      setCopiedStdout((prev) => ({ ...prev, [index]: false }));
    }, 2000);
  };

  const handleCopyStderr = (index: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedStderr((prev) => ({ ...prev, [index]: true }));
    setTimeout(() => {
      setCopiedStderr((prev) => ({ ...prev, [index]: false }));
    }, 2000);
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!prompt.trim()) return;

    setIsRunning(true);
    setError(null);
    setRequestId(null);
    setResult(null);

    const payload: ToolRunPayload = {
      prompt: prompt.trim(),
      maxSteps,
      providerId: selectedProviderId || undefined,
      model: selectedModel || undefined,
      noiseProfile,
      authProfileId: selectedAuthProfileId || undefined,
      ...(allowShell && sandboxStatus?.available ? { allowShell: true } : {}),
    };

    try {
      const runRes = await fetchJson<ToolRunResponse>(`/sessions/${sessionId}/tool-run`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setResult(runRes);

      // Invalidate session journal and evidence after completion
      await queryClient.invalidateQueries({ queryKey: ['sessionJournal', sessionId] });
      await queryClient.invalidateQueries({ queryKey: ['sessionEvidence', sessionId] });
      await queryClient.invalidateQueries({ queryKey: ['sessionTasks', sessionId] });
      await queryClient.invalidateQueries({ queryKey: ['session', sessionId] });

      onToolRunComplete?.();
    } catch (err) {
      if (isApiError(err)) {
        setError(err.message);
        setRequestId(err.request_id);
      } else {
        setError(err instanceof Error ? err.message : 'Tool agent execution failed.');
      }
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-bg overflow-hidden select-none font-sans">
      {/* Scrollable Container */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl w-full mx-auto">
        {/* Header Notice */}
        <div className="p-4 rounded-xl bg-surface border border-border flex items-start gap-3">
          <Bot className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-text">Autonomous Security Tool Agent</h2>
            <p className="text-xs text-text-muted leading-relaxed font-sans">
              The agent executes targeted security tasks within strict scope constraints. 
              It uses captured workbench traffic and scoped tools (<code className="font-mono text-accent">workbench.search</code>,{' '}
              <code className="font-mono text-accent">http.replay</code>,{' '}
              <code className="font-mono text-accent">coverage.record</code>,{' '}
              <code className="font-mono text-accent">evidence.record</code>) to investigate hypotheses and record hashed evidence.
            </p>
          </div>
        </div>

        {/* Prompt Composer & Configuration Form */}
        <form onSubmit={handleSubmit} className="p-5 rounded-xl bg-surface border border-border space-y-4 shadow-sm">
          <div className="space-y-1.5">
            <label htmlFor="agent-prompt" className="block text-text font-semibold text-xs">
              Task Prompt / Investigation Goal <span className="text-danger">*</span>
            </label>
            <textarea
              id="agent-prompt"
              rows={3}
              required
              disabled={isRunning}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Investigate the invoice endpoint for cross-tenant IDOR. Replay with tenant_b credentials and verify if 403 Forbidden is properly enforced."
              className="w-full px-3.5 py-2.5 rounded-lg bg-bg border border-border text-text font-sans text-xs focus:outline-none focus:border-accent disabled:opacity-50 leading-relaxed resize-y"
            />
          </div>

          {/* Configuration Controls Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 text-xs">
            {/* Provider Selector */}
            <div className="space-y-1">
              <label htmlFor="provider-select" className="block text-text-muted font-mono text-[11px]">Provider</label>
              <select
                id="provider-select"
                disabled={isRunning || providers.length === 0}
                value={selectedProviderId}
                onChange={(e) => {
                  setSelectedProviderId(e.target.value);
                  const p = providers.find((prov) => prov.id === e.target.value);
                  if (p?.models && p.models.length > 0) {
                    setSelectedModel(p.models[0].id);
                  }
                }}
                className="w-full px-2.5 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent disabled:opacity-50"
              >
                {providers.length === 0 ? (
                  <option value="">No providers configured</option>
                ) : (
                  providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.type})
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Model Selector */}
            <div className="space-y-1">
              <label htmlFor="model-input" className="block text-text-muted font-mono text-[11px]">Model</label>
              <input
                id="model-input"
                type="text"
                disabled={isRunning}
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder="e.g. qwen3:14b or gpt-4o"
                className="w-full px-2.5 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent disabled:opacity-50"
              />
            </div>

            {/* Max Steps */}
            <div className="space-y-1">
              <label htmlFor="max-steps-input" className="block text-text-muted font-mono text-[11px]">Max Steps</label>
              <input
                id="max-steps-input"
                type="number"
                min={1}
                max={50}
                disabled={isRunning}
                value={maxSteps}
                onChange={(e) => setMaxSteps(parseInt(e.target.value, 10) || 12)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent disabled:opacity-50"
              />
            </div>

            {/* Noise Profile */}
            <div className="space-y-1">
              <label htmlFor="noise-select" className="block text-text-muted font-mono text-[11px]">Noise Profile</label>
              <select
                id="noise-select"
                disabled={isRunning}
                value={noiseProfile}
                onChange={(e) => setNoiseProfile(e.target.value as NoiseProfile)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="off">off (no governor delay)</option>
                <option value="quiet">quiet (stealth low-noise)</option>
                <option value="balanced">balanced (standard)</option>
                <option value="aggressive">aggressive (rapid test)</option>
              </select>
            </div>
          </div>

          {/* Sandbox & Shell Execution Lane */}
          <div className="pt-2 border-t border-border space-y-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <label
                htmlFor="allow-shell-toggle"
                className="flex items-center gap-2.5 cursor-pointer select-none"
              >
                <div className="relative inline-flex items-center">
                  <input
                    id="allow-shell-toggle"
                    aria-label="Allow shell execution"
                    type="checkbox"
                    checked={allowShell && Boolean(sandboxStatus?.available)}
                    onChange={(e) => setAllowShell(e.target.checked)}
                    disabled={isRunning || !sandboxStatus?.available}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-surface-2 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-text after:border-border after:border after:rounded-full after:h-3 after:w-3.5 after:transition-all peer-checked:bg-accent peer-disabled:opacity-40 peer-disabled:cursor-not-allowed"></div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Terminal className="w-3.5 h-3.5 text-accent" />
                  <span className={`text-xs font-medium ${!sandboxStatus?.available ? 'text-text-muted' : 'text-text'}`}>
                    Allow shell execution
                  </span>
                  {sandboxStatus && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text-muted">
                      {sandboxStatus.name} ({sandboxStatus.strength})
                    </span>
                  )}
                  {!sandboxStatus?.available && (
                    <span className="text-[10px] text-danger font-mono">
                      (Unavailable)
                    </span>
                  )}
                </div>
              </label>
            </div>

            {/* Partial Sandbox Warning */}
            {sandboxStatus?.available && sandboxStatus.strength === 'partial' && (
              <div className="p-2.5 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>This platform currently provides process limits, not full filesystem isolation.</span>
              </div>
            )}
          </div>

          {/* Auth Profile Selector Lane */}
          <div className="pt-2 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex-1 w-full space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="auth-profile-select" className="block text-text-muted font-mono text-[11px]">
                  Target Auth Profile
                </label>
                {activeAuthProfiles.length === 0 && (
                  <span className="text-[10px] text-warning font-mono">
                    No active auth session found
                  </span>
                )}
              </div>

              <select
                id="auth-profile-select"
                disabled={isRunning || activeAuthProfiles.length === 0}
                value={selectedAuthProfileId}
                onChange={(e) => setSelectedAuthProfileId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent disabled:opacity-50"
              >
                {activeAuthProfiles.length === 0 ? (
                  <option value="">No active auth profile</option>
                ) : (
                  <>
                    <option value="">None (baseline unauthenticated)</option>
                    {activeAuthProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} ({p.identity || p.role}) - Active
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <div className="pt-4 sm:pt-0 shrink-0 self-end">
              <button
                type="submit"
                onClick={handleSubmit}
                disabled={isRunning || !prompt.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-50 shadow-sm"
              >
                {isRunning ? (
                  <>
                    <RotateCw className="w-4 h-4 animate-spin" />
                    <span>Agent Running...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Run Agent</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Error Banner */}
        {error && (
          <div 
            data-testid="tool-run-error"
            className="p-4 rounded-xl bg-danger/10 border border-danger/30 text-danger space-y-2 text-xs"
          >
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Tool Agent Execution Failed</span>
            </div>
            <p className="leading-relaxed font-sans">{error}</p>
            {requestId && (
              <p className="font-mono text-[11px] text-text-muted">
                Request ID: <span className="text-text">{requestId}</span>
              </p>
            )}
          </div>
        )}

        {/* Empty State when no result and not running */}
        {!isRunning && !result && !error && (
          <div 
            data-testid="tool-run-empty-state"
            className="py-12 text-center border border-dashed border-border rounded-xl bg-surface/30 p-8 space-y-3"
          >
            <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center mx-auto text-text-muted">
              <Wrench className="w-5 h-5" />
            </div>
            <h3 className="text-xs font-semibold text-text">Agent Idle</h3>
            <p className="text-xs text-text-muted leading-relaxed font-sans max-w-md mx-auto">
              Agent uses captured traffic and scoped tools only. Compose a prompt above and click &quot;Run Agent&quot; to execute autonomous security verification.
            </p>
          </div>
        )}

        {/* Long Running Progress Indicator */}
        {isRunning && (
          <div className="py-12 flex flex-col items-center justify-center space-y-3 p-8 rounded-xl bg-surface border border-border animate-pulse">
            <RotateCw className="w-6 h-6 text-accent animate-spin" />
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-text">Tool Loop Executing...</p>
              <p className="text-xs text-text-muted font-mono">
                Executing steps within step budget ({maxSteps} max steps). Evaluating tool calls and recording evidence.
              </p>
            </div>
          </div>
        )}

        {/* Result & Tool-Call Timeline */}
        {result && (
          <div data-testid="tool-run-result" className="space-y-5">
            {/* Final Answer Summary Card */}
            <div className="p-5 rounded-xl bg-surface border border-border space-y-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-success shrink-0" />
                  <h3 className="text-sm font-semibold text-text">Agent Final Answer</h3>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30">
                    Status: {result.status}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-surface-2 border border-border text-text-muted">
                    Steps: {result.steps}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-surface-2 border border-border text-text-muted">
                    Model: {result.model}
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-bg border border-border/80 text-xs text-text leading-relaxed font-sans whitespace-pre-wrap">
                {result.finalText || 'Task completed with no text output.'}
              </div>
            </div>

            {/* Tool-Call Timeline */}
            {(() => {
              const calls: ToolCallItem[] = 
                result.toolCalls || 
                ((result as unknown as Record<string, unknown>).tool_calls as ToolCallItem[]) || 
                [];

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono text-text-muted">
                    <span>Tool Calls Executed ({calls.length})</span>
                    <span className="text-[11px] flex items-center gap-1">
                      <EyeOff className="w-3 h-3 text-text-muted/70" />
                      <span>Arguments redacted</span>
                    </span>
                  </div>

                  {calls.length === 0 ? (
                    <div className="p-4 rounded-lg bg-surface border border-border text-center text-xs text-text-muted">
                      No external tool calls were made during this execution.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {calls.map((call, idx) => {
                        const isExpanded = Boolean(expandedCalls[idx]);
                        const isShell = call.name === 'shell.exec';
                        const shellResult = isShell ? (call.result as Record<string, unknown>) : null;
                        const command = String(call.arguments?.command || shellResult?.command || '');
                        const exitCode = typeof shellResult?.exitCode === 'number' ? shellResult.exitCode : undefined;
                        const stdout = String(shellResult?.stdout || '');
                        const stderr = String(shellResult?.stderr || '');
                        const timedOut = Boolean(shellResult?.timedOut);
                        const truncated = Boolean(shellResult?.truncated);
                        const shellSandbox = shellResult?.sandbox as SandboxStatus | undefined;
                        const evidenceId = call.evidenceId || (call.result as Record<string, unknown>)?.evidenceId;
                        const isCallError = Boolean(
                          call.error || 
                          (call.result as Record<string, unknown>)?.error || 
                          (exitCode !== undefined && exitCode !== 0)
                        );

                        return (
                          <div
                            key={idx}
                            data-testid={`tool-call-${idx}`}
                            className="rounded-lg border border-border bg-surface overflow-hidden text-xs"
                          >
                            {/* Call Header */}
                            <div 
                              onClick={() => toggleCallExpand(idx)}
                              className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-surface-2/60 transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
                                )}
                                <Terminal className="w-4 h-4 text-accent shrink-0" />
                                <span className="font-mono font-semibold text-text truncate">
                                  {call.name}
                                </span>
                                {command && (
                                  <span 
                                    className="font-mono text-[11px] text-text-muted bg-bg px-2 py-0.5 rounded border border-border truncate max-w-[220px]" 
                                    title={command}
                                  >
                                    {command}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                                {/* Shell Metadata Badges */}
                                {isShell && (
                                  <>
                                    {exitCode !== undefined && (
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                                        exitCode === 0 
                                          ? 'bg-success/15 text-success border border-success/30' 
                                          : 'bg-danger/15 text-danger border border-danger/30'
                                      }`}>
                                        exit: {exitCode}
                                      </span>
                                    )}
                                    {timedOut && (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-danger/15 text-danger border border-danger/30">
                                        timedOut
                                      </span>
                                    )}
                                    {truncated && (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-warning/15 text-warning border border-warning/30">
                                        truncated
                                      </span>
                                    )}
                                    {shellSandbox && (
                                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text-muted">
                                        {shellSandbox.name} ({shellSandbox.strength})
                                      </span>
                                    )}
                                  </>
                                )}

                                {/* Evidence Link */}
                                {evidenceId ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/projects/${projectId}/findings`);
                                    }}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-accent/15 border border-accent/30 text-accent font-mono text-[10px] hover:bg-accent/25 transition-colors"
                                    title="Inspect evidence in Findings / Workbench"
                                  >
                                    <span>Evidence: {String(evidenceId)}</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                ) : null}

                                {/* Status badge for non-shell */}
                                {!isShell && (
                                  isCallError ? (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-danger/15 text-danger border border-danger/30">
                                      Error
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-success/15 text-success border border-success/30">
                                      Success
                                    </span>
                                  )
                                )}
                              </div>
                            </div>

                            {/* Collapsible Details */}
                            {isExpanded && (
                              <div className="p-4 border-t border-border bg-bg/80 space-y-3 font-mono text-[11px]">
                                {isShell ? (
                                  <>
                                    {/* Shell Command */}
                                    <div className="space-y-1">
                                      <span className="text-text-muted text-[10px] uppercase tracking-wider">
                                        Command
                                      </span>
                                      <pre className="p-2.5 rounded bg-[#0A0D12] border border-border text-accent overflow-x-auto select-all">
                                        {command}
                                      </pre>
                                    </div>

                                    {/* Execution Metrics Grid */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                                      <div className="p-2 rounded bg-surface border border-border">
                                        <span className="text-text-muted block uppercase">Exit Code</span>
                                        <span className={`font-semibold ${exitCode === 0 ? 'text-success' : 'text-danger'}`}>
                                          {exitCode !== undefined ? exitCode : '—'}
                                        </span>
                                      </div>
                                      <div className="p-2 rounded bg-surface border border-border">
                                        <span className="text-text-muted block uppercase">Sandbox</span>
                                        <span className="text-text">
                                          {shellSandbox ? `${shellSandbox.name} (${shellSandbox.strength})` : '—'}
                                        </span>
                                      </div>
                                      <div className="p-2 rounded bg-surface border border-border">
                                        <span className="text-text-muted block uppercase">Timed Out</span>
                                        <span className={timedOut ? 'text-danger font-semibold' : 'text-text'}>
                                          {timedOut ? 'Yes' : 'No'}
                                        </span>
                                      </div>
                                      <div className="p-2 rounded bg-surface border border-border">
                                        <span className="text-text-muted block uppercase">Truncated</span>
                                        <span className={truncated ? 'text-warning font-semibold' : 'text-text'}>
                                          {truncated ? 'Yes' : 'No'}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Stdout Collapsible with Copy Action */}
                                    <div className="space-y-1.5 pt-1">
                                      <div className="flex items-center justify-between">
                                        <button
                                          type="button"
                                          onClick={() => toggleStdout(idx)}
                                          className="flex items-center gap-1.5 text-xs text-text hover:text-accent font-medium transition-colors"
                                        >
                                          {expandedStdout[idx] ? (
                                            <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                                          ) : (
                                            <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                                          )}
                                          <span>Stdout ({stdout.length} chars)</span>
                                        </button>

                                        {stdout && (
                                          <button
                                            type="button"
                                            onClick={() => handleCopyStdout(idx, stdout)}
                                            className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-[10px] text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
                                            title="Copy standard output"
                                          >
                                            {copiedStdout[idx] ? (
                                              <Check className="w-3 h-3 text-success" />
                                            ) : (
                                              <Copy className="w-3 h-3" />
                                            )}
                                            <span>{copiedStdout[idx] ? 'Copied' : 'Copy stdout'}</span>
                                          </button>
                                        )}
                                      </div>

                                      {expandedStdout[idx] && (
                                        <pre className="p-3 rounded bg-[#0A0D12] border border-border text-text whitespace-pre-wrap max-h-60 overflow-y-auto select-text font-mono text-xs">
                                          {stdout || '(empty stdout)'}
                                        </pre>
                                      )}
                                    </div>

                                    {/* Stderr Collapsible with Copy Action */}
                                    <div className="space-y-1.5 pt-1">
                                      <div className="flex items-center justify-between">
                                        <button
                                          type="button"
                                          onClick={() => toggleStderr(idx)}
                                          className="flex items-center gap-1.5 text-xs text-text hover:text-danger font-medium transition-colors"
                                        >
                                          {expandedStderr[idx] ? (
                                            <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                                          ) : (
                                            <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                                          )}
                                          <span>Stderr ({stderr.length} chars)</span>
                                        </button>

                                        {stderr && (
                                          <button
                                            type="button"
                                            onClick={() => handleCopyStderr(idx, stderr)}
                                            className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-[10px] text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
                                            title="Copy standard error"
                                          >
                                            {copiedStderr[idx] ? (
                                              <Check className="w-3 h-3 text-success" />
                                            ) : (
                                              <Copy className="w-3 h-3" />
                                            )}
                                            <span>{copiedStderr[idx] ? 'Copied' : 'Copy stderr'}</span>
                                          </button>
                                        )}
                                      </div>

                                      {expandedStderr[idx] && (
                                        <pre className="p-3 rounded bg-[#0A0D12] border border-danger/30 text-danger whitespace-pre-wrap max-h-60 overflow-y-auto select-text font-mono text-xs">
                                          {stderr || '(empty stderr)'}
                                        </pre>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    {/* Redacted Arguments */}
                                    <div className="space-y-1">
                                      <span className="text-text-muted text-[10px] uppercase tracking-wider">
                                        Arguments (Redacted)
                                      </span>
                                      <pre className="p-2.5 rounded bg-surface border border-border text-text overflow-x-auto">
                                        {JSON.stringify(redactArguments(call.arguments), null, 2)}
                                      </pre>
                                    </div>

                                    {/* Result or Error */}
                                    <div className="space-y-1">
                                      <span className="text-text-muted text-[10px] uppercase tracking-wider">
                                        Result
                                      </span>
                                      {call.error ? (
                                        <div className="p-2.5 rounded bg-danger/10 border border-danger/30 text-danger font-sans">
                                          {call.error}
                                        </div>
                                      ) : (
                                        <pre className="p-2.5 rounded bg-surface border border-border text-text overflow-x-auto max-h-48">
                                          {JSON.stringify(call.result, null, 2)}
                                        </pre>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};
