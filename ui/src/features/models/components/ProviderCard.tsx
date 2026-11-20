import React, { useState } from 'react';
import { 
  Server, Globe, CheckCircle, AlertTriangle, 
  Crosshair, HeartPulse 
} from 'lucide-react';
import { fetchJson, isApiError } from '../../../api/client';
import { ProviderHealthResponse, ProviderItem } from '../../../api/types';

interface ProviderCardProps {
  provider: ProviderItem;
  onCalibrate: (provider: ProviderItem) => void;
}

export const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  onCalibrate,
}) => {
  const [healthStatus, setHealthStatus] = useState<ProviderHealthResponse | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const isWebUi = (provider.type as string) === 'webui' || (provider.type as string) === 'browser';

  const handleCheckHealth = async () => {
    setIsCheckingHealth(true);
    setHealthError(null);
    try {
      const res = await fetchJson<ProviderHealthResponse>(`/providers/${provider.id}/health`);
      setHealthStatus(res);
    } catch (err) {
      setHealthError(isApiError(err) ? err.message : 'Health check failed.');
    } finally {
      setIsCheckingHealth(false);
    }
  };

  return (
    <div 
      data-testid={`provider-card-${provider.id}`}
      className="rounded-lg border border-border bg-surface p-5 flex flex-col justify-between space-y-4 shadow-sm hover:border-border/80 transition-all"
    >
      <div className="space-y-3">
        {/* Header: Name, Type Badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isWebUi ? (
                <Globe className="w-4 h-4 text-accent shrink-0" />
              ) : (
                <Server className="w-4 h-4 text-accent shrink-0" />
              )}
              <h3 className="text-sm font-semibold text-text tracking-tight truncate">
                {provider.name}
              </h3>
            </div>
            <p className="text-xs text-text-muted font-mono mt-0.5 truncate">
              {provider.id}
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-1.5 font-mono text-[11px]">
            <span className={`px-2 py-0.5 rounded-full font-medium ${
              isWebUi
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'bg-surface-2 text-text border border-border'
            }`}>
              {provider.type}
            </span>
          </div>
        </div>

        {/* Engine & Configuration Details */}
        <div className="p-3 rounded-lg bg-bg border border-border/80 text-xs font-mono space-y-1.5">
          {provider.engine && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-muted">Engine:</span>
              <span className="text-text font-semibold">{provider.engine}</span>
            </div>
          )}

          {provider.baseUrl && (
            <div className="flex items-center justify-between text-[11px] truncate">
              <span className="text-text-muted shrink-0 mr-2">URL:</span>
              <span className="text-text truncate" title={provider.baseUrl}>{provider.baseUrl}</span>
            </div>
          )}

          {provider.profileDir && (
            <div className="flex items-center justify-between text-[11px] truncate">
              <span className="text-text-muted shrink-0 mr-2">Profile Dir:</span>
              <span className="text-text truncate" title={provider.profileDir}>{provider.profileDir}</span>
            </div>
          )}

          {provider.headless !== undefined && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-muted">Mode:</span>
              <span className="text-text">{provider.headless ? 'Headless' : 'Visible Window'}</span>
            </div>
          )}
        </div>

        {/* Models list */}
        {provider.models && provider.models.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
              Available Models
            </span>
            <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
              {provider.models.map((m) => (
                <span key={m.id} className="px-2 py-0.5 rounded bg-surface-2 border border-border/70 text-text">
                  {m.name || m.id}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Health status banner */}
        {healthStatus && (
          <div className="p-2.5 rounded-lg bg-success/10 border border-success/30 text-success text-xs flex items-center justify-between font-mono">
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {healthStatus.loggedIn ? 'Operator Logged In' : 'Logged Out / Gate Active'}
              </span>
            </div>
            {healthStatus.engine && (
              <span className="text-[10px] text-text-muted">{healthStatus.engine}</span>
            )}
          </div>
        )}

        {healthError && (
          <div className="p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs flex items-center gap-1.5 font-sans">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{healthError}</span>
          </div>
        )}
      </div>

      {/* Card Action Controls */}
      <div className="pt-3 border-t border-border flex items-center justify-between gap-2">
        <button
          onClick={handleCheckHealth}
          disabled={isCheckingHealth}
          className="flex items-center gap-1.5 px-3 py-1 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors disabled:opacity-50"
          title="Check provider health and operator login state"
        >
          <HeartPulse className={`w-3.5 h-3.5 ${isCheckingHealth ? 'animate-spin text-accent' : 'text-accent'}`} />
          <span>{isCheckingHealth ? 'Checking...' : 'Check Health'}</span>
        </button>

        {isWebUi && (
          <button
            onClick={() => onCalibrate(provider)}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent text-xs font-medium transition-colors"
            title="Inspect and calibrate DOM selectors for this Web UI"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Calibrate</span>
          </button>
        )}
      </div>
    </div>
  );
};
