import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Play, RotateCw, AlertTriangle, AlertCircle, 
  CheckCircle, Sliders, X
} from 'lucide-react';
import { fetchJson, isApiError } from '../../../api/client';
import { 
  Paginated, 
  ProviderItem, 
  ModelRole, 
  NoiseProfile, 
  RoleModelConfig, 
  SessionRunPayload, 
  SessionRunResponse 
} from '../../../api/types';

export interface SessionRunPanelProps {
  sessionId: string;
  projectId?: string;
  sessionProvider?: string;
  sessionModel?: string;
  onRunComplete?: (response: SessionRunResponse) => void;
  onClose?: () => void;
}

export const ROLE_DEFINITIONS: { id: ModelRole; label: string; desc: string }[] = [
  { id: 'orchestrator', label: 'Orchestrator', desc: 'Plans execution, decomposes goals, and coordinates worker steps' },
  { id: 'operator', label: 'Operator', desc: 'Executes commands, tests boundaries, and calls scoped tools' },
  { id: 'recon', label: 'Recon', desc: 'Discovers assets, enumerates endpoints, and maps attack surface' },
  { id: 'validator', label: 'Validator', desc: 'Audits evidence, validates boundaries, and verifies reproducibility' },
  { id: 'reporter', label: 'Reporter', desc: 'Compiles assessment narratives and synthesizes findings' },
];

