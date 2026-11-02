import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="space-y-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">
            <div className="text-foreground flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div>
                <div className="font-medium">Something went wrong</div>
                <div className="text-muted-foreground mt-0.5 break-words text-xs">
                  {this.state.error.message}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
