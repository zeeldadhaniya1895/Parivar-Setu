import { requireOfficer } from "@/lib/role";

export default async function OfficerLayout({ children }: LayoutProps<"/officer">) {
  await requireOfficer();
  return children;
}
