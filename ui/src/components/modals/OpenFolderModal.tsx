import React, { useState } from 'react';
import { FolderOpen, AlertTriangle } from 'lucide-react';
import { Dialog } from '../common/Dialog';
import { pickFolder } from '../../lib/nativeDialog';

interface OpenFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: (path: string, initializeIfAbsent: boolean) => void;
}

export const OpenFolderModal: React.FC<OpenFolderModalProps> = ({
  isOpen,
  onClose,
  onOpen,
}) => {
  const [folderPath, setFolderPath] = useState('');
  const [initPrompt, setInitPrompt] = useState(false);

  const handleBrowse = async () => {
    const selected = await pickFolder('Open Existing Engagement Folder');
    if (selected) {
      setFolderPath(selected);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderPath.trim()) return;

    if (!folderPath.includes('.chainsaw') && !initPrompt) {
      setInitPrompt(true);
      return;
    }

    onOpen(folderPath, true);
    setFolderPath('');
    setInitPrompt(false);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        setInitPrompt(false);
        onClose();
      }}
      title="Open Existing Folder"
      icon={<FolderOpen className="w-4 h-4 text-accent" />}
      maxWidth="md"
    >
      {initPrompt ? (
        <div className="space-y-4">
          <div className="p-3 rounded bg-warning/10 border border-warning/30 text-warning space-y-1.5">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Initialize Engagement Workspace?</span>
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              No <code className="text-text font-mono">.chainsaw/</code> directory was detected at this location. Would you like to initialize engagement state and scope scaffolding in this folder?
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setInitPrompt(false)}
              className="px-3 py-1.5 rounded bg-surface-2 text-text hover:bg-surface-2/80 border border-border transition-colors text-xs"
            >
              Choose Different Path
            </button>
            <button
              type="button"
              onClick={() => {
                onOpen(folderPath, true);
                setFolderPath('');
                setInitPrompt(false);
                onClose();
              }}
              className="px-3 py-1.5 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium transition-colors text-xs"
            >
              Initialize & Open
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] font-mono text-text-muted block">Folder Path</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={folderPath}
                placeholder="Click Browse to select folder..."
                className="flex-1 px-3 py-2 bg-bg border border-border rounded text-text font-mono text-xs placeholder:text-text-muted/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="px-3 py-2 bg-surface-2 hover:bg-surface-2/80 border border-border text-text rounded text-xs font-medium transition-colors"
              >
                Browse...
              </button>
            </div>
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
              disabled={!folderPath.trim()}
              className="px-3 py-1.5 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium transition-colors text-xs disabled:opacity-40"
            >
              Open
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
};
