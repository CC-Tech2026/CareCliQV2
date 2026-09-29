import * as React from "react";
import { AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { reportClientError } from "@/lib/error-reporting";

/**
 * Catches render errors so one broken value can't blank the whole app.
 *
 * - PageErrorBoundary wraps the page area inside AppLayout / HubLayout: the
 *   sidebar stays usable, and navigating to another page clears the error.
 * - AppErrorBoundary wraps everything as a last resort.
 *
 * The fallback copy is plain English on purpose: it must render even when
 * the provider that failed is the accessibility/translation context.
 */

interface Props {
  scope: "page" | "app";
  resetKey?: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportClientError({
      kind: this.props.scope === "app" ? "app-crash" : "page-crash",
      error,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return this.props.scope === "app" ? <AppFallback /> : <PageFallback onRetry={this.retry} />;
  }
}

function FallbackCard({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div role="alert" className="w-full max-w-md mx-auto bg-white rounded-2xl p-8 text-center"
      style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
      <div className="h-14 w-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
        style={{ background: "rgba(241,115,138,0.10)" }}>
        <AlertCircle className="h-7 w-7" style={{ color: "#F1738A" }} />
      </div>
      <h1 className="text-[20px] font-bold mb-2" style={{ color: "#1C1626" }}>{title}</h1>
      <p className="text-[14px] mb-6" style={{ color: "var(--cc-text)" }}>{body}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>
    </div>
  );
}

const primaryButton = "inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90";
const secondaryButton = "inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-colors hover:bg-black/5";

function PageFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-16 px-4">
      <FallbackCard
        title="This page ran into a problem"
        body="The error has been reported. You can try again, or use the menu to go to another page — your other work isn't affected."
      >
        <button type="button" onClick={onRetry} className={primaryButton} style={{ background: "var(--cc-cta)" }}>
          Try again
        </button>
        <button type="button" onClick={() => window.location.reload()} className={secondaryButton}
          style={{ color: "var(--cc-text)", border: "1px solid var(--cc-border)" }}>
          Reload
        </button>
      </FallbackCard>
    </div>
  );
}

function AppFallback() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4" style={{ background: "var(--cc-soft)" }}>
      <FallbackCard
        title="CareCliQ ran into a problem"
        body="The error has been reported. Reloading usually fixes it."
      >
        <button type="button" onClick={() => window.location.reload()} className={primaryButton}
          style={{ background: "var(--cc-cta)" }}>
          Reload
        </button>
      </FallbackCard>
    </div>
  );
}

export function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary scope="page" resetKey={location}>{children}</ErrorBoundary>;
}

export function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary scope="app">{children}</ErrorBoundary>;
}
