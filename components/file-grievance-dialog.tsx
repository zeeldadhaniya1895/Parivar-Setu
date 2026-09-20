"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MESSAGE_MAX, MESSAGE_MIN } from "@/lib/grievances";

type Lang = "en" | "gu";

const TEXT = {
  en: {
    open: "Ask an officer why",
    title: "Ask an officer",
    about: (scheme: string, who: string) => `Your question about ${scheme} (${who}) goes to a department officer. Their answer will appear on this page.`,
    label: "Your question",
    placeholder: "Why am I not getting this scheme?",
    send: "Send question",
    sending: "Sending…",
    sent: "Your question was sent. The officer's answer will appear on this page.",
    already: "You already have an open question about this scheme. An officer will answer it here.",
    failed: "Could not send your question. Please try again.",
  },
  gu: {
    open: "અધિકારીને કારણ પૂછો",
    title: "અધિકારીને પૂછો",
    about: (scheme: string, who: string) => `${scheme} (${who}) વિશેનો તમારો પ્રશ્ન વિભાગના અધિકારી પાસે જશે. તેમનો જવાબ આ પાના પર દેખાશે.`,
    label: "તમારો પ્રશ્ન",
    placeholder: "મને આ યોજનાનો લાભ કેમ મળતો નથી?",
    send: "પ્રશ્ન મોકલો",
    sending: "મોકલી રહ્યા છીએ…",
    sent: "તમારો પ્રશ્ન મોકલાઈ ગયો. અધિકારીનો જવાબ આ પાના પર દેખાશે.",
    already: "આ યોજના વિશે તમારો એક પ્રશ્ન પહેલેથી ખુલ્લો છે. અધિકારી અહીં જવાબ આપશે.",
    failed: "તમારો પ્રશ્ન મોકલી શકાયો નથી. કૃપા કરીને ફરી પ્રયાસ કરો.",
  },
} as const;

interface Props {
  familyId: string;
  personId: string | null;
  schemeCode: string;
  schemeName: string;
  /** Who the question is about, e.g. "Savita" or "whole family" */
  who: string;
  lang: Lang;
}

export function FileGrievanceDialog({ familyId, personId, schemeCode, schemeName, who, lang }: Props) {
  const t = TEXT[lang];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"sent" | "already" | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/grievances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, personId, schemeCode, message }),
      });
      const body = (await response.json()) as { ok: boolean; error?: string; existing?: boolean };
      if (!response.ok || !body.ok) throw new Error(body.error ?? t.failed);
      setDone(body.existing ? "already" : "sent");
      setMessage("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setDone(null);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{t.open}</DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.about(schemeName, who)}</DialogDescription>
        </DialogHeader>
        {done ? (
          <p className="py-6 text-center text-sm font-medium text-green-700" role="status">
            {done === "sent" ? t.sent : t.already}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor={`q-${schemeCode}-${personId ?? "family"}`}>{t.label}</Label>
              <textarea
                id={`q-${schemeCode}-${personId ?? "family"}`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                minLength={MESSAGE_MIN}
                maxLength={MESSAGE_MAX}
                rows={4}
                required
                placeholder={t.placeholder}
                className="w-full rounded-lg border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="text-right text-xs text-muted-foreground">{message.length}/{MESSAGE_MAX}</span>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={busy || message.trim().length < MESSAGE_MIN}>
                {busy ? t.sending : t.send}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
