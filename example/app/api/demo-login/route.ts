import { DEMO_COOKIE, demoUser } from "@/lib/rbac";

/** DEMO ONLY: "sign in" as one of the demo users by setting a cookie. */
export async function POST(req: Request) {
  const form = await req.formData();
  const id = String(form.get("user") ?? "");
  const back = String(form.get("back") ?? "/");
  const target = back.startsWith("/") && !back.startsWith("//") ? back : "/";
  const headers = new Headers({ location: target });
  headers.append(
    "set-cookie",
    demoUser(id)
      ? `${DEMO_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax`
      : `${DEMO_COOKIE}=; Path=/; Max-Age=0`,
  );
  return new Response(null, { status: 303, headers });
}
