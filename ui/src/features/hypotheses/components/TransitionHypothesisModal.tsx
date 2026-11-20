import React, { useState } from 'react';
import { X, ArrowRight, AlertCircle, ShieldCheck } from 'lucide-react';
import { fetchJson, isApiError } from '../../../api/client';
import { Hypothesis, HypothesisState, HypothesisTransitionPayload } from '../../../api/types';

interface TransitionHypothesisModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  hypothesis: Hypothesis | null;
  onTransitioned: (updated: Hypothesis) => void;
}

export const TransitionHypothesisModal: React.FC<TransitionHypothesisModalProps> = ({
  isOpen,
  onClose,
  sessionId,
  hypothesis,
  onTransitioned,
}) => {
  const [targetState, setTargetState] = useState<HypothesisState>(
    hypothesis?.state === 'suspected' ? 'supported' : 'suspected'
  );
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !hypothesis) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setErrorMessage('A justification reason is mandatory for any hypothesis state transition.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const payload: HypothesisTransitionPayload = {
      state: targetState,
      reason: reason.trim(),
    };

    try {
      const updated = await fetchJson<Hypothesis>(
        `/sessions/${sessionId}/hypotheses/${hypothesis.id}/transition`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      onTransitioned(updated);
      onClose();
    } catch (err) {
      if (isApiError(err)) {
        setErrorMessage(err.message || 'Failed to transition hypothesis');
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Unexpected error during hypothesis transition');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans select-none">
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-surface-2/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-accent/15 text-accent border border-accent/20">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text">Transition Hypothesis State</h2>
              <p className="text-xs text-text-muted">{hypothesis.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMessage && (
            <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Current State -> Target State */}
          <div className="p-3 rounded-lg bg-bg border border-border flex items-center justify-between text-xs font-mono">
            <div>
              <span className="text-text-muted block text-[10px] uppercase">Current State</span>
              <span className="font-semibold text-text">{hypothesis.state}</span>
            </div>
            <ArrowRight className="w-4 h-4 text-text-muted" />
            <div>
              <span className="text-text-muted block text-[10px] uppercase">Target State</span>
              <select
                id="target-state-select"
                value={targetState}
                onChange={(e) => setTargetState(e.target.value as HypothesisState)}
                className="bg-surface border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
              >
                <option value="suspected">suspected</option>
                <option value="supported">supported</option>
                <option value="rejected">rejected</option>
                <option value="deferred">deferred</option>
                <option value="blocked">blocked</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="transition-reason" className="block text-xs font-medium text-text mb-1">
              Transition Justification Reason <span className="text-danger">*</span>
            </label>
            <textarea
              id="transition-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Exploitation artifact evd_idor_payload verified cross-tenant read under non-admin session."
              rows={3}
              className="w-full px-3 py-2 bg-bg border border-border rounded-md text-xs text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent resize-none font-sans"
              required
            />
            <p className="text-[11px] text-text-muted mt-1">
              A reason is strictly mandatory. All transitions are permanently audited in the project ledger.
            </p>
          </div>

          {/* Footer Controls */}
          <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-border text-xs text-text hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !reason.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <span>{isSubmitting ? 'Recording...' : 'Record Transition'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
