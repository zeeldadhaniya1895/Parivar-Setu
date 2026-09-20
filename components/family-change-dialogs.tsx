"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RELATIONS, DOCUMENT_MAX, NOTE_MAX } from "@/lib/family-changes";
import { RELATION_LABELS } from "@/lib/format";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const areaClass =
  "w-full rounded-lg border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

const relationOptions = RELATIONS.filter((r) => r !== "head");

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function RelationSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass} required>
      <option value="" disabled>Choose relation</option>
      {relationOptions.map((r) => (
        <option key={r} value={r}>{RELATION_LABELS[r] ?? r}</option>
      ))}
    </select>
  );
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json()) as { ok: boolean; error?: string } & Record<string, unknown>;
  if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not save the change");
  return data;
}

// ---- add a member ------------------------------------------------------------------------

export function AddMemberDialog({ familyId, today }: { familyId: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [f, setF] = useState({
    name: "", dob: "", gender: "", relation: "", maritalStatus: "unmarried", isStudent: false,
    reason: "birth", documentRef: "", note: "",
  });
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF((prev) => ({ ...prev, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/family-changes/member", { familyId, ...f });
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the member");
    } finally {
      setBusy(false);
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setDone(false);
      setError(null);
      setF((prev) => ({ ...prev, name: "", dob: "", documentRef: "", note: "" }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Add a member</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add a member to this family</DialogTitle>
          <DialogDescription>
            For a birth, or someone missing from the family. A supporting document reference is required and is recorded with the change.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <p role="status" className="py-6 text-center text-sm font-medium text-green-700">Member added. The family has been updated.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="Full name" htmlFor="am-name" hint="First name, father's or husband's name, surname">
              <Input id="am-name" value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date of birth" htmlFor="am-dob">
                <Input id="am-dob" type="date" max={today} value={f.dob} onChange={(e) => set("dob", e.target.value)} required />
              </Field>
              <Field label="Gender" htmlFor="am-gender">
                <select id="am-gender" value={f.gender} onChange={(e) => set("gender", e.target.value)} className={selectClass} required>
                  <option value="" disabled>Choose</option>
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                </select>
              </Field>
              <Field label="Relation to head" htmlFor="am-rel">
                <RelationSelect id="am-rel" value={f.relation} onChange={(v) => set("relation", v)} />
              </Field>
              <Field label="Marital status" htmlFor="am-marital">
                <select id="am-marital" value={f.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)} className={selectClass}>
                  <option value="unmarried">Unmarried</option>
                  <option value="married">Married</option>
                  <option value="widowed">Widowed</option>
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.isStudent} onChange={(e) => set("isStudent", e.target.checked)} /> Currently a student
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Reason" htmlFor="am-reason">
                <select id="am-reason" value={f.reason} onChange={(e) => set("reason", e.target.value)} className={selectClass}>
                  <option value="birth">Birth</option>
                  <option value="marriage">Marriage into the family</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Document reference" htmlFor="am-doc" hint="e.g. birth certificate number">
                <Input id="am-doc" value={f.documentRef} onChange={(e) => set("documentRef", e.target.value)} required maxLength={DOCUMENT_MAX} />
              </Field>
            </div>
            <Field label="Note (optional)" htmlFor="am-note">
              <textarea id="am-note" rows={2} maxLength={NOTE_MAX} value={f.note} onChange={(e) => set("note", e.target.value)} className={areaClass} />
            </Field>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add member"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- separate or move members ------------------------------------------------------------

export interface MemberOption {
  personId: string;
  name: string;
  relation: string | null;
  age: number | null;
  isDeceased: boolean;
}

interface Lookup {
  id: string;
  status: string;
  headName: string | null;
  village: string;
  taluka: string;
  district: string;
  memberCount: number;
}

export function SeparateMembersDialog({
  familyId, members, place, today,
}: {
  familyId: string;
  members: MemberOption[];
  place: { village: string; taluka: string; district: string };
  today: string;
}) {
  const router = useRouter();
  const movable = members.filter((m) => !m.isDeceased);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ familyId: string; isNew: boolean } | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [headId, setHeadId] = useState("");
  const [relations, setRelations] = useState<Record<string, string>>({});
  const [village, setVillage] = useState(place.village);
  const [taluka, setTaluka] = useState(place.taluka);
  const [district, setDistrict] = useState(place.district);
  const [income, setIncome] = useState("");
  const [targetId, setTargetId] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [reason, setReason] = useState("separation");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [documentRef, setDocumentRef] = useState("");
  const [note, setNote] = useState("");
  const [markMarried, setMarriedFlag] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  const tooMany = selected.length >= members.length;
  const effectiveHead = selected.includes(headId) ? headId : (selected[0] ?? "");

  function toggle(personId: string) {
    setSelected((prev) => (prev.includes(personId) ? prev.filter((p) => p !== personId) : [...prev, personId]));
  }

  async function checkTarget() {
    setLookup(null);
    setLookupError(null);
    const id = targetId.trim();
    if (id === "") return;
    try {
      const response = await fetch(`/api/families/lookup?id=${encodeURIComponent(id)}`);
      const data = (await response.json()) as { ok: boolean; error?: string; family?: Lookup };
      if (!response.ok || !data.ok || !data.family) throw new Error(data.error ?? "Family not found");
      setLookup(data.family);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Family not found");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const destination =
        mode === "new"
          ? { kind: "new", headPersonId: effectiveHead, relations, village, taluka, district, income: Number(income) }
          : { kind: "existing", familyId: targetId.trim(), relations };
      const data = await post("/api/family-changes/move", {
        sourceFamilyId: familyId, memberPersonIds: selected, reason, effectiveDate, documentRef, note,
        confirmVerified: confirmed, markMarried, destination,
      });
      setResult({ familyId: String(data.familyId), isNew: mode === "new" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the change");
    } finally {
      setBusy(false);
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setResult(null);
      setError(null);
      setSelected([]);
      setConfirmed(false);
      setDocumentRef("");
      setNote("");
    }
  }

  const relationRows = selected.filter((id) => id !== (mode === "new" ? effectiveHead : ""));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Separate or move members</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Separate or move members</DialogTitle>
          <DialogDescription>
            The chosen members leave this family. They start a new family or join an existing one. A verified supporting document is required.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 py-4 text-center" role="status">
            <p className="text-sm font-medium text-green-700">
              Done. {result.isNew ? "A new family was created." : "The members joined the other family."}
            </p>
            <Link href={`/officer/families/${result.familyId}`} className="font-mono text-primary underline underline-offset-4">
              Open {result.familyId}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Who is leaving</legend>
              {movable.map((m) => (
                <label key={m.personId} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selected.includes(m.personId)} onChange={() => toggle(m.personId)} />
                  <span>{m.name}</span>
                  <span className="text-muted-foreground">
                    {m.relation ? (RELATION_LABELS[m.relation] ?? m.relation) : ""}{m.age !== null ? ` · ${m.age}` : ""}
                  </span>
                </label>
              ))}
              {tooMany && <p className="text-xs text-destructive">At least one member must stay in this family.</p>}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Where they are going</legend>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> A new family</label>
                <label className="flex items-center gap-2"><input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> An existing family</label>
              </div>
            </fieldset>

            {mode === "new" ? (
              <div className="space-y-3 rounded-lg border p-3">
                <Field label="Head of the new family" htmlFor="sm-head">
                  <select id="sm-head" value={effectiveHead} onChange={(e) => setHeadId(e.target.value)} className={selectClass} required disabled={selected.length === 0}>
                    {selected.length === 0 && <option value="">Choose members first</option>}
                    {selected.map((id) => (
                      <option key={id} value={id}>{members.find((m) => m.personId === id)?.name ?? id}</option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Village" htmlFor="sm-village"><Input id="sm-village" value={village} onChange={(e) => setVillage(e.target.value)} required /></Field>
                  <Field label="Taluka" htmlFor="sm-taluka"><Input id="sm-taluka" value={taluka} onChange={(e) => setTaluka(e.target.value)} required /></Field>
                  <Field label="District" htmlFor="sm-district"><Input id="sm-district" value={district} onChange={(e) => setDistrict(e.target.value)} required /></Field>
                </div>
                <Field label="New family's annual income (₹)" htmlFor="sm-income" hint="Their own household income, used for scheme eligibility">
                  <Input id="sm-income" type="number" min={0} step={1} value={income} onChange={(e) => setIncome(e.target.value)} required />
                </Field>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border p-3">
                <Field label="Family ID to move them into" htmlFor="sm-target">
                  <Input id="sm-target" value={targetId} onChange={(e) => { setTargetId(e.target.value); setLookup(null); }} onBlur={checkTarget} placeholder="GJ-FID-000123" required />
                </Field>
                {lookup && (
                  <p className="text-sm text-green-700" role="status">
                    {lookup.id}: headed by {lookup.headName ?? "unknown"}, {lookup.village}, {lookup.taluka} ({lookup.memberCount} members)
                  </p>
                )}
                {lookupError && <p className="text-sm text-destructive" role="alert">{lookupError}</p>}
              </div>
            )}

            {relationRows.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  Relation to the head of {mode === "new" ? "the new family" : "that family"}
                </legend>
                {relationRows.map((id) => (
                  <div key={id} className="grid grid-cols-2 items-center gap-2 text-sm">
                    <span>{members.find((m) => m.personId === id)?.name ?? id}</span>
                    <RelationSelect id={`sm-rel-${id}`} value={relations[id] ?? ""} onChange={(v) => setRelations((prev) => ({ ...prev, [id]: v }))} />
                  </div>
                ))}
              </fieldset>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Reason" htmlFor="sm-reason">
                <select id="sm-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={selectClass}>
                  <option value="separation">Separation (own household)</option>
                  <option value="marriage">Marriage</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Effective date" htmlFor="sm-date">
                <Input id="sm-date" type="date" max={today} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
              </Field>
            </div>
            <Field label="Document reference" htmlFor="sm-doc" hint="e.g. marriage certificate number. One document can support one change only.">
              <Input id="sm-doc" value={documentRef} onChange={(e) => setDocumentRef(e.target.value)} required maxLength={DOCUMENT_MAX} />
            </Field>
            <Field label="Note (optional)" htmlFor="sm-note">
              <textarea id="sm-note" rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} className={areaClass} />
            </Field>
            {reason === "marriage" && selected.length === 1 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={markMarried} onChange={(e) => setMarriedFlag(e.target.checked)} /> Record the person as married
              </label>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required />
              <span>I have verified the supporting document. This change is recorded in the audit log and cannot be undone here.</span>
            </label>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={busy || selected.length === 0 || tooMany || !confirmed}>
                {busy ? "Saving…" : mode === "new" ? "Create new family" : "Move members"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
