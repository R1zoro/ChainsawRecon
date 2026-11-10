import React, { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Dialog } from '../common/Dialog';

interface RemoveProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  onConfirm: () => void;
}

export const RemoveProjectModal: React.FC<RemoveProjectModalProps> = ({
  isOpen,
  onClose,
  projectName,
  onConfirm,
}) => {
  const [typedConfirmation, setTypedConfirmation] = useState('');

  const isConfirmed = typedConfirmation.trim() === projectName.trim();

  const handleConfirm = () => {
    if (!isConfirmed) return;
    onConfirm();
    setTypedConfirmation('');
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        setTypedConfirmation('');
        onClose();
      }}
      title="Remove Engagement From Index"
      icon={<AlertTriangle className="w-4 h-4 text-danger" />}
      maxWidth="md"
    >
      <div className="space-y-4">
        <p className="text-text-muted text-xs leading-relaxed">
          This will remove <strong className="text-text">{projectName}</strong> from your local engagement index. Your files on disk will not be deleted.
        </p>

        <div className="p-3 rounded bg-bg border border-border space-y-2">
          <label className="text-[11px] font-mono text-text-muted block">
            Type <span className="text-danger font-semibold select-all">"{projectName}"</span> to confirm:
          </label>
          <input
            type="text"
            value={typedConfirmation}
            onChange={(e) => setTypedConfirmation(e.target.value)}
            placeholder={projectName}
            className="w-full px-3 py-1.5 bg-surface border border-border rounded text-text font-mono text-xs focus:outline-none focus:border-danger"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-surface-2 text-text hover:bg-surface-2/80 border border-border transition-colors text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!isConfirmed}
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-danger text-white hover:bg-danger/90 font-medium transition-colors text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Remove From Index</span>
          </button>
        </div>
      </div>
    </Dialog>
  );
};
