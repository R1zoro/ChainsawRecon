import React, { useState, useEffect } from 'react';
import { 
  X, ShieldAlert, ShieldCheck, AlertTriangle, 
  RotateCw, Check, Globe, AlertCircle, Copy 
} from 'lucide-react';
import { fetchJson, isApiError } from '../../../api/client';
import { AuthDetection } from '../../../api/types';

interface DetectAuthModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onApplyCandidate?: (candidateUrl: string, method: string) => void;
}

export const DetectAuthModal: React.FC<DetectAuthModalProps> = ({
  projectId,
  isOpen,
  onClose,
  onApplyCandidate,
}) => {
  const [detection, setDetection] = useState<AuthDetection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [copiedReqId, setCopiedReqId] = useState(false);

  const runDetection = async () => {
    setIsLoading(true);
    setError(null);
    setRequestId(null);
    try {
      const res = await fetchJson<AuthDetection>(`/projects/${projectId}/auth/detect`, {
        method: 'POST',
      });
      setDetection(res);
    } catch (err) {
      if (isApiError(err)) {
        setError(err.message);
        setRequestId(err.request_id);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to detect authentication mechanisms.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runDetection();
    } else {
      setDetection(null);
      setError(null);
    }
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans select-none animate-in fade-in duration-200">
      <div 
        className="w-full max-w-2xl bg-surface border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detect-auth-title"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-2/40">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-accent" />
            <div>
              <h2 id="detect-auth-title" className="text-sm font-semibold text-text">
                Authentication & Bot Protection Detection
              </h2>
              <p className="text-xs text-text-muted">
                Analyze captured traffic to discover login endpoints and anti-bot obstacles.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {isLoading && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <RotateCw className="w-6 h-6 text-accent animate-spin" />
              <p className="text-text-muted font-mono text-xs">
                Scanning captured flows and login forms...
              </p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-lg bg-danger/10 border border-danger/30 text-danger space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Detection Failed</span>
              </div>
              <p className="text-xs leading-relaxed font-sans">{error}</p>
              {requestId && (
                <div className="flex items-center justify-between text-[11px] font-mono pt-1 text-text-muted">
                  <span>Request ID: <span className="text-text">{requestId}</span></span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(requestId);
                      setCopiedReqId(true);
                      setTimeout(() => setCopiedReqId(false), 2000);
                    }}
                    className="p-1 hover:text-text rounded"
                  >
                    {copiedReqId ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
              <button
                onClick={runDetection}
                className="mt-2 px-3 py-1 rounded bg-danger/20 hover:bg-danger/30 border border-danger/40 text-danger text-xs font-mono transition-colors"
              >
                Retry Scan
              </button>
            </div>
          )}

          {!isLoading && detection && (
            <>
              {/* Bot Protection Banner */}
              {detection.botProtection?.detected ? (
                <div 
                  data-testid="bot-protection-warning"
                  className="p-4 rounded-lg bg-warning/10 border border-warning/40 text-warning space-y-2"
                >
                  <div className="flex items-center gap-2 font-semibold text-sm text-warning">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      Bot Protection Detected: {detection.botProtection.vendor || 'Unknown Vendor'}{' '}
                      ({Math.round((detection.botProtection.confidence || 0) * 100)}% confidence)
                    </span>
                  </div>
                  <p className="text-xs text-text-muted font-sans leading-relaxed">
                    Anti-bot challenges or CAPTCHA widgets were identified. Chainsaw does not automate CAPTCHA solving. 
                    <strong className="text-text ml-1">Browser login with manual operator completion is strongly recommended.</strong>
                  </p>
                  {detection.botProtection.signals?.length > 0 && (
                    <div className="pt-1 space-y-1">
                      <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">Detection Signals:</span>
                      <ul className="list-disc list-inside space-y-0.5 font-mono text-[11px] text-text">
                        {detection.botProtection.signals.map((sig, i) => (
                          <li key={i}>{sig}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-success/10 border border-success/30 text-success flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>No active bot protection or CAPTCHA detected in captured endpoints.</span>
                </div>
              )}

              {/* Recommended Adapter & Mechanisms */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-lg bg-surface-2 border border-border space-y-2">
                  <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
                    Recommended Adapter
                  </span>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-accent" />
                    <span className="font-semibold text-text text-sm capitalize">
                      {detection.recommendedAdapter}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted leading-relaxed font-sans">
                    {detection.recommendedAdapter === 'browser'
                      ? 'Opens a visible Chromium session for interactive login, MFA, and bot verification.'
                      : 'Executes automated HTTP POST requests directly to login endpoints.'}
                  </p>
                </div>

                <div className="p-3.5 rounded-lg bg-surface-2 border border-border space-y-2">
                  <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
                    Detected Mechanisms
                  </span>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {detection.mechanisms?.length > 0 ? (
                      detection.mechanisms.map((mech) => (
                        <span 
                          key={mech}
                          className="px-2 py-0.5 rounded bg-bg border border-border/80 text-text font-mono text-[11px]"
                        >
                          {mech}
                        </span>
                      ))
                    ) : (
                      <span className="text-text-muted font-mono text-xs">None detected</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Warnings List */}
              {detection.warnings?.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
                    Detection Warnings ({detection.warnings.length})
                  </span>
                  <div className="space-y-1">
                    {detection.warnings.map((warn, i) => (
                      <div key={i} className="p-2 rounded bg-bg border border-border flex items-start gap-2 text-[11px] text-text-muted">
                        <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                        <span className="font-sans leading-relaxed">{warn}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Login Candidates */}
              <div className="space-y-2">
                <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
                  Login Candidates ({detection.loginCandidates?.length || 0})
                </span>
                {detection.loginCandidates?.length === 0 ? (
                  <p className="p-4 rounded bg-bg border border-border text-center text-text-muted text-xs">
                    No login candidate forms found in captured traffic.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {detection.loginCandidates.map((cand, idx) => (
                      <div 
                        key={idx}
                        className="p-3 rounded-lg bg-bg border border-border hover:border-border/80 transition-colors space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 truncate font-mono">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-2 border border-border text-accent">
                              {cand.method}
                            </span>
                            <span className="text-text text-xs font-semibold truncate" title={cand.url}>
                              {cand.url}
                            </span>
                          </div>
                          {onApplyCandidate && (
                            <button
                              onClick={() => {
                                onApplyCandidate(cand.url, cand.method);
                                onClose();
                              }}
                              className="px-2 py-0.5 rounded bg-accent/20 hover:bg-accent/30 border border-accent/40 text-accent font-medium text-[11px] shrink-0"
                            >
                              Use in Profile
                            </button>
                          )}
                        </div>

                        {/* Fields & flags */}
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-text-muted">
                          {cand.usernameField && (
                            <span>User field: <span className="text-text font-semibold">{cand.usernameField}</span></span>
                          )}
                          {cand.passwordField && (
                            <span>Password field: <span className="text-text font-semibold">{cand.passwordField}</span></span>
                          )}
                          {cand.csrfField && (
                            <span>CSRF field: <span className="text-text">{cand.csrfField}</span></span>
                          )}
                          {cand.hasCaptcha && (
                            <span className="px-1.5 py-0.2 rounded bg-danger/10 border border-danger/30 text-danger text-[10px]">
                              CAPTCHA present
                            </span>
                          )}
                          {cand.hasOAuth && (
                            <span className="px-1.5 py-0.2 rounded bg-accent/10 border border-accent/30 text-accent text-[10px]">
                              OAuth flow
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
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
