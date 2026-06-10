import { Link, Outlet, useRouterState, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Building2,
  FileCheck2,
  PlaneTakeoff,
  BarChart3,
  ShieldCheck,
  Bell,
  Menu,
  X,
  LogOut,
  KeyRound,
  UserCog,
  LogIn,
  Timer,
  LayoutGrid,
} from "lucide-react";
import logo from "@/assets/logo.jpeg";
import { cn } from "@/lib/utils";
import { useAuth, ROLE_DESCRIPTIONS, ROLE_LABELS, type AppRole } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { loadMenuPermissions, getEffectiveRoles, MENU_PERMISSIONS_KEY } from "@/lib/menu-permissions";

const ALL: AppRole[] = ["admin", "cno", "chief_matron", "head_nurse", "hr_admin", "nurse"];
const MANAGERS: AppRole[] = ["admin", "cno", "chief_matron", "head_nurse", "hr_admin"];
const APPROVERS: AppRole[] = ["admin", "cno", "chief_matron", "head_nurse", "hr_admin"];

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
  { to: "/rota", label: "Rota", icon: CalendarDays, roles: ALL },
  { to: "/shift", label: "Shift", icon: Timer, roles: ALL },
  { to: "/staff", label: "Staff", icon: Users, roles: MANAGERS },
  { to: "/wards", label: "Wards", icon: Building2, roles: MANAGERS },
  { to: "/leave", label: "Leave & Requests", icon: PlaneTakeoff, roles: ALL },
  { to: "/approvals", label: "Approvals", icon: FileCheck2, roles: APPROVERS },
  {
    to: "/reports",
    label: "Reports",
    icon: BarChart3,
    roles: ["admin", "cno", "chief_matron", "hr_admin"] as AppRole[],
  },
  { to: "/audit", label: "Audit Log", icon: ShieldCheck, roles: ["admin", "cno"] as AppRole[] },
  { to: "/users", label: "User Profiles", icon: UserCog, roles: ["admin"] as AppRole[] },
  { to: "/permissions", label: "Permissions", icon: KeyRound, roles: ["admin"] as AppRole[] },
  { to: "/menu-permissions", label: "Menu Access", icon: LayoutGrid, roles: ["admin"] as AppRole[] },
] as const;

export async function appBeforeLoad() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw redirect({ to: "/login" });
}

