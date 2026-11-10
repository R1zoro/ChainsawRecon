import React, { useState } from 'react';
import { Download, CheckCircle2 } from 'lucide-react';
import { Dialog } from '../common/Dialog';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (type: string, fileData: string) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const [importType, setImportType] = useState<'scope' | 'har' | 'source'>('scope');
  const [content, setContent] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    onImport(importType, content);
    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
      setContent('');
      onClose();
    }, 600);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        setSuccess(false);
        setContent('');
        onClose();
      }}
      title="Import Artifacts or Evidence"
      icon={<Download className="w-4 h-4 text-accent" />}
      maxWidth="md"
    >
      {success ? (
        <div className="p-6 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-success mx-auto" />
          <p className="text-text font-medium">Import validated and staged!</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] font-mono text-text-muted block">Artifact Type</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'scope', label: 'Program Scope' },
                { id: 'har', label: 'Browser HAR' },
                { id: 'source', label: 'Source Tree' },
              ].map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setImportType(type.id as 'scope' | 'har' | 'source')}
                  className={`py-1.5 px-2 rounded border text-center font-mono text-xs transition-colors ${
                    importType === type.id
                      ? 'bg-accent/15 border-accent text-accent font-medium'
                      : 'bg-bg border-border text-text-muted hover:text-text'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-mono text-text-muted block">Paste JSON / HAR / Paths</label>
            <textarea
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                importType === 'scope'
                  ? '{"program_name": "Acme", "target_urls": ["https://..."]}'
                  : importType === 'har'
                  ? '{"log": {"entries": [...]}}'
                  : 'C:/repos/acme-backend'
              }
              className="w-full px-3 py-2 bg-bg border border-border rounded text-text font-mono text-xs placeholder:text-text-muted/60 focus:outline-none focus:border-accent resize-none"
            />
          </div>

          <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-surface-2 text-text hover:bg-surface-2/80 border border-border transition-colors text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!content.trim()}
              className="px-3 py-1.5 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium transition-colors text-xs disabled:opacity-40"
            >
              Import
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
};
