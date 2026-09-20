import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getRole } from "@/lib/role";

const OFFICER_LINKS = [
  { href: "/officer", label: "Dashboard" },
  { href: "/officer/families", label: "Families" },
  { href: "/officer/flags", label: "Flags" },
  { href: "/officer/review", label: "Review" },
];

export async function SiteHeader() {
  const role = await getRole();
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Parivar Setu
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {role === "officer" &&
            OFFICER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-foreground">
                {link.label}
              </Link>
            ))}
          {role === "citizen" && (
            <Link href="/citizen" className="hover:text-foreground">
              Find my family
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="border-amber-500 text-amber-700">
            Demo mode &middot; synthetic data
          </Badge>
          {role && <Badge variant="secondary">{role === "officer" ? "Officer" : "Citizen"}</Badge>}
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Switch role
          </Link>
        </div>
      </div>
    </header>
  );
}
