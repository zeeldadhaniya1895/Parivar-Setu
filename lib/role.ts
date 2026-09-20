import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type Role = "officer" | "citizen";
export const ROLE_COOKIE = "role";

/** The demo role toggle. There is no authentication: the cookie only switches the view. */
export async function getRole(): Promise<Role | null> {
  const value = (await cookies()).get(ROLE_COOKIE)?.value;
  return value === "officer" || value === "citizen" ? value : null;
}

/** Officer pages send anyone who has not picked the officer role back to the toggle. */
export async function requireOfficer(): Promise<void> {
  if ((await getRole()) !== "officer") redirect("/?needs=officer");
}
