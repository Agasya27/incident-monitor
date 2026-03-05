/**
 * Web Worker for rule engine evaluation.
 *
 * Receives:
 *   SET_RULES  → compiles rules into AST (parse once)
 *   EVALUATE   → evaluates event batch against compiled ASTs
 *
 * Posts:
 *   RESULTS    → array of RuleResult
 *
 * Runs entirely off the main thread for sustained >200 events/sec.
 */

import { ASTRuleEvaluator } from '../lib/ast-rule-engine';
import type { Rule, NormalizedEvent, RuleResult } from '../types/events';

const evaluator = new ASTRuleEvaluator();

self.onmessage = (e: MessageEvent<{ type: string; rules?: Rule[]; events?: NormalizedEvent[] }>) => {
  const { type } = e.data;

  switch (type) {
    case 'SET_RULES': {
      if (e.data.rules) {
        evaluator.setRules(e.data.rules);
      }
      break;
    }
    case 'EVALUATE': {
      if (e.data.events) {
        const results: RuleResult[] = evaluator.evaluate(e.data.events);
        self.postMessage({ type: 'RESULTS', results });
      }
      break;
    }
    case 'RESET': {
      evaluator.reset();
      break;
    }
    default:
      break;
  }
};
