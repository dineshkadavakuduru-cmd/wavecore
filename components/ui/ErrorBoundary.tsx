"use client";

import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[Wavecore] ErrorBoundary caught:", error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="absolute inset-0 grid place-items-center bg-ink-950 z-50">
          <div className="glass max-w-md w-full mx-6 rounded-2xl p-8 text-center">
            <div
              className="w-14 h-14 mx-auto mb-5 rounded-full border border-white/10 bg-white/[0.04]"
              style={{
                boxShadow:
                  "0 1px 0 0 rgb(255 255 255 / 0.06) inset, 0 24px 64px -28px rgb(0 0 0 / 0.9)",
              }}
            >
              <svg
                className="w-7 h-7 mx-auto mt-3.5 text-chalk-faint"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-chalk mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-chalk-faint mb-6 max-w-sm mx-auto">
              The 3D scene encountered an error and had to stop. This can happen
              if the GPU driver crashes or the WebGL context is lost.
            </p>
            <button
              onClick={this.handleReload}
              className="chrome-btn px-5 py-2 !rounded-full"
              style={{
                minWidth: "10rem",
              }}
            >
              Reload
            </button>
            {this.state.error && (
              <details className="mt-6 text-left">
                <summary className="font-mono text-2xs uppercase text-chalk-ghost cursor-pointer">
                  Error details
                </summary>
                <pre className="mt-3 p-3 rounded-xl bg-white/[0.02] text-[0.55rem] text-chalk-faint overflow-auto max-h-40 font-mono">
                  {this.state.error.message}
                  {this.state.error.stack && "\n" + this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}