import React, { useState, useEffect } from 'react';
import { ShieldAlert, X, Send } from 'lucide-react';

interface ScopeGateConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  method: string;
  url: string;
}

export const ScopeGateConfirmationModal: React.FC<ScopeGateConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  method,
  url,
}) => {
  const [reason, setReason] = useState('');
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setHasError(false);
    }
  }, [isOpen]);

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

  const handleConfirm = () => {
    if (!reason.trim()) {
      setHasError(true);
      return;
    }
    onConfirm(reason.trim());
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scope-gate-title"
    >
      <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-md w-full flex flex-col overflow-hidden text-text">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-warning/10">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg border bg-warning/15 border-warning/30 text-warning">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h3 id="scope-gate-title" className="text-sm font-semibold text-text">
                Destructive Action Governance Gate
              </h3>
              <p className="text-[11px] text-text-muted">
                State-changing HTTP request requires operator authorization
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

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          <div className="p-3 bg-bg rounded-lg border border-border space-y-1 font-mono text-[11px]">
            <div className="flex items-center gap-2">
              <span className="font-bold text-danger uppercase">{method}</span>
              <span className="text-text truncate">{url}</span>
            </div>
            <p className="text-text-muted text-[10px] font-sans pt-1">
              This request method may mutate remote database state, delete assets, or trigger irreversible side-effects.
            </p>
          </div>

          <div className="space-y-1.5 font-sans">
            <label className="text-xs font-medium text-text">
              Operator Justification <span className="text-danger">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (hasError) setHasError(false);
              }}
              placeholder="e.g. Authorized IDOR verification on test account per engagement scope rules."
              rows={3}
              className={`w-full bg-bg border rounded-lg p-2.5 text-xs text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent font-sans ${
                hasError ? 'border-danger' : 'border-border'
              }`}
            />
            {hasError && (
              <p className="text-[11px] text-danger">A valid justification reason is required to proceed.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-surface-2/30 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 text-xs font-medium text-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-danger text-white font-semibold text-xs hover:bg-danger/90 transition-colors shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Authorize &amp; Send</span>
          </button>
        </div>
      </div>
    </div>
  );
};
