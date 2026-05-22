import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  Building2,
  AlertTriangle,
  Clock,
  PlaneTakeoff,
  ChevronRight,
  CheckCircle2,
  Shield,
  Plus,
  Trash2,
  UserCog,
} from "lucide-react";
import { useAuth, ROLE_LABELS, type AppRole } from "@/lib/auth-context";
import { toast } from "sonner";
import { useState, type ComponentType, type ReactNode } from "react";

export const Route = createFileRoute("/_app/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Nurses Rota" },
      {
        name: "description",
        content:
          "Live overview of nursing staff, ward coverage, leave requests and rota status across Iwosan Lagoon Hospitals.",
      },
      { property: "og:title", content: "Dashboard — Nurses Rota" },
      {
        property: "og:description",
        content: "Live overview of nursing staff, ward coverage and rota status.",
      },
    ],
  }),
  component: Dashboard,
});

// ── Types ────────────────────────────────────────────────────────────────────

interface StatProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "warn" | "danger" | "success";
}

type UserRow = { id: string; email: string | null; full_name: string | null; roles: AppRole[] };

const ALL_ROLES: AppRole[] = ["admin", "cno", "chief_matron", "head_nurse", "hr_admin", "nurse"];

const ROLE_BADGE_COLORS: Record<AppRole, string> = {
  admin: "bg-red-100 text-red-700 border-red-200",
  cno: "bg-violet-100 text-violet-700 border-violet-200",
  chief_matron: "bg-blue-100 text-blue-700 border-blue-200",
  head_nurse: "bg-amber-100 text-amber-700 border-amber-200",
  hr_admin: "bg-teal-100 text-teal-700 border-teal-200",
  nurse: "bg-muted text-muted-foreground border-border",
};

