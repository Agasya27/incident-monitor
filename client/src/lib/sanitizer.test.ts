import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  limitString,
  clampNumber,
  clampTimestamp,
  clampSeverityLevel,
  validateRuleExpression,
  safeRegex,
  sanitizeForDisplay,
  sanitizeMetadata,
} from './sanitizer';

// ── escapeHtml ─────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes ampersand', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles complex XSS payloads', () => {
    const xss = '<img onerror="alert(1)" src=x>';
    const escaped = escapeHtml(xss);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });
});

// ── limitString ────────────────────────────────────────────────────

describe('limitString', () => {
  it('returns short strings unchanged', () => {
    expect(limitString('hello', 10)).toBe('hello');
  });

  it('truncates long strings', () => {
    const long = 'a'.repeat(2000);
    const result = limitString(long, 100);
    expect(result.length).toBe(101); // 100 + ellipsis
    expect(result.endsWith('…')).toBe(true);
  });

  it('uses default max length', () => {
    const str = 'a'.repeat(1001);
    const result = limitString(str);
    expect(result.length).toBe(1001); // 1000 + ellipsis
  });
});

// ── clampNumber ────────────────────────────────────────────────────

describe('clampNumber', () => {
  it('clamps within range', () => {
    expect(clampNumber(50, 0, 100)).toBe(50);
  });

  it('clamps below minimum', () => {
    expect(clampNumber(-5, 0, 100)).toBe(0);
  });

  it('clamps above maximum', () => {
    expect(clampNumber(200, 0, 100)).toBe(100);
  });

  it('returns min for NaN', () => {
    expect(clampNumber(NaN, 0, 100)).toBe(0);
  });

  it('returns min for Infinity', () => {
    expect(clampNumber(Infinity, 0, 100)).toBe(0);
  });
});

// ── clampTimestamp ──────────────────────────────────────────────────

describe('clampTimestamp', () => {
  it('allows valid timestamps', () => {
    const ts = Date.now();
    expect(clampTimestamp(ts)).toBe(ts);
  });

  it('clamps very old timestamps', () => {
    expect(clampTimestamp(1000)).toBe(946684800000); // floor
  });

  it('clamps very future timestamps', () => {
    expect(clampTimestamp(999999999999999)).toBe(4102444800000); // ceiling
  });
});

// ── clampSeverityLevel ─────────────────────────────────────────────

describe('clampSeverityLevel', () => {
  it('allows valid severity levels (0-3)', () => {
    expect(clampSeverityLevel(0)).toBe(0);
    expect(clampSeverityLevel(1)).toBe(1);
    expect(clampSeverityLevel(2)).toBe(2);
    expect(clampSeverityLevel(3)).toBe(3);
  });

  it('clamps negative values', () => {
    expect(clampSeverityLevel(-1)).toBe(0);
  });

  it('clamps values above 3', () => {
    expect(clampSeverityLevel(5)).toBe(3);
  });

  it('rounds fractional values', () => {
    expect(clampSeverityLevel(1.7)).toBe(2);
  });
});

// ── validateRuleExpression ─────────────────────────────────────────

describe('validateRuleExpression', () => {
  it('accepts valid expressions', () => {
    expect(validateRuleExpression('auth-service').valid).toBe(true);
    expect(validateRuleExpression('error').valid).toBe(true);
    expect(validateRuleExpression('level > 2').valid).toBe(true);
  });

  it('rejects empty expressions', () => {
    const result = validateRuleExpression('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects overly long expressions', () => {
    const result = validateRuleExpression('a'.repeat(501));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too long');
  });

  it('blocks eval keyword', () => {
    const result = validateRuleExpression('eval(x)');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('blocked');
  });

  it('blocks Function keyword', () => {
    const result = validateRuleExpression('new Function()');
    expect(result.valid).toBe(false);
  });

  it('blocks import keyword', () => {
    expect(validateRuleExpression('import("module")').valid).toBe(false);
  });

  it('blocks __proto__', () => {
    expect(validateRuleExpression('__proto__').valid).toBe(false);
  });

  it('blocks constructor', () => {
    expect(validateRuleExpression('constructor').valid).toBe(false);
  });

  it('blocks prototype', () => {
    expect(validateRuleExpression('prototype').valid).toBe(false);
  });
});

// ── safeRegex ──────────────────────────────────────────────────────

describe('safeRegex', () => {
  it('compiles valid regex', () => {
    const re = safeRegex('fail.*');
    expect(re).not.toBeNull();
    expect(re!.test('failed')).toBe(true);
  });

  it('returns null for invalid regex', () => {
    expect(safeRegex('[unclosed')).toBeNull();
  });

  it('returns case-insensitive regex', () => {
    const re = safeRegex('error');
    expect(re).not.toBeNull();
    expect(re!.test('ERROR')).toBe(true);
  });
});

// ── sanitizeForDisplay ─────────────────────────────────────────────

describe('sanitizeForDisplay', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeForDisplay(null)).toBe('');
    expect(sanitizeForDisplay(undefined)).toBe('');
  });

  it('converts numbers to string', () => {
    expect(sanitizeForDisplay(42)).toBe('42');
  });

  it('escapes HTML in strings', () => {
    const result = sanitizeForDisplay('<script>alert(1)</script>');
    expect(result).not.toContain('<script>');
  });

  it('limits string length', () => {
    const long = 'x'.repeat(2000);
    expect(sanitizeForDisplay(long).length).toBeLessThanOrEqual(1001);
  });
});

// ── sanitizeMetadata ───────────────────────────────────────────────

describe('sanitizeMetadata', () => {
  it('handles undefined', () => {
    expect(sanitizeMetadata(undefined as any)).toEqual({});
  });

  it('sanitizes string values with length limit', () => {
    const meta = sanitizeMetadata({ key: 'a'.repeat(2000) });
    expect(String(meta.key).length).toBeLessThanOrEqual(1001);
  });

  it('limits number of keys', () => {
    const bigMeta: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) {
      bigMeta[`key-${i}`] = 'value';
    }
    const result = sanitizeMetadata(bigMeta);
    expect(Object.keys(result).length).toBeLessThanOrEqual(100);
  });
});
