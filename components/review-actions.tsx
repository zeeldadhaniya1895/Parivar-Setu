"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ReviewActions({ pairKey }: { pairKey: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDecision(decision: "approved" | "rejected") {
    if (loading) return;
    setLoading(decision);
    setError(null);

    try {
      const res = await fetch(`/api/review/${encodeURIComponent(pairKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to record decision");
      }
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
      setLoading(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          onClick={() => handleDecision("approved")}
          disabled={loading !== null}
          variant="default"
          className="bg-green-600 hover:bg-green-700"
        >
          {loading === "approved" ? "Approving..." : "Approve"}
        </Button>
        <Button
          onClick={() => handleDecision("rejected")}
          disabled={loading !== null}
          variant="destructive"
        >
          {loading === "rejected" ? "Rejecting..." : "Reject"}
        </Button>
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}
