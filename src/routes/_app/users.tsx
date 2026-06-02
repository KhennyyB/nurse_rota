import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Users, Search, Plus, Trash2, Shield, UserCog } from "lucide-react";
import { useAuth, ROLE_LABELS, type AppRole } from "@/lib/auth-context";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/users")({
  head: () => ({
    meta: [
      { title: "User Profiles — Nurses Rota" },
      { name: "description", content: "Manage user accounts and role assignments." },
    ],
  }),
  component: UsersPage,
});

const ALL_ROLES: AppRole[] = ["admin", "cno", "chief_matron", "head_nurse", "hr_admin", "nurse"];

const ROLE_BADGE_COLORS: Record<AppRole, string> = {
  admin: "bg-red-100 text-red-700 border-red-200",
  cno: "bg-violet-100 text-violet-700 border-violet-200",
  chief_matron: "bg-blue-100 text-blue-700 border-blue-200",
  head_nurse: "bg-amber-100 text-amber-700 border-amber-200",
  hr_admin: "bg-teal-100 text-teal-700 border-teal-200",
  nurse: "bg-muted text-muted-foreground border-border",
};

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  roles: AppRole[];
};

function UsersPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["user-profiles"],
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
    toast.success(`Granted: ${ROLE_LABELS[role]}`);
    qc.invalidateQueries({ queryKey: ["user-profiles"] });
  }

  async function removeRole(userId: string, role: AppRole) {
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", role);
    if (error) return toast.error(error.message);
    toast.success(`Revoked: ${ROLE_LABELS[role]}`);
    qc.invalidateQueries({ queryKey: ["user-profiles"] });
  }

  const filtered = search.trim()
    ? users.filter(
        (u) =>
          u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
          u.email?.toLowerCase().includes(search.toLowerCase()),
      )
    : users;

  if (!isAdmin) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Administrator access required.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Profiles"
        subtitle={`${users.length} user${users.length !== 1 ? "s" : ""} · Manage role assignments`}
        actions={
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              placeholder="Search users…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 pl-8 pr-3 w-52 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Loading users…</p>
      ) : users.length === 0 ? (
        <EmptyState
          icon={<UserCog className="h-6 w-6" />}
          title="No user profiles found"
          description="Create logins for nurses from the Staff page — they will appear here."
        />
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden shadow-soft">
          {filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              No users match &ldquo;{search}&rdquo;
            </p>
          ) : (
            <div className="divide-y">
              {filtered.map((u) => (
                <UserRow key={u.id} user={u} onAdd={addRole} onRemove={removeRole} />
              ))}
            </div>
          )}

          <div className="px-5 py-3 border-t bg-muted/30 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Shield className="h-3.5 w-3.5" />
            {filtered.length} of {users.length} user{users.length !== 1 ? "s" : ""} shown · Role
            changes take effect on next login
          </div>
        </div>
      )}
    </div>
  );
}

function UserRow({
  user,
  onAdd,
  onRemove,
}: {
  user: UserRow;
  onAdd: (id: string, role: AppRole) => void;
  onRemove: (id: string, role: AppRole) => void;
}) {
  const [adding, setAdding] = useState<AppRole | "">("");
  const available = ALL_ROLES.filter((r) => !user.roles.includes(r));
  const initials = (user.full_name ?? user.email ?? "?")
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
      {/* Avatar + name */}
      <div className="flex items-center gap-3 min-w-0 sm:w-60 shrink-0">
        <div className="h-9 w-9 rounded-full bg-primary/10 text-primary grid place-items-center shrink-0 font-semibold text-sm">
          {initials || <Users className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{user.full_name ?? "Unnamed"}</p>
          <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
        </div>
      </div>

      {/* Role badges */}
      <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
        {user.roles.length === 0 && (
          <span className="text-xs text-muted-foreground italic">No roles assigned</span>
        )}
        {user.roles.map((r) => (
          <span
            key={r}
            className={`inline-flex items-center gap-1 rounded-full border text-xs px-2.5 py-0.5 ${ROLE_BADGE_COLORS[r]}`}
          >
            {ROLE_LABELS[r]}
            <button
              type="button"
              onClick={() => onRemove(user.id, r)}
              className="hover:text-destructive ml-0.5"
              title={`Revoke ${ROLE_LABELS[r]}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {/* Add role */}
      {available.length > 0 && (
        <div className="flex items-center gap-2 shrink-0">
          <select
            aria-label="Add role"
            value={adding}
            onChange={(e) => setAdding(e.target.value as AppRole | "")}
            className="text-xs h-8 rounded-md border bg-background px-2 outline-none focus:ring-2 focus:ring-ring"
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
