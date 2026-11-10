import React, { useState, useEffect } from 'react';
import { Upload, X, Check, FileCode } from 'lucide-react';
import { fetchJson } from '../../../api/client';

interface ImportHarModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

export const ImportHarModal: React.FC<ImportHarModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const [format, setFormat] = useState<'har' | 'burp_xml'>('har');
  const [filePath, setFilePath] = useState('C:/captures/session_dump.har');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await fetchJson('/workbench/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, path: filePath }),
      });
      onImportComplete();
      onClose();
    } catch {
      // Handled
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-har-title"
    >
      <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-md w-full flex flex-col overflow-hidden text-text">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-surface-2/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg border bg-accent/15 border-accent/30 text-accent">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h3 id="import-har-title" className="text-sm font-semibold text-text">
                Import Traffic Capture
              </h3>
              <p className="text-[11px] text-text-muted">
                Ingest HTTP history from HAR or Burp Suite export
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {/* Format Radio Selection */}
          <div className="space-y-1.5 font-sans">
            <label className="text-xs font-medium text-text">Capture Format</label>
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                format === 'har' ? 'bg-surface-2 border-accent text-accent' : 'bg-bg border-border text-text-muted'
              }`}>
                <input
                  type="radio"
                  name="format"
                  value="har"
                  checked={format === 'har'}
                  onChange={() => setFormat('har')}
                  className="hidden"
                />
                <FileCode className="w-4 h-4" />
                <span className="font-semibold text-xs">HTTP Archive (.har)</span>
              </label>

              <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                format === 'burp_xml' ? 'bg-surface-2 border-accent text-accent' : 'bg-bg border-border text-text-muted'
              }`}>
                <input
                  type="radio"
                  name="format"
                  value="burp_xml"
                  checked={format === 'burp_xml'}
                  onChange={() => setFormat('burp_xml')}
                  className="hidden"
                />
                <FileCode className="w-4 h-4" />
                <span className="font-semibold text-xs">Burp Suite XML</span>
              </label>
            </div>
          </div>

          {/* File Path */}
          <div className="space-y-1.5 font-sans">
            <label className="text-xs font-medium text-text">Filesystem Path</label>
            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="C:/captures/traffic.har"
              className="w-full bg-bg border border-border rounded-lg px-2.5 py-1.5 text-xs text-text font-mono focus:outline-none focus:border-accent"
            />
          </div>

          {/* Footer */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 text-xs font-medium text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors shadow-sm disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Importing...' : 'Start Ingestion'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
