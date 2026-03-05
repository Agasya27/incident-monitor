import { useState, useEffect, useRef, useMemo } from 'react';
import { List } from 'react-window';
import {
  History, Play, Pause, SkipBack, SkipForward, RotateCcw,
  Camera, Radio, Hash, Shield
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorBoundary } from '@/components/error-boundary';
import { useStore, computeStateHash } from '../store/use-store';
import type { NormalizedEvent, Severity } from '../types/events';

const SEVERITY_DOT: Record<Severity, string> = {
  info: 'bg-blue-500',
  warning: 'bg-amber-500',
  error: 'bg-orange-500',
  critical: 'bg-red-500',
};

const SEVERITY_COLORS: Record<Severity, string> = {
  info: 'bg-blue-500/8 text-blue-400 border-blue-500/15',
  warning: 'bg-amber-500/8 text-amber-400 border-amber-500/15',
  error: 'bg-orange-500/8 text-orange-400 border-orange-500/15',
  critical: 'bg-red-500/8 text-red-400 border-red-500/15',
};

const SEV_CARD_STYLES: Record<Severity, { text: string; border: string }> = {
  info: { text: 'text-blue-400', border: 'border-blue-500/20' },
  warning: { text: 'text-amber-400', border: 'border-amber-500/20' },
  error: { text: 'text-orange-400', border: 'border-orange-500/20' },
  critical: { text: 'text-red-400', border: 'border-red-500/20' },
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 1 } as Intl.DateTimeFormatOptions);
}

