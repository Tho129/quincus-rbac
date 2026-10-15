import { rbac } from "@/lib/rbac";
import { OrderToolbar } from "./order-toolbar";

export const dynamic = "force-dynamic";

const ORDERS = [
  { id: "SO-1001", customer: "Jollibee", qty: 120 },
  { id: "SO-1002", customer: "Lotteria", qty: 80 },
];

/** A guarded page: what the signed-in user may do here comes from the package. */
export default async function OrdersPage() {
  const me = await rbac.identify();
  if (!me) return <p>Pick a user in the sidebar to sign in.</p>;

  const canView = rbac.has(me, "order:view");
  const canEdit = rbac.has(me, "order:edit");

  return (
    <div className="demo-page">
      <h1>Orders</h1>
      <p className="demo-muted">
        {me.userId} in tenant <b>{me.tenantId}</b>
        {me.groups.length > 0 && <> · groups {me.groups.join(", ")}</>}
      </p>
      <p className="demo-perms">
        Permissions: {me.permissions.length ? me.permissions.map((p) => <code key={p}>{p}</code>) : <i>none</i>}
      </p>

      <OrderToolbar />

      {canView ? (
        <table className="demo-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Qty</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ORDERS.map((o) => (
              <tr key={o.id}>
                <td>{o.id}</td>
                <td>{o.customer}</td>
                <td>{o.qty}</td>
                <td>{canEdit ? <button type="button">Edit</button> : <span className="demo-muted">read-only</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="demo-denied">403 — you need the “View orders” permission (order:view).</div>
      )}
    </div>
  );
}
