import { JournalEvent } from '../../api/types';

export type EventFamily = 
  | 'session' 
  | 'decision' 
  | 'action' 
  | 'observation' 
  | 'evidence' 
  | 'finding' 
  | 'approval' 
  | 'task' 
  | 'message' 
  | 'context' 
  | 'hypothesis' 
  | 'generic';

export function getEventFamily(type: string): EventFamily {
  if (!type) return 'generic';
  const prefix = type.split('/')[0].toLowerCase();
  switch (prefix) {
    case 'session':
    case 'decision':
    case 'action':
    case 'observation':
    case 'evidence':
    case 'finding':
    case 'approval':
    case 'task':
    case 'message':
    case 'context':
    case 'hypothesis':
      return prefix;
    default:
      return 'generic';
  }
}

export interface AdaptedEventView {
  family: EventFamily;
  subtype: string;
  title: string;
  summary: string;
  detail?: string;
  status?: string;
  method?: string;
  endpoint?: string;
  hash?: string;
  artifactId?: string;
  severity?: string;
  rationale?: string;
  nextAction?: string;
  alternatives?: string[];
  confidence?: string;
  tokens?: number;
  data: Record<string, unknown>;
}

export function eventView(event: JournalEvent): AdaptedEventView {
  const family = getEventFamily(event.type);
  const subtype = event.type.includes('/') ? event.type.split('/')[1] : '';
  const rawData = typeof event.data === 'object' && event.data !== null 
    ? (event.data as Record<string, unknown>) 
    : {};

  switch (family) {
    case 'decision': {
      const rationale = String(rawData.rationale || rawData.reason || 'Strategic transition');
      const nextAction = rawData.selectedTaskId 
        ? `Task ${String(rawData.selectedTaskId)}` 
        : (rawData.nextAction ? String(rawData.nextAction) : undefined);
      const alternatives = Array.isArray(rawData.alternatives) 
        ? rawData.alternatives.map((a) => String(a)) 
        : undefined;

      return {
        family,
        subtype,
        title: rawData.selectedTaskId ? `Decision: Task ${String(rawData.selectedTaskId)}` : 'Strategic Decision',
        summary: rationale,
        rationale,
        nextAction,
        alternatives,
        data: rawData,
      };
    }

    case 'action': {
      const method = String(rawData.method || 'EXEC');
      const endpoint = String(rawData.endpoint || rawData.target || rawData.tool || '');
      const status = rawData.status !== undefined ? String(rawData.status) : (rawData.exitCode !== undefined ? `exit ${String(rawData.exitCode)}` : undefined);
      const summary = endpoint ? `${method} ${endpoint}` : method;

      return {
        family,
        subtype,
        title: `Action: ${method}`,
        summary,
        method,
        endpoint,
        status,
        data: rawData,
      };
    }

    case 'observation': {
      const statement = String(rawData.statement || rawData.snippet || rawData.observation || 'Observation recorded');
      const status = rawData.status !== undefined ? String(rawData.status) : undefined;
      const confidence = rawData.confidence ? String(rawData.confidence) : 'observed';

      return {
        family,
        subtype,
        title: status ? `Observation (Status ${status})` : 'Observation',
        summary: statement,
        detail: statement,
        status,
        confidence,
        data: rawData,
      };
    }

    case 'evidence': {
      const artifactId = String(rawData.artifactId || rawData.artifact_id || rawData.evidenceId || rawData.id || '');
      const summary = String(rawData.summary || rawData.preview || rawData.description || 'Artifact recorded');
      const hash = rawData.hash ? String(rawData.hash) : undefined;

      return {
        family,
        subtype,
        title: artifactId ? `Evidence: ${artifactId}` : 'Evidence Recorded',
        summary,
        artifactId,
        hash,
        data: rawData,
      };
    }

    case 'finding': {
      const title = String(rawData.title || 'Vulnerability Discovered');
      const severity = String(rawData.severity || 'unknown');
      const status = String(rawData.state || subtype || 'candidate');

      return {
        family,
        subtype,
        title,
        summary: `${title} (${severity})`,
        severity,
        status,
        data: rawData,
      };
    }

    case 'approval': {
      const title = String(rawData.title || 'Approval Gate');
      const detail = String(rawData.detail || rawData.reason || '');
      const risk = String(rawData.risk || 'high');
      const status = String(rawData.status || subtype || 'pending');

      return {
        family,
        subtype,
        title,
        summary: detail || title,
        detail,
        severity: risk,
        status,
        data: rawData,
      };
    }

    case 'task': {
      const taskId = String(rawData.taskId || rawData.id || '');
      const title = String(rawData.title || taskId || 'Task Transition');
      const status = String(rawData.status || rawData.to || subtype || 'proposed');
      const endpoint = rawData.target ? String(rawData.target) : undefined;

      return {
        family,
        subtype,
        title,
        summary: `${title} → ${status}`,
        status,
        endpoint,
        data: rawData,
      };
    }

    case 'message': {
      const content = String(rawData.content || '');
      const isUser = event.type === 'message/user';

      return {
        family,
        subtype,
        title: isUser ? 'Operator Guidance' : 'Agent Response',
        summary: content,
        detail: content,
        data: rawData,
      };
    }

    case 'session': {
      const isCreated = subtype === 'created' || event.type === 'session/created';
      const mode = rawData.mode ? String(rawData.mode) : undefined;
      const status = rawData.status ? String(rawData.status) : undefined;
      const title = String(rawData.title || 'Session');

      return {
        family,
        subtype,
        title,
        summary: isCreated ? `Session created (${mode || 'auto'})` : `Session ended (${status || 'completed'})`,
        status,
        data: rawData,
      };
    }

    case 'context': {
      const role = rawData.role ? String(rawData.role) : undefined;
      const tokens = typeof rawData.finalTokens === 'number' 
        ? rawData.finalTokens 
        : (typeof rawData.usedTokens === 'number' ? rawData.usedTokens : undefined);

      return {
        family,
        subtype,
        title: role ? `Context: ${role}` : 'Context Assembled',
        summary: role ? `${role} (${tokens ?? 0} tokens)` : 'Context updated',
        tokens,
        data: rawData,
      };
    }

    default: {
      return {
        family: 'generic',
        subtype,
        title: event.type,
        summary: JSON.stringify(rawData).slice(0, 100),
        data: rawData,
      };
    }
  }
}
