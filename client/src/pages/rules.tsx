import { useState, useMemo } from 'react';
import { Shield, Plus, Trash2, Power, PowerOff, Zap, Clock, Layers, AlertTriangle, Ban, BarChart3 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorBoundary } from '@/components/error-boundary';
import { useStore } from '../store/use-store';
import { validateRuleExpression } from '../lib/sanitizer';
import type { Rule, RuleCondition, Severity, RuleOperator, AggregationType } from '../types/events';

const SEVERITY_COLORS: Record<Severity, string> = {
  info: 'bg-blue-500/8 text-blue-400 border-blue-500/15',
  warning: 'bg-amber-500/8 text-amber-400 border-amber-500/15',
  error: 'bg-orange-500/8 text-orange-400 border-orange-500/15',
  critical: 'bg-red-500/8 text-red-400 border-red-500/15',
};

const OPERATORS: { value: RuleOperator; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'greater_than', label: 'Greater Than' },
  { value: 'less_than', label: 'Less Than' },
  { value: 'matches', label: 'Regex Match' },
];

const FIELDS = ['service', 'severity', 'message', 'source'];

function RuleCard({ rule }: { rule: Rule }) {
  const updateRule = useStore((s) => s.updateRule);
  const removeRule = useStore((s) => s.removeRule);
  const ruleResults = useStore((s) => s.ruleResults);
  const isTriggered = ruleResults.some(r => r.ruleId === rule.id && r.triggered);

  return (
    <Card
      className={`p-4 transition-colors border-border/50 ${
        isTriggered ? 'ring-1 ring-red-500/20' : ''
      } ${!rule.enabled ? 'opacity-50' : ''}`}
      data-testid={`card-rule-${rule.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-2.5">
          {/* Header */}
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[13px] font-medium">{rule.name}</h3>
            <span className={`px-1.5 py-0 rounded-[3px] text-[10px] font-medium border ${SEVERITY_COLORS[rule.escalationSeverity]}`}>
              {rule.escalationSeverity}
            </span>
            {isTriggered && (
              <Badge variant="destructive" className="text-[9px] px-1.5 py-0 animate-pulse gap-1 rounded-full">
                <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
                ACTIVE
              </Badge>
            )}
          </div>

          {/* Conditions */}
          <div className="space-y-0.5 bg-muted/20 rounded-[5px] p-2.5 border border-border/50">
            {rule.conditions.map((c, i) => (
              <div key={i} className="text-[11px] font-mono text-muted-foreground">
                {i > 0 && <span className="text-primary font-bold mr-1">{rule.logic}</span>}
                {c.negate && <span className="text-red-400 font-bold mr-1">NOT</span>}
                <span className="text-foreground/80">{c.field}</span>
                <span className="text-primary/70 mx-1">{c.operator}</span>
                <span className="text-foreground">"{c.value}"</span>
              </div>
            ))}
          </div>

          {/* Params */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
            {rule.aggregation && (
              <span className="flex items-center gap-1">
                <BarChart3 className="w-3 h-3" aria-hidden="true" />
                {rule.aggregation}({rule.aggregationField || 'count'})
              </span>
            )}
            {rule.timeWindowSeconds > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" aria-hidden="true" />
                {rule.timeWindowSeconds}s window
              </span>
            )}
            {rule.threshold > 0 && (
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" aria-hidden="true" />
                {rule.threshold} threshold
              </span>
            )}
            {rule.consecutiveCount > 0 && (
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3" aria-hidden="true" />
                {rule.consecutiveCount} consecutive
              </span>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground/60 italic">Action: {rule.action}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded"
            onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
            data-testid={`button-toggle-rule-${rule.id}`}
            aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
          >
            {rule.enabled ? (
              <Power className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <PowerOff className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded hover:text-destructive"
            onClick={() => { if (window.confirm(`Delete rule "${rule.name}"?`)) removeRule(rule.id); }}
            data-testid={`button-delete-rule-${rule.id}`}
            aria-label="Delete rule"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function RuleBuilder() {
  const addRule = useStore((s) => s.addRule);
  const [name, setName] = useState('');
  const [conditions, setConditions] = useState<RuleCondition[]>([
    { field: 'service', operator: 'equals', value: '', negate: false },
  ]);
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [timeWindow, setTimeWindow] = useState('10');
  const [threshold, setThreshold] = useState('5');
  const [consecutive, setConsecutive] = useState('0');
  const [escalationSeverity, setEscalationSeverity] = useState<Severity>('critical');
  const [action, setAction] = useState('');
  const [aggregation, setAggregation] = useState<AggregationType | ''>('');
  const [aggregationField, setAggregationField] = useState('');

  // Validate all condition values
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    for (const c of conditions) {
      if (c.value && typeof c.value === 'string') {
        const result = validateRuleExpression(c.value);
        if (!result.valid && result.error) {
          errors.push(`Condition "${c.field}": ${result.error}`);
        }
      }
    }
    return errors;
  }, [conditions]);

  const addCondition = () => {
    setConditions([...conditions, { field: 'service', operator: 'equals', value: '', negate: false }]);
  };

  const removeCondition = (index: number) => {
    if (conditions.length <= 1) return;
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, update: Partial<RuleCondition>) => {
    setConditions(conditions.map((c, i) => i === index ? { ...c, ...update } : c));
  };

  const handleSubmit = () => {
    if (!name.trim() || validationErrors.length > 0) return;

    const rule: Rule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      name: name.trim(),
      enabled: true,
      conditions: conditions.filter(c => c.value !== ''),
      logic,
      timeWindowSeconds: parseInt(timeWindow) || 0,
      threshold: parseInt(threshold) || 0,
      consecutiveCount: parseInt(consecutive) || 0,
      escalationSeverity,
      action: action.trim() || 'No action specified',
      ...(aggregation ? { aggregation: aggregation as AggregationType, aggregationField: aggregationField || undefined } : {}),
    };

    addRule(rule);
    setName('');
    setConditions([{ field: 'service', operator: 'equals', value: '', negate: false }]);
    setAction('');
    setAggregation('');
    setAggregationField('');

    useStore.getState().addAuditEntry({
      action: `Rule created: ${rule.name}`,
      details: `ID: ${rule.id}, Severity: ${rule.escalationSeverity}`,
      category: 'user',
    });
  };

  return (
    <Card className="panel-section overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60">
        <Plus className="w-3.5 h-3.5 text-muted-foreground/50" aria-hidden="true" />
        <h3 className="text-[13px] font-medium">Create Rule</h3>
      </div>

      <div className="p-4 space-y-4">
        {/* Name + Action */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs font-medium" htmlFor="rule-name">Rule Name</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Auth Service Critical"
              className="mt-1.5 h-9"
              data-testid="input-rule-name"
            />
          </div>
          <div>
            <Label className="text-xs font-medium" htmlFor="rule-action">Action</Label>
            <Input
              id="rule-action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g., Page on-call engineer"
              className="mt-1.5 h-9"
              data-testid="input-rule-action"
            />
          </div>
        </div>

        <Separator />

        {/* Conditions */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-3">
            <Label className="text-xs font-medium">Conditions</Label>
            <div className="flex items-center gap-2">
              <Select value={logic} onValueChange={(v) => setLogic(v as 'AND' | 'OR')}>
                <SelectTrigger className="h-7 w-20 text-xs" data-testid="select-logic">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AND">AND</SelectItem>
                  <SelectItem value="OR">OR</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="secondary" onClick={addCondition} className="h-7 text-xs gap-1" data-testid="button-add-condition">
                <Plus className="w-3 h-3" aria-hidden="true" />
                Add
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {conditions.map((condition, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap p-2 rounded-[5px] bg-muted/20 border border-border/50">
                <div className="flex items-center gap-1.5" title="Negate this condition (NOT)">
                  <Checkbox
                    id={`negate-${i}`}
                    checked={condition.negate || false}
                    onCheckedChange={(checked) => updateCondition(i, { negate: !!checked })}
                    data-testid={`checkbox-negate-${i}`}
                    aria-label="Negate condition"
                  />
                  <label htmlFor={`negate-${i}`} className="text-[10px] text-red-400 font-semibold cursor-pointer select-none">
                    NOT
                  </label>
                </div>
                <Select value={condition.field} onValueChange={(v) => updateCondition(i, { field: v })}>
                  <SelectTrigger className="h-8 w-24 sm:w-28 text-xs" data-testid={`select-field-${i}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELDS.map(f => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={condition.operator} onValueChange={(v) => updateCondition(i, { operator: v as RuleOperator })}>
                  <SelectTrigger className="h-8 w-28 sm:w-32 text-xs" data-testid={`select-operator-${i}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map(op => (
                      <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={String(condition.value)}
                  onChange={(e) => updateCondition(i, { value: e.target.value })}
                  placeholder="Value"
                  className="h-8 flex-1 min-w-[100px] sm:min-w-[120px] text-xs"
                  data-testid={`input-condition-value-${i}`}
                />
                {conditions.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeCondition(i)}
                    className="h-8 w-8 hover:text-destructive"
                    data-testid={`button-remove-condition-${i}`}
                    aria-label="Remove condition"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-md p-2 space-y-1" role="alert">
              {validationErrors.map((err, i) => (
                <p key={i} className="text-[11px] text-red-400 flex items-center gap-1">
                  <Ban className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                  {err}
                </p>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Parameters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <Label className="text-xs font-medium flex items-center gap-1" htmlFor="time-window">
              <Clock className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
              Window (s)
            </Label>
            <Input
              id="time-window"
              type="number"
              value={timeWindow}
              onChange={(e) => setTimeWindow(e.target.value)}
              className="mt-1.5 h-9"
              min="0"
              data-testid="input-time-window"
            />
          </div>
          <div>
            <Label className="text-xs font-medium flex items-center gap-1" htmlFor="threshold">
              <Zap className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
              Threshold
            </Label>
            <Input
              id="threshold"
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="mt-1.5 h-9"
              min="0"
              data-testid="input-threshold"
            />
          </div>
          <div>
            <Label className="text-xs font-medium flex items-center gap-1" htmlFor="consecutive">
              <Layers className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
              Consecutive
            </Label>
            <Input
              id="consecutive"
              type="number"
              value={consecutive}
              onChange={(e) => setConsecutive(e.target.value)}
              className="mt-1.5 h-9"
              min="0"
              data-testid="input-consecutive"
            />
          </div>
          <div>
            <Label className="text-xs font-medium flex items-center gap-1" htmlFor="aggregation">
              <BarChart3 className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
              Aggregation
            </Label>
            <Select value={aggregation} onValueChange={(v) => setAggregation(v === 'none' ? '' : v as AggregationType | '')}>
              <SelectTrigger className="mt-1.5 h-9" data-testid="select-aggregation">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="count">Count</SelectItem>
                <SelectItem value="sum">Sum</SelectItem>
                <SelectItem value="avg">Average</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium flex items-center gap-1" htmlFor="agg-field">
              Agg Field
            </Label>
            <Input
              id="agg-field"
              value={aggregationField}
              onChange={(e) => setAggregationField(e.target.value)}
              placeholder="e.g., severity"
              className="mt-1.5 h-9"
              data-testid="input-agg-field"
            />
          </div>
          <div>
            <Label className="text-xs font-medium flex items-center gap-1" htmlFor="escalation">
              <AlertTriangle className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
              Escalation
            </Label>
            <Select value={escalationSeverity} onValueChange={(v) => setEscalationSeverity(v as Severity)}>
              <SelectTrigger className="mt-1.5 h-9" data-testid="select-escalation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Submit */}
        <Button onClick={handleSubmit} disabled={!name.trim() || validationErrors.length > 0} className="gap-1.5 font-medium text-xs" data-testid="button-create-rule">
          <Shield className="w-3.5 h-3.5" aria-hidden="true" />
          Create Rule
        </Button>
      </div>
    </Card>
  );
}

export default function RulesPage() {
  const rules = useStore((s) => s.rules);
  const ruleResults = useStore((s) => s.ruleResults);
  const activeCount = ruleResults.filter(r => r.triggered).length;

  return (
    <div className="app-page" role="region" aria-label="Rule engine management">
      <div className="page-container space-y-4 sm:space-y-5">
        <div className="pb-2 border-b border-border/50">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary/90 mb-1">Rule engine</p>
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Detection Rules</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            {rules.length} rules configured · <span className="font-medium text-foreground/80">{activeCount}</span> active
          </p>
        </div>

        <ErrorBoundary section="Rule Builder">
          <RuleBuilder />
        </ErrorBoundary>

        <div className="space-y-3">
          <h3 className="text-[12px] font-medium text-muted-foreground">Active Rules</h3>
          {rules.length === 0 ? (
            <Card className="panel-section p-12 border-border/50">
              <div className="flex flex-col items-center text-center gap-5">
                <div className="rounded-2xl bg-primary/10 p-4">
                  <Shield className="w-12 h-12 text-primary/70" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground/90">No rules configured</p>
                  <p className="text-xs text-muted-foreground mt-1">Create a rule above to start monitoring incidents</p>
                </div>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              {rules.map(rule => (
                <ErrorBoundary key={rule.id} section={`Rule: ${rule.name}`}>
                  <RuleCard rule={rule} />
                </ErrorBoundary>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
