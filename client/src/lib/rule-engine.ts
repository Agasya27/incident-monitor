import type { Rule } from '../types/events';

export function getDefaultRules(): Rule[] {
  return [
    {
      id: 'rule-1',
      name: 'Auth Service Critical',
      enabled: true,
      conditions: [
        { field: 'service', operator: 'equals', value: 'auth' },
        { field: 'severity', operator: 'equals', value: 'error' },
      ],
      logic: 'AND',
      timeWindowSeconds: 10,
      threshold: 5,
      consecutiveCount: 0,
      escalationSeverity: 'critical',
      action: 'Escalate to on-call',
    },
    {
      id: 'rule-2',
      name: 'Consecutive Timeouts',
      enabled: true,
      conditions: [
        { field: 'message', operator: 'contains', value: 'timeout' },
      ],
      logic: 'AND',
      timeWindowSeconds: 0,
      threshold: 0,
      consecutiveCount: 3,
      escalationSeverity: 'critical',
      action: 'Alert infrastructure team',
    },
    {
      id: 'rule-3',
      name: 'High Error Rate',
      enabled: true,
      conditions: [
        { field: 'severity', operator: 'equals', value: 'error' },
      ],
      logic: 'AND',
      timeWindowSeconds: 30,
      threshold: 20,
      consecutiveCount: 0,
      escalationSeverity: 'warning',
      action: 'Monitor closely',
    },
    {
      id: 'rule-4',
      name: 'Database Service Down',
      enabled: true,
      conditions: [
        { field: 'service', operator: 'equals', value: 'database' },
        { field: 'severity', operator: 'equals', value: 'critical' },
      ],
      logic: 'AND',
      timeWindowSeconds: 5,
      threshold: 2,
      consecutiveCount: 0,
      escalationSeverity: 'critical',
      action: 'Page database admin',
    },
  ];
}
