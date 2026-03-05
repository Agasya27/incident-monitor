/**
 * Security hardening utilities – sanitization, validation, clamping.
 * No external sanitization libraries; all implemented inline.
 */

// ── HTML escape (prevent XSS in rendered strings) ─────────────────

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
};

const HTML_ESCAPE_RE = /[&<>"'/]/g;

export function escapeHtml(str: string): string {
  return str.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch] || ch);
}

// ── String length limiter ─────────────────────────────────────────

export function limitString(str: string, maxLen = 1000): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

// ── Numeric clamping ──────────────────────────────────────────────

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function clampTimestamp(ts: number): number {
  // Valid timestamps: 2000-01-01 to 2100-01-01
  return clampNumber(ts, 946684800000, 4102444800000);
}

export function clampSeverityLevel(level: number): number {
  return clampNumber(Math.round(level), 0, 3);
}

// ── Rule expression validation ────────────────────────────────────

const RULE_EXPR_MAX_LENGTH = 500;
// Allow alphanumeric, spaces, basic operators, regex chars, quotes
const RULE_EXPR_ALLOWED = /^[a-zA-Z0-9\s_.><=!&|(){}[\]*+?^$\\/"',:;@#%-]+$/;

export function validateRuleExpression(expr: string): { valid: boolean; error?: string } {
  if (expr.length === 0) {
    return { valid: false, error: 'Expression cannot be empty' };
  }
  if (expr.length > RULE_EXPR_MAX_LENGTH) {
    return { valid: false, error: `Expression too long (max ${RULE_EXPR_MAX_LENGTH} chars, got ${expr.length})` };
  }
  if (!RULE_EXPR_ALLOWED.test(expr)) {
    return { valid: false, error: 'Expression contains disallowed characters' };
  }
  // Block potential code injection patterns
  const blockedPatterns = [
    /\beval\b/i,
    /\bFunction\b/,
    /\bimport\b/,
    /\brequire\b/,
    /\bprocess\b/,
    /\b__proto__\b/,
    /\bconstructor\b/,
    /\bprototype\b/,
  ];
  for (const pattern of blockedPatterns) {
    if (pattern.test(expr)) {
      return { valid: false, error: `Expression contains blocked keyword: ${pattern.source}` };
    }
  }
  return { valid: true };
}

// ── Safe regex compilation ────────────────────────────────────────

export function safeRegex(pattern: string, timeoutMs = 100): RegExp | null {
  try {
    const re = new RegExp(pattern, 'i');
    // Test with a simple string to catch catastrophic backtracking early
    const testStr = 'a'.repeat(25);
    const start = performance.now();
    re.test(testStr);
    if (performance.now() - start > timeoutMs) return null;
    return re;
  } catch {
    return null;
  }
}

// ── Sanitize event fields for display ─────────────────────────────

export function sanitizeForDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  return escapeHtml(limitString(str, 500));
}

// ── Sanitize metadata object ──────────────────────────────────────

export function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {};
  const sanitized: Record<string, unknown> = {};
  const keys = Object.keys(meta).slice(0, 50); // Limit number of keys
  for (const key of keys) {
    const safeKey = limitString(key, 100);
    const val = meta[key];
    if (typeof val === 'string') {
      sanitized[safeKey] = limitString(val, 1000);
    } else if (typeof val === 'number') {
      sanitized[safeKey] = Number.isFinite(val) ? val : 0;
    } else if (typeof val === 'boolean') {
      sanitized[safeKey] = val;
    } else {
      // Drop complex nested objects to prevent prototype pollution
      sanitized[safeKey] = String(val).slice(0, 200);
    }
  }
  return sanitized;
}
