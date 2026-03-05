/**
 * AST-based Rule Engine
 *
 * Implements a full AST interpreter supporting:
 *   AND, OR, NOT, comparators (>, <, =, contains, regex)
 *
 * Features:
 *   - Rule compilation: parse once, evaluate many
 *   - Time window aggregation: count, sum, avg
 *   - Consecutive event evaluation
 *   - Severity escalation chains with cooldown
 *   - No eval() or third-party rule libraries
 */

import type {
  ASTNode,
  Rule,
  RuleCondition,
  RuleResult,
  NormalizedEvent,
  Severity,
  AggregationType,
  EscalationChain,
} from '../types/events';
import { safeRegex } from './sanitizer';

// ── AST Construction ──────────────────────────────────────────────

export function buildAST(conditions: RuleCondition[], logic: 'AND' | 'OR'): ASTNode {
  if (conditions.length === 0) {
    // Empty condition set always matches
    return { type: 'COMPARE', field: '__always__', operator: 'equals', value: '__always__' };
  }

  const compareNodes: ASTNode[] = conditions.map((cond) => {
    const compareNode: ASTNode = {
      type: 'COMPARE',
      field: cond.field,
      operator: cond.operator,
      value: cond.value,
      compiledRegex: cond.operator === 'matches' ? (safeRegex(String(cond.value)) ?? undefined) : undefined,
    };
    // Wrap with NOT if negated
    if (cond.negate) {
      return { type: 'NOT' as const, child: compareNode };
    }
    return compareNode;
  });

  if (compareNodes.length === 1) return compareNodes[0];

  return { type: logic, children: compareNodes };
}

// ── AST Evaluation ────────────────────────────────────────────────

function getEventField(event: NormalizedEvent, field: string): unknown {
  if (field === '__always__') return '__always__';
  // Support dot notation for metadata fields
  if (field.startsWith('metadata.')) {
    const metaKey = field.slice(9);
    return event.metadata?.[metaKey];
  }
  return (event as unknown as Record<string, unknown>)[field];
}

export function evaluateAST(node: ASTNode, event: NormalizedEvent): boolean {
  switch (node.type) {
    case 'AND':
      return node.children.every((child) => evaluateAST(child, event));
    case 'OR':
      return node.children.some((child) => evaluateAST(child, event));
    case 'NOT':
      return !evaluateAST(node.child, event);
    case 'COMPARE': {
      const fieldValue = getEventField(event, node.field);
      return evaluateCompare(fieldValue, node.operator, node.value, node.compiledRegex);
    }
    default:
      return false;
  }
}

function evaluateCompare(
  fieldValue: unknown,
  operator: string,
  ruleValue: string | number,
  compiledRegex?: RegExp
): boolean {
  if (fieldValue === undefined || fieldValue === null) return false;

  const strField = String(fieldValue);
  const strRule = String(ruleValue);

  switch (operator) {
    case 'equals':
      return strField === strRule;
    case 'not_equals':
      return strField !== strRule;
    case 'contains':
      return strField.toLowerCase().includes(strRule.toLowerCase());
    case 'greater_than': {
      const numField = Number(fieldValue);
      const numRule = Number(ruleValue);
      return !isNaN(numField) && !isNaN(numRule) && numField > numRule;
    }
    case 'less_than': {
      const numField = Number(fieldValue);
      const numRule = Number(ruleValue);
      return !isNaN(numField) && !isNaN(numRule) && numField < numRule;
    }
    case 'matches': {
      if (compiledRegex) return compiledRegex.test(strField);
      const re = safeRegex(strRule);
      return re ? re.test(strField) : false;
    }
    default:
      return false;
  }
}

// ── Compiled Rule ─────────────────────────────────────────────────

export interface CompiledRule {
  rule: Rule;
  ast: ASTNode;
}

export function compileRule(rule: Rule): CompiledRule {
  const ast = buildAST(rule.conditions, rule.logic);
  return { rule, ast };
}

// ── Time Window Tracker (count / sum / avg) ───────────────────────

export class TimeWindowTracker {
  private windows: Map<string, { timestamps: number[]; values: number[] }> = new Map();

  recordMatch(ruleId: string, timestamp: number, value?: number): void {
    let window = this.windows.get(ruleId);
    if (!window) {
      window = { timestamps: [], values: [] };
      this.windows.set(ruleId, window);
    }
    window.timestamps.push(timestamp);
    window.values.push(value ?? 1);

    // Max 5000 entries per rule
    if (window.timestamps.length > 5000) {
      window.timestamps = window.timestamps.slice(-2500);
      window.values = window.values.slice(-2500);
    }
  }

