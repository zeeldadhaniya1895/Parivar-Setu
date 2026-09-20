"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ANSWER_MAX } from "@/lib/grievances";

/** An officer's reply to one grievance. Posts to the route handler, then refreshes the list. */
export function AnswerForm({ id }: { id: number }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/grievances/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officerResponse: answer }),
      });
      const body = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Could not save the answer");
      setAnswer("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the answer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor={`answer-${id}`} className="text-sm font-medium">Your answer to the citizen</label>
      <textarea
        id={`answer-${id}`}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        maxLength={ANSWER_MAX}
        rows={3}
        required
        placeholder="Explain why the scheme is not reaching them and what happens next."
        className="w-full rounded-lg border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{answer.length}/{ANSWER_MAX}</span>
        <div className="flex items-center gap-3">
          {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
          <Button type="submit" disabled={busy || answer.trim().length < 2}>
            {busy ? "Saving…" : "Send answer"}
          </Button>
        </div>
      </div>
    </form>
  );
}
