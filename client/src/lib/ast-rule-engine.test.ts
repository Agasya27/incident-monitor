import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildAST,
  evaluateAST,
  compileRule,
  TimeWindowTracker,
  ConsecutiveTracker,
  EscalationManager,
  ASTRuleEvaluator,
} from './ast-rule-engine';
import type { NormalizedEvent, Rule, ASTNode } from '../types/events';

const makeEvent = (overrides?: Partial<NormalizedEvent>): NormalizedEvent => ({
  id: 'evt-1',
  service: 'auth-service',
  severity: 'error',
  timestamp: Date.now(),
  message: 'Login failed',
  source: 'us-east',
  metadata: { region: 'us-east-1' },
  receivedAt: Date.now(),
  normalized: true,
  originalSchema: 'A',
  ...overrides,
});

// ── AST Construction ──────────────────────────────────────────────

describe('buildAST', () => {
  it('creates a COMPARE node for single condition', () => {
    const ast = buildAST([{ field: 'severity', operator: 'equals', value: 'error' }], 'AND');
    expect(ast.type).toBe('COMPARE');
  });

  it('creates an AND node for multiple conditions', () => {
    const ast = buildAST([
      { field: 'severity', operator: 'equals', value: 'error' },
      { field: 'service', operator: 'contains', value: 'auth' },
    ], 'AND');
    expect(ast.type).toBe('AND');
    if (ast.type === 'AND') expect(ast.children).toHaveLength(2);
  });

  it('creates an OR node', () => {
    const ast = buildAST([
      { field: 'severity', operator: 'equals', value: 'error' },
      { field: 'severity', operator: 'equals', value: 'critical' },
    ], 'OR');
    expect(ast.type).toBe('OR');
  });

  it('wraps negated conditions with NOT', () => {
    const ast = buildAST([
      { field: 'service', operator: 'equals', value: 'health-check', negate: true },
    ], 'AND');
    expect(ast.type).toBe('NOT');
    if (ast.type === 'NOT') expect(ast.child?.type).toBe('COMPARE');
  });

  it('handles empty conditions', () => {
    const ast = buildAST([], 'AND');
    expect(ast.type).toBe('COMPARE');
    if (ast.type === 'COMPARE') expect(ast.field).toBe('__always__');
  });
});

// ── AST Evaluation ────────────────────────────────────────────────

describe('evaluateAST', () => {
  it('evaluates equals operator', () => {
    const ast = buildAST([{ field: 'severity', operator: 'equals', value: 'error' }], 'AND');
    expect(evaluateAST(ast, makeEvent({ severity: 'error' }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ severity: 'info' }))).toBe(false);
  });

  it('evaluates not_equals operator', () => {
    const ast = buildAST([{ field: 'severity', operator: 'not_equals', value: 'info' }], 'AND');
    expect(evaluateAST(ast, makeEvent({ severity: 'error' }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ severity: 'info' }))).toBe(false);
  });

  it('evaluates contains operator (case-insensitive)', () => {
    const ast = buildAST([{ field: 'message', operator: 'contains', value: 'FAILED' }], 'AND');
    expect(evaluateAST(ast, makeEvent({ message: 'Login failed' }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ message: 'success' }))).toBe(false);
  });

  it('evaluates greater_than operator', () => {
    const ast = buildAST([{ field: 'timestamp', operator: 'greater_than', value: 100 }], 'AND');
    expect(evaluateAST(ast, makeEvent({ timestamp: 200 }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ timestamp: 50 }))).toBe(false);
  });

  it('evaluates less_than operator', () => {
    const ast = buildAST([{ field: 'timestamp', operator: 'less_than', value: 100 }], 'AND');
    expect(evaluateAST(ast, makeEvent({ timestamp: 50 }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ timestamp: 200 }))).toBe(false);
  });

  it('evaluates matches (regex) operator', () => {
    const ast = buildAST([{ field: 'message', operator: 'matches', value: 'fail.*' }], 'AND');
    expect(evaluateAST(ast, makeEvent({ message: 'failed to connect' }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ message: 'success' }))).toBe(false);
  });

  it('evaluates AND logic', () => {
    const ast = buildAST([
      { field: 'severity', operator: 'equals', value: 'error' },
      { field: 'service', operator: 'contains', value: 'auth' },
    ], 'AND');
    expect(evaluateAST(ast, makeEvent({ severity: 'error', service: 'auth-service' }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ severity: 'error', service: 'payment' }))).toBe(false);
  });

  it('evaluates OR logic', () => {
    const ast = buildAST([
      { field: 'severity', operator: 'equals', value: 'error' },
      { field: 'severity', operator: 'equals', value: 'critical' },
    ], 'OR');
    expect(evaluateAST(ast, makeEvent({ severity: 'error' }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ severity: 'critical' }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ severity: 'info' }))).toBe(false);
  });

  it('evaluates NOT logic (negation)', () => {
    const ast = buildAST([
      { field: 'service', operator: 'contains', value: 'health', negate: true },
    ], 'AND');
    expect(evaluateAST(ast, makeEvent({ service: 'auth' }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ service: 'health-check' }))).toBe(false);
  });

  it('evaluates combined AND with NOT', () => {
    const ast = buildAST([
      { field: 'severity', operator: 'equals', value: 'error' },
      { field: 'service', operator: 'equals', value: 'health', negate: true },
    ], 'AND');
    expect(evaluateAST(ast, makeEvent({ severity: 'error', service: 'auth' }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ severity: 'error', service: 'health' }))).toBe(false);
  });

  it('handles metadata fields with dot notation', () => {
    const ast = buildAST([{ field: 'metadata.region', operator: 'equals', value: 'us-east-1' }], 'AND');
    expect(evaluateAST(ast, makeEvent({ metadata: { region: 'us-east-1' } }))).toBe(true);
    expect(evaluateAST(ast, makeEvent({ metadata: { region: 'eu-west-1' } }))).toBe(false);
  });
});

