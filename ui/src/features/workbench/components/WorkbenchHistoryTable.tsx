import React, { useState, useMemo } from 'react';
import { 
  ArrowUpDown, ShieldAlert, Check, Send, Inbox 
} from 'lucide-react';
import { CapturedRequest } from '../../../api/types';

interface WorkbenchHistoryTableProps {
  requests: CapturedRequest[];
  selectedRequest: CapturedRequest | null;
  onSelectRequest: (req: CapturedRequest) => void;
  onSendToRepeater: (req: CapturedRequest) => void;
}

type SortField = 'id' | 'method' | 'host' | 'path' | 'status' | 'durationMs' | 'sizeBytes' | 'capturedAt';
type SortOrder = 'asc' | 'desc';

export const WorkbenchHistoryTable: React.FC<WorkbenchHistoryTableProps> = ({
  requests,
  selectedRequest,
  onSelectRequest,
  onSendToRepeater,
}) => {
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => {
      let aVal: unknown = a[sortField];
      let bVal: unknown = b[sortField];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
  }, [requests, sortField, sortOrder]);

  const getMethodBadgeClass = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'text-accent border-accent/30 bg-accent/10';
      case 'POST':
        return 'text-success border-success/30 bg-success/10';
      case 'PUT':
      case 'PATCH':
        return 'text-warning border-warning/30 bg-warning/10';
      case 'DELETE':
        return 'text-danger border-danger/30 bg-danger/10';
      default:
        return 'text-text-muted border-border bg-surface-2';
    }
  };

  const getStatusBadgeClass = (status: number) => {
    if (status >= 200 && status < 300) {
      return 'text-success bg-success/15 border-success/30';
    }
    if (status >= 300 && status < 400) {
      return 'text-accent bg-accent/15 border-accent/30';
    }
    if (status >= 400 && status < 500) {
      return 'text-warning bg-warning/15 border-warning/30';
    }
    if (status >= 500) {
      return 'text-danger bg-danger/15 border-danger/30';
    }
    return 'text-text-muted bg-surface-2 border-border';
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  if (requests.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-surface select-none space-y-2">
        <Inbox className="w-8 h-8 opacity-40 text-text-muted" />
        <h3 className="text-sm font-semibold text-text">No captured requests</h3>
        <p className="text-xs text-text-muted max-w-sm">
          Traffic will appear here as web requests are captured by scanning modules, the local proxy, or imported HAR files.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-bg select-none font-sans text-xs">
      <table className="w-full border-collapse text-left font-mono" role="table">
        <thead className="bg-surface sticky top-0 z-10 border-b border-border shadow-sm text-[11px] text-text-muted">
          <tr>
            <th className="py-2 px-3 w-12 font-medium">
              <button onClick={() => handleSort('id')} className="flex items-center gap-1 hover:text-text">
                <span>#</span>
                <ArrowUpDown className="w-2.5 h-2.5" />
              </button>
            </th>
            <th className="py-2 px-3 w-20 font-medium">
              <button onClick={() => handleSort('method')} className="flex items-center gap-1 hover:text-text">
                <span>Method</span>
                <ArrowUpDown className="w-2.5 h-2.5" />
              </button>
            </th>
            <th className="py-2 px-3 min-w-[200px] font-medium">
              <button onClick={() => handleSort('path')} className="flex items-center gap-1 hover:text-text">
                <span>Host &amp; Path</span>
                <ArrowUpDown className="w-2.5 h-2.5" />
              </button>
            </th>
            <th className="py-2 px-3 w-20 font-medium">
              <button onClick={() => handleSort('status')} className="flex items-center gap-1 hover:text-text">
                <span>Status</span>
                <ArrowUpDown className="w-2.5 h-2.5" />
              </button>
            </th>
            <th className="py-2 px-3 w-20 font-medium text-right">
              <button onClick={() => handleSort('durationMs')} className="flex items-center gap-1 justify-end w-full hover:text-text">
                <span>Time</span>
                <ArrowUpDown className="w-2.5 h-2.5" />
              </button>
            </th>
            <th className="py-2 px-3 w-20 font-medium text-right">
              <button onClick={() => handleSort('sizeBytes')} className="flex items-center gap-1 justify-end w-full hover:text-text">
                <span>Size</span>
                <ArrowUpDown className="w-2.5 h-2.5" />
              </button>
            </th>
            <th className="py-2 px-3 w-32 font-medium">Auth</th>
            <th className="py-2 px-3 w-16 text-center font-medium">Scope</th>
            <th className="py-2 px-3 min-w-[120px] font-medium">Tags</th>
            <th className="py-2 px-3 w-16 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {sortedRequests.map((req, idx) => {
            const isSelected = selectedRequest?.id === req.id;
            return (
              <tr
                key={req.id}
                onClick={() => onSelectRequest(req)}
                className={`cursor-pointer transition-colors group ${
                  isSelected
                    ? 'bg-accent/15 border-l-2 border-l-accent'
                    : idx % 2 === 0
                    ? 'bg-surface/40 hover:bg-surface-2/60'
                    : 'bg-surface/20 hover:bg-surface-2/60'
                }`}
              >
                {/* ID index */}
                <td className="py-1.5 px-3 text-[11px] text-text-muted">
                  {req.id.replace('req_demo_', '').replace('req_replay_', 'r-')}
                </td>

                {/* Method */}
                <td className="py-1.5 px-3">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${getMethodBadgeClass(req.method)}`}>
                    {req.method}
                  </span>
                </td>

                {/* Host & Path */}
                <td className="py-1.5 px-3 truncate max-w-[280px]">
                  <span className="text-text-muted text-[11px]">{req.host}</span>
                  <span className="text-text font-medium text-xs ml-1">{req.path}</span>
                </td>

                {/* Status Code */}
                <td className="py-1.5 px-3">
                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold border ${getStatusBadgeClass(req.status)}`}>
                    {req.status}
                  </span>
                </td>

                {/* Duration */}
                <td className="py-1.5 px-3 text-right text-[11px] text-text-muted">
                  {req.durationMs}ms
                </td>

                {/* Size */}
                <td className="py-1.5 px-3 text-right text-[11px] text-text-muted">
                  {formatSize(req.sizeBytes)}
                </td>

                {/* Auth Context */}
                <td className="py-1.5 px-3 truncate max-w-[120px] text-[11px] text-text-muted">
                  {req.authContext}
                </td>

                {/* Scope Indicator */}
                <td className="py-1.5 px-3 text-center">
                  {req.inScope ? (
                    <span className="inline-flex text-success" title="Target in scope">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  ) : (
                    <span className="inline-flex text-warning" title="Target outside scope">
                      <ShieldAlert className="w-3.5 h-3.5" />
                    </span>
                  )}
                </td>

                {/* Tags */}
                <td className="py-1.5 px-3">
                  <div className="flex items-center gap-1 overflow-hidden">
                    {req.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="px-1 py-0.2 rounded bg-surface-2 text-[10px] text-text-muted border border-border">
                        {tag}
                      </span>
                    ))}
                    {req.tags.length > 2 && (
                      <span className="text-[10px] text-text-muted">+{req.tags.length - 2}</span>
                    )}
                  </div>
                </td>

                {/* Action: Send to Repeater */}
                <td className="py-1.5 px-3 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSendToRepeater(req);
                    }}
                    className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-accent transition-colors"
                    title="Clone to Repeater tab"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