// ── Stat card ────────────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, hint, tone = "default" }: StatProps) {
  const toneCls: Record<string, string> = {
    default: "bg-primary/10 text-primary",
    warn: "bg-warning/15 text-warning-foreground",
    danger: "bg-destructive/10 text-destructive",
    success: "bg-success/15 text-success",
  };
  return (
    <div className="bg-card border rounded-xl p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {label}
          </p>
          <p className="text-3xl font-bold mt-2">{value}</p>
          {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
        </div>
        <div className={`h-10 w-10 rounded-lg grid place-items-center shrink-0 ${toneCls[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

// ── User profile row ─────────────────────────────────────────────────────────

function UserProfileRow({
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

  return (
    <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
      {/* Avatar + name */}
      <div className="flex items-center gap-3 min-w-0 sm:w-56 shrink-0">
        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary grid place-items-center shrink-0 font-semibold text-sm">
          {(user.full_name ?? user.email ?? "?")[0].toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{user.full_name ?? "Unnamed"}</p>
          <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
        </div>
      </div>

      {/* Role badges */}
      <div className="flex flex-wrap gap-1.5 flex-1">
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

// ── User profiles panel (admin only) ────────────────────────────────────────

function UserProfilesPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["dashboard-users"],
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
    qc.invalidateQueries({ queryKey: ["dashboard-users"] });
  }

  async function removeRole(userId: string, role: AppRole) {
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", role);
    if (error) return toast.error(error.message);
    toast.success(`Revoked: ${ROLE_LABELS[role]}`);
    qc.invalidateQueries({ queryKey: ["dashboard-users"] });
  }

  const filtered = search.trim()
    ? users.filter(
        (u) =>
          u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
          u.email?.toLowerCase().includes(search.toLowerCase()),
      )
    : users;

  return (
    <section className="rounded-xl border bg-card overflow-hidden shadow-soft">
      {/* Header */}
      <div className="px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <UserCog className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">User Profiles</h2>
            <p className="text-xs text-muted-foreground">
              Manage role assignments for all system users
            </p>
          </div>
        </div>
        <input
          type="search"
          placeholder="Search users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 px-3 w-48 rounded-md border bg-background text-xs outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* User list */}
      {isLoading ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">Loading users…</p>
      ) : filtered.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          {search ? "No users match your search." : "No user profiles found."}
        </p>
      ) : (
        <div className="divide-y">
          {filtered.map((u) => (
            <UserProfileRow key={u.id} user={u} onAdd={addRole} onRemove={removeRole} />
          ))}
        </div>
      )}

      <div className="px-5 py-3 border-t bg-muted/30 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Shield className="h-3.5 w-3.5" />
        {users.length} user{users.length !== 1 ? "s" : ""} · Role changes take effect on next login
      </div>
    </section>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { fullName, isAdmin } = useAuth();

  const { data: nurses = [] } = useQuery({
    queryKey: ["nurses"],
    queryFn: async () => (await supabase.from("nurses").select("*")).data ?? [],
  });
  const { data: wards = [] } = useQuery({
    queryKey: ["wards"],
    queryFn: async () => (await supabase.from("wards").select("*")).data ?? [],
  });
  const { data: leave = [] } = useQuery({
    queryKey: ["leave"],
    queryFn: async () =>
      (await supabase.from("leave_requests").select("*").order("created_at", { ascending: false }))
        .data ?? [],
  });

  const understaffed = wards.filter(
    (w) => w.staffed < w.min_morning_nurses + w.min_morning_supervisor + w.min_morning_na,
  );
  const pendingLeave = leave.filter((l) => l.status === "Pending");

  return (
    <div className="space-y-6">
      <PageHeader
        title={fullName ? `Welcome, ${fullName.split(" ")[0]}` : "Operations Dashboard"}
        subtitle="Live staffing, approvals and rota health across all wards"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat icon={Users} label="Staff" value={nurses.length} hint="Active nurses" />
        <Stat
          icon={Building2}
          label="Wards"
          value={wards.length}
          hint={`${understaffed.length} understaffed`}
          tone={understaffed.length ? "warn" : "success"}
        />
        <Stat
          icon={PlaneTakeoff}
          label="Pending Leave"
          value={pendingLeave.length}
          tone={pendingLeave.length ? "warn" : "default"}
        />
        <Stat
          icon={CheckCircle2}
          label="Approved Leave"
          value={leave.filter((l) => l.status === "Approved").length}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border rounded-xl p-5 shadow-soft">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold">Ward Safety Snapshot</h2>
              <p className="text-xs text-muted-foreground">
                Minimum-staffing rules enforced per ward
              </p>
            </div>
            <Link
              to="/wards"
              className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
            >
              View all <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {wards.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No wards configured yet.{" "}
              <Link to="/wards" className="text-primary hover:underline">
                Add one →
              </Link>
            </p>
          ) : (
            <div className="space-y-2.5">
              {wards.slice(0, 8).map((w) => {
                const min = w.min_morning_nurses + w.min_morning_supervisor + w.min_morning_na;
                const ok = w.staffed >= min;
                const pct = Math.min(100, Math.round((w.staffed / Math.max(min, 1)) * 100));
                return (
                  <div key={w.id} className="flex items-center gap-3 text-sm">
                    <div className="w-32 sm:w-40 truncate font-medium">{w.name}</div>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <svg
                        className="h-full w-full"
                        viewBox="0 0 100 1"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <rect
                          width={pct}
                          height="1"
                          className={ok ? "fill-success" : "fill-destructive"}
                        />
                      </svg>
                    </div>
                    <div className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                      {w.staffed}/{min}
                    </div>
                    {ok ? (
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-card border rounded-xl p-5 shadow-soft">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Pending Leave</h2>
            <Link
              to="/leave"
              className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
            >
              Review <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {pendingLeave.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No pending requests</p>
          ) : (
            <div className="space-y-2.5">
              {pendingLeave.slice(0, 6).map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between border rounded-lg px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{l.nurse_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.type} · {l.from_date} → {l.to_date}
                    </p>
                  </div>
                  <Clock className="h-4 w-4 text-warning-foreground shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* User Profiles — admin only */}
      {isAdmin && <UserProfilesPanel />}
    </div>
  );
}
