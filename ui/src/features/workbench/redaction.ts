/**
 * Strict Security Redaction Utility for ChainsawRecon HTTP Workbench
 * 
 * Invariant:
 * The headers Authorization, Cookie, Set-Cookie, X-Api-Key, and Proxy-Authorization
 * must always render as «redacted» unless an explicit operator unredaction action is invoked.
 */

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'proxy-authorization',
  'api-key',
  'access-token',
]);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      result[key] = '«redacted»';
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function isSensitiveHeader(headerKey: string): boolean {
  return SENSITIVE_HEADERS.has(headerKey.toLowerCase());
}

export function parseQueryParams(urlOrPath: string): Array<{ key: string; value: string }> {
  try {
    const qIndex = urlOrPath.indexOf('?');
    if (qIndex === -1) return [];
    const search = urlOrPath.slice(qIndex + 1);
    const params = new URLSearchParams(search);
    const result: Array<{ key: string; value: string }> = [];
    params.forEach((value, key) => {
      result.push({ key, value });
    });
    return result;
  } catch {
    return [];
  }
}
