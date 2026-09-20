import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AssistantChat } from "@/components/assistant-chat";
import { DemoNotice } from "@/components/demo-notice";
import { FileGrievanceDialog } from "@/components/file-grievance-dialog";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentAsOfDate } from "@/lib/asof";
import { benefitStatus, STATUS_LABELS, isReceiving, type BenefitStatus, type Lang } from "@/lib/benefit-status";
import { grievancesForFamily } from "@/lib/db/grievances";
import { getFamilySummary } from "@/lib/db/queries";
import { ageFromDob } from "@/lib/engine/eligibility";
import { RELATION_LABELS, RELATION_LABELS_GU, rupees } from "@/lib/format";
import type { GrievanceRow } from "@/lib/grievances";
import { describeRule } from "@/lib/rule-text";
import { schemeName, schemeNameGu, schemesConfig } from "@/lib/schemes";

const T = {
  en: {
    back: "← Find my family",
    family: "Your family",
    members: "Family members",
    name: "Name", relation: "Relation", age: "Age", gender: "Gender", years: "years", deceased: "Deceased",
    receiving: "Benefits your family is receiving",
    receivingNone: "No benefit is reaching this family yet.",
    waiting: "Eligible, waiting for officer verification",
    waitingHelp: "These schemes need an officer to verify your records before the benefit starts.",
    notEligible: "Not eligible under the demo rules",
    notEligibleHelp: "If you think this is wrong, ask an officer.",
    wholeFamily: "Whole family",
    perMonth: "a month",
    rulesMet: "Why",
    questionSent: "Question sent, waiting for the officer",
    questionAnswered: "Answered, see below",
    questions: "Your questions to the officer",
    questionsNone: "You have not asked anything yet.",
    officerAnswer: "Officer's answer",
    waitingAnswer: "Waiting for an answer",
    answered: "Answered",
    unavailable: "Questions to officers are not available right now.",
    assistant: "Ask the assistant",
    assistantHelp: "Ask about your family's schemes in English or Gujarati. The assistant answers only from the facts above.",
    schemesFor: "for",
  },
  gu: {
    back: "← મારો પરિવાર શોધો",
    family: "તમારો પરિવાર",
    members: "પરિવારના સભ્યો",
    name: "નામ", relation: "સંબંધ", age: "ઉંમર", gender: "જાતિ", years: "વર્ષ", deceased: "અવસાન",
    receiving: "તમારા પરિવારને મળતા લાભ",
    receivingNone: "હજી આ પરિવારને કોઈ લાભ મળતો નથી.",
    waiting: "પાત્ર, અધિકારીની ચકાસણીની રાહ",
    waitingHelp: "આ યોજનાઓમાં લાભ શરૂ થાય તે પહેલાં અધિકારી તમારા રેકોર્ડ ચકાસે છે.",
    notEligible: "ડેમો નિયમો મુજબ પાત્ર નથી",
    notEligibleHelp: "જો તમને ભૂલ લાગે તો અધિકારીને પૂછો.",
    wholeFamily: "આખો પરિવાર",
    perMonth: "દર મહિને",
    rulesMet: "કારણ",
    questionSent: "પ્રશ્ન મોકલાયો, અધિકારીના જવાબની રાહ",
    questionAnswered: "જવાબ મળ્યો, નીચે જુઓ",
    questions: "અધિકારીને તમારા પ્રશ્નો",
    questionsNone: "તમે હજી કંઈ પૂછ્યું નથી.",
    officerAnswer: "અધિકારીનો જવાબ",
    waitingAnswer: "જવાબની રાહ",
    answered: "જવાબ મળ્યો",
    unavailable: "અધિકારીને પ્રશ્નો પૂછવાની સુવિધા હાલમાં ઉપલબ્ધ નથી.",
    assistant: "સહાયકને પૂછો",
    assistantHelp: "તમારા પરિવારની યોજનાઓ વિશે અંગ્રેજી અથવા ગુજરાતીમાં પૂછો. સહાયક ફક્ત ઉપર આપેલી હકીકતોના આધારે જવાબ આપે છે.",
    schemesFor: "માટે",
  },
} as const;

const STATUS_ORDER: BenefitStatus[] = ["receiving_record", "receiving_auto", "awaiting_verification", "not_eligible"];
const STATUS_VARIANT = {
  receiving_record: "secondary", receiving_auto: "default", awaiting_verification: "outline", not_eligible: "outline",
} as const;