// ── compileRule ─────────────────────────────────────────────────────

describe('compileRule', () => {
  it('parses once and allows multiple evaluations', () => {
    const rule: Rule = {
      id: 'r1', name: 'Test', enabled: true,
      conditions: [{ field: 'severity', operator: 'equals', value: 'error' }],
      logic: 'AND', timeWindowSeconds: 60, threshold: 1,
      consecutiveCount: 0, escalationSeverity: 'critical', action: 'alert',
    };
    const compiled = compileRule(rule);
    expect(compiled.ast).toBeDefined();
    expect(compiled.rule.id).toBe('r1');

    // Evaluate multiple times with same AST
    expect(evaluateAST(compiled.ast, makeEvent({ severity: 'error' }))).toBe(true);
    expect(evaluateAST(compiled.ast, makeEvent({ severity: 'info' }))).toBe(false);
    expect(evaluateAST(compiled.ast, makeEvent({ severity: 'error' }))).toBe(true);
  });
});

// ── TimeWindowTracker ──────────────────────────────────────────────

describe('TimeWindowTracker', () => {
  let tracker: TimeWindowTracker;

  beforeEach(() => {
    tracker = new TimeWindowTracker();
  });

  it('tracks count aggregation', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      tracker.recordMatch('r1', now - i * 100);
    }
    const result = tracker.evaluate('r1', 10, 3, 'count', now);
    expect(result.triggered).toBe(true);
    expect(result.matchCount).toBe(5);
  });

  it('respects window boundary', () => {
    const now = Date.now();
    // Record matches outside the window
    for (let i = 0; i < 5; i++) {
      tracker.recordMatch('r1', now - 120000); // 2 minutes ago
    }
    const result = tracker.evaluate('r1', 60, 1, 'count', now);
    expect(result.triggered).toBe(false);
  });

  it('tracks sum aggregation', () => {
    const now = Date.now();
    tracker.recordMatch('r1', now, 10);
    tracker.recordMatch('r1', now - 100, 20);
    tracker.recordMatch('r1', now - 200, 30);

    const result = tracker.evaluate('r1', 60, 50, 'sum', now);
    expect(result.triggered).toBe(true); // sum = 60 >= 50
  });

  it('tracks avg aggregation', () => {
    const now = Date.now();
    tracker.recordMatch('r1', now, 10);
    tracker.recordMatch('r1', now - 100, 20);
    tracker.recordMatch('r1', now - 200, 30);

    const result = tracker.evaluate('r1', 60, 20, 'avg', now);
    expect(result.triggered).toBe(true); // avg = 20 >= 20
  });

  it('returns false for unknown rule', () => {
    const result = tracker.evaluate('unknown', 60, 1, 'count');
    expect(result.triggered).toBe(false);
  });

  it('resets all windows', () => {
    tracker.recordMatch('r1', Date.now());
    tracker.reset();
    const result = tracker.evaluate('r1', 60, 1, 'count');
    expect(result.triggered).toBe(false);
  });
});

// ── ConsecutiveTracker ─────────────────────────────────────────────

describe('ConsecutiveTracker', () => {
  let tracker: ConsecutiveTracker;

  beforeEach(() => {
    tracker = new ConsecutiveTracker();
  });

  it('counts consecutive matches', () => {
    tracker.recordMatch('r1');
    tracker.recordMatch('r1');
    tracker.recordMatch('r1');
    expect(tracker.getCount('r1')).toBe(3);
  });

  it('resets on miss', () => {
    tracker.recordMatch('r1');
    tracker.recordMatch('r1');
    tracker.recordMiss('r1');
    expect(tracker.getCount('r1')).toBe(0);
  });

  it('tracks rules independently', () => {
    tracker.recordMatch('r1');
    tracker.recordMatch('r2');
    tracker.recordMatch('r2');
    expect(tracker.getCount('r1')).toBe(1);
    expect(tracker.getCount('r2')).toBe(2);
  });

  it('resets all counters', () => {
    tracker.recordMatch('r1');
    tracker.reset();
    expect(tracker.getCount('r1')).toBe(0);
  });
});

