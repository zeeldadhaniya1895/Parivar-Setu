import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getRole } from "@/lib/role";

const OFFICER_LINKS = [
  { href: "/officer", label: "Dashboard" },
  { href: "/officer/families", label: "Families" },
  { href: "/officer/flags", label: "Flags" },
  { href: "/officer/schemes", label: "Schemes" },
  { href: "/officer/review", label: "Review" },
  { href: "/officer/grievances", label: "Grievances" },
];

export async function SiteHeader() {
  const role = await getRole();
  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-primary transition-colors hover:text-primary/80">
          <span className="bg-primary text-primary-foreground px-2 py-1 rounded-md text-sm leading-none">PS</span>
          Parivar Setu
        </Link>
        <nav className="flex flex-wrap items-center gap-6 text-sm font-medium text-muted-foreground">
          {role === "officer" &&
            OFFICER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="relative transition-colors hover:text-foreground after:absolute after:bottom-[-2px] after:left-0 after:h-[2px] after:w-0 after:bg-primary after:transition-all hover:after:w-full">
                {link.label}
              </Link>
            ))}
          {role === "citizen" && (
            <Link href="/citizen" className="relative transition-colors hover:text-foreground after:absolute after:bottom-[-2px] after:left-0 after:h-[2px] after:w-0 after:bg-primary after:transition-all hover:after:w-full">
              Find my family
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-600 shadow-sm">
            Demo mode &middot; synthetic data
          </Badge>
          {role && <Badge variant="secondary" className="bg-secondary/50 font-semibold">{role === "officer" ? "Officer" : "Citizen"}</Badge>}
          <Link href="/" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
            Switch role
          </Link>
        </div>
      </div>
    </header>
  );
}
