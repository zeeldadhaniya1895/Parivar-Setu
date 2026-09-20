import { Badge } from "@/components/ui/badge";
import type { SourceRecord } from "@/lib/engine/types";
import { maskUid, rupees, RELATION_LABELS, SOURCE_LABELS } from "@/lib/format";

function Row({ label, value }: { label: string; value: string | null }) {
  if (value === null || value === "") return null;
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

/** One raw source record, exactly as the department stored it (IDs masked). */
export function RecordCard({ record }: { record: SourceRecord }) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-xs">{record.id}</span>
        <Badge variant="secondary">{SOURCE_LABELS[record.source] ?? record.source}</Badge>
      </div>
      <p className="mb-2 text-base font-medium">{record.full_name}</p>
      <dl className="space-y-0.5">
        <Row label="DOB" value={record.dob} />
        <Row label="Gender" value={record.gender} />
        <Row label="Relation" value={record.relation_to_head ? (RELATION_LABELS[record.relation_to_head] ?? record.relation_to_head) : null} />
        <Row label="Marital" value={record.marital_status} />
        <Row label="Guardian" value={record.guardian_name} />
        <Row label="Card" value={record.household_ref} />
        <Row label="Place" value={`${record.village}, ${record.taluka}, ${record.district}`} />
        <Row label="Address" value={record.address} />
        <Row label="Aadhaar" value={maskUid(record.uid_last4)} />
        <Row label="Income" value={record.income_declared === null ? null : `${rupees(record.income_declared)} / year`} />
        <Row label="Scheme" value={record.scheme_code} />
        <Row label="Benefit" value={record.benefit_amount === null ? null : `${rupees(record.benefit_amount)} / month`} />
        <Row label="Died" value={record.date_of_death} />
      </dl>
    </div>
  );
}
