import React, { useState, useEffect } from 'react';
import { 
  X, Crosshair, RotateCw, AlertTriangle, AlertCircle 
} from 'lucide-react';
import { fetchJson, isApiError } from '../../../api/client';
import { ProviderCalibrateResponse, ProviderItem } from '../../../api/types';

interface CalibrateModalProps {
  provider: ProviderItem;
  isOpen: boolean;
  onClose: () => void;
}

export const CalibrateModal: React.FC<CalibrateModalProps> = ({
  provider,
  isOpen,
  onClose,
}) => {
  const [calibration, setCalibration] = useState<ProviderCalibrateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCalibration = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchJson<ProviderCalibrateResponse>(
        `/providers/${provider.id}/calibrate`,
        { method: 'POST' }
      );
      setCalibration(res);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Calibration failed.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runCalibration();
    } else {
      setCalibration(null);
      setError(null);
    }
  }, [isOpen, provider.id]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans select-none animate-in fade-in duration-200">
      <div 
        className="w-full max-w-xl bg-surface border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calibrate-title"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-2/40">
          <div className="flex items-center gap-2.5">
            <Crosshair className="w-5 h-5 text-accent" />
            <div>
              <h2 id="calibrate-title" className="text-sm font-semibold text-text">
                Web UI Selector Calibration
              </h2>
              <p className="text-xs text-text-muted font-mono truncate max-w-xs">
                {provider.name} ({provider.engine || 'WebUI'})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs">
          {isLoading && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <RotateCw className="w-6 h-6 text-accent animate-spin" />
              <p className="text-text-muted font-mono text-xs">
                Navigating to Web UI and testing DOM selectors...
              </p>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-lg bg-danger/10 border border-danger/30 text-danger space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Calibration Failed</span>
              </div>
              <p className="font-sans leading-relaxed">{error}</p>
              <button
                onClick={runCalibration}
                className="px-3 py-1 rounded bg-danger/20 hover:bg-danger/30 border border-danger/40 text-danger text-xs font-mono transition-colors"
              >
                Retry Calibration
              </button>
            </div>
          )}

          {!isLoading && calibration && (
            <div className="space-y-4">
              {/* Target Web Page Info */}
              <div className="p-3.5 rounded-lg bg-surface-2 border border-border space-y-1.5 font-mono text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Page Title:</span>
                  <span className="text-text font-semibold">{calibration.title || 'Untitled'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Target URL:</span>
                  <span className="text-text truncate max-w-xs" title={calibration.url}>{calibration.url}</span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-border/60">
                  <span className="text-text-muted">Password Field Visible:</span>
                  {calibration.hasPassword ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-warning/15 text-warning font-semibold">
                      Yes (Login / Auth gate detected)
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-success/15 text-success">
                      No password field (Chat active)
                    </span>
                  )}
                </div>
              </div>

              {/* Selector Counts Breakdown */}
              <div className="space-y-2">
                <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
                  DOM Selectors Match Counts
                </span>

                {calibration.counts && Object.keys(calibration.counts).length > 0 ? (
                  <div className="space-y-2 font-mono text-xs">
                    {Object.entries(calibration.counts).map(([role, list]) => (
                      <div 
                        key={role}
                        className="p-3 rounded-lg bg-bg border border-border space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-accent uppercase text-[11px]">{role}</span>
                          <span className="text-[10px] text-text-muted">
                            Total: {list.reduce((acc, curr) => acc + curr.count, 0)} matches
                          </span>
                        </div>

                        <div className="space-y-1">
                          {list.map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between text-[11px] text-text-muted">
                              <code className="text-text truncate max-w-xs">{item.selector}</code>
                              <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                                item.count > 0 ? 'bg-success/15 text-success' : 'bg-surface-2 text-text-muted'
                              }`}>
                                {item.count} found
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-text-muted font-mono text-xs p-3 rounded bg-bg border border-border">
                    No selector counts returned.
                  </p>
                )}
              </div>

              {/* Advisory Box */}
              <div className="p-3 rounded-lg bg-surface-2 border border-border text-text-muted text-[11px] font-sans leading-relaxed flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <span>
                  Web UI layouts change frequently. If chat input or response extraction fails during sessions, recalibrate and adjust custom selector rules.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2 bg-surface-2/40">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
