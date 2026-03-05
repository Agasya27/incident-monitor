import { BookOpen, Database, Cpu, Shield, Workflow, Layers, Zap, Server, GitBranch, MemoryStick } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <Card className="panel-section overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60">
        <div className="rounded-lg bg-primary/10 p-2">
          <Icon className="w-4 h-4 text-primary" aria-hidden="true" />
        </div>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="p-4 space-y-3 text-[13px] text-muted-foreground leading-relaxed">
        {children}
      </div>
    </Card>
  );
}

function DesignChoice({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5 py-1">
      <Badge variant="outline" className="text-[10px] font-mono font-medium flex-shrink-0 mt-0.5 rounded-[3px]">{label}</Badge>
      <span className="text-[12px] leading-relaxed">{value}</span>
    </div>
  );
}

export default function ArchitecturePage() {
  return (
    <div className="app-page" role="region" aria-label="Architecture documentation">
      <div className="page-container space-y-4 sm:space-y-5 max-w-5xl">
        <div className="pb-2 border-b border-border/50">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary/90 mb-1">Documentation</p>
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Architecture</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            Design decisions, trade-offs &amp; implementation
          </p>
        </div>
        <p className="text-xs text-muted-foreground/70">
          This page documents the architectural decisions, trade-offs, and implementation strategies
          for the Distributed Real-Time Incident Monitoring System.
        </p>

        <Separator />

        {/* State Management */}
        <Section icon={Database} title="State Management Justification">
          <p>
            <strong className="text-foreground">Choice: Zustand (flat store)</strong> over Redux, MobX, or React Context.
          </p>
          <DesignChoice
            label="Why flat"
            value="A single-level store avoids nested selector re-renders. With 10K+ events updating at 200+ evt/s, deeply nested state causes cascading renders. Zustand's shallow equality check on flat slices ensures only subscribing components re-render."
          />
          <DesignChoice
            label="Why Zustand"
            value="Minimal boilerplate (no providers, reducers, or action creators). Direct store access via getState() enables imperative updates from Web Workers and timers without hook dependencies. Bundle size ~2KB vs Redux Toolkit ~11KB."
          />
          <DesignChoice
            label="Trade-off"
            value="No built-in devtools time-travel; mitigated by our own snapshot/replay system. No middleware ecosystem; acceptable since we control all mutation paths."
          />
          <DesignChoice
            label="Bounded buffers"
            value="Events capped at 10K, audit at 5K, throughput at 60 points, replay at 60s window. Prevents unbounded memory growth during long sessions. Old entries are evicted FIFO."
          />
          <DesignChoice
            label="State hash"
            value="djb2 hash of last 500 event IDs+timestamps computed every 5s. Provides determinism proof: same input stream → same hash. Displayed in replay for verification."
          />
        </Section>

        {/* Reconciliation Strategy */}
        <Section icon={Workflow} title="Event Reconciliation Strategy">
          <p>
            <strong className="text-foreground">4-stage pipeline:</strong> Validate → Normalize → Deduplicate → Reorder
          </p>
          <DesignChoice
            label="Stage 1"
            value="Zod schema validation against 5 schemas (A-E) representing different backend formats. tryParse with discriminated unions; first matching schema wins. Failed validation produces a typed CorruptionDetail (malformed_json, missing_required, type_mismatch, invalid_timestamp)."
          />
          <DesignChoice
            label="Stage 2"
            value="Normalize all 5 schemas to a single NormalizedEvent interface. Maps varying field names (eventId→id, _service→service, eventSeverity→severity). Generates contentHash via djb2 for field-level dedup."
          />
          <DesignChoice
            label="Stage 3"
            value="Dual deduplication: ID-based (Set lookup, O(1)) + content hash (separate Set). ID dedup catches retransmissions; content hash catches semantically identical events with different IDs. Both sets are bounded at 10K entries with LRU eviction."
          />
          <DesignChoice
            label="Stage 4"
            value="Configurable reorder buffer with gap tolerance (default 2000ms). Events are buffered and sorted by timestamp, flushed when gaps are filled or tolerance exceeded. Window size adjustable at runtime via pipeline.reorderBuffer.setWindowMs()."
          />
          <DesignChoice
            label="Trade-off"
            value="Content hash dedup adds ~0.1ms/event but prevents duplicate alerts. Reorder buffer adds latency proportional to gap tolerance; default 5s balances freshness vs. ordering correctness."
          />
        </Section>

        {/* Rule Engine Optimization */}
        <Section icon={Cpu} title="Rule Evaluation Optimization">
          <p>
            <strong className="text-foreground">AST-compiled rules evaluated in a Web Worker</strong> — no eval(), no third-party rule libraries.
          </p>
          <DesignChoice
            label="AST compilation"
            value="Rules are parsed once into an AST (AND/OR/NOT/COMPARE nodes) via buildAST(). Each rule's AST is cached. Evaluation walks the tree recursively—O(conditions) per event per rule. The compile-once pattern avoids repeated string parsing."
          />
          <DesignChoice
            label="NOT support"
            value="Each condition has an optional `negate` flag. When set, buildAST wraps the COMPARE node in a NOT node. The evaluator inverts the boolean result. This allows negated conditions without eval or code generation."
          />
          <DesignChoice
            label="Web Worker"
            value="Rule evaluation runs in a dedicated Worker thread via postMessage/onmessage. The main thread sends batches of events; the worker evaluates all rules and returns results. This keeps the main thread free for rendering at 60fps even with complex rule sets."
          />
          <DesignChoice
            label="Aggregations"
            value="TimeWindowTracker maintains per-rule sliding windows supporting count, sum, and avg aggregation types. Window entries are pruned on each evaluation. Max 5000 entries per rule to bound memory."
          />
          <DesignChoice
            label="Consecutive"
            value="ConsecutiveTracker counts sequential matching events per rule. Resets on non-match. Rule triggers only after N consecutive matches, reducing false positives in bursty streams."
          />
          <DesignChoice
            label="Escalation"
            value="EscalationManager supports severity chains (e.g., warning→error→critical) with configurable cooldown periods. Prevents alert fatigue by requiring cooldown before re-triggering."
          />
        </Section>

        {/* Failure Handling */}
        <Section icon={Shield} title="Failure Handling & Recovery">
          <p>
            <strong className="text-foreground">Designed for unreliable streams</strong> with jitter, corruption, and disconnections.
          </p>
          <DesignChoice
            label="Reconnection"
            value="Exponential backoff with jitter: base 1s, max 30s, multiplied by 2 each attempt with ±50% random jitter. Prevents thundering herd on server recovery. Max 20 retries before giving up; after exhaustion, connection remains disconnected until manual restart."
          />
          <DesignChoice
            label="Corruption"
            value="JSON parse errors, missing fields, type mismatches, and invalid timestamps are all classified. Each corruption is logged to the audit trail with the original raw payload. Corrupted events never enter the store—they're counted in pipeline stats."
          />
          <DesignChoice
            label="Latency"
            value="LatencyTracker sends ping/pong every 2s to measure RTT. Displayed as connection health metric. Simulated in mock backend with 20-150ms base + random jitter."
          />
          <DesignChoice
            label="Integrity"
            value="IntegrityWindow tracks accepted/total ratio as a percentage. Displayed on dashboard. A score below 80% indicates excessive corruption or dedup—signals upstream issues."
          />
          <DesignChoice
            label="Chaos mode"
            value="Configurable chaos parameters: disconnect probability (0-1), corruption rate (0-1), delay range (ms), duplicate rate. Enables testing of all failure paths without external tooling."
          />
        </Section>

        {/* Rendering Performance */}
        <Section icon={Zap} title="Rendering & Performance">
          <p>
            <strong className="text-foreground">Virtualized rendering</strong> for 10K+ records at 60fps.
          </p>
          <DesignChoice
            label="Virtualization"
            value="react-window (v2) for history and replay lists. Fixed row height (36px) enables O(1) scroll offset calculation. Only visible rows + overscan (20 rows) are rendered in DOM. Handles 10K+ rows without degradation."
          />
          <DesignChoice
            label="FPS tracking"
            value="requestAnimationFrame loop measures frame intervals. FPS displayed on dashboard. If FPS drops below 30, indicates rendering bottleneck—suggests reducing event rate or increasing batch interval."
          />
          <DesignChoice
            label="Heap tracking"
            value="performance.memory API (Chrome) sampled every 2s. Displays used heap in MB on dashboard. If sustained growth detected, indicates a memory leak in event buffers."
          />
          <DesignChoice
            label="Batch updates"
            value="Events from WebSocket are processed in microtask batches. The pipeline processes all pending events, then commits a single store update. This coalesces multiple events into one React render cycle."
          />
          <DesignChoice
            label="Memoization"
            value="useMemo for sorted/filtered event arrays, severity counts, rate computations. useRef for timers and worker references. Zustand selectors with shallow comparison prevent unnecessary re-renders."
          />
        </Section>

        {/* Security */}
        <Section icon={Shield} title="Security Hardening">
          <DesignChoice
            label="Input sanitization"
            value="All user-facing strings pass through escapeHtml() which neutralizes <, >, &, quotes. Metadata is sanitized via sanitizeMetadata() during normalization—limiting keys to 50, capping string values to 1000 chars, and dropping complex nested objects. Prevents XSS and memory exhaustion from malicious event payloads."
          />
          <DesignChoice
            label="Rule validation"
            value="validateRuleExpression() enforces: max 500 char length, alphanumeric/operator whitelist, blocks eval/Function/import/require/__proto__/constructor/prototype patterns. Prevents code injection via rule conditions."
          />
          <DesignChoice
            label="String limits"
            value="limitString() caps all stored strings at 1000 chars for messages and 200 chars for service/source fields. Applied during the normalization stage of the pipeline. Prevents memory exhaustion from oversized payloads."
          />
          <DesignChoice
            label="Numeric clamping"
            value="clampTimestamp() rejects timestamps outside 2000-2100 range (broad range for monitoring tool compatibility). clampSeverityLevel() bounds 0-3. Prevents injection of extreme values that could break sorting or display."
          />
          <DesignChoice
            label="Regex safety"
            value="safeRegex() wraps user-provided patterns in try-catch. Invalid or malicious regex patterns fail gracefully rather than crashing the rule engine."
          />
        </Section>

        {/* Replay / Event Sourcing */}
        <Section icon={GitBranch} title="Replay & Event Sourcing">
          <DesignChoice
            label="Recording"
            value="All normalized events from the last 60s are retained in a circular buffer. Snapshots (full state + hash) are taken every 10s, providing 6 restore points per minute."
          />
          <DesignChoice
            label="Step forward"
            value="Advances the replay index by 1. The visible event set is sortedEvents.slice(0, index+1). O(1) per step."
          />
          <DesignChoice
            label="Step backward"
            value="Finds the nearest earlier snapshot via binary search on timestamps. Marks the snapshot as restored (visual indicator). The visible set is recomputed from the beginning up to the target index. This implements the 'snapshot restore + replay forward' pattern from event sourcing."
          />
          <DesignChoice
            label="Playback timing"
            value="Instead of fixed intervals, playback uses the actual timestamp deltas between consecutive events, scaled by the speed multiplier (0.25x–2x). This preserves the original temporal distribution of events during replay."
          />
          <DesignChoice
            label="Determinism"
            value="Replay hash (djb2 of visible event IDs+timestamps) is displayed alongside the live state hash. If the same events are replayed, the hash matches—proving deterministic state reconstruction."
          />
        </Section>

        {/* Data Flow Diagram */}
        <Section icon={Layers} title="Data Flow Overview">
            <div className="font-mono text-xs space-y-1 bg-muted/15 rounded-[5px] p-4 overflow-x-auto border border-border/50">
            <p className="text-foreground">WebSocket Stream</p>
            <p>  │</p>
            <p>  ▼</p>
            <p className="text-foreground">┌─ Pipeline ──────────────────────────┐</p>
            <p>│  1. Validate (5 Zod schemas)        │</p>
            <p>│  2. Normalize → NormalizedEvent      │</p>
            <p>│  3. Dedup (ID + content hash)        │</p>
            <p>│  4. Reorder (gap-tolerant buffer)    │</p>
            <p className="text-foreground">└──────────────────────────────────────┘</p>
            <p>  │</p>
            <p>  ├──→ <span className="text-foreground">Zustand Store</span> (max 10K events)</p>
            <p>  │      ├── Dashboard (live feed, charts)</p>
            <p>  │      ├── History (virtualized, sorted)</p>
            <p>  │      └── Replay (60s buffer + snapshots)</p>
            <p>  │</p>
            <p>  └──→ <span className="text-foreground">Web Worker</span> (AST rule engine)</p>
            <p>         ├── Time window aggregation</p>
            <p>         ├── Consecutive tracking</p>
            <p>         ├── Escalation chains</p>
            <p>         └──→ Results → Store → AlertsPanel</p>
          </div>
        </Section>

        {/* Technology Stack */}
        <Section icon={Server} title="Technology Stack">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { name: 'React 18', role: 'UI framework' },
              { name: 'TypeScript 5.6', role: 'Type safety' },
              { name: 'Vite 7', role: 'Build tool' },
              { name: 'Zustand 5', role: 'State management' },
              { name: 'Zod 3.24', role: 'Schema validation' },
              { name: 'react-window 2', role: 'List virtualization' },
              { name: 'Recharts', role: 'Charts' },
              { name: 'Tailwind CSS 3', role: 'Styling' },
              { name: 'shadcn/ui', role: 'Component library' },
              { name: 'Web Workers', role: 'Off-thread compute' },
              { name: 'Vitest', role: 'Testing' },
              { name: 'wouter', role: 'Routing' },
            ].map(tech => (
              <div key={tech.name} className="flex items-center gap-2 text-xs">
                <Badge variant="secondary" className="text-[10px] font-mono">{tech.name}</Badge>
                <span className="text-muted-foreground">{tech.role}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Memory Model */}
        <Section icon={MemoryStick} title="Memory Bounds">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { buffer: 'Events', limit: '10,000', eviction: 'FIFO' },
              { buffer: 'Audit Log', limit: '5,000', eviction: 'FIFO' },
              { buffer: 'Replay Window', limit: '60 seconds', eviction: 'Time-based' },
              { buffer: 'Dedup Sets', limit: '10,000 each', eviction: 'Oldest removed' },
              { buffer: 'Throughput', limit: '60 points', eviction: 'FIFO' },
              { buffer: 'Window Tracker', limit: '5,000/rule', eviction: 'Time-pruned' },
            ].map(m => (
              <div key={m.buffer} className="flex items-center justify-between gap-2 p-2.5 rounded-[5px] bg-muted/15 border border-border/50">
                <span className="text-xs font-medium text-foreground">{m.buffer}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-mono">{m.limit}</Badge>
                  <span className="text-[10px] text-muted-foreground">{m.eviction}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