  evaluate(
    ruleId: string,
    windowSeconds: number,
    threshold: number,
    aggregation: AggregationType = 'count',
    now?: number
  ): { triggered: boolean; matchCount: number } {
    const window = this.windows.get(ruleId);
    if (!window) return { triggered: false, matchCount: 0 };

    const cutoff = (now ?? Date.now()) - windowSeconds * 1000;
    const validIndices: number[] = [];
    for (let i = 0; i < window.timestamps.length; i++) {
      if (window.timestamps[i] >= cutoff) validIndices.push(i);
    }

    if (validIndices.length === 0) return { triggered: false, matchCount: 0 };

    let result: number;
    switch (aggregation) {
      case 'count':
        result = validIndices.length;
        break;
      case 'sum':
        result = validIndices.reduce((acc, i) => acc + window.values[i], 0);
        break;
      case 'avg':
        result = validIndices.reduce((acc, i) => acc + window.values[i], 0) / validIndices.length;
        break;
      default:
        result = validIndices.length;
    }

    return { triggered: result >= threshold, matchCount: validIndices.length };
  }

  reset(): void {
    this.windows.clear();
  }
}

// ── Consecutive Tracker ───────────────────────────────────────────

export class ConsecutiveTracker {
  private counters: Map<string, number> = new Map();

  recordMatch(ruleId: string): number {
    const current = (this.counters.get(ruleId) || 0) + 1;
    this.counters.set(ruleId, current);
    return current;
  }

  recordMiss(ruleId: string): void {
    this.counters.set(ruleId, 0);
  }

  getCount(ruleId: string): number {
    return this.counters.get(ruleId) || 0;
  }

  reset(): void {
    this.counters.clear();
  }
}

// ── Escalation Manager ───────────────────────────────────────────

interface EscalationState {
  currentLevelIndex: number;
  lastEscalatedAt: number;
  triggerCount: number;
}

export class EscalationManager {
  private states: Map<string, EscalationState> = new Map();

  getEscalatedSeverity(ruleId: string, chain: EscalationChain | undefined, baseSeverity: Severity): Severity {
    if (!chain || chain.levels.length === 0) return baseSeverity;

    let state = this.states.get(ruleId);
    const now = Date.now();

    if (!state) {
      state = { currentLevelIndex: 0, lastEscalatedAt: now, triggerCount: 1 };
      this.states.set(ruleId, state);
      return chain.levels[0] || baseSeverity;
    }

    state.triggerCount++;

    // Check cooldown
    if (now - state.lastEscalatedAt > chain.cooldownMs) {
      // Cooldown expired → escalate if possible
      if (state.currentLevelIndex < chain.levels.length - 1) {
        state.currentLevelIndex++;
        state.lastEscalatedAt = now;
      }
    }

    return chain.levels[state.currentLevelIndex] || baseSeverity;
  }

  resetRule(ruleId: string): void {
    this.states.delete(ruleId);
  }

  reset(): void {
    this.states.clear();
  }
}

// ── Main Rule Evaluator ───────────────────────────────────────────

export class ASTRuleEvaluator {
  private compiledRules: CompiledRule[] = [];
  private timeWindowTracker = new TimeWindowTracker();
  private consecutiveTracker = new ConsecutiveTracker();
  private escalationManager = new EscalationManager();

  setRules(rules: Rule[]): void {
    this.compiledRules = rules.filter((r) => r.enabled).map(compileRule);
  }

  evaluate(events: NormalizedEvent[]): RuleResult[] {
    const results: RuleResult[] = [];
    const now = Date.now();

    for (const compiled of this.compiledRules) {
      const { rule, ast } = compiled;
      const matchedEvents: string[] = [];

      for (const event of events) {
        const matches = evaluateAST(ast, event);

        if (matches) {
          matchedEvents.push(event.id);

          // Track for time window aggregation
          const aggField = rule.aggregationField;
          const aggValue = aggField
            ? Number((event as unknown as Record<string, unknown>)[aggField] ?? event.metadata?.[aggField] ?? 1)
            : 1;
          this.timeWindowTracker.recordMatch(rule.id, event.timestamp, isNaN(aggValue) ? 1 : aggValue);

          // Track consecutive
          this.consecutiveTracker.recordMatch(rule.id);
        } else {
          this.consecutiveTracker.recordMiss(rule.id);
        }
      }

      // Check time window (skip if timeWindowSeconds is 0 — consecutive-only rule)
      const aggregation: AggregationType = rule.aggregation || 'count';
      const hasTimeWindow = rule.timeWindowSeconds > 0;
      const windowTriggered = hasTimeWindow
        ? this.timeWindowTracker.evaluate(
            rule.id,
            rule.timeWindowSeconds,
            rule.threshold || 1,
            aggregation,
            now
          ).triggered
        : matchedEvents.length > 0;

      // Check consecutive
      const consecutiveOk =
        !rule.consecutiveCount || this.consecutiveTracker.getCount(rule.id) >= rule.consecutiveCount;

      const triggered = windowTriggered && consecutiveOk && matchedEvents.length > 0;

      if (triggered) {
        // Determine severity (with escalation chain)
        const severity = this.escalationManager.getEscalatedSeverity(
          rule.id,
          rule.escalationChain,
          rule.escalationSeverity
        );

        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          triggered: true,
          triggeredAt: now,
          matchedEvents,
          severity,
          action: rule.action,
        });
      }
    }

    return results;
  }

  reset(): void {
    this.timeWindowTracker.reset();
    this.consecutiveTracker.reset();
    this.escalationManager.reset();
  }
}
