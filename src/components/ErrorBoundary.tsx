import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackBody?: string;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("PEG-code render failure", error, info);
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="error-panel" role="alert">
        <strong>{this.props.fallbackTitle ?? "PEG-code runtime error"}</strong>
        <p>{this.props.fallbackBody ?? "A render error prevented this panel from loading."}</p>
        <pre>{this.state.error.message}</pre>
      </div>
    );
  }
}

