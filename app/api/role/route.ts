import { NextResponse, type NextRequest } from "next/server";
import { ROLE_COOKIE } from "@/lib/role";

/** Demo role toggle: stores the chosen view in a cookie and redirects. This is not authentication. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const role = form.get("role");
  if (role !== "officer" && role !== "citizen") {
    return Response.json({ ok: false, error: "role must be officer or citizen" }, { status: 400 });
  }
  const response = NextResponse.redirect(new URL(role === "officer" ? "/officer" : "/citizen", request.url), 303);
  response.cookies.set(ROLE_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
