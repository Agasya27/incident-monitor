import { useState, useMemo, useCallback, useRef } from 'react';
import { List } from 'react-window';
import { Clock, Search, Filter, Download, FileJson, FileSpreadsheet, Database, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorBoundary } from '@/components/error-boundary';
import { useStore } from '../store/use-store';
import type { NormalizedEvent, Severity } from '../types/events';

const SEVERITY_COLORS: Record<Severity, string> = {
  info: 'bg-blue-500/8 text-blue-400 border-blue-500/15',
  warning: 'bg-amber-500/8 text-amber-400 border-amber-500/15',
  error: 'bg-orange-500/8 text-orange-400 border-orange-500/15',
  critical: 'bg-red-500/8 text-red-400 border-red-500/15',
};

const SEVERITY_DOT: Record<Severity, string> = {
  info: 'bg-blue-500',
  warning: 'bg-amber-500',
  error: 'bg-orange-500',
  critical: 'bg-red-500',
};

const SEVERITY_ORDER: Record<string, number> = { info: 0, warning: 1, error: 2, critical: 3 };

type SortField = 'timestamp' | 'service' | 'severity' | 'message' | 'source';
type SortDir = 'asc' | 'desc';

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    hour12: false,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function HistoryRow({ index, style, events, focusedIndex, onFocus }: {
  index: number;
  style: React.CSSProperties;
  events: NormalizedEvent[];
  focusedIndex: number;
  onFocus: (index: number) => void;
}) {
  const event = events[index];
  if (!event) return null;
  const isFocused = index === focusedIndex;

  return (
    <div
      style={style}
      className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 border-b border-border/40 text-[12px] hover:bg-muted/20 transition-colors cursor-pointer ${
        isFocused ? 'bg-muted/30 ring-1 ring-primary/40 ring-inset' : ''
      }`}
      data-testid={`row-history-${event.id}`}
      role="row"
      tabIndex={isFocused ? 0 : -1}
      aria-selected={isFocused}
      onFocus={() => onFocus(index)}
    >
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[event.severity]}`} aria-hidden="true" />
      <span className="font-mono text-muted-foreground w-28 sm:w-36 flex-shrink-0 tabular-nums">
        {formatTimestamp(event.timestamp)}
      </span>
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono flex-shrink-0 hidden sm:inline-flex rounded-[3px]">
        {event.service}
      </Badge>
      <span className={`px-1.5 py-0 rounded-[3px] text-[10px] font-medium flex-shrink-0 border ${SEVERITY_COLORS[event.severity]}`}>
        {event.severity}
      </span>
      <span className="truncate text-muted-foreground flex-1 min-w-0">{event.message}</span>
      <span className="text-muted-foreground/60 font-mono text-[10px] flex-shrink-0 w-16 sm:w-20 text-right hidden md:inline">
        {event.source}
      </span>
      <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono flex-shrink-0 opacity-40 hidden lg:inline-flex">
        {event.originalSchema}
      </Badge>
    </div>
  );
}

/* ── Sortable Column Header ── */
function SortHeader({ label, field, sortField, sortDir, onSort, className }: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  className?: string;
}) {
  const isActive = sortField === field;
  return (
    <button
      className={`flex items-center gap-0.5 hover:text-foreground transition-colors ${className || ''}`}
      onClick={() => onSort(field)}
      aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      {isActive ? (
        sortDir === 'asc' ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />
      ) : (
        <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />
      )}
    </button>
  );
}

