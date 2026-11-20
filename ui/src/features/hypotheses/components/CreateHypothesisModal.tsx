import React, { useState } from 'react';
import { X, HelpCircle, AlertCircle, Plus } from 'lucide-react';
import { fetchJson, isApiError } from '../../../api/client';
import { Hypothesis, HypothesisConfidence, HypothesisCreatePayload } from '../../../api/types';

interface CreateHypothesisModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  onCreated: (hypothesis: Hypothesis) => void;
}

export const CreateHypothesisModal: React.FC<CreateHypothesisModalProps> = ({
  isOpen,
  onClose,
  sessionId,
  onCreated,
}) => {
  const [title, setTitle] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [surface, setSurface] = useState('');
  const [confidence, setConfidence] = useState<HypothesisConfidence>('candidate');
  const [requiredEvidenceInput, setRequiredEvidenceInput] = useState('baseline_response, candidate_response');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !securityQuestion.trim()) {
      setErrorMessage('Title and Security Question are required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const requiredEvidence = requiredEvidenceInput
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const payload: HypothesisCreatePayload = {
      title: title.trim(),
      securityQuestion: securityQuestion.trim(),
      surface: surface.trim() || undefined,
      state: 'suspected',
      confidence,
      requiredEvidence,
    };

    try {
      const created = await fetchJson<Hypothesis>(`/sessions/${sessionId}/hypotheses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      onCreated(created);
      onClose();
    } catch (err) {
      if (isApiError(err)) {
        setErrorMessage(err.message || 'Failed to create hypothesis');
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Unexpected error creating hypothesis');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans select-none">
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-surface-2/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-accent/15 text-accent border border-accent/20">
              <HelpCircle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text">Formulate Hypothesis</h2>
              <p className="text-xs text-text-muted">A testable security question to probe during execution</p>
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
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {errorMessage && (
            <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div>
            <label htmlFor="hypothesis-title" className="block text-xs font-medium text-text mb-1">
              Title <span className="text-danger">*</span>
            </label>
            <input
              id="hypothesis-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Cross-tenant invoice access"
              className="w-full px-3 py-2 bg-bg border border-border rounded-md text-xs text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent"
              required
            />
          </div>

          <div>
            <label htmlFor="hypothesis-security-question" className="block text-xs font-medium text-text mb-1">
              Security Question <span className="text-danger">*</span>
            </label>
            <textarea
              id="hypothesis-security-question"
              value={securityQuestion}
              onChange={(e) => setSecurityQuestion(e.target.value)}
              placeholder="e.g. Can Tenant A read invoices belonging to Tenant B without authorization?"
              rows={3}
              className="w-full px-3 py-2 bg-bg border border-border rounded-md text-xs text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent resize-none font-sans"
              required
            />
            <p className="text-[11px] text-text-muted mt-1">
              Hypotheses define what you are testing, not what is already confirmed.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="hypothesis-surface" className="block text-xs font-medium text-text mb-1">
                Target Surface
              </label>
              <input
                id="hypothesis-surface"
                type="text"
                value={surface}
                onChange={(e) => setSurface(e.target.value)}
                placeholder="e.g. GET /api/v1/invoices/{id}"
                className="w-full px-3 py-2 bg-bg border border-border rounded-md text-xs font-mono text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label htmlFor="hypothesis-confidence" className="block text-xs font-medium text-text mb-1">
                Initial Confidence
              </label>
              <select
                id="hypothesis-confidence"
                value={confidence}
                onChange={(e) => setConfidence(e.target.value as HypothesisConfidence)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent"
              >
                <option value="candidate">Candidate</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="hypothesis-evidence" className="block text-xs font-medium text-text mb-1">
              Required Evidence Artifacts (comma separated)
            </label>
            <input
              id="hypothesis-evidence"
              type="text"
              value={requiredEvidenceInput}
              onChange={(e) => setRequiredEvidenceInput(e.target.value)}
              placeholder="baseline_response, candidate_response"
              className="w-full px-3 py-2 bg-bg border border-border rounded-md text-xs font-mono text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent"
            />
            <p className="text-[11px] text-text-muted mt-1">
              Artifact kinds that must be collected before transitioning to supported.
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
              disabled={isSubmitting || !title.trim() || !securityQuestion.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Creating...' : 'Create Hypothesis'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
