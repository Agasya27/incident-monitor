# Incident Monitor — Distributed Real-Time Incident Monitoring System

A frontend-only DevOps SaaS dashboard that simulates a distributed real-time incident monitoring system. It ingests high-frequency event streams from a mock WebSocket backend, normalizes five different event schemas, deduplicates and reorders out-of-order events, runs a custom AST-based rule engine off the main thread via Web Workers, and renders 10,000+ records at 60 FPS using virtualization — all while handling network jitter, corrupted payloads, and random disconnections with exponential backoff recovery.

![React](https://img.shields.io/badge/React-18-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue) ![Vite](https://img.shields.io/badge/Vite-5-purple) ![Tests](https://img.shields.io/badge/Tests-239%20passing-brightgreen) ![Coverage](https://img.shields.io/badge/Coverage-91%25-brightgreen)

---

## Table of Contents

- [What This Project Does](#what-this-project-does)
- [Architecture Overview](#architecture-overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Available Scripts](#available-scripts)
- [Project Structure](#project-structure)
- [How the Event Pipeline Works](#how-the-event-pipeline-works)
- [Rule Engine](#rule-engine)
- [Replay System](#replay-system)
- [Testing](#testing)
- [Memory Bounds](#memory-bounds)
- [Accessibility](#accessibility)
- [Design Decisions and Trade-offs](#design-decisions-and-trade-offs)

---

## What This Project Does

Imagine you're running a microservices platform with dozens of services (auth, payments, database, gateway, etc.) all emitting incident events in different formats, at different rates, sometimes out of order, sometimes corrupted. This dashboard is the single pane of glass that makes sense of all that chaos.

It doesn't just display events — it normalizes them from five incompatible schemas into a single format, removes duplicates, puts out-of-order events back in sequence, evaluates user-defined alerting rules in real time, and can deterministically replay the last 60 seconds of activity step by step.

There is no real backend. The entire system runs in the browser. A mock WebSocket service generates realistic traffic at ~200 events/sec with configurable chaos (duplicates, corruption, disconnections). This lets you stress-test every part of the pipeline without any server infrastructure.

---

## Architecture Overview

```
  Mock WebSocket (200 evt/s)
        │
        ▼
  ┌─────────────────────┐
  │  Event Pipeline      │
  │  ├─ Zod Validation   │
  │  ├─ Schema Normalize │   5 schemas → 1 NormalizedEvent
  │  ├─ Sanitization     │   XSS/injection prevention
  │  ├─ Deduplication    │   Content hash + ID dedup
  │  └─ Reorder Buffer   │   Timestamp-based sort with gap tolerance
  └──────────┬──────────┘
             │
             ▼
  ┌────────────────────┐     ┌─────────────────────┐
  │  Zustand Store      │────▶│  Web Worker          │
  │  (Single source of  │◀────│  AST Rule Evaluator  │
  │   truth, bounded)   │     │  (Off main thread)   │
  └──────────┬──────────┘     └─────────────────────┘
             │
     ┌───────┼───────┬────────────┐
     ▼       ▼       ▼            ▼
  Dashboard  History  Replay    Audit Log
  (Live)     (10K+)   (Event    (Exportable
              Sorted)  Sourcing)  JSON/CSV)
```

---

## Features

### Real-Time Dashboard
- Live event feed with virtualized rendering (react-window)
- Auto-scroll toggle for the live stream
- Severity breakdown bar (info / warning / error / critical)
- Throughput chart showing accepted vs. rejected events over time
- Connection health panel (state, uptime, reconnects, latency, dropped events)
- Data integrity score (percentage of clean events)
- FPS, heap memory, and pipeline latency metrics

### Event Pipeline
- Ingests events from five different schemas (Schema A through E)
- Validates each event with Zod schemas
- Normalizes to a single `NormalizedEvent` format
- Sanitizes metadata (HTML escaping, string length limits, key count caps)
- Deduplicates using djb2 content hashing + ID tracking
- Reorders out-of-order events using a time-window buffer with gap tolerance

### Rule Engine (No eval, No third-party rule libraries)
- AST-based rule evaluation built from scratch
- Supports 6 operators: equals, not_equals, contains, greater_than, less_than, matches (regex)
- AND / OR / NOT logic combinators
- Time-window aggregation (count, sum, avg) with sliding windows
- Consecutive event detection (resets on miss)
- Severity escalation chains with cooldown
- Runs entirely in a Web Worker to keep the UI at 60 FPS

### Replay System
- Records the last 60 seconds of events
- Step forward / step backward controls
- Snapshot-based restore (snapshots taken every 10 seconds)
- Variable playback speed: 0.25x, 0.5x, 1x, 2x
- Determinism proof: compares replay hash vs. live state hash (djb2)
- Uses actual timestamp deltas between events for realistic playback timing

### Chaos Engineering Controls
- Adjustable sliders on the dashboard:
  - Duplicate rate (default 5%)
  - Out-of-order rate (default 10%)
  - Corruption rate (default 3%)
  - Schema variation rate (default 30%)
- Automatic periodic disconnections with exponential backoff reconnection (max 20 retries, 30s cap, jitter)

### History Page
- Browse 10,000+ historical events with virtualized scrolling
- Search across message, service, ID, and source
- Filter by severity and service
- Sort by timestamp, service, severity, message, or source
- Keyboard navigation (Arrow keys, Home, End)
- Export to JSON or CSV with human-readable timestamps

### Audit Log
- Every system event is logged: connections, disconnections, rule creations, errors, corruption detections
- Filterable by category (system, rule, connection, user)
- Searchable
- Exportable to JSON and CSV
- Capped at 5,000 entries to prevent memory issues

### Architecture Documentation
- Built-in page explaining every design decision
- Covers: state management, reconciliation, rule engine optimization, failure handling, rendering strategy, security hardening, replay/event sourcing, data flow, and memory bounds

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | React 18 |
| Language | TypeScript 5.6 |
| Build Tool | Vite 5 |
| State Management | Zustand 5 (flat store, bounded buffers) |
| Validation | Zod 3.24 |
| Virtualization | react-window 2 |
| Charts | Recharts 2 |
| Styling | Tailwind CSS 3 + shadcn/ui |
| Routing | wouter 3 |
| Testing | Vitest 2 + Testing Library |
| Coverage | v8 (91%+ statements) |
| Worker | Web Worker API (native) |

---

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd INCIDENT_MONITOR-main

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:5173`.

### Production Build

```bash
npm run build
npm run preview
```

---

## Available Scripts

| Script | Description |
|--------|-----------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Production build (outputs to `dist/`) |
| `npm run preview` | Preview the production build locally |
| `npm run check` | Run TypeScript type checking |
| `npm run test` | Run all 239 tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |

---

## Project Structure

```
client/
├── index.html                    # Entry HTML
├── src/
│   ├── App.tsx                   # Root component, routing, layout
│   ├── main.tsx                  # React entry point
│   ├── index.css                 # Global styles, Tailwind config
│   │
│   ├── types/
│   │   └── events.ts             # All TypeScript types and interfaces
│   │
│   ├── lib/
│   │   ├── pipeline.ts           # Event validation, normalization, dedup, reorder
│   │   ├── ast-rule-engine.ts    # AST-based rule engine (buildAST, evaluateAST, trackers)
│   │   ├── rule-engine.ts        # Default rule definitions
│   │   ├── sanitizer.ts          # XSS prevention, injection blocking, regex safety
│   │   ├── profiler.ts           # FPS, latency, heap tracking
│   │   ├── queryClient.ts        # React Query client config
│   │   └── utils.ts              # Tailwind class merge utility
│   │
│   ├── store/
│   │   └── use-store.ts          # Zustand store (all state slices, bounded buffers)
│   │
│   ├── hooks/
│   │   ├── use-incident-stream.ts # Main orchestration hook (WS, pipeline, worker, timers)
│   │   ├── use-mobile.tsx         # Mobile breakpoint detection
│   │   └── use-toast.ts           # Toast notification state
│   │
│   ├── workers/
│   │   └── rule-engine.worker.ts  # Web Worker for off-thread rule evaluation
│   │
│   ├── services/
│   │   └── mock-backend.ts        # Mock WebSocket, chaos engineering, historical data
│   │
│   ├── pages/
│   │   ├── dashboard.tsx          # Main monitoring dashboard
│   │   ├── rules.tsx              # Rule engine management UI
│   │   ├── history.tsx            # Historical event viewer
│   │   ├── replay-page.tsx        # Deterministic event replay
│   │   ├── audit.tsx              # Audit log viewer
│   │   ├── architecture.tsx       # Architecture documentation
│   │   └── not-found.tsx          # 404 page
│   │
│   └── components/
│       ├── app-sidebar.tsx        # Navigation sidebar
│       ├── error-boundary.tsx     # Error boundary with audit logging
│       ├── theme-provider.tsx     # Dark/light theme
│       └── ui/                    # shadcn/ui component library (40+ components)
```

---

## How the Event Pipeline Works

When the mock WebSocket sends a batch of raw events (every 50ms, ~10 events per batch):

1. **Validation** — Each raw event is checked against five Zod schemas (A through E). Events that don't match any schema are classified as corrupted with a specific corruption type (malformed_json, missing_required, type_mismatch, invalid_timestamp).

2. **Normalization** — Valid events are mapped to a single `NormalizedEvent` shape regardless of which schema they came from. For example, Schema B uses `svc` for service and `msg` for message, while Schema D uses `serviceName` and `description`. All get normalized.

3. **Sanitization** — Metadata values are HTML-escaped to prevent XSS. Strings are capped at 200 characters. Nested objects are flattened. Metadata keys are limited to 50 per event.

4. **Deduplication** — Each event gets a djb2 content hash. The deduplicator tracks both event IDs and content hashes with an LRU-style cache (10,000 entries). Exact duplicates and content-identical events with different IDs are both caught.

5. **Reordering** — Events go into a time-window buffer that flushes sorted batches. The buffer has configurable gap tolerance (default 2 seconds) so slightly late events still get placed in the right order.

---

## Rule Engine

The rule engine is built entirely from scratch — no `eval()`, no `new Function()`, no third-party rule libraries.

**How it works:**

- When a user creates a rule in the UI, the rule's conditions are compiled into an AST (Abstract Syntax Tree) with AND, OR, NOT, and COMPARE nodes.
- The compiled AST is sent to a Web Worker via `postMessage`.
- Every 100ms, the latest batch of events is sent to the worker for evaluation.
- The worker walks the AST for each rule against each event, checks time windows and consecutive counts, handles escalation chains, and sends results back.

**Example rule — "Auth Service Critical":**
- Conditions: `service equals "auth"` AND `severity equals "error"`
- Time window: 10 seconds
- Threshold: 5 events
- Escalation severity: critical
- Action: "Escalate to on-call"

This means: if 5 or more events matching both conditions appear within any 10-second window, the rule triggers and the alert is raised as critical severity.

---

## Replay System

The replay system implements an event-sourcing pattern:

- **Recording:** During live streaming, all processed events are buffered in the replay store. State snapshots are taken every 10 seconds, capturing the event array, index, and a state hash.

- **Playback:** Events are replayed using the actual timestamp deltas between consecutive events (not fixed intervals), scaled by the speed multiplier. This preserves the original temporal distribution.

- **Step backward:** Instead of just decrementing an index, step-backward finds the nearest earlier snapshot, restores the store state from it, and recomputes the visible slice. This is the "snapshot restore + replay forward" pattern from event sourcing.

- **Determinism proof:** The page displays two hashes — one computed from the replay's visible events, one from the live store. If you replay the same events, the hashes match, proving the state reconstruction is deterministic.

---

## Testing

The project has 239 tests across 12 test files with the following coverage:

```
File               | % Stmts | % Branch | % Funcs | % Lines
-------------------|---------|----------|---------|--------
All files          |   91.13 |    85.03 |   96.39 |  91.13
  ast-rule-engine  |   94.62 |    81.05 |  100.00 |  94.62
  pipeline         |   93.57 |    78.94 |   96.00 |  93.57
  sanitizer        |   91.20 |    89.47 |  100.00 |  91.20
  profiler         |   97.82 |    89.28 |  100.00 |  97.82
  use-store        |  100.00 |    98.43 |  100.00 | 100.00
  use-incident-stream | 72.69 | 68.88   |   60.00 |  72.69
```

**Test categories include:**

- **Unit tests** — Pipeline, sanitizer, rule engine, store, profiler, utilities
- **Stress tests** — 250-event pipeline throughput (>200 eps), rule engine throughput, 10K bulk processing
- **Determinism tests** — Same inputs produce same outputs, same events produce same state hash
- **Reconnection tests** — Exponential backoff math, jitter bounds, state transitions, rapid cycle handling
- **Memory bound tests** — Event buffer cap (10K), audit log cap (5K), dedup cache eviction, corruption detail cap
- **Security tests** — XSS escaping, prototype pollution blocking, eval/import injection prevention

To run:

```bash
npm test                # Run all tests
npm run test:coverage   # Run with coverage report
```

---

## Memory Bounds

Every buffer in the system is bounded to prevent memory leaks:

| Buffer | Max Size | Eviction Strategy |
|--------|----------|-------------------|
| Event store | 10,000 events | Drop oldest |
| Audit log | 5,000 entries | Drop oldest |
| Dedup cache | 10,000 hashes | LRU eviction |
| Throughput history | 60 data points | Sliding window |
| Replay snapshots | 12 snapshots | Drop oldest |
| Rule results | 100 results | Drop oldest |
| Profiler snapshots | 300 snapshots | Sliding window |
| Corruption details | 500 details | Drop oldest |

---

## Accessibility

The application follows WCAG guidelines:

- Skip-to-main-content link for keyboard users
- ARIA landmarks (`role="banner"`, `role="main"`, `role="contentinfo"`, `role="region"`)
- `aria-label` on all interactive elements
- `aria-live="polite"` and `aria-live="assertive"` regions for screen reader announcements
- `aria-sort` on sortable table columns
- `aria-current="page"` on the active navigation item
- `aria-hidden="true"` on all decorative icons
- Keyboard navigation in the history table (Arrow keys, Home, End)
- Dark/light theme toggle

---

## Design Decisions and Trade-offs

**Why Zustand over Redux?**
Zustand gives us a single flat store with zero boilerplate. There's no need for action types, reducers, or middleware. For a real-time system where state updates happen hundreds of times per second, Zustand's minimal overhead matters. The flat store shape also makes it easy to subscribe to specific slices without unnecessary re-renders.

**Why a custom AST rule engine instead of a library?**
The requirement explicitly prohibits `eval` and third-party rule libraries. Building an AST from rule conditions and walking it for evaluation gives us full control over the execution model, lets us run it safely in a Web Worker, and avoids any dependency on string-based code evaluation.

**Why Web Workers for rule evaluation?**
At 200+ events per second with multiple rules, each with time-window and consecutive tracking, the evaluation can take meaningful CPU time. Running it in a Web Worker keeps the main thread free for rendering. The worker communicates via structured-clone-safe messages.

**Why djb2 for hashing instead of SHA-256?**
djb2 is fast and deterministic, which is what we need for content-based deduplication and state hash comparison. We don't need cryptographic security — we need speed. SHA-256 would add overhead with no practical benefit for this use case.

**Why bound every buffer?**
In a real-time system, unbounded growth is a guaranteed memory leak. Every array in the store has a hard cap. When the cap is hit, the oldest entries are dropped. This means we might lose very old events, but the system never crashes from running out of memory.

**Why `react-window` over `react-virtuoso` or `tanstack-virtual`?**
react-window v2 is the lightest option with the smallest bundle size. For a system that already manages its own data layer, we don't need the extra features of heavier alternatives. The simple API (`List` + `rowComponent`) is enough.

---

