import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useStore } from '@/store/use-store';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  section?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.section ? ` - ${this.props.section}` : ''}]`, error, errorInfo);
    // Log to audit trail for observability
    try {
      useStore.getState().addAuditEntry({
        action: `Error boundary caught: ${this.props.section || 'Unknown section'}`,
        details: `${error.name}: ${error.message}`,
        category: 'system',
      });
    } catch {
      // Silently fail if store is unavailable
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <Card className="flex flex-col items-center justify-center gap-3 p-6 m-2 bg-card">
          <AlertTriangle className="w-8 h-8 text-destructive" aria-hidden="true" />
          <div className="text-center">
            <p className="text-sm font-medium">
              {this.props.section ? `${this.props.section} encountered an error` : 'Something went wrong'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => this.setState({ hasError: false, error: null })}
            data-testid="button-error-retry"
            aria-label="Retry loading this section"
          >
            <RefreshCw className="w-3 h-3 mr-1.5" aria-hidden="true" />
            Retry
          </Button>
        </Card>
      );
    }

    return this.props.children;
  }
}
