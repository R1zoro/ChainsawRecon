import React, { useState, useEffect } from 'react';
import { 
  X, LogIn, Globe, AlertCircle, RotateCw, CheckCircle, 
  AlertTriangle 
} from 'lucide-react';
import { fetchJson, isApiError } from '../../../api/client';
import { AuthProfile, AuthSessionStatus } from '../../../api/types';

interface LoginModalProps {
  projectId: string;
  profile: AuthProfile;
  initialAdapter: 'http_form' | 'browser';
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (session: AuthSessionStatus) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  projectId,
  profile,
  initialAdapter,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [adapter, setAdapter] = useState<'http_form' | 'browser'>(initialAdapter);
  const [username, setUsername] = useState(profile.identity || '');
  const [password, setPassword] = useState('');
  const loginTimeout = 300;
  const [isLoading, setIsLoading] = useState(false);
  const [isBrowserWaiting, setIsBrowserWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successStatus, setSuccessStatus] = useState<string | null>(null);

  useEffect(() => {
    setAdapter(initialAdapter);
    setUsername(profile.identity || '');
    setPassword('');
    setError(null);
    setSuccessStatus(null);
    setIsBrowserWaiting(false);
  }, [initialAdapter, profile, isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    setPassword(''); // Mandatory rule: clear password on dismiss
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessStatus(null);

    const isBrowser = adapter === 'browser';
    if (isBrowser) {
      setIsBrowserWaiting(true);
    }

    const payload = {
      username: username.trim(),
      password: password, // Send to API
      adapter,
      loginTimeout,
    };

    // Mandatory rule: Immediately clear password in local component memory
    setPassword('');

    try {
      const session = await fetchJson<AuthSessionStatus>(
        `/projects/${projectId}/auth/profiles/${profile.id}/login`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );

      if (session.status === 'failed') {
        setError(session.warning || 'Authentication failed: credentials rejected.');
      } else {
        setSuccessStatus(session.status);
        setTimeout(() => {
          onSuccess(session);
          handleClose();
        }, 800);
      }
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Login failed.');
    } finally {
      setIsLoading(false);
      setIsBrowserWaiting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans select-none animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md bg-surface border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-2/40">
          <div className="flex items-center gap-2.5">
            {adapter === 'browser' ? (
              <Globe className="w-5 h-5 text-accent" />
            ) : (
              <LogIn className="w-5 h-5 text-accent" />
            )}
            <div>
              <h2 id="login-modal-title" className="text-sm font-semibold text-text">
                {adapter === 'browser' ? 'Browser Interactive Login' : 'HTTP Form Authentication'}
              </h2>
              <p className="text-xs text-text-muted truncate max-w-xs font-mono">
                {profile.label}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 font-sans leading-relaxed">{error}</div>
            </div>
          )}

          {successStatus && (
            <div className="p-3 rounded-lg bg-success/10 border border-success/30 text-success flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>Authentication successful! Status: {successStatus}</span>
            </div>
          )}

          {/* Adapter Toggle */}
          <div className="flex items-center bg-bg p-1 rounded-lg border border-border">
            <button
              type="button"
              disabled={isBrowserWaiting || isLoading}
              onClick={() => setAdapter('http_form')}
              className={`flex-1 py-1 rounded text-xs font-medium transition-all ${
                adapter === 'http_form'
                  ? 'bg-surface-2 text-text shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              HTTP Form
            </button>
            <button
              type="button"
              disabled={isBrowserWaiting || isLoading}
              onClick={() => setAdapter('browser')}
              className={`flex-1 py-1 rounded text-xs font-medium transition-all ${
                adapter === 'browser'
                  ? 'bg-surface-2 text-text shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Browser (Chromium)
            </button>
          </div>

          {/* Browser Waiting Banner */}
          {adapter === 'browser' && (
            <div 
              data-testid="browser-login-advisory"
              className="p-3.5 rounded-lg bg-accent/10 border border-accent/30 text-text space-y-2"
            >
              <div className="flex items-center gap-2 text-accent font-semibold text-xs">
                <Globe className="w-4 h-4 shrink-0" />
                <span>Visible Chromium Window</span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed font-sans">
                A Chromium browser window will launch. Please interactively complete any login challenges, MFA/2FA, or CAPTCHA prompts in that window.
              </p>
              <div className="p-2 rounded bg-bg/80 border border-border/80 text-[11px] text-warning flex items-center gap-1.5 font-sans">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Chainsaw does not bypass bot protection or solve CAPTCHAs automatically.</span>
              </div>

              {isBrowserWaiting && (
                <div 
                  data-testid="browser-waiting-indicator"
                  className="pt-2 flex items-center gap-2 text-accent font-mono text-xs animate-pulse"
                >
                  <RotateCw className="w-4 h-4 animate-spin" />
                  <span>Waiting for operator login / CAPTCHA / 2FA in Chromium window...</span>
                </div>
              )}
            </div>
          )}

          {/* Credentials Inputs */}
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="block text-text-muted font-mono text-[11px]">
                Username / Identity
              </label>
              <input
                type="text"
                required
                disabled={isBrowserWaiting || isLoading}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username or email"
                className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent disabled:opacity-50"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-text-muted font-mono text-[11px]">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="off"
                disabled={isBrowserWaiting || isLoading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-mono focus:outline-none focus:border-accent disabled:opacity-50"
              />
              <span className="block text-[10px] text-text-muted font-mono">
                Password is cleared immediately from memory upon submit.
              </span>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={isBrowserWaiting || isLoading}
              onClick={handleClose}
              className="px-4 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isBrowserWaiting || isLoading}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{adapter === 'browser' ? 'Waiting on Browser...' : 'Authenticating...'}</span>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{adapter === 'browser' ? 'Launch Browser Login' : 'Submit HTTP Login'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
