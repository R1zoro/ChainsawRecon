/**
 * Scope parser, classifier, conflict detector, and deduplicator.
 */

export interface ParsedScopeItem {
  raw: string;
  normalized: string;
  type: 'fqdn' | 'url' | 'wildcard' | 'ip' | 'cidr' | 'invalid';
  isExcluded: boolean;
}

export interface ScopeClassificationResult {
  inScope: ParsedScopeItem[];
  outOfScope: ParsedScopeItem[];
  duplicates: string[];
  conflicts: string[];
  totalValid: number;
}

const IP_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const CIDR_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/([0-9]|[1-2][0-9]|3[0-2])$/;
const URL_REGEX = /^https?:\/\//i;
const WILDCARD_REGEX = /^\*\.[a-z0-9-]+(\.[a-z0-9-]+)*$/i;
const FQDN_REGEX = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function classifyScopeItem(rawItem: string): { type: ParsedScopeItem['type']; normalized: string; isExcluded: boolean } {
  let clean = rawItem.trim();
  let isExcluded = false;

  if (clean.startsWith('!') || clean.toLowerCase().startsWith('out:')) {
    isExcluded = true;
    clean = clean.replace(/^[!out:]+/i, '').trim();
  }

  // Strip trailing slashes on bare hostnames
  clean = clean.replace(/\/+$/, '');

  if (URL_REGEX.test(clean)) {
    return { type: 'url', normalized: clean, isExcluded };
  }
  if (CIDR_REGEX.test(clean)) {
    return { type: 'cidr', normalized: clean, isExcluded };
  }
  if (IP_REGEX.test(clean)) {
    return { type: 'ip', normalized: clean, isExcluded };
  }
  if (WILDCARD_REGEX.test(clean)) {
    return { type: 'wildcard', normalized: clean.toLowerCase(), isExcluded };
  }
  if (FQDN_REGEX.test(clean)) {
    return { type: 'fqdn', normalized: clean.toLowerCase(), isExcluded };
  }

  return { type: 'invalid', normalized: clean, isExcluded };
}

export function parseAndClassifyScope(rawInput: string): ScopeClassificationResult {
  const lines = rawInput
    .split(/[\r\n,;]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const inScopeMap = new Map<string, ParsedScopeItem>();
  const outOfScopeMap = new Map<string, ParsedScopeItem>();
  const duplicates: string[] = [];
  const conflicts: string[] = [];

  for (const line of lines) {
    const { type, normalized, isExcluded } = classifyScopeItem(line);
    if (type === 'invalid') continue;

    const item: ParsedScopeItem = {
      raw: line,
      normalized,
      type,
      isExcluded,
    };

    if (isExcluded) {
      if (outOfScopeMap.has(normalized)) {
        duplicates.push(normalized);
      } else {
        outOfScopeMap.set(normalized, item);
      }
    } else {
      if (inScopeMap.has(normalized)) {
        duplicates.push(normalized);
      } else {
        inScopeMap.set(normalized, item);
      }
    }
  }

  // Check for conflicts: item in both in-scope and out-of-scope
  for (const key of inScopeMap.keys()) {
    if (outOfScopeMap.has(key)) {
      conflicts.push(key);
    }
  }

  return {
    inScope: Array.from(inScopeMap.values()),
    outOfScope: Array.from(outOfScopeMap.values()),
    duplicates: Array.from(new Set(duplicates)),
    conflicts: Array.from(new Set(conflicts)),
    totalValid: inScopeMap.size + outOfScopeMap.size,
  };
}
