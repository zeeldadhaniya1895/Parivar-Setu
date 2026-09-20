"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function CitizenHome() {
  const router = useRouter();
  const [familyId, setFamilyId] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = familyId.trim();
    if (trimmed) {
      router.push(`/citizen/${encodeURIComponent(trimmed)}`);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 py-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Find my family</h1>
        <p className="text-muted-foreground">
          Enter your Family ID to see eligible welfare schemes and ask the assistant.
        </p>
      </div>

      <Alert>
        <AlertTitle>Demo mode</AlertTitle>
        <AlertDescription>
          All data is synthetic and all eligibility thresholds are simplified demo values, not official criteria.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Family ID lookup</CardTitle>
          <CardDescription>
            Your Family ID looks like <span className="font-mono">GJ-FID-000001</span>.
            Enter it below to look up your family.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-3">
            <Input
              id="family-id-input"
              type="text"
              placeholder="GJ-FID-000001"
              value={familyId}
              onChange={(e) => setFamilyId(e.target.value)}
              className="font-mono"
              autoComplete="off"
            />
            <Button type="submit" disabled={familyId.trim() === ""}>
              Look up
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
