import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABELS, type AppRole } from "@/lib/auth-context";
import { Check, X, Plus, Trash2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/permissions")({
  head: () => ({
    meta: [
      { title: "Permissions — Nurses Rota" },
      { name: "description", content: "Manage user roles and view the role permission matrix." },
    ],
  }),
  component: PermissionsPage,
});

const ROLES: AppRole[] = [
  "admin",
  "cno",
  "chief_matron",
  "head_nurse",
  "ward_manager",
  "hr_admin",
  "nurse",
];

type Capability = { key: string; label: string; roles: AppRole[] };

const CAPABILITIES: Capability[] = [
  { key: "view_dashboard", label: "View Dashboard", roles: ROLES },
  { key: "view_rota", label: "View Rota", roles: ROLES },
  {
    key: "edit_rota",
    label: "Edit Rota (manual changes)",
    roles: ["admin", "cno", "chief_matron", "head_nurse", "ward_manager"],
  },
  {
    key: "auto_generate",
    label: "Run Auto-Schedule",
    roles: ["admin", "cno", "chief_matron", "ward_manager"],
  },
  {
    key: "manage_staff",
    label: "Manage Staff (create/edit)",
    roles: ["admin", "cno", "chief_matron", "head_nurse", "ward_manager", "hr_admin"],
  },
  { key: "delete_staff", label: "Delete Staff", roles: ["admin"] },
  {
    key: "manage_wards",
    label: "Manage Wards & Ratios",
    roles: ["admin", "cno", "chief_matron", "ward_manager"],
  },
  { key: "request_leave", label: "Request Leave", roles: ROLES },
  {
    key: "approve_leave",
    label: "Approve Leave",
    roles: ["admin", "cno", "chief_matron", "head_nurse", "hr_admin"],
  },
  {
    key: "submit_approval",
    label: "Submit Rota for Approval",
    roles: ["admin", "chief_matron", "ward_manager"],
  },
  {
    key: "approve_chief_matron",
    label: "Chief Matron Approval Step",
    roles: ["admin", "chief_matron"],
  },
  { key: "approve_cno", label: "CNO Approval Step", roles: ["admin", "cno"] },
  { key: "publish_rota", label: "Publish Rota", roles: ["admin", "cno"] },
  {
    key: "view_reports",
    label: "View Reports",
    roles: ["admin", "cno", "chief_matron", "hr_admin"],
  },
  { key: "view_audit", label: "View Audit Log", roles: ["admin", "cno"] },
  { key: "manage_roles", label: "Assign / Revoke Roles", roles: ["admin"] },
];

type UserRow = { id: string; email: string | null; full_name: string | null; roles: AppRole[] };

function PermissionsPage() {
  const navigate = useNavigate();
  const { isAdmin, loading } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/" });
  }, [loading, isAdmin, navigate]);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["permissions-users"],
    enabled: isAdmin,
    queryFn: async () => {
      const [{ data: profs, error: e1 }, { data: rls, error: e2 }] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const map = new Map<string, AppRole[]>();
      (rls ?? []).forEach((r) => {
        const arr = map.get(r.user_id) ?? [];
        arr.push(r.role as AppRole);
        map.set(r.user_id, arr);
      });
      return (profs ?? []).map((p) => ({ ...p, roles: map.get(p.id) ?? [] })) as UserRow[];
    },
  });

  async function addRole(userId: string, role: AppRole) {
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) return toast.error(error.message);
    toast.success(`Granted ${ROLE_LABELS[role]}`);
    qc.invalidateQueries({ queryKey: ["permissions-users"] });
  }

  async function removeRole(userId: string, role: AppRole) {
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", role);
    if (error) return toast.error(error.message);
    toast.success(`Revoked ${ROLE_LABELS[role]}`);
    qc.invalidateQueries({ queryKey: ["permissions-users"] });
  }

  if (!isAdmin) {
    return (
      <div className="py-20 text-center">
        <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Administrator access required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Permissions" subtitle="Role capability matrix & user role assignments" />

      {/* Matrix */}
      <section className="rounded-xl border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">Role capability matrix</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            What each role is allowed to do in the system.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Capability</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-3 py-3 font-medium text-center whitespace-nowrap">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => (
                <tr key={cap.key} className="border-t">
                  <td className="px-4 py-2.5 font-medium">{cap.label}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-3 py-2.5 text-center">
                      {cap.roles.includes(r) ? (
                        <Check className="h-4 w-4 text-emerald-600 inline" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground/40 inline" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 border-t text-xs text-muted-foreground">
          Capabilities are enforced server-side by row-level security policies. To change a
          capability's role mapping, contact engineering.
        </p>
      </section>

      {/* User roles */}
      <section className="rounded-xl border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">User role assignments</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Grant or revoke roles per user. Changes take effect on next login.
          </p>
        </div>
        {isLoading ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Loading users…</p>
        ) : (
          <div className="divide-y">
            {users.map((u) => (
              <UserRoleRow key={u.id} user={u} onAdd={addRole} onRemove={removeRole} />
            ))}
            {users.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                No users found.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function UserRoleRow({
  user,
  onAdd,
  onRemove,
}: {
  user: UserRow;
  onAdd: (id: string, r: AppRole) => void;
  onRemove: (id: string, r: AppRole) => void;
}) {
  const [adding, setAdding] = useState<AppRole | "">("");
  const available = ROLES.filter((r) => !user.roles.includes(r));

  return (
    <div className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{user.full_name ?? user.email ?? "Unnamed"}</p>
        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {user.roles.length === 0 && (
          <span className="text-xs text-muted-foreground italic">No roles assigned</span>
        )}
        {user.roles.map((r) => (
          <span
            key={r}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs px-2.5 py-1"
          >
            {ROLE_LABELS[r]}
            <button
              type="button"
              onClick={() => onRemove(user.id, r)}
              className="hover:text-destructive"
              title={`Revoke ${ROLE_LABELS[r]}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            aria-label="Select role to add"
            value={adding}
            onChange={(e) => setAdding(e.target.value as AppRole | "")}
            className="text-xs h-8 rounded-md border bg-background px-2"
          >
            <option value="">Add role…</option>
            {available.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!adding}
            onClick={() => {
              if (adding) {
                onAdd(user.id, adding);
                setAdding("");
              }
            }}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
      )}
    </div>
  );
}
