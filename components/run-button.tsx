"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Calls the pipeline route handler, then refreshes the server-rendered page. */
export function RunButton({ label = "Run resolution" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/pipeline/run", { method: "POST" });
      const body = (await response.json()) as { ok: boolean; error?: string; durationMs?: number };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Run failed");
      setMessage(`Done in ${((body.durationMs ?? 0) / 1000).toFixed(1)} s`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={run} disabled={busy} size="lg">
        {busy ? "Running…" : label}
      </Button>
      {message && <span className="text-sm text-muted-foreground" role="status">{message}</span>}
    </div>
  );
}
