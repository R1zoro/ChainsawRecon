import React, { useState, useRef } from 'react';
import { Send, AlertCircle, RotateCw } from 'lucide-react';

interface OperatorComposerProps {
  onSendMessage: (content: string, interrupt: boolean) => Promise<void>;
  disabled?: boolean;
}

export const OperatorComposer: React.FC<OperatorComposerProps> = ({
  onSendMessage,
  disabled = false,
}) => {
  const [content, setContent] = useState('');
  const [interrupt, setInterrupt] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!content.trim() || isSubmitting || disabled) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await onSendMessage(content.trim(), interrupt);
      setContent('');
      setInterrupt(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to deliver message.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-surface p-3 shrink-0">
      {error && (
        <div className="mb-2 p-2 rounded bg-danger/10 border border-danger/30 text-danger text-xs flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-2 bg-bg border border-border focus-within:border-accent rounded-lg p-2.5 transition-colors">
        <textarea
          ref={textareaRef}
          rows={2}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isSubmitting}
          placeholder="Send guidance or directive to the orchestrator… (Ctrl+Enter to send)"
          className="w-full bg-transparent text-text text-xs placeholder:text-text-muted/60 focus:outline-none resize-none font-sans"
        />

        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <label className="flex items-center gap-2 cursor-pointer text-[11px] font-mono text-text-muted select-none hover:text-text">
            <input
              type="checkbox"
              checked={interrupt}
              onChange={(e) => setInterrupt(e.target.checked)}
              disabled={disabled || isSubmitting}
              className="rounded border-border text-accent focus:ring-accent"
            />
            <span>Interrupt current turn</span>
          </label>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-text-muted hidden sm:inline">
              Ctrl+Enter
            </span>
            <button
              type="submit"
              disabled={!content.trim() || isSubmitting || disabled}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};
