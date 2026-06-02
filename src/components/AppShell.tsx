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
} from "lucide-react";
import logo from "@/assets/logo.jpeg";
import { cn } from "@/lib/utils";
import { useAuth, ROLE_LABELS, type AppRole } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

const ALL: AppRole[] = ["admin", "cno", "chief_matron", "head_nurse", "hr_admin", "nurse"];
const MANAGERS: AppRole[] = ["admin", "cno", "chief_matron", "head_nurse", "hr_admin"];
const APPROVERS: AppRole[] = ["admin", "cno", "chief_matron", "head_nurse", "hr_admin"];

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
  { to: "/rota", label: "Rota", icon: CalendarDays, roles: ALL },
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
] as const;

export async function appBeforeLoad() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw redirect({ to: "/login" });
}

export function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user, fullName, roles, signOut, loading } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  const visibleNav = nav.filter(
    (n) => roles.length === 0 || n.roles.some((r) => roles.includes(r)),
  );
  const primaryRole = roles[0];
  const initials = (fullName ?? user?.email ?? "?")
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-sidebar text-sidebar-foreground flex-col">
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

      <div className="flex-1 flex flex-col min-w-0">
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
        <main className="flex-1 p-4 sm:p-6 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
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
