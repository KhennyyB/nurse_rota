import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { adminCreateUser } from "@/integrations/supabase/admin-client";
import { useState } from "react";
import { Users, Search, Plus, Trash2, Shield, UserCog, Loader2, X } from "lucide-react";
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
  const [showCreate, setShowCreate] = useState(false);

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
          <div className="flex items-center gap-2">
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
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Create User
            </button>
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

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["user-profiles"] });
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "nurse" as AppRole,
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      // adminCreateUser uses the service-role key — creates the account
      // instantly with email already confirmed. No confirmation email is sent.
      const userId = await adminCreateUser({
        email: form.email,
        password: form.password,
        fullName: form.fullName,
      });

      await Promise.all([
        supabase.from("user_roles").insert({
          user_id: userId,
          role: form.role as import("@/integrations/supabase/types").Database["public"]["Enums"]["app_role"],
        }),
        supabase.from("profiles").upsert({
          id: userId,
          full_name: form.fullName || form.email,
          email: form.email,
          updated_at: new Date().toISOString(),
        }),
      ]);

      toast.success(`User created — ${form.email} can log in immediately`);
      onCreated();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full h-10 px-3 rounded-md border bg-background text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-xl border w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Create User</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="h-7 w-7 grid place-items-center rounded-md hover:bg-muted text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Full name</label>
            <input
              type="text"
              placeholder="e.g. Jane Doe"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Email <span className="text-destructive">*</span>
            </label>
            <input
              type="email"
              required
              placeholder="user@example.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Password <span className="text-destructive">*</span>
            </label>
            <input
              type="password"
              required
              minLength={8}
              placeholder="Min. 8 characters"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Role <span className="text-destructive">*</span>
            </label>
            <select
              required
              title="Role"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AppRole }))}
              className={inputCls}
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-md border text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? "Creating…" : "Create User"}
            </button>
          </div>
        </form>
      </div>
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