export function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user, fullName, roles, activeRole, needsRoleSelection, selectRole, signOut, loading } =
    useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [menuPermissions, setMenuPermissions] = useState(loadMenuPermissions);

  // Auto-end any overdue shifts server-side on every app load (safety net for closed browsers)
  useEffect(() => {
    void supabase.rpc("auto_end_overdue_shifts");
  }, []);

  // Same-tab / same-browser cache updates (instant)
  useEffect(() => {
    const handler = () => setMenuPermissions(loadMenuPermissions());
    window.addEventListener("menu-permissions-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("menu-permissions-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  // Authoritative load from DB + Realtime subscription so changes apply across all users/devices
  useEffect(() => {
    supabase
      .from("portal_settings")
      .select("value")
      .eq("key", "menu_permissions")
      .single()
      .then(({ data }) => {
        if (data?.value) {
          const perms = data.value as Record<string, AppRole[]>;
          setMenuPermissions(perms);
          localStorage.setItem(MENU_PERMISSIONS_KEY, JSON.stringify(perms));
        }
      });

    const channel = supabase
      .channel("portal-settings-menu")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "portal_settings", filter: "key=eq.menu_permissions" },
        (payload) => {
          const perms = ((payload.new ?? {}) as { value?: Record<string, AppRole[]> }).value ?? {};
          setMenuPermissions(perms);
          localStorage.setItem(MENU_PERMISSIONS_KEY, JSON.stringify(perms));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (needsRoleSelection) {
    return (
      <RoleSelectionScreen
        fullName={fullName}
        roles={roles}
        selectRole={selectRole}
        signOut={signOut}
      />
    );
  }

  const visibleNav = nav.filter((n) => {
    // Admin always sees every page — menu permissions apply to non-admin roles only.
    if (activeRole === "admin") return true;
    const effectiveRoles = getEffectiveRoles(n.to, menuPermissions);
    return activeRole ? effectiveRoles.includes(activeRole) : roles.length === 0;
  });
  const primaryRole = activeRole ?? roles[0];
  const initials = (fullName ?? user?.email ?? "?")
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <div className="h-screen flex overflow-hidden bg-background text-foreground">
      {/* Sidebar — desktop: fixed height, never scrolls */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-sidebar text-sidebar-foreground flex-col h-screen">
        <SidebarContent path={path} items={visibleNav} />
        <UserBlock fullName={fullName} role={primaryRole} signOut={signOut} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-sidebar text-sidebar-foreground flex flex-col">
            <SidebarContent path={path} items={visibleNav} onClose={() => setOpen(false)} />
            <UserBlock fullName={fullName} role={primaryRole} signOut={signOut} />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <header className="h-16 border-b bg-card flex items-center px-3 sm:px-6 gap-2 sm:gap-4 sticky top-0 z-30">
          <button
            onClick={() => setOpen(true)}
            className="lg:hidden h-10 w-10 grid place-items-center rounded-md hover:bg-muted"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{currentTitle(path)}</p>
          </div>
          <button
            className="relative h-10 w-10 grid place-items-center rounded-md hover:bg-muted"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>
          <div className="h-9 w-9 rounded-full bg-primary/15 text-primary grid place-items-center text-sm font-semibold shrink-0">
            {initials || "U"}
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function RoleSelectionScreen({
  fullName,
  roles,
  selectRole,
  signOut,
}: {
  fullName: string | null;
  roles: AppRole[];
  selectRole: (role: AppRole) => void;
  signOut: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<AppRole>(roles[0]);

  useEffect(() => {
    if (!roles.includes(selected)) setSelected(roles[0]);
  }, [roles, selected]);

  return (
    <div className="min-h-screen bg-background text-foreground grid place-items-center px-4">
      <form
        className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-soft"
        onSubmit={(event) => {
          event.preventDefault();
          selectRole(selected);
        }}
      >
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-white grid place-items-center overflow-hidden border">
            <img
              src={logo}
              alt="Iwosan Lagoon Hospitals"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">Choose your role</p>
            <p className="text-sm text-muted-foreground truncate">
              {fullName ? `Continue as ${fullName}` : "Select how you want to sign in"}
            </p>
          </div>
        </div>

        <label htmlFor="active-role" className="mt-6 block text-sm font-medium">
          Login role
        </label>
        <select
          id="active-role"
          value={selected}
          onChange={(event) => setSelected(event.target.value as AppRole)}
          className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {roles.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        <p className="mt-2 min-h-10 text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[selected]}</p>

        <button
          type="submit"
          className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <LogIn className="h-4 w-4" />
          Open dashboard
        </button>
        <button
          type="button"
          onClick={signOut}
          className="mt-3 h-10 w-full rounded-md border bg-background text-sm font-medium hover:bg-muted"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

function currentTitle(path: string) {
  const n = nav.find((n) => (n.to === "/" ? path === "/" : path.startsWith(n.to)));
  return n?.label ?? "NurseRota";
}

function SidebarContent({
  path,
  items,
  onClose,
}: {
  path: string;
  items: (typeof nav)[number][];
  onClose?: () => void;
}) {
  return (
    <>
      <div className="px-5 py-5 flex items-center justify-between border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-lg bg-white grid place-items-center overflow-hidden border border-sidebar-border">
            <img
              src={logo}
              alt="Iwosan Lagoon Hospitals"
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">Nurses Rota</p>
            <p className="text-[11px] text-sidebar-foreground/60 leading-tight">
              Iwosan Lagoon Hospitals
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-md hover:bg-sidebar-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {items.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? path === "/" : path.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function UserBlock({
  fullName,
  role,
  signOut,
}: {
  fullName: string | null;
  role: string | undefined;
  signOut: () => Promise<void>;
}) {
  return (
    <div className="px-4 py-4 border-t border-sidebar-border flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-sidebar-foreground truncate">{fullName ?? "User"}</p>
        <p className="text-xs text-sidebar-foreground/60 truncate">
          {role ? ROLE_LABELS[role as keyof typeof ROLE_LABELS] : "Member"}
        </p>
      </div>
      <button
        onClick={signOut}
        className="h-8 w-8 grid place-items-center rounded-md hover:bg-sidebar-accent"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