export const SessionRunPanel: React.FC<SessionRunPanelProps> = ({
  sessionId,
  sessionProvider = '',
  sessionModel = '',
  onRunComplete,
  onClose,
}) => {
  // 1. Fetch configured providers
  const { data: providersData, isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => fetchJson<Paginated<ProviderItem>>('/providers'),
  });

  const providers = useMemo(() => providersData?.items || [], [providersData]);
  const knownProviderIds = useMemo(() => new Set(providers.map((p) => p.id)), [providers]);

  // Determine default provider & model
  const defaultProvider = useMemo(() => {
    if (sessionProvider && knownProviderIds.has(sessionProvider)) {
      return sessionProvider;
    }
    return providers[0]?.id || '';
  }, [sessionProvider, knownProviderIds, providers]);

  const defaultModel = useMemo(() => {
    if (sessionModel) return sessionModel;
    const p = providers.find((prov) => prov.id === defaultProvider);
    return p?.models?.[0]?.id || '';
  }, [sessionModel, defaultProvider, providers]);

  // Run controls state
  const [maxSteps, setMaxSteps] = useState<number>(10);
  const [noiseProfile, setNoiseProfile] = useState<NoiseProfile>('balanced');

  // Role matrix state: per session local storage or state
  const storageKey = `chainsaw_roles_${sessionId}`;
  const [roleMatrix, setRoleMatrix] = useState<Record<ModelRole, RoleModelConfig>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // Fallback
    }
    return {
      orchestrator: { providerId: defaultProvider, model: defaultModel },
      operator: { providerId: defaultProvider, model: defaultModel },
      recon: { providerId: defaultProvider, model: defaultModel },
      validator: { providerId: defaultProvider, model: defaultModel },
      reporter: { providerId: defaultProvider, model: defaultModel },
    };
  });

  // Keep defaults updated if initial providers load after mount
  useEffect(() => {
    if (defaultProvider && defaultModel) {
      setRoleMatrix((prev) => {
        let changed = false;
        const updated = { ...prev };
        for (const def of ROLE_DEFINITIONS) {
          if (!updated[def.id]?.providerId) {
            updated[def.id] = { providerId: defaultProvider, model: defaultModel };
            changed = true;
          }
        }
        return changed ? updated : prev;
      });
    }
  }, [defaultProvider, defaultModel]);

  // Save to local state per session
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(roleMatrix));
    } catch {
      // Ignore storage errors
    }
  }, [roleMatrix, storageKey]);

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<SessionRunResponse | null>(null);

  // Validation: Check for unknown providers
  const unknownProviderErrors = useMemo(() => {
    const errors: string[] = [];
    if (providers.length === 0) return errors;

    for (const def of ROLE_DEFINITIONS) {
      const cfg = roleMatrix[def.id];
      if (cfg?.providerId && !knownProviderIds.has(cfg.providerId)) {
        errors.push(`Role '${def.label}' specifies unknown provider '${cfg.providerId}'.`);
      }
    }
    return errors;
  }, [roleMatrix, knownProviderIds, providers]);

  // Warning: Check for Web UI providers in roles
  const webUiWarnings = useMemo(() => {
    const warnings: string[] = [];
    for (const def of ROLE_DEFINITIONS) {
      const cfg = roleMatrix[def.id];
      if (cfg?.providerId) {
        const prov = providers.find((p) => p.id === cfg.providerId);
        if (prov && (prov.type === 'browser' || prov.type === 'webui')) {
          warnings.push(`Role '${def.label}' uses Web UI provider '${prov.name}'. Web UI execution is slower, opens a browser window, and does not support native tool calls.`);
        }
      }
    }
    return warnings;
  }, [roleMatrix, providers]);

  const handleRoleChange = (role: ModelRole, field: 'providerId' | 'model', value: string) => {
    setRoleMatrix((prev) => {
      const current = prev[role] || { providerId: defaultProvider, model: defaultModel };
      let newModel = current.model;
      if (field === 'providerId') {
        const p = providers.find((prov) => prov.id === value);
        newModel = p?.models?.[0]?.id || current.model;
      } else {
        newModel = value;
      }
      return {
        ...prev,
        [role]: {
          ...current,
          [field]: value,
          ...(field === 'providerId' ? { model: newModel } : {}),
        },
      };
    });
  };

  const handleResetToDefaults = () => {
    setRoleMatrix({
      orchestrator: { providerId: defaultProvider, model: defaultModel },
      operator: { providerId: defaultProvider, model: defaultModel },
      recon: { providerId: defaultProvider, model: defaultModel },
      validator: { providerId: defaultProvider, model: defaultModel },
      reporter: { providerId: defaultProvider, model: defaultModel },
    });
  };

  const handleRun = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (unknownProviderErrors.length > 0) {
      setError(unknownProviderErrors[0]);
      return;
    }

    setIsRunning(true);
    setError(null);
    setRunResult(null);

    // Build roles payload: submit ONLY roles that differ from the session default
    const nonDefaultRoles: Record<string, RoleModelConfig> = {};
    for (const def of ROLE_DEFINITIONS) {
      const cfg = roleMatrix[def.id];
      if (!cfg) continue;
      const isDifferent = cfg.providerId !== defaultProvider || cfg.model !== defaultModel;
      if (isDifferent) {
        nonDefaultRoles[def.id] = {
          providerId: cfg.providerId,
          model: cfg.model,
        };
      }
    }

    const payload: SessionRunPayload = {
      maxSteps,
      noiseProfile,
      providerId: defaultProvider || undefined,
      model: defaultModel || undefined,
      ...(Object.keys(nonDefaultRoles).length > 0 ? { roles: nonDefaultRoles } : {}),
    };

    try {
      const res = await fetchJson<SessionRunResponse>(`/sessions/${sessionId}/run`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setRunResult(res);
      onRunComplete?.(res);
    } catch (err) {
      if (isApiError(err)) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Session run execution failed.');
      }
    } finally {
      setIsRunning(false);
    }
  };

  if (isLoading) {
    return (
      <div 
        data-testid="session-run-panel"
        className="rounded-xl border border-border bg-surface p-12 flex flex-col items-center justify-center space-y-3 text-xs max-w-3xl w-full mx-auto"
      >
        <RotateCw className="w-5 h-5 text-accent animate-spin" />
        <span className="text-text-muted">Loading providers and role matrix...</span>
      </div>
    );
  }

  return (
    <div 
      data-testid="session-run-panel"
      className="rounded-xl border border-border bg-surface flex flex-col max-w-3xl w-full mx-auto overflow-hidden shadow-lg font-sans"
    >
      {/* Header */}
      <div className="border-b border-border px-5 py-3.5 flex items-center justify-between bg-surface-2/40">
        <div className="flex items-center gap-2.5">
          <Sliders className="w-4 h-4 text-accent shrink-0" />
          <div>
            <h3 className="text-xs font-semibold text-text">Session Run Role Matrix</h3>
            <p className="text-[11px] text-text-muted font-sans">
              Route specialized session subtasks to tuned models. Default fallback: <span className="font-mono text-text">{defaultProvider || 'none'} / {defaultModel || 'none'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetToDefaults}
            className="text-[11px] px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
            title="Reset all roles to session default"
          >
            Reset Defaults
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
              title="Close panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Body Content */}
      <form onSubmit={handleRun} className="p-5 space-y-5 overflow-y-auto max-h-[75vh]">
        {/* Global Run Settings */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-lg bg-bg border border-border text-xs">
          <div className="space-y-1">
            <label htmlFor="run-max-steps" className="block text-text-muted font-mono text-[11px]">
              Max Step Budget
            </label>
            <input
              id="run-max-steps"
              type="number"
              min={1}
              max={200}
              disabled={isRunning}
              value={maxSteps}
              onChange={(e) => setMaxSteps(parseInt(e.target.value, 10) || 10)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-border text-text font-mono text-xs focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="run-noise-profile" className="block text-text-muted font-mono text-[11px]">
              Governor Noise Profile
            </label>
            <select
              id="run-noise-profile"
              disabled={isRunning}
              value={noiseProfile}
              onChange={(e) => setNoiseProfile(e.target.value as NoiseProfile)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-border text-text font-sans text-xs focus:outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="off">off (no rate delays)</option>
              <option value="quiet">quiet (stealth)</option>
              <option value="balanced">balanced (default)</option>
              <option value="aggressive">aggressive (rapid test)</option>
            </select>
          </div>
        </div>

        {/* Role Matrix Rows */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs font-mono text-text-muted px-1">
            <span>Specialized Roles</span>
            <span className="text-[11px]">Omitted roles inherit session orchestrator</span>
          </div>

          <div className="space-y-2">
            {ROLE_DEFINITIONS.map((def) => {
              const currentCfg = roleMatrix[def.id] || { providerId: defaultProvider, model: defaultModel };
              const isCustom = currentCfg.providerId !== defaultProvider || currentCfg.model !== defaultModel;
              const providerObj = providers.find((p) => p.id === currentCfg.providerId);
              const isWebUi = providerObj && (providerObj.type === 'browser' || providerObj.type === 'webui');
              const isUnknown = currentCfg.providerId && !knownProviderIds.has(currentCfg.providerId);

              return (
                <div
                  key={def.id}
                  data-testid={`role-row-${def.id}`}
                  className={`p-3 rounded-lg border transition-all ${
                    isUnknown
                      ? 'border-danger/40 bg-danger/5'
                      : isCustom 
                        ? 'border-accent/40 bg-accent/5' 
                        : 'border-border bg-bg/60'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    {/* Role Identity */}
                    <div className="min-w-0 sm:w-48">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-text capitalize">
                          {def.label}
                        </span>
                        {isCustom ? (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-accent/15 text-accent border border-accent/30">
                            Custom
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-surface-2 text-text-muted border border-border">
                            Default
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-text-muted truncate mt-0.5" title={def.desc}>
                        {def.desc}
                      </p>
                    </div>

                    {/* Provider & Model Selectors */}
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {/* Provider Select */}
                      <select
                        aria-label={`${def.id} provider`}
                        disabled={isRunning || providers.length === 0}
                        value={currentCfg.providerId}
                        onChange={(e) => handleRoleChange(def.id, 'providerId', e.target.value)}
                        className={`w-full px-2.5 py-1.5 rounded bg-surface border text-xs focus:outline-none focus:border-accent disabled:opacity-50 ${
                          isUnknown ? 'border-danger text-danger' : 'border-border text-text'
                        }`}
                      >
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.type})
                          </option>
                        ))}
                        {isUnknown && (
                          <option value={currentCfg.providerId}>
                            {currentCfg.providerId} (Unknown)
                          </option>
                        )}
                      </select>

                      {/* Model Input/Select */}
                      {providerObj && providerObj.models && providerObj.models.length > 0 ? (
                        <select
                          aria-label={`${def.id} model`}
                          disabled={isRunning}
                          value={currentCfg.model}
                          onChange={(e) => handleRoleChange(def.id, 'model', e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded bg-surface border border-border text-text text-xs focus:outline-none focus:border-accent disabled:opacity-50 font-mono"
                        >
                          {providerObj.models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.id}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={`${def.id} model`}
                          type="text"
                          disabled={isRunning}
                          value={currentCfg.model}
                          onChange={(e) => handleRoleChange(def.id, 'model', e.target.value)}
                          placeholder="Model identifier (e.g. gpt-4o)"
                          className="w-full px-2.5 py-1.5 rounded bg-surface border border-border text-text font-mono text-xs focus:outline-none focus:border-accent disabled:opacity-50"
                        />
                      )}
                    </div>
                  </div>

                  {/* Web UI Provider Warning for this Role */}
                  {isWebUi && (
                    <div className="mt-2 p-2 rounded bg-warning/10 border border-warning/30 text-warning text-[11px] flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Warning: Web UI provider will open a browser window and runs without native tool calls.</span>
                    </div>
                  )}

                  {/* Unknown Provider Error for this Role */}
                  {isUnknown && (
                    <div className="mt-2 p-2 rounded bg-danger/10 border border-danger/30 text-danger text-[11px] flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Unknown provider &quot;{currentCfg.providerId}&quot;. Please select a configured provider.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Global Warnings Banner */}
        {webUiWarnings.length > 0 && (
          <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Web UI Provider Notice</span>
            </div>
            <p className="leading-relaxed">
              One or more roles use a Web UI provider. These providers run through a visible browser automation tab and do not execute native sandbox tools.
            </p>
          </div>
        )}

        {/* Unknown Provider Blocking Error Banner */}
        {unknownProviderErrors.length > 0 && (
          <div 
            data-testid="unknown-provider-error"
            className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs space-y-1"
          >
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Unknown Provider Blocked</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5">
              {unknownProviderErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div 
            data-testid="session-run-error"
            className="p-3.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Effective Role Mapping Display after Run */}
        {runResult && runResult.roles && (
          <div 
            data-testid="effective-roles-mapping"
            className="p-4 rounded-xl bg-surface-2/60 border border-border space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-success shrink-0" />
                <h4 className="text-xs font-semibold text-text">Effective Role Routing</h4>
              </div>
              <span className="text-[10px] font-mono text-text-muted bg-bg px-2 py-0.5 rounded border border-border">
                Steps: {runResult.steps} | Status: {runResult.finished ? 'Finished' : 'Running'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
              {Object.entries(runResult.roles).map(([role, ref]) => (
                <div 
                  key={role} 
                  className="p-2.5 rounded bg-bg border border-border/80 flex items-center justify-between"
                >
                  <span className="font-semibold text-accent capitalize">{role}</span>
                  <span className="text-text-muted text-[11px]">
                    {ref.providerId} / <span className="text-text font-medium">{ref.modelId}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submit Action Bar */}
        <div className="pt-2 border-t border-border flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-muted font-sans">
            Preserves settings in local session state.
          </span>

          <button
            type="submit"
            disabled={isRunning || unknownProviderErrors.length > 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-50 shadow-sm"
          >
            {isRunning ? (
              <>
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                <span>Running Session...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Start Session Run</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export const SessionRunModal: React.FC<SessionRunPanelProps & { isOpen: boolean }> = ({
  isOpen,
  onClose,
  ...props
}) => {
  if (!isOpen) return null;
  return (
    <div 
      data-testid="session-run-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-3xl">
        <SessionRunPanel {...props} onClose={onClose} />
      </div>
    </div>
  );
};
