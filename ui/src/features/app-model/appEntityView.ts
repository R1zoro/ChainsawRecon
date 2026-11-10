import React from 'react';
import { 
  Layers, Server, Globe, Sliders, UserCheck, 
  Cpu, Bug, GitFork, Box 
} from 'lucide-react';
import { AppEntity, AppEntityKind, EntityConfidence } from '../../api/types';

export interface AppEntityViewModel {
  kind: AppEntityKind;
  kindLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  summary: string;
  confidence: EntityConfidence;
  confidenceBadgeClass: string;
  isStale: boolean;
  staleBadgeClass: string;
  hasAuthBoundary: boolean;
  authBadgeClass: string;
  borderClass: string;
  metaFields: Array<{ label: string; value: string }>;
}

export function appEntityView(entity: AppEntity): AppEntityViewModel {
  const meta = entity.meta || {};

  // 1. Icon & Label per kind
  let icon = Box;
  let kindLabel = entity.kind.toUpperCase();
  let subtitle: string | undefined;
  let summary = entity.name;
  let hasAuthBoundary = Boolean(meta.authBoundary);
  const metaFields: Array<{ label: string; value: string }> = [];

  switch (entity.kind) {
    case 'application':
      icon = Layers;
      kindLabel = 'APPLICATION';
      subtitle = (meta.environment as string) || 'Primary System';
      summary = `Application container: ${entity.name}`;
      if (meta.domains && Array.isArray(meta.domains)) {
        metaFields.push({ label: 'Domains', value: meta.domains.join(', ') });
      }
      break;

    case 'service':
      icon = Server;
      kindLabel = 'SERVICE';
      subtitle = `${meta.port || 443} • ${meta.tls ? 'TLS / HTTPS' : 'HTTP'}`;
      summary = `Service endpoint on ${meta.host || entity.name}`;
      if (meta.host) metaFields.push({ label: 'Host', value: String(meta.host) });
      if (meta.port) metaFields.push({ label: 'Port', value: String(meta.port) });
      if (meta.tls !== undefined) metaFields.push({ label: 'TLS Secured', value: meta.tls ? 'Yes' : 'No' });
      break;

    case 'route':
      icon = Globe;
      kindLabel = 'ROUTE';
      subtitle = `${meta.method || 'GET'} • ${meta.host || ''}`;
      summary = `${meta.method || 'GET'} ${meta.path || entity.name}`;
      hasAuthBoundary = Boolean(meta.authBoundary);
      if (meta.method) metaFields.push({ label: 'Method', value: String(meta.method) });
      if (meta.path) metaFields.push({ label: 'Path', value: String(meta.path) });
      if (meta.host) metaFields.push({ label: 'Host', value: String(meta.host) });
      if (meta.authBoundary !== undefined) metaFields.push({ label: 'Auth Boundary', value: meta.authBoundary ? 'Enforced' : 'None' });
      if (meta.statusCodes && Array.isArray(meta.statusCodes)) {
        metaFields.push({ label: 'Status Codes', value: meta.statusCodes.join(', ') });
      }
      if (meta.contentTypes && Array.isArray(meta.contentTypes)) {
        metaFields.push({ label: 'Content Types', value: meta.contentTypes.join(', ') });
      }
      break;

    case 'input':
      icon = Sliders;
      kindLabel = 'INPUT';
      subtitle = `${meta.location || 'parameter'} • ${meta.type || 'string'}`;
      summary = `Parameter '${entity.name}' in ${meta.location || 'request'}`;
      if (meta.location) metaFields.push({ label: 'Location', value: String(meta.location) });
      if (meta.type) metaFields.push({ label: 'Data Type', value: String(meta.type) });
      if (meta.example) metaFields.push({ label: 'Example', value: String(meta.example) });
      if (meta.routeId) metaFields.push({ label: 'Route ID', value: String(meta.routeId) });
      break;

    case 'identity':
      icon = UserCheck;
      kindLabel = 'IDENTITY';
      subtitle = `${meta.role || 'user'} • ${meta.tenant || 'tenant'}`;
      summary = `Principal ${entity.name} (${meta.mechanism || 'auth'})`;
      hasAuthBoundary = true;
      if (meta.role) metaFields.push({ label: 'Role', value: String(meta.role) });
      if (meta.tenant) metaFields.push({ label: 'Tenant', value: String(meta.tenant) });
      if (meta.mechanism) metaFields.push({ label: 'Mechanism', value: String(meta.mechanism) });
      break;

    case 'technology':
      icon = Cpu;
      kindLabel = 'TECHNOLOGY';
      subtitle = (meta.category as string) || 'Stack';
      summary = `${entity.name} ${meta.version ? 'v' + meta.version : ''}`.trim();
      if (meta.category) metaFields.push({ label: 'Category', value: String(meta.category) });
      if (meta.version) metaFields.push({ label: 'Version', value: String(meta.version) });
      break;

    case 'finding':
      icon = Bug;
      kindLabel = 'FINDING';
      subtitle = `${(meta.severity as string)?.toUpperCase() || 'HIGH'} • ${meta.state || 'candidate'}`;
      summary = entity.name;
      if (meta.severity) metaFields.push({ label: 'Severity', value: String(meta.severity).toUpperCase() });
      if (meta.state) metaFields.push({ label: 'Lifecycle State', value: String(meta.state) });
      if (meta.asset) metaFields.push({ label: 'Affected Asset', value: String(meta.asset) });
      if (meta.cvss) metaFields.push({ label: 'CVSS Score', value: String(meta.cvss) });
      break;

    case 'flow':
      icon = GitFork;
      kindLabel = 'FLOW';
      subtitle = 'Transaction Flow';
      summary = entity.name;
      break;

    default:
      icon = Box;
      kindLabel = entity.kind.toUpperCase();
      summary = entity.name;
      break;
  }

  // 2. Confidence styling
  let confidenceBadgeClass = 'bg-surface-2 text-text-muted border-border';
  if (entity.confidence === 'confirmed') {
    confidenceBadgeClass = 'bg-success/15 text-success border-success/30';
  } else if (entity.confidence === 'observed') {
    confidenceBadgeClass = 'bg-accent/15 text-accent border-accent/30';
  } else if (entity.confidence === 'tentative') {
    confidenceBadgeClass = 'bg-surface-2 text-text-muted border-border';
  }

  // 3. Stale styling (Amber warning only, never alarming red)
  const staleBadgeClass = entity.stale 
    ? 'bg-warning/20 text-warning border-warning/40' 
    : 'hidden';

  // 4. Auth boundary styling
  const authBadgeClass = hasAuthBoundary
    ? 'bg-accent/15 text-accent border-accent/40'
    : 'hidden';

  // 5. Border class for cards/nodes (Matte charcoal theme, semantic borders)
  let borderClass = 'border-border hover:border-accent/60';
  if (entity.stale) {
    borderClass = 'border-warning/40 hover:border-warning';
  } else if (entity.kind === 'finding') {
    borderClass = 'border-danger/40 hover:border-danger';
  }

  return {
    kind: entity.kind,
    kindLabel,
    icon,
    title: entity.name,
    subtitle,
    summary,
    confidence: entity.confidence,
    confidenceBadgeClass,
    isStale: entity.stale,
    staleBadgeClass,
    hasAuthBoundary,
    authBadgeClass,
    borderClass,
    metaFields,
  };
}
