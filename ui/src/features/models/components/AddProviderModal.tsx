import React, { useState } from 'react';
import { 
  X, Plus, Globe, Server, 
  ChevronDown, ChevronRight, AlertCircle 
} from 'lucide-react';
import { fetchJson, isApiError } from '../../../api/client';
import { ProviderCreatePayload, ProviderItem, ProviderType, WebUiEngine } from '../../../api/types';

interface AddProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProviderCreated: (provider: ProviderItem) => void;
}

export const AddProviderModal: React.FC<AddProviderModalProps> = ({
  isOpen,
  onClose,
  onProviderCreated,
}) => {
  const [name, setName] = useState('');
  const [providerType, setProviderType] = useState<ProviderType>('webui');

  // WebUI specific fields
  const [engine, setEngine] = useState<WebUiEngine>('ChatGPT');
  const [url, setUrl] = useState('https://chatgpt.com');
  const [profileDir, setProfileDir] = useState('~/.chainsaw/webui/profiles/chatgpt');
  const [modelLabel, setModelLabel] = useState('gpt-4o');
  const [headless, setHeadless] = useState(false);
  const [selectorsJson, setSelectorsJson] = useState('');

  // API provider fields
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434/v1');
  const [apiKeyRef, setApiKeyRef] = useState('');
  const [modelsText, setModelsText] = useState('qwen3:14b, llama3.3:70b');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleEngineChange = (newEngine: WebUiEngine) => {
    setEngine(newEngine);
    if (newEngine === 'ChatGPT') {
      setUrl('https://chatgpt.com');
      setProfileDir('~/.chainsaw/webui/profiles/chatgpt');
      setModelLabel('gpt-4o');
    } else if (newEngine === 'DeepSeek') {
      setUrl('https://chat.deepseek.com');
      setProfileDir('~/.chainsaw/webui/profiles/deepseek');
      setModelLabel('deepseek-chat');
    } else {
      setUrl('');
      setProfileDir('~/.chainsaw/webui/profiles/custom');
      setModelLabel('custom-model');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Provider name is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    let parsedSelectors: Record<string, unknown> | undefined;
    if (selectorsJson.trim()) {
      try {
        parsedSelectors = JSON.parse(selectorsJson);
      } catch {
        setError('Advanced selectors must be valid JSON.');
        setIsSubmitting(false);
        return;
      }
    }

    let payload: ProviderCreatePayload;
    if (providerType === 'webui') {
      payload = {
        name: name.trim(),
        type: 'webui',
        engine,
        baseUrl: url.trim(),
        profileDir: profileDir.trim(),
        headless,
        selectors: parsedSelectors,
        models: [{ id: modelLabel.trim() || 'webui-model', name: modelLabel.trim() || 'Web UI Model' }],
      };
    } else {
      const parsedModels = modelsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((m) => ({ id: m, name: m }));

      payload = {
        name: name.trim(),
        type: providerType,
        baseUrl: baseUrl.trim(),
        apiKeyRef: apiKeyRef.trim() || undefined,
        models: parsedModels,
      };
    }

    try {
      const created = await fetchJson<ProviderItem>('/providers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onProviderCreated(created);
      onClose();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Failed to create provider.');
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
        aria-labelledby="add-provider-title"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-2/40">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-accent" />
            <div>
              <h2 id="add-provider-title" className="text-sm font-semibold text-text">
                Add Model / Inference Provider
              </h2>
              <p className="text-xs text-text-muted">
                Connect local LLM runtimes, cloud endpoints, or persistent browser web UI drivers.
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

          {/* Provider Type Selection */}
          <div className="space-y-1">
            <label className="block text-text-muted font-mono text-[11px]">Provider Type</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['webui', 'openai-compatible', 'ollama', 'groq'] as ProviderType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setProviderType(t)}
                  className={`py-2 px-2.5 rounded-lg border text-xs font-medium text-center transition-all ${
                    providerType === t
                      ? 'bg-accent/15 border-accent text-accent font-semibold'
                      : 'bg-bg border-border text-text-muted hover:text-text hover:bg-surface-2'
                  }`}
                >
                  {t === 'webui' ? 'Web UI (Browser)' : t}
                </button>
              ))}
            </div>
          </div>

          {/* Common Name */}
          <div className="space-y-1">
            <label className="block text-text-muted font-mono text-[11px]">
              Display Name <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={providerType === 'webui' ? 'e.g. ChatGPT Web (Plus)' : 'e.g. Local Ollama Server'}
              className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent"
            />
          </div>

          {/* WebUI Provider Specific Fields */}
          {providerType === 'webui' && (
            <div className="space-y-4 pt-2 border-t border-border">
              {/* Educational Notice Banner */}
              <div className="p-3.5 rounded-lg bg-accent/10 border border-accent/30 text-text space-y-2 font-sans">
                <div className="flex items-center gap-2 text-accent font-semibold text-xs">
                  <Globe className="w-4 h-4 shrink-0" />
                  <span>Chromium Web UI Automation</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-text-muted text-[11px] leading-relaxed">
                  <li>A real Chromium browser window will launch on execution.</li>
                  <li>The operator logs in once; cookies and session state are persisted in the profile directory.</li>
                  <li>CAPTCHA and 2FA challenges must be completed manually by the operator.</li>
                  <li>No API key required. Does not guarantee official API reliability or uptime.</li>
                </ul>
              </div>

              {/* Engine Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-text-muted font-mono text-[11px]">Web UI Engine</label>
                  <select
                    value={engine}
                    onChange={(e) => handleEngineChange(e.target.value as WebUiEngine)}
                    className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-sans focus:outline-none focus:border-accent"
                  >
                    <option value="ChatGPT">ChatGPT (OpenAI)</option>
                    <option value="DeepSeek">DeepSeek Web</option>
                    <option value="Custom">Custom Web UI</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-text-muted font-mono text-[11px]">Model Label</label>
                  <input
                    type="text"
                    value={modelLabel}
                    onChange={(e) => setModelLabel(e.target.value)}
                    placeholder="e.g. gpt-4o or deepseek-chat"
                    className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* URL & Profile Directory */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-text-muted font-mono text-[11px]">Web UI URL</label>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://chatgpt.com"
                    className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-text-muted font-mono text-[11px]">Profile Directory</label>
                  <input
                    type="text"
                    value={profileDir}
                    onChange={(e) => setProfileDir(e.target.value)}
                    placeholder="~/.chainsaw/webui/profiles/..."
                    className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Headless Switch */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-border">
                <div className="space-y-0.5">
                  <span className="font-semibold text-text text-xs">Headless Mode</span>
                  <p className="text-[11px] text-text-muted font-sans">
                    Leave OFF (default) so a visible window opens for operator login and manual 2FA/CAPTCHA.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={headless}
                  onChange={(e) => setHeadless(e.target.checked)}
                  className="w-4 h-4 rounded text-accent bg-bg border-border focus:ring-0 focus:outline-none cursor-pointer"
                />
              </div>

              {/* Advanced JSON Selectors */}
              <div className="space-y-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 text-text-muted hover:text-text font-mono text-[11px] font-semibold"
                >
                  {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <span>Advanced Selectors JSON (DOM Overrides)</span>
                </button>

                {showAdvanced && (
                  <div className="space-y-1 pl-3 border-l-2 border-border/60">
                    <textarea
                      rows={3}
                      value={selectorsJson}
                      onChange={(e) => setSelectorsJson(e.target.value)}
                      placeholder='{"input": ["#prompt-textarea"], "send": ["button[data-testid=send-button]"]}'
                      className="w-full px-2.5 py-1.5 rounded bg-bg border border-border text-text font-mono text-[11px]"
                    />
                    <span className="block text-[10px] text-text-muted">
                      Optional custom selector map to override defaults when web interfaces update.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Standard API Provider Fields */}
          {providerType !== 'webui' && (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="space-y-1">
                <label className="block text-text-muted font-mono text-[11px]">Base URL</label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-text-muted font-mono text-[11px]">API Key Environment Reference</label>
                <input
                  type="text"
                  value={apiKeyRef}
                  onChange={(e) => setApiKeyRef(e.target.value)}
                  placeholder="e.g. GROQ_API_KEY or leave blank for local Ollama"
                  className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-text-muted font-mono text-[11px]">Model Identifiers (comma separated)</label>
                <input
                  type="text"
                  value={modelsText}
                  onChange={(e) => setModelsText(e.target.value)}
                  placeholder="qwen3:14b, llama3.3:70b"
                  className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          )}

          {/* Footer Submit */}
          <div className="pt-4 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
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
              <span>{isSubmitting ? 'Adding...' : 'Save Provider'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
