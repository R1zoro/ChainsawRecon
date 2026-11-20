import React, { useState } from 'react';
import { 
  X, Plus, AlertTriangle, ChevronDown, ChevronRight, 
  Key, AlertCircle 
} from 'lucide-react';
import { fetchJson, isApiError } from '../../../api/client';
import { AuthAdapter, AuthPersistence, AuthProfile, CreateAuthProfilePayload } from '../../../api/types';

interface AddProfileModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onProfileCreated: (profile: AuthProfile) => void;
  initialLoginUrl?: string;
}

export const AddProfileModal: React.FC<AddProfileModalProps> = ({
  projectId,
  isOpen,
  onClose,
  onProfileCreated,
  initialLoginUrl = '',
}) => {
  const [label, setLabel] = useState('');
  const [identity, setIdentity] = useState('');
  const [role, setRole] = useState('operator');
  const [tenant, setTenant] = useState('default');
  const [kind, setKind] = useState('credentials');
  const [adapter, setAdapter] = useState<AuthAdapter>('auto');
  const [persistence, setPersistence] = useState<AuthPersistence>('session_only');
  const [targetPatterns, setTargetPatterns] = useState('');
  const [loginUrl, setLoginUrl] = useState(initialLoginUrl);
  const [verifyUrl, setVerifyUrl] = useState('');
  const [verifyIndicator, setVerifyIndicator] = useState('');

  // Advanced section
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [usernameField, setUsernameField] = useState('');
  const [passwordField, setPasswordField] = useState('');
  const [extraFieldsText, setExtraFieldsText] = useState('');
  const [selectorsJson, setSelectorsJson] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) {
      setError('Profile label is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    let parsedExtraFields: Record<string, string> | undefined;
    if (extraFieldsText.trim()) {
      try {
        parsedExtraFields = JSON.parse(extraFieldsText);
      } catch {
        setError('Extra fields must be valid JSON object (e.g. {"tenantId": "t123"}).');
        setIsSubmitting(false);
        return;
      }
    }

    let parsedSelectors: Record<string, string[]> | undefined;
    if (selectorsJson.trim()) {
      try {
        parsedSelectors = JSON.parse(selectorsJson);
      } catch {
        setError('Browser selectors must be valid JSON object with string array values.');
        setIsSubmitting(false);
        return;
      }
    }

    const payload: CreateAuthProfilePayload = {
      label: label.trim(),
      identity: identity.trim() || undefined,
      role: role.trim() || undefined,
      tenant: tenant.trim() || undefined,
      kind,
      adapter,
      persistence,
      targetPatterns: targetPatterns
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
      loginUrl: loginUrl.trim() || undefined,
      verifyUrl: verifyUrl.trim() || undefined,
      verifyIndicator: verifyIndicator.trim() || undefined,
      usernameField: usernameField.trim() || undefined,
      passwordField: passwordField.trim() || undefined,
      extraFields: parsedExtraFields,
      selectors: parsedSelectors,
    };

    try {
      const created = await fetchJson<AuthProfile>(`/projects/${projectId}/auth/profiles`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onProfileCreated(created);
      onClose();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Failed to create auth profile.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans select-none animate-in fade-in duration-200">
      <div 
        className="w-full max-w-xl bg-surface border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-profile-title"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-2/40">
          <div className="flex items-center gap-2.5">
            <Key className="w-5 h-5 text-accent" />
            <div>
              <h2 id="add-profile-title" className="text-sm font-semibold text-text">
                Create Authentication Profile
              </h2>
              <p className="text-xs text-text-muted">
                Configure credential lanes, adapters, and session verification targets.
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 font-sans">{error}</div>
            </div>
          )}

          {/* Label & Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-text-muted font-mono text-[11px]">
                Profile Label <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Primary Admin Account"
                className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-text-muted font-mono text-[11px]">
                Identity / Username
              </label>
              <input
                type="text"
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                placeholder="e.g. admin@acme.example.com"
                className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Role & Tenant */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-text-muted font-mono text-[11px]">
                Role
              </label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. admin, auditor, customer"
                className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-text-muted font-mono text-[11px]">
                Tenant Identifier
              </label>
              <input
                type="text"
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                placeholder="e.g. acme-tenant-1"
                className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Adapter & Persistence */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-text-muted font-mono text-[11px]">
                Auth Kind
              </label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent"
              >
                <option value="credentials">credentials</option>
                <option value="oauth">oauth</option>
                <option value="api_token">api_token</option>
                <option value="saved_session">saved_session</option>
                <option value="manual_handover">manual_handover</option>
                <option value="none">none</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-text-muted font-mono text-[11px]">
                Auth Adapter
              </label>
              <select
                value={adapter}
                onChange={(e) => setAdapter(e.target.value as AuthAdapter)}
                className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent"
              >
                <option value="auto">auto (detect based on kind/target)</option>
                <option value="http_form">http_form (Automated POST)</option>
                <option value="http_json">http_json (REST API JSON)</option>
                <option value="browser">browser (Interactive Chromium)</option>
                <option value="headers">headers (Static headers)</option>
                <option value="operator">operator (Manual handover)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="persistence-select" className="block text-text-muted font-mono text-[11px]">
                Session Persistence
              </label>
              <select
                id="persistence-select"
                value={persistence}
                onChange={(e) => setPersistence(e.target.value as AuthPersistence)}
                className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent"
              >
                <option value="session_only">session_only (In-memory)</option>
                <option value="credentials">credentials (Encrypted store)</option>
                <option value="none">none (Do not retain)</option>
              </select>
            </div>
          </div>

          {/* Persistence warning banner */}
          {persistence === 'credentials' && (
            <div className="p-2.5 rounded-lg bg-warning/10 border border-warning/30 text-warning flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="leading-relaxed font-sans text-xs">
                <strong>Warning:</strong> Credentials will be retained in the local encrypted store. Only use for non-production lab or authorized test accounts.
              </div>
            </div>
          )}

          {/* URLs: Login URL, Verify URL, Verify Indicator */}
          <div className="space-y-2 pt-1 border-t border-border">
            <div className="space-y-1">
              <label className="block text-text-muted font-mono text-[11px]">
                Login URL
              </label>
              <input
                type="url"
                value={loginUrl}
                onChange={(e) => setLoginUrl(e.target.value)}
                placeholder="https://app.example.com/login"
                className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-text-muted font-mono text-[11px]">
                  Verify URL
                </label>
                <input
                  type="url"
                  value={verifyUrl}
                  onChange={(e) => setVerifyUrl(e.target.value)}
                  placeholder="https://api.example.com/v1/me"
                  className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-text-muted font-mono text-[11px]">
                  Verify Indicator (text or field in response)
                </label>
                <input
                  type="text"
                  value={verifyIndicator}
                  onChange={(e) => setVerifyIndicator(e.target.value)}
                  placeholder="e.g. user_id or Logout"
                  className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-text-muted font-mono text-[11px]">
                Target URL Patterns (comma or newline separated)
              </label>
              <input
                type="text"
                value={targetPatterns}
                onChange={(e) => setTargetPatterns(e.target.value)}
                placeholder="https://api.example.com/*, https://app.example.com/*"
                className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Advanced Collapsible Accordion */}
          <div className="pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-text-muted hover:text-text font-mono text-[11px] font-semibold transition-colors"
            >
              {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <span>Advanced Form & Selector Overrides</span>
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 pl-3 border-l-2 border-border/60">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-text-muted font-mono text-[10px]">
                      Username Field Name
                    </label>
                    <input
                      type="text"
                      value={usernameField}
                      onChange={(e) => setUsernameField(e.target.value)}
                      placeholder="username or email"
                      className="w-full px-2.5 py-1 rounded bg-bg border border-border text-text font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-text-muted font-mono text-[10px]">
                      Password Field Name
                    </label>
                    <input
                      type="text"
                      value={passwordField}
                      onChange={(e) => setPasswordField(e.target.value)}
                      placeholder="password"
                      className="w-full px-2.5 py-1 rounded bg-bg border border-border text-text font-mono text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-text-muted font-mono text-[10px]">
                    Extra JSON Fields (e.g. CSRF or Tenant tokens)
                  </label>
                  <textarea
                    rows={2}
                    value={extraFieldsText}
                    onChange={(e) => setExtraFieldsText(e.target.value)}
                    placeholder='{"tenant_id": "corp_12"}'
                    className="w-full px-2.5 py-1 rounded bg-bg border border-border text-text font-mono text-[11px]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-text-muted font-mono text-[10px]">
                    Browser Selectors JSON
                  </label>
                  <textarea
                    rows={2}
                    value={selectorsJson}
                    onChange={(e) => setSelectorsJson(e.target.value)}
                    placeholder='{"input": ["#user-input"], "submit": ["button.login-btn"]}'
                    className="w-full px-2.5 py-1 rounded bg-bg border border-border text-text font-mono text-[11px]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer Submit */}
          <div className="pt-4 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{isSubmitting ? 'Creating...' : 'Save Auth Profile'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
