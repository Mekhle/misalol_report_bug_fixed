"use client";

import Link from "next/link";
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; resetKey?: string };
type State = { hasError: boolean };

export class RuntimeErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidUpdate(previous: Props) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) this.setState({ hasError: false });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Dashboard route rendering failed", error, info.componentStack);
  }

  private retry = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#07070a] px-5 text-zinc-200">
        <section className="w-full max-w-md rounded-2xl border border-white/[.08] bg-[#0d0d12] p-6 text-center shadow-2xl">
          <h1 className="text-lg font-semibold text-white">This dashboard page could not load</h1>
          <p className="mt-2 text-sm text-zinc-500">Your changes are safe. Try loading the page again or return to the dashboard.</p>
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" onClick={this.retry} className="rounded-xl bg-[#e11d48] px-4 py-2.5 text-sm font-medium text-white hover:brightness-110">Try again</button>
            <Link href="/" className="rounded-xl border border-white/[.1] px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-white/[.06]">Dashboard</Link>
          </div>
        </section>
      </main>
    );
  }
}
