import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { RbacProvider } from "@quincusdev/rbac/react";
import { DEMO_COOKIE, DEMO_USERS, demoUser, rbac } from "@/lib/rbac";
import "./demo.css";

export const metadata = { title: "@quincusdev/rbac example" };

/** A stand-in for an app's own shell: its sidebar links to the RBAC page like any other page. */
export default async function Layout({ children }: { children: ReactNode }) {
  const current = demoUser((await cookies()).get(DEMO_COOKIE)?.value);
  // Hand the server's view of the caller to the client, so <Can> needs no extra request.
  const me = await rbac.identify();

  return (
    <html lang="en">
      <body>
        <div className="demo-shell">
          <aside className="demo-sidebar">
            <div className="demo-brand">Demo App</div>
            <nav className="demo-nav">
              <Link href="/orders">Orders</Link>
              <div className="demo-nav__section">Settings</div>
              <Link href="/admin/roles">Roles &amp; permissions</Link>
            </nav>
            <form className="demo-signin" action="/api/demo-login" method="post">
              <label htmlFor="demo-user">Signed in as (demo)</label>
              <select id="demo-user" name="user" defaultValue={current?.id ?? ""}>
                <option value="">— signed out —</option>
                {DEMO_USERS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.tenantId}
                    {u.groups ? ` · groups ${u.groups}` : ""}
                  </option>
                ))}
              </select>
              <input type="hidden" name="back" value="/orders" />
              <button type="submit">Switch user</button>
            </form>
          </aside>
          <main className="demo-main">
            <RbacProvider initial={me}>{children}</RbacProvider>
          </main>
        </div>
      </body>
    </html>
  );
}