export default async function CitizenFamilyPage({
  params, searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { familyId } = await params;
  const { lang: langParam } = await searchParams;
  const lang: Lang = langParam === "gu" ? "gu" : "en";
  const t = T[lang];
  const langQuery = lang === "gu" ? "?lang=gu" : "";

  const summary = await getFamilySummary(familyId);
  if (!summary) notFound();
  if (summary.family.status === "merged" && summary.mergedInto) {
    redirect(`/citizen/${summary.mergedInto.id}${langQuery}`);
  }
  const { family, members, enrollments, eligibility } = summary;
  const asOf = currentAsOfDate();

  let grievances: GrievanceRow[] = [];
  let questionsAvailable = true;
  try {
    grievances = await grievancesForFamily(family.id);
  } catch (error) {
    console.error("grievances unavailable", error);
    questionsAvailable = false;
  }

  const firstName = (name: string) => name.split(" ")[0];
  const memberByPerson = new Map(members.map((m, i) => [m.person.id, { ...m, index: i }]));
  const relationLabel = (relation: string | null) =>
    relation ? ((lang === "gu" ? RELATION_LABELS_GU : RELATION_LABELS)[relation] ?? relation) : "—";
  const schemeByCode = new Map(schemesConfig.schemes.map((s) => [s.code, s]));
  const schemeOrder = schemesConfig.schemes.map((s) => s.code);
  const schemeTitle = (code: string) => (lang === "gu" ? schemeNameGu(code) : schemeName(code));

  const statusEnrollments = enrollments.map((e) => ({ personId: e.person_id, schemeCode: e.scheme_code, basis: e.basis }));
  const rows = eligibility
    .map((row) => {
      const scheme = schemeByCode.get(row.scheme_code);
      const status = benefitStatus(
        { schemeCode: row.scheme_code, personId: row.person_id, eligible: row.eligible }, statusEnrollments, scheme,
      );
      const covering = enrollments.find(
        (e) => e.scheme_code === row.scheme_code && (scheme?.scope === "family" || e.person_id === row.person_id),
      );
      const member = row.person_id ? memberByPerson.get(row.person_id) : undefined;
      return {
        row, status,
        amount: covering?.monthly_amount ?? null,
        who: row.person_id === null ? t.wholeFamily : firstName(member?.person.canonical_name ?? row.person_id),
        memberIndex: member?.index ?? -1,
      };
    })
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        schemeOrder.indexOf(a.row.scheme_code) - schemeOrder.indexOf(b.row.scheme_code) ||
        a.memberIndex - b.memberIndex,
    );

  const grievanceFor = (personId: string | null, code: string) =>
    grievances.find((g) => g.scheme_code === code && (g.person_id ?? null) === personId && g.status === "pending") ??
    grievances.find((g) => g.scheme_code === code && (g.person_id ?? null) === personId);

  const receiving = rows.filter((r) => isReceiving(r.status));
  const waiting = rows.filter((r) => r.status === "awaiting_verification");
  const notEligible = rows.filter((r) => r.status === "not_eligible");

  function SchemeItem({ item }: { item: (typeof rows)[number] }) {
    const { row, status, amount, who } = item;
    const existing = grievanceFor(row.person_id, row.scheme_code);
    const reasons = row.reasons.filter((r) => !(r.passed && r.rule.startsWith("is_deceased")));
    return (
      <li className="space-y-2 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="font-medium">{schemeTitle(row.scheme_code)}</div>
            <div className="text-sm text-muted-foreground">{t.schemesFor} {who}</div>
          </div>
          <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status][lang]}</Badge>
        </div>
        {isReceiving(status) && amount !== null && amount > 0 && (
          <div className="text-sm">{rupees(amount)} {t.perMonth}</div>
        )}
        <ul className="space-y-0.5 text-xs">
          {reasons.map((r) => (
            <li key={r.rule} className={r.passed ? "text-muted-foreground" : "text-destructive"}>
              {r.passed ? "✓" : "✗"} {describeRule(r.rule, lang)}
            </li>
          ))}
        </ul>
        {!isReceiving(status) && questionsAvailable && (
          existing ? (
            <a href="#questions" className="text-sm text-primary underline-offset-4 hover:underline">
              {existing.status === "resolved" ? t.questionAnswered : t.questionSent}
            </a>
          ) : (
            <FileGrievanceDialog
              familyId={family.id} personId={row.person_id} schemeCode={row.scheme_code}
              schemeName={schemeTitle(row.scheme_code)} who={who} lang={lang}
            />
          )
        )}
      </li>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={`/citizen${langQuery}`} className="text-sm text-muted-foreground hover:text-foreground">{t.back}</Link>
          <div className="flex gap-2" role="group" aria-label="Language">
            <Link href={`/citizen/${family.id}`} className={buttonVariants({ variant: lang === "en" ? "default" : "outline", size: "sm" })}>English</Link>
            <Link href={`/citizen/${family.id}?lang=gu`} className={buttonVariants({ variant: lang === "gu" ? "default" : "outline", size: "sm" })}>ગુજરાતી</Link>
          </div>
        </div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">{family.id}</h1>
        <p className="text-muted-foreground">
          {t.family} &middot; {family.village}, {family.taluka}, {family.district} &middot; {members.length}
        </p>
      </div>

      <DemoNotice />

      <Card>
        <CardHeader><CardTitle>{t.members}</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.name}</TableHead>
                  <TableHead>{t.relation}</TableHead>
                  <TableHead>{t.age}</TableHead>
                  <TableHead>{t.gender}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map(({ member, person }) => {
                  const age = ageFromDob(person.dob, asOf);
                  return (
                    <TableRow key={person.id}>
                      <TableCell className="font-medium">
                        {firstName(person.canonical_name)}
                        {person.is_deceased && <Badge variant="destructive" className="ml-2">{t.deceased}</Badge>}
                      </TableCell>
                      <TableCell>{relationLabel(member.relation_to_head)}</TableCell>
                      <TableCell>{age !== null ? `${age} ${t.years}` : "—"}</TableCell>
                      <TableCell>{person.gender ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t.receiving}</CardTitle></CardHeader>
        <CardContent>
          {receiving.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.receivingNone}</p>
          ) : (
            <ul className="divide-y">{receiving.map((item) => <SchemeItem key={`${item.row.person_id}|${item.row.scheme_code}`} item={item} />)}</ul>
          )}
        </CardContent>
      </Card>

      {waiting.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t.waiting}</CardTitle>
            <CardDescription>{t.waitingHelp}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">{waiting.map((item) => <SchemeItem key={`${item.row.person_id}|${item.row.scheme_code}`} item={item} />)}</ul>
          </CardContent>
        </Card>
      )}

      {notEligible.length > 0 && (
        <details className="rounded-lg border">
          <summary className="cursor-pointer p-4 font-medium">
            {t.notEligible} ({notEligible.length})
          </summary>
          <div className="px-4 pb-4">
            <p className="text-sm text-muted-foreground">{t.notEligibleHelp}</p>
            <ul className="divide-y">{notEligible.map((item) => <SchemeItem key={`${item.row.person_id}|${item.row.scheme_code}`} item={item} />)}</ul>
          </div>
        </details>
      )}

      <section id="questions" className="scroll-mt-20 space-y-3">
        <h2 className="text-lg font-semibold">{t.questions}</h2>
        {!questionsAvailable ? (
          <p className="text-sm text-muted-foreground">{t.unavailable}</p>
        ) : grievances.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.questionsNone}</p>
        ) : (
          grievances.map((g) => {
            const member = g.person_id ? memberByPerson.get(g.person_id) : undefined;
            return (
              <Card key={g.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">{schemeTitle(g.scheme_code)}</CardTitle>
                    <Badge variant={g.status === "resolved" ? "secondary" : "outline"}>
                      {g.status === "resolved" ? t.answered : t.waitingAnswer}
                    </Badge>
                  </div>
                  <CardDescription>
                    {g.person_id ? firstName(member?.person.canonical_name ?? g.person_id) : t.wholeFamily}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{g.message}</p>
                  {g.status === "resolved" && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.officerAnswer}</div>
                      <p className="mt-1 whitespace-pre-wrap rounded-md border border-primary/20 bg-primary/5 p-3">{g.officer_response}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{t.assistant}</h2>
          <p className="text-sm text-muted-foreground">{t.assistantHelp}</p>
        </div>
        <AssistantChat familyId={family.id} initialLang={lang} />
      </section>
    </div>
  );
}
