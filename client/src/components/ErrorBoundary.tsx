import { cn } from "@/lib/utils";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

const IS_PROD = import.meta.env.PROD;

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: { componentStack: string }) => void;
}
interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, errorId: `ERR-${Date.now().toString(36).toUpperCase()}` };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "ERROR",
      source: "ErrorBoundary",
      errorId: this.state.errorId,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    }));
    this.props.onError?.(error, info);
  }
  reset = () => this.setState({ hasError: false, error: null, errorId: null });
  render() {
    if (!this.state.hasError || !this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
    return (
      <div className="flex items-center justify-center min-h-screen p-8 bg-background">
        <div className="flex flex-col items-center w-full max-w-2xl p-8 space-y-6">
          <AlertTriangle size={48} className="text-destructive flex-shrink-0" />
          <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">An unexpected error occurred. The issue has been logged.</p>
            {this.state.errorId && (
              <p className="text-xs text-muted-foreground font-mono">Error ID: {this.state.errorId}</p>
            )}
          </div>
          {!IS_PROD && (
            <div className="p-4 w-full rounded-lg bg-muted overflow-auto max-h-64 border border-destructive/20">
              <p className="text-xs font-semibold text-destructive mb-2">{this.state.error.message}</p>
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">{this.state.error.stack}</pre>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={this.reset} className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium", "bg-primary text-primary-foreground hover:opacity-90 cursor-pointer")}>
              <RotateCcw size={14} /> Try Again
            </button>
            <button onClick={() => (window.location.href = "/")} className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium", "bg-secondary text-secondary-foreground hover:opacity-90 cursor-pointer")}>
              <Home size={14} /> Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
export default ErrorBoundary;