export default function HistoryPage() {
  const events = useStore((s) => s.events);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listContainerRef = useRef<HTMLDivElement>(null);

  const services = useMemo(() => {
    const set = new Set(events.map(e => e.service));
    return Array.from(set).sort();
  }, [events]);

  const handleSort = useCallback((field: SortField) => {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }, [sortField]);

  const filteredEvents = useMemo(() => {
    let result = [...events];

    if (search) {
      const lower = search.toLowerCase();
      result = result.filter(e =>
        e.message.toLowerCase().includes(lower) ||
        e.service.toLowerCase().includes(lower) ||
        e.id.toLowerCase().includes(lower) ||
        e.source.toLowerCase().includes(lower)
      );
    }

    if (severityFilter !== 'all') {
      result = result.filter(e => e.severity === severityFilter);
    }

    if (serviceFilter !== 'all') {
      result = result.filter(e => e.service === serviceFilter);
    }

    // Sort
    const dir = sortDir === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      switch (sortField) {
        case 'timestamp': return (a.timestamp - b.timestamp) * dir;
        case 'service': return a.service.localeCompare(b.service) * dir;
        case 'severity': return ((SEVERITY_ORDER[a.severity] || 0) - (SEVERITY_ORDER[b.severity] || 0)) * dir;
        case 'message': return a.message.localeCompare(b.message) * dir;
        case 'source': return a.source.localeCompare(b.source) * dir;
        default: return 0;
      }
    });

    return result;
  }, [events, search, severityFilter, serviceFilter, sortField, sortDir]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (filteredEvents.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(i => Math.min(i + 1, filteredEvents.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(filteredEvents.length - 1);
        break;
    }
  }, [filteredEvents.length]);

  const getFileTimestamp = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  };

  const formatExportTimestamp = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  };

  const exportToJson = () => {
    const fileTs = getFileTimestamp();
    const exportData = filteredEvents.map(e => ({
      ...e,
      timestamp: formatExportTimestamp(e.timestamp),
      receivedAt: formatExportTimestamp(e.receivedAt),
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `incidents-${fileTs}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportToCsv = () => {
    const fileTs = getFileTimestamp();
    const headers = ['ID', 'Service', 'Severity', 'Timestamp', 'Message', 'Source', 'Schema'];
    const rows = filteredEvents.map(e => [
      `"${e.id}"`, `"${e.service}"`, `"${e.severity}"`,
      `"${formatExportTimestamp(e.timestamp)}"`,
      `"${e.message.replace(/"/g, '""')}"`,
      `"${e.source}"`, `"${e.originalSchema}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `incidents-${fileTs}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rowProps = useMemo(() => ({ events: filteredEvents, focusedIndex, onFocus: setFocusedIndex }), [filteredEvents, focusedIndex]);

  return (
    <div className="app-page" role="region" aria-label="Historical event logs">
      <div className="page-container space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-2 border-b border-border/50">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary/90 mb-1">Time series</p>
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Event History</h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              <span className="font-medium text-foreground/80 tabular-nums">{filteredEvents.length.toLocaleString()}</span>
              {' / '}
              <span className="tabular-nums">{events.length.toLocaleString()}</span> events
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button size="sm" variant="secondary" onClick={exportToJson} className="h-8 text-xs gap-1.5" data-testid="button-export-json">
              <FileJson className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">JSON</span>
            </Button>
            <Button size="sm" variant="secondary" onClick={exportToCsv} className="h-8 text-xs gap-1.5" data-testid="button-export-csv">
              <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">CSV</span>
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="panel-section rounded-xl p-3 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[160px] sm:min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events..."
              className="pl-8 h-9 rounded"
              data-testid="input-history-search"
              aria-label="Search events"
            />
          </div>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-28 sm:w-32 h-9 rounded" data-testid="select-severity-filter" aria-label="Filter by severity">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Select value={serviceFilter} onValueChange={setServiceFilter}>
              <SelectTrigger className="w-28 sm:w-36 h-9 rounded" data-testid="select-service-filter" aria-label="Filter by service">
              <SelectValue placeholder="Service" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Services</SelectItem>
              {services.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card className="panel-section flex-1 mx-3 sm:mx-5 lg:mx-7 mb-3 sm:mb-5 overflow-hidden">
        <ErrorBoundary section="History Table">
          {/* Sortable Column Headers */}
          <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border-b border-border/60 text-[11px] font-medium text-muted-foreground" role="row" aria-label="Column headers">
            <span className="w-1.5" />
            <SortHeader label="Timestamp" field="timestamp" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="w-28 sm:w-36" />
            <SortHeader label="Service" field="service" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="w-20 hidden sm:flex" />
            <SortHeader label="Severity" field="severity" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="w-16" />
            <SortHeader label="Message" field="message" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="flex-1" />
            <SortHeader label="Source" field="source" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="w-16 sm:w-20 hidden md:flex justify-end" />
            <span className="w-8 hidden lg:inline">Schema</span>
          </div>
          {/* Virtual List with keyboard navigation */}
          <div
            ref={listContainerRef}
            onKeyDown={handleKeyDown}
            role="grid"
            aria-rowcount={filteredEvents.length}
            aria-label="Event rows"
            tabIndex={0}
          >
            {filteredEvents.length > 0 ? (
              <List
                defaultHeight={600}
                rowCount={filteredEvents.length}
                rowHeight={36}
                overscanCount={30}
                rowComponent={HistoryRow}
                rowProps={rowProps as any}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
                <Database className="w-10 h-10 opacity-20" aria-hidden="true" />
                <p className="text-sm font-medium">No events match your filters</p>
                <p className="text-xs text-muted-foreground/70">Try adjusting your search or filter criteria</p>
              </div>
            )}
          </div>
        </ErrorBoundary>
      </Card>
    </div>
  );
}
