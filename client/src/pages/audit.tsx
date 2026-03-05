import { useState, useMemo, useCallback } from 'react';
import { List } from 'react-window';
import { FileText, Trash2, Search, FileJson, FileSpreadsheet, ScrollText } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorBoundary } from '@/components/error-boundary';
import { useStore } from '../store/use-store';
import type { AuditEntry } from '../types/events';

const CATEGORY_COLORS: Record<string, string> = {
  system: 'bg-blue-500/8 text-blue-400 border-blue-500/15',
  rule: 'bg-amber-500/8 text-amber-400 border-amber-500/15',
  connection: 'bg-emerald-500/8 text-emerald-400 border-emerald-500/15',
  user: 'bg-purple-500/8 text-purple-400 border-purple-500/15',
};

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

function AuditRow({ index, style, entries }: { index: number; style: React.CSSProperties; entries: AuditEntry[] }) {
  const entry = entries[index];
  if (!entry) return null;

  return (
    <div
      style={style}
      className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 border-b border-border/40 text-[12px] hover:bg-muted/20 transition-colors"
      data-testid={`row-audit-${entry.id}`}
      role="row"
    >
      <span className="font-mono text-muted-foreground w-28 sm:w-36 flex-shrink-0 tabular-nums">
        {formatTimestamp(entry.timestamp)}
      </span>
      <span className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-medium flex-shrink-0 border ${CATEGORY_COLORS[entry.category] || ''}`}>
        {entry.category}
      </span>
      <span className="font-medium flex-shrink-0 w-32 sm:w-48 truncate">{entry.action}</span>
      <span className="truncate text-muted-foreground flex-1 min-w-0 hidden sm:inline">{entry.details}</span>
    </div>
  );
}

export default function AuditPage() {
  const auditLog = useStore((s) => s.auditLog);
  const clearAuditLog = useStore((s) => s.clearAuditLog);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredLog = useMemo(() => {
    let result = auditLog;

    if (search) {
      const lower = search.toLowerCase();
      result = result.filter(e =>
        e.action.toLowerCase().includes(lower) ||
        e.details.toLowerCase().includes(lower)
      );
    }

    if (categoryFilter !== 'all') {
      result = result.filter(e => e.category === categoryFilter);
    }

    return result;
  }, [auditLog, search, categoryFilter]);

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
    const exportData = filteredLog.map(e => ({
      ...e,
      timestamp: formatExportTimestamp(e.timestamp),
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${fileTs}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportToCsv = () => {
    const fileTs = getFileTimestamp();
    const headers = ['ID', 'Timestamp', 'Category', 'Action', 'Details'];
    const rows = filteredLog.map(e => [
      `"${e.id}"`,
      `"${formatExportTimestamp(e.timestamp)}"`,
      `"${e.category}"`,
      `"${e.action.replace(/"/g, '""')}"`,
      `"${e.details.replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${fileTs}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const auditRowProps = useMemo(() => ({ entries: filteredLog }), [filteredLog]);

  return (
    <div className="app-page" role="region" aria-label="Audit log">
      <div className="page-container space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-2 border-b border-border/50">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary/90 mb-1">Compliance</p>
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Audit Log</h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              <span className="font-medium text-foreground/80 tabular-nums">{filteredLog.length.toLocaleString()}</span>
              {' / '}
              <span className="tabular-nums">{auditLog.length.toLocaleString()}</span> entries
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            <Button size="sm" variant="secondary" onClick={exportToJson} className="h-8 text-xs gap-1.5" data-testid="button-audit-export-json">
              <FileJson className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">JSON</span>
            </Button>
            <Button size="sm" variant="secondary" onClick={exportToCsv} className="h-8 text-xs gap-1.5" data-testid="button-audit-export-csv">
              <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">CSV</span>
            </Button>
            <Button size="sm" variant="destructive" onClick={() => { if (window.confirm('Clear all audit log entries? This cannot be undone.')) clearAuditLog(); }} className="h-8 text-xs gap-1.5" data-testid="button-audit-clear">
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Clear</span>
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
              placeholder="Search audit log..."
              className="pl-8 h-9 rounded"
              data-testid="input-audit-search"
              aria-label="Search audit log"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-32 sm:w-36 h-9 rounded" data-testid="select-audit-category" aria-label="Filter by category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="rule">Rule</SelectItem>
              <SelectItem value="connection">Connection</SelectItem>
              <SelectItem value="user">User</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card className="panel-section flex-1 mx-3 sm:mx-5 lg:mx-7 mb-3 sm:mb-5 overflow-hidden">
        <ErrorBoundary section="Audit Table">
          <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border-b border-border/60 text-[11px] font-medium text-muted-foreground" role="row" aria-label="Column headers">
            <span role="columnheader" className="w-28 sm:w-36">Timestamp</span>
            <span role="columnheader" className="w-16">Category</span>
            <span role="columnheader" className="w-32 sm:w-48">Action</span>
            <span role="columnheader" className="flex-1 hidden sm:inline">Details</span>
          </div>
          {filteredLog.length > 0 ? (
            <List
              defaultHeight={600}
              rowCount={filteredLog.length}
              rowHeight={36}
              overscanCount={30}
              rowComponent={AuditRow}
              rowProps={auditRowProps as any}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
              <ScrollText className="w-10 h-10 opacity-20" aria-hidden="true" />
              <p className="text-sm font-medium">No audit entries</p>
              <p className="text-xs text-muted-foreground/70">
                {auditLog.length === 0
                  ? 'Start streaming to generate audit entries'
                  : 'No entries match your filters'
                }
              </p>
            </div>
          )}
        </ErrorBoundary>
      </Card>
    </div>
  );
}
