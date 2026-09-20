import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FAMILY_PAGE_SIZE, listFamilies } from "@/lib/db/queries";
import { number, rupees } from "@/lib/format";

export default async function FamiliesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const { rows, total } = await listFamilies(q, page);
  const pages = Math.max(1, Math.ceil(total / FAMILY_PAGE_SIZE));
  const pageHref = (p: number) => `/officer/families?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Families</h1>
        <p className="text-sm text-muted-foreground">{number(total)} families{q ? ` matching “${q}”` : ""}</p>
      </div>

      <form className="flex max-w-lg gap-2" action="/officer/families">
        <Input name="q" defaultValue={q} placeholder="Search by name, Family ID, village, taluka or district" aria-label="Search families" />
        <button type="submit" className={buttonVariants()}>Search</button>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Family ID</TableHead>
              <TableHead>Head</TableHead>
              <TableHead>Place</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead className="text-right">Income</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No families found. Run resolution from the dashboard if this is a fresh database.
                </TableCell>
              </TableRow>
            )}
            {rows.map((f) => (
              <TableRow key={f.id}>
                <TableCell>
                  <Link href={`/officer/families/${f.id}`} className="font-mono text-primary underline-offset-4 hover:underline">
                    {f.id}
                  </Link>
                  {!f.is_anchored && <Badge variant="outline" className="ml-2">no ration card</Badge>}
                </TableCell>
                <TableCell>{f.headName ?? "—"}</TableCell>
                <TableCell>{f.village}, {f.taluka}</TableCell>
                <TableCell className="text-right tabular-nums">{f.memberCount}</TableCell>
                <TableCell className="text-right tabular-nums">{rupees(f.resolved_income)}</TableCell>
                <TableCell>{f.flagCount > 0 ? <Badge variant="destructive">{f.flagCount}</Badge> : <span className="text-muted-foreground">&mdash;</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          {page > 1 ? <Link href={pageHref(page - 1)} className={buttonVariants({ variant: "outline" })}>Previous</Link> : <span />}
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          {page < pages ? <Link href={pageHref(page + 1)} className={buttonVariants({ variant: "outline" })}>Next</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
