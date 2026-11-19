import React, { useState, useEffect } from 'react';
import { Shield, ShieldAlert, Check, Copy, X, Terminal, Monitor, Globe, AlertCircle, RotateCw } from 'lucide-react';
import { CaStatusResponse } from '../../../api/types';

interface CaHelperModalProps {
  isOpen: boolean;
  onClose: () => void;
  caStatus?: CaStatusResponse | null;
  onGenerateCa?: () => Promise<void>;
  isGenerating?: boolean;
}

export const CaHelperModal: React.FC<CaHelperModalProps> = ({ 
  isOpen, 
  onClose, 
  caStatus,
  onGenerateCa,
  isGenerating = false,
}) => {
  const [copiedPath, setCopiedPath] = useState(false);
  const [activeTab, setActiveTab] = useState<'windows' | 'unix' | 'browser' | 'cli'>('windows');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isAvailable = Boolean(caStatus?.available && caStatus?.path);
  const caPath = caStatus?.path || '';

  const handleCopyPath = () => {
    if (!caPath) return;
    navigator.clipboard.writeText(caPath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ca-helper-title"
    >
      <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-xl w-full flex flex-col overflow-hidden text-text">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-surface-2/40">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg border ${isAvailable ? 'bg-accent/15 border-accent/30 text-accent' : 'bg-surface-2 border-border text-text-muted'}`}>
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 id="ca-helper-title" className="text-sm font-semibold text-text">
                Proxy CA Certificate &amp; Trust Helper
              </h3>
              <p className="text-[11px] text-text-muted">
                {isAvailable 
                  ? 'Root CA certificate is generated and ready for client trust configuration' 
                  : 'CA certificate required for TLS interception'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 space-y-4 text-xs">
          {!isAvailable ? (
            /* Neutral CA Unavailable State */
            <div className="p-6 bg-surface-2/30 rounded-xl border border-dashed border-border flex flex-col items-center justify-center text-center space-y-3">
              <div className="p-3 rounded-full bg-surface-2 text-text-muted">
                <ShieldAlert className="w-6 h-6 text-warning" />
              </div>
              <div className="space-y-1">
                <h4 className="font-semibold text-text text-sm">No local CA generated</h4>
                <p className="text-xs text-text-muted max-w-sm">
                  A local Certificate Authority (CA) is required for Chainsaw to intercept and decrypt HTTPS traffic.
                </p>
              </div>
              <button
                onClick={onGenerateCa}
                disabled={isGenerating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent hover:bg-accent/80 text-white font-medium text-xs transition-colors disabled:opacity-50 shadow-sm"
              >
                {isGenerating ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
                <span>{isGenerating ? 'Generating CA…' : 'Generate CA'}</span>
              </button>
            </div>
          ) : (
            <>
              {/* TLS Trust Warning */}
              <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg flex items-start gap-2.5 text-warning text-xs font-sans">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-semibold">TLS Trust Warning</span>
                  <p className="text-[11px] text-warning/90">
                    Traffic will fail TLS validation until this certificate is trusted by your client, browser, or OS.
                  </p>
                </div>
              </div>

              {/* Certificate Path Box */}
              <div className="p-3 bg-bg rounded-lg border border-border space-y-1.5">
                <span className="text-[10px] uppercase font-mono text-text-muted tracking-wider">CA Certificate File</span>
                <div className="flex items-center justify-between gap-2 bg-surface px-2.5 py-1.5 rounded border border-border font-mono text-xs text-text">
                  <span className="truncate">{caPath}</span>
                  <button
                    onClick={handleCopyPath}
                    disabled={!caPath}
                    className="flex items-center gap-1 text-[11px] text-accent hover:underline shrink-0 disabled:opacity-40 disabled:no-underline"
                  >
                    {copiedPath ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedPath ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* OS / Tool Tabs */}
              <div className="flex border-b border-border">
                <button
                  onClick={() => setActiveTab('windows')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === 'windows'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-muted hover:text-text'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span>Windows</span>
                </button>
                <button
                  onClick={() => setActiveTab('unix')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === 'unix'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-muted hover:text-text'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>macOS / Linux</span>
                </button>
                <button
                  onClick={() => setActiveTab('browser')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === 'browser'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-muted hover:text-text'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Browser</span>
                </button>
                <button
                  onClick={() => setActiveTab('cli')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === 'cli'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-muted hover:text-text'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>CLI / Env</span>
                </button>
              </div>

              {/* Tab Instructions Content */}
              <div className="bg-surface-2/20 p-3.5 rounded-lg border border-border font-mono text-[11px] leading-relaxed text-text-muted">
                {activeTab === 'windows' && (
                  <div className="space-y-2">
                    <p className="text-text font-sans text-xs font-medium">Install into Windows Trusted Root Certification Authorities:</p>
                    <div className="p-2 bg-bg rounded border border-border text-accent select-all">
                      certutil -addstore -f &quot;ROOT&quot; &quot;{caPath}&quot;
                    </div>
                    <p className="text-[10px] text-text-muted">Requires administrative privileges. Press Enter and accept the trust prompt.</p>
                  </div>
                )}

                {activeTab === 'unix' && (
                  <div className="space-y-2">
                    <p className="text-text font-sans text-xs font-medium">macOS Keychain or Linux CA Trust:</p>
                    <div className="p-2 bg-bg rounded border border-border text-accent select-all space-y-1">
                      <div># macOS:</div>
                      <div>sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain &quot;{caPath}&quot;</div>
                      <div className="pt-1"># Debian/Ubuntu:</div>
                      <div>sudo cp &quot;{caPath}&quot; /usr/local/share/ca-certificates/chainsaw.crt &amp;&amp; sudo update-ca-certificates</div>
                    </div>
                  </div>
                )}

                {activeTab === 'browser' && (
                  <div className="space-y-2">
                    <p className="text-text font-sans text-xs font-medium">Firefox &amp; Chromium Import:</p>
                    <ul className="list-disc list-inside space-y-1 text-text-muted font-sans text-xs">
                      <li>In <strong>Firefox</strong>, open <code className="text-accent bg-bg px-1 rounded">about:preferences#privacy</code> &rarr; Certificates &rarr; View Certificates &rarr; Import.</li>
                      <li>Check <em>&quot;Trust this CA to identify websites&quot;</em> and click OK.</li>
                      <li>In <strong>Chrome/Edge</strong>, the browser uses the OS system trust store automatically once installed via the Windows/macOS instructions.</li>
                    </ul>
                  </div>
                )}

                {activeTab === 'cli' && (
                  <div className="space-y-2">
                    <p className="text-text font-sans text-xs font-medium">Environment Variables for Scripts &amp; Tools:</p>
                    <div className="p-2 bg-bg rounded border border-border text-accent select-all space-y-1">
                      <div>export NODE_EXTRA_CA_CERTS=&quot;{caPath}&quot;</div>
                      <div>export REQUESTS_CA_BUNDLE=&quot;{caPath}&quot;</div>
                      <div>export SSL_CERT_FILE=&quot;{caPath}&quot;</div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-border bg-surface-2/30 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 text-xs font-medium text-text transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