function ReplayRow({ index, style, events }: { index: number; style: React.CSSProperties; events: NormalizedEvent[] }) {
  const event = events[index];
  if (!event) return null;

  return (
    <div
      style={style}
      className="flex items-center gap-2 sm:gap-3 px-3 border-b border-border/40 text-[12px] hover:bg-muted/20 transition-colors"
      data-testid={`row-replay-${event.id}`}
      role="row"
    >
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[event.severity]}`} aria-hidden="true" />
      <span className="font-mono text-muted-foreground w-16 sm:w-20 flex-shrink-0 tabular-nums">
        {formatTime(event.timestamp)}
      </span>
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono flex-shrink-0 hidden sm:inline-flex rounded-[3px]">
        {event.service}
      </Badge>
      <span className={`px-1.5 py-0 rounded-[3px] text-[10px] font-medium flex-shrink-0 border ${SEVERITY_COLORS[event.severity]}`}>
        {event.severity}
      </span>
      <span className="truncate text-muted-foreground flex-1">{event.message}</span>
    </div>
  );
}

export default function ReplayPage() {
  const replayEvents = useStore((s) => s.replayEvents);
  const replaySnapshots = useStore((s) => s.replaySnapshots);
  const isStreaming = useStore((s) => s.isStreaming);
  const stateHash = useStore((s) => s.stateHash);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [replayHash, setReplayHash] = useState('0');
  const [restoredSnapshot, setRestoredSnapshot] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const sortedEvents = useMemo(() =>
    [...replayEvents].sort((a, b) => a.timestamp - b.timestamp),
    [replayEvents]
  );

  const visibleEvents = useMemo(() =>
    sortedEvents.slice(0, currentIndex + 1),
    [sortedEvents, currentIndex]
  );

  // Compute determinism hash for visible replay state
  useEffect(() => {
    setReplayHash(computeStateHash(visibleEvents));
  }, [visibleEvents]);

  const progress = sortedEvents.length > 0
    ? ((currentIndex + 1) / sortedEvents.length) * 100
    : 0;

  const currentTime = sortedEvents[currentIndex]?.timestamp;
  const startTime = sortedEvents[0]?.timestamp;
  const endTime = sortedEvents[sortedEvents.length - 1]?.timestamp;

  // Playback with original event timing (timestamp deltas)
  useEffect(() => {
    if (!isPlaying || currentIndex >= sortedEvents.length - 1) {
      if (isPlaying && currentIndex >= sortedEvents.length - 1) setIsPlaying(false);
      return;
    }

    const currentTs = sortedEvents[currentIndex]?.timestamp || 0;
    const nextTs = sortedEvents[currentIndex + 1]?.timestamp || 0;
    const rawDelta = Math.max(0, nextTs - currentTs);
    // Use a minimum base interval of 200ms so speed changes are always perceptible
    const baseDelta = Math.max(rawDelta, 200);
    const delay = Math.min(Math.max(20, baseDelta / speed), 3000);

    timerRef.current = window.setTimeout(() => {
      setCurrentIndex(prev => prev + 1);
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, currentIndex, sortedEvents, speed]);

  const handlePlay = () => {
    if (currentIndex >= sortedEvents.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(true);
  };

  const handlePause = () => setIsPlaying(false);

  const handleStepForward = () => {
    setIsPlaying(false);
    setCurrentIndex(prev => Math.min(prev + 1, sortedEvents.length - 1));
    setRestoredSnapshot(null);
  };

  // Step backward using snapshot restore + replay forward
  const handleStepBackward = () => {
    setIsPlaying(false);
    const targetIndex = Math.max(currentIndex - 1, 0);

    if (replaySnapshots.length > 0 && targetIndex > 0) {
      // Find the nearest snapshot whose timestamp <= target event's timestamp
      const targetTs = sortedEvents[targetIndex]?.timestamp || 0;
      let bestSnap = -1;
      for (let i = replaySnapshots.length - 1; i >= 0; i--) {
        if (replaySnapshots[i].timestamp <= targetTs) {
          bestSnap = i;
          break;
        }
      }
      if (bestSnap >= 0) {
        // Actually restore the snapshot state (event sourcing pattern)
        useStore.getState().restoreSnapshot(bestSnap);
        setRestoredSnapshot(bestSnap);
      }
    }

    setCurrentIndex(targetIndex);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentIndex(0);
    setRestoredSnapshot(null);
  };

  const handleSeek = (value: number[]) => {
    setIsPlaying(false);
    setCurrentIndex(Math.min(value[0], sortedEvents.length - 1));
    setRestoredSnapshot(null);
  };

  const jumpToSnapshot = (snapshotIndex: number) => {
    const snapshot = replaySnapshots[snapshotIndex];
    if (!snapshot) return;
    const eventIdx = sortedEvents.findIndex(e => e.timestamp >= snapshot.timestamp);
    if (eventIdx >= 0) {
      setIsPlaying(false);
      setCurrentIndex(eventIdx);
      setRestoredSnapshot(snapshotIndex);
    }
  };

  const severityCounts = useMemo(() => {
    const counts = { info: 0, warning: 0, error: 0, critical: 0 };
    for (const e of visibleEvents) {
      counts[e.severity]++;
    }
    return counts;
  }, [visibleEvents]);

  const reversedVisible = useMemo(() => [...visibleEvents].reverse(), [visibleEvents]);
  const replayRowProps = useMemo(() => ({ events: reversedVisible }), [reversedVisible]);

  return (
    <div className="app-page" role="region" aria-label="Event replay">
      <div className="page-container space-y-4 sm:space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-2 border-b border-border/50">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary/90 mb-1">Determinism</p>
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Event Replay</h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              <span className="font-medium text-foreground/80 tabular-nums">{sortedEvents.length}</span> events buffered
              {isPlaying && <span className="text-primary font-medium"> · playing</span>}
            </p>
          </div>
          {!isStreaming && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 shrink-0">
              <Radio className="w-3.5 h-3.5" aria-hidden="true" />
              Start streaming to capture events
            </p>
          )}
        </div>

        {/* Determinism Proof & Snapshot Info */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-[10px]">
            <Hash className="w-3 h-3 text-primary" aria-hidden="true" />
            <span className="text-muted-foreground">Replay Hash:</span>
            <code className="font-mono text-xs bg-muted/50 px-1.5 py-0.5 rounded">{replayHash}</code>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <Shield className="w-3 h-3 text-emerald-400" aria-hidden="true" />
            <span className="text-muted-foreground">Live Hash:</span>
            <code className="font-mono text-xs bg-muted/50 px-1.5 py-0.5 rounded">{stateHash}</code>
          </div>
          {restoredSnapshot !== null && (
            <Badge variant="outline" className="text-[10px]">
              Restored from snapshot #{restoredSnapshot + 1}
            </Badge>
          )}
        </div>

        {/* Transport Controls */}
        <Card className="panel-section overflow-hidden">
          <div className="p-3.5 sm:p-4 space-y-3.5">
            {/* Timeline */}
            <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs text-muted-foreground font-mono tabular-nums">
              <span>{startTime ? formatTime(startTime) : '--:--:--'}</span>
              <span className="font-semibold text-foreground">
                {currentTime ? formatTime(currentTime) : '--:--:--'}
                <span className="ml-1.5 text-muted-foreground/60 text-[10px]">
                  ({currentIndex + 1}/{sortedEvents.length})
                </span>
              </span>
              <span>{endTime ? formatTime(endTime) : '--:--:--'}</span>
            </div>

            <Slider
              value={[currentIndex]}
              max={Math.max(sortedEvents.length - 1, 0)}
              step={1}
              onValueChange={handleSeek}
              disabled={sortedEvents.length === 0}
              data-testid="slider-replay-position"
              aria-label="Replay position"
            />

            <Progress value={progress} className="h-1" />

            {/* Buttons */}
            <div className="flex items-center justify-center gap-1 sm:gap-1.5">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={handleReset}
                disabled={sortedEvents.length === 0}
                data-testid="button-replay-reset"
                aria-label="Reset replay"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={handleStepBackward}
                disabled={sortedEvents.length === 0 || currentIndex <= 0}
                data-testid="button-replay-step-back"
                aria-label="Step backward (snapshot restore)"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="icon"
                variant={isPlaying ? 'secondary' : 'default'}
                className="h-9 w-9"
                onClick={isPlaying ? handlePause : handlePlay}
                disabled={sortedEvents.length === 0}
                data-testid="button-replay-play-pause"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={handleStepForward}
                disabled={sortedEvents.length === 0 || currentIndex >= sortedEvents.length - 1}
                data-testid="button-replay-step-forward"
                aria-label="Step forward"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </Button>
              <Select
                value={String(speed)}
                onValueChange={(v) => setSpeed(Number(v))}
                disabled={sortedEvents.length === 0}
              >
                <SelectTrigger
                  className="h-8 w-[72px] text-[11px] font-mono tabular-nums ml-1.5"
                  data-testid="select-replay-speed"
                  aria-label="Playback speed"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.25">0.25x</SelectItem>
                  <SelectItem value="0.5">0.5x</SelectItem>
                  <SelectItem value="1">1x</SelectItem>
                  <SelectItem value="2">2x</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {/* Severity Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['info', 'warning', 'error', 'critical'] as Severity[]).map(sev => (
            <Card key={sev} className={`metric-card p-3 border ${SEV_CARD_STYLES[sev].border} border-opacity-50 transition-colors`}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{sev}</p>
              <p className={`text-xl font-bold tabular-nums ${SEV_CARD_STYLES[sev].text}`} data-testid={`text-replay-${sev}`}>
                {severityCounts[sev]}
              </p>
            </Card>
          ))}
        </div>

        {/* Snapshots */}
        {replaySnapshots.length > 0 && (
            <Card className="panel-section p-3">
            <div className="flex items-center gap-2 mb-2">
              <Camera className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-xs font-semibold text-muted-foreground">Snapshots ({replaySnapshots.length})</h3>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {replaySnapshots.map((snap, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant={restoredSnapshot === i ? 'default' : 'outline'}
                  className="text-[10px] font-mono h-7 tabular-nums gap-1"
                  onClick={() => jumpToSnapshot(i)}
                  data-testid={`button-snapshot-${i}`}
                  aria-label={`Restore snapshot from ${formatTime(snap.timestamp)}`}
                >
                  <Camera className="w-2.5 h-2.5" aria-hidden="true" />
                  {formatTime(snap.timestamp)}
                  <span className="text-muted-foreground text-[9px]">#{snap.stateHash.slice(0, 6)}</span>
                </Button>
              ))}
            </div>
          </Card>
        )}

        {/* Event Feed */}
        <Card className="panel-section flex flex-col h-[380px] overflow-hidden">
          <ErrorBoundary section="Replay Feed">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 shrink-0">
              <History className="w-3.5 h-3.5 text-muted-foreground/50" aria-hidden="true" />
              <h3 className="text-[13px] font-medium">Replayed Events</h3>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums ml-auto">
                {visibleEvents.length}
              </span>
              {isPlaying && (
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-1" aria-hidden="true" />
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
            {visibleEvents.length > 0 ? (
              <List
                defaultHeight={340}
                rowCount={reversedVisible.length}
                rowHeight={36}
                overscanCount={20}
                rowComponent={ReplayRow}
                rowProps={replayRowProps as any}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <History className="w-10 h-10 opacity-20" aria-hidden="true" />
                <p className="text-sm font-medium">No replay data available</p>
                <p className="text-xs text-muted-foreground/70">Events from the last 60 seconds will appear here</p>
              </div>
            )}
            </div>
          </ErrorBoundary>
        </Card>
      </div>
    </div>
  );
}
