import Link from "next/link";
import { notFound } from "next/navigation";
import { AssistantChat } from "@/components/assistant-chat";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentAsOfDate } from "@/lib/asof";
import { getFamilyDetail, type EligibilityRow } from "@/lib/db/queries";
import { ageFromDob } from "@/lib/engine/eligibility";
import { RELATION_LABELS } from "@/lib/format";
import { schemeIsDiscoveryOnly, schemeName, schemeNameGu, schemeScope, schemesConfig } from "@/lib/schemes";

function Reasons({ row }: { row: EligibilityRow }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {row.reasons.filter((r) => !r.passed).length === 0
          ? "All rules pass"
          : `${row.reasons.filter((r) => !r.passed).length} rule(s) fail`}
      </summary>
      <ul className="mt-1 space-y-0.5">
        {row.reasons.map((r) => (
          <li key={r.rule} className={r.passed ? "" : "text-destructive"}>
            {r.passed ? "✓" : "✗"} {r.rule}{" "}
            <span className="text-muted-foreground">
              (actual: {r.actual === null ? "unknown" : String(r.actual)})
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function CitizenFamilyPage({
  params,
}: {
  params: Promise<{ familyId: string }>;
}) {
  const { familyId } = await params;
  const detail = await getFamilyDetail(familyId);
  if (!detail) notFound();

  const { family, members, enrollments, eligibility } = detail;
  const asOf = currentAsOfDate();

  const enrolledKeys = new Set(
    enrollments.map((e) =>
      schemeScope(e.scheme_code) === "family"
        ? `family|${e.scheme_code}`
        : `${e.person_id}|${e.scheme_code}`,
    ),
  );
  const isEnrolled = (row: EligibilityRow) =>
    enrolledKeys.has(
      row.person_id === null
        ? `family|${row.scheme_code}`
        : `${row.person_id}|${row.scheme_code}`,
    );
  const schemeOrder = schemesConfig.schemes.map((s) => s.code);
  const sortRows = (rows: EligibilityRow[]) =>
    [...rows].sort(
      (a, b) =>
        schemeOrder.indexOf(a.scheme_code) - schemeOrder.indexOf(b.scheme_code),
    );

  const familyRows = sortRows(eligibility.filter((r) => r.person_id === null));
  const personRows = eligibility.filter((r) => r.person_id !== null);
  const memberOrder = new Map(members.map((m, i) => [m.person.id, i]));
  const sortedPersonRows = [...personRows].sort(
    (a, b) =>
      (memberOrder.get(a.person_id ?? "") ?? 0) -
        (memberOrder.get(b.person_id ?? "") ?? 0) ||
      schemeOrder.indexOf(a.scheme_code) - schemeOrder.indexOf(b.scheme_code),
  );

  // Citizen sees first name + relation, not full details
  const nameOf = new Map(
    members.map((m) => [m.person.id, m.person.canonical_name.split(" ")[0]]),
  );

  const EnrolledCell = ({ row }: { row: EligibilityRow }) =>
    schemeIsDiscoveryOnly(row.scheme_code) ? (
      <span className="text-muted-foreground">discovery only</span>
    ) : isEnrolled(row) ? (
      <Badge variant="secondary">Enrolled</Badge>
    ) : (
      <span className="text-muted-foreground">Not enrolled</span>
    );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/citizen" className="hover:text-foreground">
            ← Find my family
          </Link>
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
          {family.id}
        </h1>
        <p className="text-muted-foreground">
          {family.village}, {family.taluka}, {family.district} ·{" "}
          {members.length} member{members.length === 1 ? "" : "s"}
        </p>
      </div>

      <DemoNotice />

      {/* Members summary */}
      <Card>
        <CardHeader>
          <CardTitle>Family members</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Relation</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Gender</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map(({ member, person }) => {
                  const age = ageFromDob(person.dob, asOf);
                  return (
                    <TableRow key={person.id}>
                      <TableCell className="font-medium">
                        {person.canonical_name.split(" ")[0]}
                        {person.is_deceased && (
                          <Badge variant="destructive" className="ml-2">
                            Deceased
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {member.relation_to_head
                          ? (RELATION_LABELS[member.relation_to_head] ??
                              member.relation_to_head)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {age !== null ? `${age} years` : "—"}
                      </TableCell>
                      <TableCell>{person.gender ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Eligibility: family schemes */}
      <Card>
        <CardHeader>
          <CardTitle>Eligible schemes</CardTitle>
          <CardDescription>
            Schemes the family and its members may be eligible for under simplified demo criteria.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Family schemes
          </h3>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scheme</TableHead>
                  <TableHead>Eligible</TableHead>
                  <TableHead>Enrollment</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {familyRows.map((row) => (
                  <TableRow key={row.scheme_code}>
                    <TableCell>
                      <div>
                        <span>{schemeName(row.scheme_code)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {schemeNameGu(row.scheme_code)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.eligible ? "default" : "outline"}
                      >
                        {row.eligible ? "Eligible" : "Not eligible"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <EnrolledCell row={row} />
                    </TableCell>
                    <TableCell>
                      <Reasons row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <h3 className="text-sm font-semibold text-muted-foreground">
            Member schemes
          </h3>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Scheme</TableHead>
                  <TableHead>Eligible</TableHead>
                  <TableHead>Enrollment</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPersonRows.map((row) => (
                  <TableRow
                    key={`${row.person_id}|${row.scheme_code}`}
                  >
                    <TableCell>
                      {nameOf.get(row.person_id ?? "") ?? row.person_id}
                    </TableCell>
                    <TableCell>
                      <div>
                        <span>{schemeName(row.scheme_code)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {schemeNameGu(row.scheme_code)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.eligible ? "default" : "outline"}
                      >
                        {row.eligible ? "Eligible" : "Not eligible"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <EnrolledCell row={row} />
                    </TableCell>
                    <TableCell>
                      <Reasons row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Assistant chat */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Ask the assistant</h2>
          <p className="text-sm text-muted-foreground">
            Ask about your family&apos;s schemes in English or Gujarati. The assistant answers only
            from the facts above.
          </p>
        </div>
        <AssistantChat familyId={family.id} />
      </section>
    </div>
  );
}