// ── EscalationManager ─────────────────────────────────────────────

describe('EscalationManager', () => {
  let manager: EscalationManager;

  beforeEach(() => {
    manager = new EscalationManager();
  });

  it('returns base severity without chain', () => {
    const sev = manager.getEscalatedSeverity('r1', undefined, 'warning');
    expect(sev).toBe('warning');
  });

  it('returns first level on initial trigger', () => {
    const chain = { levels: ['warning' as const, 'error' as const, 'critical' as const], cooldownMs: 1000 };
    const sev = manager.getEscalatedSeverity('r1', chain, 'info');
    expect(sev).toBe('warning');
  });

  it('stays at current level within cooldown', () => {
    const chain = { levels: ['warning' as const, 'error' as const], cooldownMs: 60000 };
    manager.getEscalatedSeverity('r1', chain, 'info');
    const sev = manager.getEscalatedSeverity('r1', chain, 'info');
    expect(sev).toBe('warning'); // Still within cooldown
  });

  it('resets a specific rule', () => {
    const chain = { levels: ['warning' as const, 'error' as const], cooldownMs: 0 };
    manager.getEscalatedSeverity('r1', chain, 'info');
    manager.resetRule('r1');
    const sev = manager.getEscalatedSeverity('r1', chain, 'info');
    expect(sev).toBe('warning'); // Reset back to first level
  });
});

// ── ASTRuleEvaluator (integration) ────────────────────────────────

describe('ASTRuleEvaluator', () => {
  let evaluator: ASTRuleEvaluator;

  const makeRule = (overrides?: Partial<Rule>): Rule => ({
    id: 'rule-1',
    name: 'Test Rule',
    enabled: true,
    conditions: [{ field: 'severity', operator: 'equals', value: 'error' }],
    logic: 'AND',
    timeWindowSeconds: 60,
    threshold: 1,
    consecutiveCount: 0,
    escalationSeverity: 'critical',
    action: 'alert',
    ...overrides,
  });

  beforeEach(() => {
    evaluator = new ASTRuleEvaluator();
  });

  it('evaluates matching events', () => {
    evaluator.setRules([makeRule()]);
    const results = evaluator.evaluate([makeEvent({ severity: 'error' })]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].triggered).toBe(true);
  });

  it('skips disabled rules', () => {
    evaluator.setRules([makeRule({ enabled: false })]);
    const results = evaluator.evaluate([makeEvent({ severity: 'error' })]);
    expect(results).toHaveLength(0);
  });

  it('handles multiple rules', () => {
    evaluator.setRules([
      makeRule({ id: 'r1', conditions: [{ field: 'severity', operator: 'equals', value: 'error' }] }),
      makeRule({ id: 'r2', conditions: [{ field: 'severity', operator: 'equals', value: 'critical' }] }),
    ]);
    const results = evaluator.evaluate([makeEvent({ severity: 'error' })]);
    const triggered = results.filter(r => r.triggered);
    expect(triggered.length).toBe(1);
    expect(triggered[0].ruleId).toBe('r1');
  });

  it('resets trackers', () => {
    evaluator.setRules([makeRule()]);
    evaluator.evaluate([makeEvent({ severity: 'error' })]);
    evaluator.reset();
    // After reset, time window should not have prior matches,
    // so a single event should still trigger (threshold=1)
    evaluator.setRules([makeRule({ threshold: 5 })]);
    const results = evaluator.evaluate([makeEvent({ severity: 'error' })]);
    // Should NOT trigger because threshold=5 and we only sent 1 event post-reset
    expect(results.filter(r => r.triggered)).toHaveLength(0);
  });

  it('handles NOT conditions end-to-end', () => {
    evaluator.setRules([makeRule({
      conditions: [
        { field: 'severity', operator: 'equals', value: 'error' },
        { field: 'service', operator: 'contains', value: 'health', negate: true },
      ],
    })]);

    const results1 = evaluator.evaluate([makeEvent({ severity: 'error', service: 'auth' })]);
    expect(results1.some(r => r.triggered)).toBe(true);

    // Reset and test with excluded service
    evaluator.reset();
    evaluator.setRules([makeRule({
      conditions: [
        { field: 'severity', operator: 'equals', value: 'error' },
        { field: 'service', operator: 'contains', value: 'health', negate: true },
      ],
    })]);
    const results2 = evaluator.evaluate([makeEvent({ severity: 'error', service: 'health-check' })]);
    expect(results2.filter(r => r.triggered)).toHaveLength(0);
  });
});
