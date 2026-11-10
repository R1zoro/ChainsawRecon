import React from 'react';
import { Activity, Shield, Bug, PlayCircle, FileText } from 'lucide-react';
import { RecentActivityItem, ActivityKind } from '../../api/types';
import { formatRelativeTime } from '../../lib/utils';

interface RecentActivityProps {
  activity: RecentActivityItem[];
  onSelectActivity?: (item: RecentActivityItem) => void;
}

export const RecentActivity: React.FC<RecentActivityProps> = ({
  activity,
  onSelectActivity,
}) => {
  if (!activity || activity.length === 0) return null;

  const getKindIcon = (kind: ActivityKind) => {
    switch (kind) {
      case 'finding':
        return <Bug className="w-3.5 h-3.5 text-danger" />;
      case 'scope':
        return <Shield className="w-3.5 h-3.5 text-warning" />;
      case 'session':
        return <PlayCircle className="w-3.5 h-3.5 text-accent" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-text-muted" />;
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-accent" />
        <h3 className="font-semibold text-text text-sm tracking-tight">Recent activity</h3>
      </div>

      <div className="divide-y divide-border/60">
        {activity.slice(0, 6).map((item) => (
          <div
            key={item.id}
            onClick={() => onSelectActivity?.(item)}
            className="py-2.5 flex items-start justify-between gap-3 hover:bg-surface-2/40 px-2 -mx-2 rounded transition-colors cursor-pointer group"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <span className="mt-0.5 shrink-0">{getKindIcon(item.kind)}</span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs text-text group-hover:text-accent transition-colors leading-tight truncate">
                  <strong className="font-semibold">{item.projectName}</strong>
                  <span className="text-text-muted"> — {item.summary}</span>
                </p>
                {item.targetUrl && (
                  <code className="text-[10px] font-mono text-text-muted/70 block truncate">
                    {item.targetUrl}
                  </code>
                )}
              </div>
            </div>

            <span className="text-[11px] font-mono text-text-muted shrink-0">
              {formatRelativeTime(item.ts)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
