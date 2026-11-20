import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Archive, Download, Copy, Check, AlertTriangle, 
  X, RotateCw, FileArchive, HardDrive, Info
} from 'lucide-react';
import { fetchJson } from '../../../api/client';
import { 
  ProjectArchiveItem, 
  CreateArchivePayload, 
  CreateArchiveResponse, 
  Paginated 
} from '../../../api/types';

interface ProjectArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export const ProjectArchiveModal: React.FC<ProjectArchiveModalProps> = ({
  isOpen,
  onClose,
  projectId,
}) => {
  const queryClient = useQueryClient();
  const [includeWorkspace, setIncludeWorkspace] = useState(false);
  const [lastCreated, setLastCreated] = useState<CreateArchiveResponse | null>(null);
  const [copiedSha, setCopiedSha] = useState(false);
  const [downloadingName, setDownloadingName] = useState<string | null>(null);

  // 1. Fetch Archives list
  const { 
    data: archivesData, 
    isLoading: isArchivesLoading, 
    refetch: refetchArchives 
  } = useQuery<Paginated<ProjectArchiveItem>>({
    queryKey: ['projectArchives', projectId],
    queryFn: () => fetchJson<Paginated<ProjectArchiveItem>>(`/projects/${projectId}/archives`),
    enabled: isOpen && Boolean(projectId),
  });

  // 2. Create Archive mutation
  const createMutation = useMutation({
    mutationFn: (payload: CreateArchivePayload) =>
      fetchJson<CreateArchiveResponse>(`/projects/${projectId}/archive`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      setLastCreated(data);
      queryClient.invalidateQueries({ queryKey: ['projectArchives', projectId] });
    },
  });

  if (!isOpen) return null;

  const archives = archivesData?.items || [];

  const handleCreate = () => {
    createMutation.mutate({ includeWorkspace });
  };

  const handleCopySha = (sha: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(sha);
    }
    setCopiedSha(true);
    setTimeout(() => setCopiedSha(false), 2000);
  };

  const handleDownload = async (filename: string) => {
    setDownloadingName(filename);
    try {
      if (import.meta.env.VITE_USE_MOCKS === 'true') {
        const blob = await fetchJson<Blob>(`/projects/${projectId}/archives/${filename}`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const a = document.createElement('a');
        a.href = `/api/v1/projects/${projectId}/archives/${filename}`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error('[ProjectArchive] Download failed', err);
    } finally {
      setDownloadingName(null);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-modal-title"
    >
      <div className="bg-surface border border-border rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl text-text font-sans overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-2/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-accent/15 text-accent border border-accent/30">
              <Archive className="w-5 h-5" />
            </div>
            <div>
              <h2 id="archive-modal-title" className="text-base font-semibold tracking-tight text-text">
                Project Archives
              </h2>
              <p className="text-xs text-text-muted">
                Create and download self-contained portable snapshots of this engagement's state.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Create Archive Section */}
          <div className="p-4 rounded-lg bg-bg border border-border space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-text font-mono flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-accent" />
                  Create Archive
                </span>
                <p className="text-xs text-text-muted">
                  Generates an immutable snapshot of scope, models, journals, findings, and evidence.
                </p>
              </div>
            </div>

            {/* Include Workspace Toggle */}
            <div className="space-y-2 pt-2 border-t border-border/50">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeWorkspace}
                  onChange={(e) => setIncludeWorkspace(e.target.checked)}
                  className="rounded border-border bg-surface-2 text-accent focus:ring-accent/30 w-4 h-4 cursor-pointer"
                />
                <div className="text-xs">
                  <span className="font-medium text-text">Include workspace directory</span>
                  <span className="text-text-muted block text-[11px]">
                    Optionally bundle session workspace files and tool run caches
                  </span>
                </div>
              </label>

              {/* Workspace Size Warning */}
              {includeWorkspace && (
                <div 
                  data-testid="workspace-size-warning"
                  className="flex items-start gap-2 p-3 rounded bg-warning/10 border border-warning/30 text-warning text-xs mt-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-semibold block">Archive Size Warning</span>
                    <p className="text-[11px] leading-relaxed opacity-90">
                      Including the workspace directory bundles raw scan outputs, temporary tools cache, and session working directories. This substantially increases archive size and creation time.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Error Banner */}
            {createMutation.isError && (
              <div className="p-3 rounded bg-danger/10 border border-danger/30 text-danger text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Failed to create archive: {(createMutation.error as Error)?.message || 'Internal server error'}</span>
              </div>
            )}

            {/* Action Button */}
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-50"
              >
                {createMutation.isPending ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Creating archive...</span>
                  </>
                ) : (
                  <>
                    <Archive className="w-3.5 h-3.5" />
                    <span>Create Archive</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Recently Created Archive Summary Card */}
          {lastCreated && (
            <div 
              data-testid="created-archive-result"
              className="p-4 rounded-lg bg-success/10 border border-success/30 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-success font-semibold text-xs">
                  <Check className="w-4 h-4" />
                  <span>Archive Generated Successfully</span>
                </div>
                <button
                  onClick={() => handleDownload(lastCreated.name)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-success/20 text-success hover:bg-success/30 border border-success/40 text-xs font-medium transition-colors"
                  title="Download newly created archive"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download ZIP</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-bg/60 p-3 rounded border border-border">
                <div>
                  <span className="text-text-muted text-[11px] block">Filename</span>
                  <span className="font-mono text-text font-medium text-[11px] truncate block" title={lastCreated.name}>
                    {lastCreated.name}
                  </span>
                </div>
                <div>
                  <span className="text-text-muted text-[11px] block">Packaged Files</span>
                  <span className="font-mono text-text font-semibold">
                    {lastCreated.fileCount} files
                  </span>
                </div>
                <div>
                  <span className="text-text-muted text-[11px] block">Total Size</span>
                  <span className="font-mono text-text font-semibold">
                    {formatBytes(lastCreated.sizeBytes)}
                  </span>
                </div>
              </div>

              {/* SHA-256 Display */}
              <div className="space-y-1">
                <span className="text-text-muted text-[11px] block">SHA-256 Checksum</span>
                <div className="flex items-center justify-between p-2 rounded bg-bg border border-border font-mono text-[11px] text-text-muted">
                  <span className="truncate select-all text-text font-mono pr-2" data-testid="archive-sha256">
                    {lastCreated.sha256}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopySha(lastCreated.sha256)}
                    className="p-1 hover:text-text rounded transition-colors shrink-0"
                    title="Copy SHA-256 checksum"
                  >
                    {copiedSha ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Saved Archives List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text font-mono flex items-center gap-1.5">
                <FileArchive className="w-3.5 h-3.5 text-accent" />
                Saved Archives ({archives.length})
              </span>
              <button
                onClick={() => refetchArchives()}
                className="text-xs text-text-muted hover:text-text flex items-center gap-1 transition-colors"
                title="Refresh archives list"
              >
                <RotateCw className="w-3 h-3" />
                <span>Refresh</span>
              </button>
            </div>

            {isArchivesLoading ? (
              <div className="p-8 text-center text-xs text-text-muted space-y-2">
                <RotateCw className="w-5 h-5 animate-spin mx-auto text-accent" />
                <p>Loading project archives...</p>
              </div>
            ) : archives.length === 0 ? (
              <div 
                data-testid="archives-empty-state"
                className="p-8 rounded-lg bg-bg border border-border border-dashed text-center text-xs text-text-muted space-y-1"
              >
                <FileArchive className="w-6 h-6 mx-auto text-text-muted/50 mb-1" />
                <p className="font-medium text-text">No archives created yet</p>
                <p className="text-[11px]">Use the form above to generate a portable snapshot of this engagement.</p>
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden bg-bg divide-y divide-border">
                {archives.map((arch) => (
                  <div 
                    key={arch.name}
                    className="p-3.5 flex items-center justify-between gap-3 hover:bg-surface-2/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded bg-surface border border-border text-accent shrink-0">
                        <FileArchive className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-mono text-xs text-text font-medium truncate block" title={arch.name}>
                          {arch.name}
                        </span>
                        <div className="flex items-center gap-3 text-[11px] text-text-muted font-mono mt-0.5">
                          <span>{formatBytes(arch.sizeBytes)}</span>
                          <span>•</span>
                          <span>{new Date(arch.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDownload(arch.name)}
                      disabled={downloadingName === arch.name}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-2 hover:bg-surface-2/80 text-text border border-border text-xs transition-colors shrink-0 disabled:opacity-50"
                      title={`Download ${arch.name}`}
                    >
                      {downloadingName === arch.name ? (
                        <RotateCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>Download</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Restore Notice / Disclaimer (Restore is NOT implemented) */}
          <div className="flex items-start gap-2 p-3 rounded bg-surface-2/50 border border-border text-[11px] text-text-muted">
            <Info className="w-4 h-4 shrink-0 text-text-muted mt-0.5" />
            <p className="leading-relaxed">
              <strong className="text-text">Note on cold backups:</strong> Archives are portable, read-only snapshots intended for off-site backup, compliance audits, and offline report packaging. Restore operations are intentionally not implemented yet.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-border bg-surface-2/20 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-surface-2 hover:bg-surface-2/80 text-text border border-border text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
