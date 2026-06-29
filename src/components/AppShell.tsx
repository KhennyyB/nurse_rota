import { Link, Outlet, useRouterState, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
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
  Loader2,
  ShieldAlert,
  AlertCircle,
  Info,
  CheckCircle2,
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
  const {
    user,
    fullName,
    roles,
    activeRole,
    nurseId,
    needsRoleSelection,
    mustChangePassword,
    clearMustChangePassword,
    selectRole,
    signOut,
    loading,
  } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [menuPermissions, setMenuPermissions] = useState(loadMenuPermissions);

  // Auto-end any overdue shifts server-side on every app load (safety net for closed browsers)
  useEffect(() => {
    void supabase.rpc("auto_end_overdue_shifts");
  }, []);

  // Auto-close the period at 8am the day after the last published shift ends
  useEffect(() => {
    void supabase.rpc("auto_close_period").then(({ data }) => {
      const result = data as { closed: boolean; period_start?: string; period_end?: string } | null;
      if (result?.closed) {
        toast.success(
          `Period ${result.period_start} → ${result.period_end} has been automatically closed and archived.`,
          { duration: 8000 },
        );
      }
    });
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

  if (mustChangePassword) {
    return (
      <ForcePasswordChangeScreen
        fullName={fullName}
        onChanged={clearMustChangePassword}
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

  // Synchronous permission check — computed before render so there is never a
  // flash of the real page content before a redirect kicks in.
  const currentNavItem = nav.find(
    (n) => (n.to === "/" ? path === "/" : path.startsWith(n.to)),
  );
  const isPathPermitted =
    loading || // auth still resolving — don't block yet
    !activeRole ||
    !currentNavItem ||
    activeRole === "admin" ||
    getEffectiveRoles(currentNavItem.to, menuPermissions).includes(activeRole);
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
          <RotaReminderBell activeRole={activeRole} nurseId={nurseId} userId={user?.id ?? null} />
          <div className="h-9 w-9 rounded-full bg-primary/15 text-primary grid place-items-center text-sm font-semibold shrink-0">
            {initials || "U"}
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          {isPathPermitted ? (
            <Outlet />
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-24 gap-5 text-center">
              <div className="h-16 w-16 rounded-full bg-destructive/10 text-destructive grid place-items-center">
                <ShieldAlert className="h-8 w-8" />
              </div>
              <div>
                <p className="text-lg font-semibold">Access denied</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  You don&apos;t have permission to view this page.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void navigate({ to: "/" })}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                <LayoutDashboard className="h-4 w-4" />
                Back to Dashboard
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Group a sorted array of date strings into clusters separated by gaps > 14 days.
function clusterDates(rawDates: string[]): string[][] {
  if (!rawDates.length) return [];
  const sorted = [...new Set(rawDates)].sort();
  const clusters: string[][] = [];
  let cur: string[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const diff = Math.round(
      (new Date(sorted[i] + "T00:00:00").getTime() -
        new Date(sorted[i - 1] + "T00:00:00").getTime()) /
        86400000,
    );
    if (diff > 14) {
      clusters.push(cur);
      cur = [];
    }
    cur.push(sorted[i]);
  }
  if (cur.length) clusters.push(cur);
  return clusters;
}

type NotifState = "unread" | "read";

function useNotifState(
  notifKey: string | null,
  userId: string | null,
): [NotifState | null, () => void, () => void] {
  // null = not yet loaded from DB (avoid showing badge before we know the real state)
  const [state, setState] = useState<NotifState | null>(null);

  // Load initial state from DB
  useEffect(() => {
    if (!notifKey || !userId) {
      setState(null);
      return;
    }
    supabase
      .from("notification_state")
      .select("is_read")
      .eq("user_id", userId)
      .eq("notif_key", notifKey)
      .maybeSingle()
      .then(({ data }) => setState(data?.is_read ? "read" : "unread"));
  }, [notifKey, userId]);

  // Real-time sync — updates other devices/tabs immediately
  useEffect(() => {
    if (!notifKey || !userId) return;
    const channel = supabase
      .channel(`notif-${userId}-${notifKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notification_state",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = (payload.new ?? {}) as { notif_key?: string; is_read?: boolean };
          if (row.notif_key === notifKey) setState(row.is_read ? "read" : "unread");
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [notifKey, userId]);

  function upsert(isRead: boolean) {
    if (!notifKey || !userId) return;
    // Optimistic update so the UI responds immediately
    setState(isRead ? "read" : "unread");
    void supabase
      .from("notification_state")
      .upsert(
        { user_id: userId, notif_key: notifKey, is_read: isRead, updated_at: new Date().toISOString() },
        { onConflict: "user_id,notif_key" },
      )
      .then(({ error }) => {
        // Roll back optimistic update on failure so the badge is truthful
        if (error) setState(isRead ? "unread" : "read");
      });
  }

  return [state, () => upsert(true), () => upsert(false)];
}

function RotaReminderBell({
  activeRole,
  nurseId,
  userId,
}: {
  activeRole: string | null;
  nurseId: string | null;
  userId: string | null;
}) {
  const canSeeManagement =
    activeRole === "admin" || activeRole === "cno" || activeRole === "chief_matron";
  const [open, setOpen] = useState(false);
  const [showAllNotifs, setShowAllNotifs] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  // ── Management: next rota deadline ────────────────────────────────────────
  const { data: mgmtNotif } = useQuery({
    queryKey: ["rota-reminder"],
    enabled: canSeeManagement,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const ymd = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const { data } = await supabase
        .from("shift_assignments")
        .select("shift_date")
        .eq("status", "published")
        .gte("shift_date", ymd(threeMonthsAgo))
        .order("shift_date", { ascending: true });

      if (!data?.length) return null;

      const clusters = clusterDates(data.map((d) => d.shift_date));
      const latest = clusters[clusters.length - 1];
      const periodStart = latest[0];
      const periodEnd = latest[latest.length - 1];

      const nextStartDt = new Date(periodEnd + "T00:00:00");
      nextStartDt.setDate(nextStartDt.getDate() + 1);
      const nextPeriodStart = ymd(nextStartDt);

      const deadlineDt = new Date(nextStartDt);
      deadlineDt.setDate(deadlineDt.getDate() - 14);
      const deadline = ymd(deadlineDt);

      const { data: next } = await supabase
        .from("shift_assignments")
        .select("id")
        .gte("shift_date", nextPeriodStart)
        .limit(1)
        .maybeSingle();

      return { periodStart, periodEnd, nextPeriodStart, deadline, nextRotaExists: !!next };
    },
  });

  const mgmtKey =
    canSeeManagement && mgmtNotif && !mgmtNotif.nextRotaExists
      ? `rota_notif_v2_${mgmtNotif.periodStart}`
      : null;
  const [mgmtState, mgmtMarkRead, mgmtMarkUnread] = useNotifState(mgmtKey, userId);

  // ── Staff: rota published notification ────────────────────────────────────
  const { data: staffNotif } = useQuery({
    queryKey: ["staff-rota-notif", nurseId],
    enabled: !!nurseId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const ymd = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const { data } = await supabase
        .from("shift_assignments")
        .select("shift_date, ward")
        .eq("nurse_id", nurseId!)
        .eq("status", "published")
        .gte("shift_date", ymd(threeMonthsAgo))
        .order("shift_date", { ascending: true });

      if (!data?.length) return null;

      const clusters = clusterDates(data.map((d) => d.shift_date));
      if (!clusters.length) return null;

      const latest = clusters[clusters.length - 1];
      const periodStart = latest[0];
      const periodEnd = latest[latest.length - 1];

      const ward =
        data.find((d) => d.shift_date >= periodStart && d.shift_date <= periodEnd && d.ward !== null)
          ?.ward ?? null;

      return { periodStart, periodEnd, ward };
    },
  });

  const staffKey = nurseId && staffNotif ? `staff_notif_v2_${nurseId}_${staffNotif.periodStart}` : null;
  const [staffState, staffMarkRead, staffMarkUnread] = useNotifState(staffKey, userId);

  // ── Computed alert counts ─────────────────────────────────────────────────
  const showMgmt = canSeeManagement && !!mgmtNotif && !mgmtNotif.nextRotaExists;
  const showStaff = !!nurseId && !!staffNotif;

  // Only count as unread once the DB has responded (state !== null)
  const mgmtUnread = showMgmt && mgmtState === "unread";
  const staffUnread = showStaff && staffState === "unread";
  const unreadCount = (mgmtUnread ? 1 : 0) + (staffUnread ? 1 : 0);

  // Build ordered notifications list — newest/most urgent first
  const allNotifItems = [
    ...(showStaff && staffNotif ? [{ kind: "staff" as const }] : []),
    ...(showMgmt && mgmtNotif ? [{ kind: "mgmt" as const }] : []),
  ];
  const notifItems = showAllNotifs ? allNotifItems : allNotifItems.slice(0, 3);
  const hasMore = !showAllNotifs && allNotifItems.length > 3;

  const mgmtOverdue = showMgmt && !!mgmtNotif && today > mgmtNotif.deadline;
  const mgmtUrgent =
    showMgmt &&
    !mgmtOverdue &&
    !!mgmtNotif &&
    (() => {
      const d = new Date(mgmtNotif.deadline + "T00:00:00");
      d.setDate(d.getDate() - 3);
      return today >= d.toISOString().slice(0, 10);
    })();

  const hasCritical = mgmtOverdue;

  return (
    <div className="relative">
      <button
        type="button"
        className="relative h-10 w-10 grid place-items-center rounded-md hover:bg-muted"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className={cn("h-4 w-4", hasCritical && "text-destructive")} />
        {unreadCount > 0 && (
          <span
            className={cn(
              "absolute top-1 right-1 min-w-[16px] h-4 px-0.5 rounded-full text-[9px] font-bold text-white grid place-items-center",
              hasCritical ? "bg-destructive" : "bg-amber-500",
            )}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-50 w-80 rounded-xl border bg-card shadow-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Notifications</p>
              <button
                type="button"
                aria-label="Close notifications"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {notifItems.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <p className="text-sm text-muted-foreground">No notifications.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notifItems.map(({ kind }) =>
                  kind === "staff" && staffNotif ? (
                    <div
                      key="staff"
                      className={cn(
                        "rounded-lg border p-3 space-y-2 transition-opacity",
                        staffState === "read" && "opacity-60",
                        "border-emerald-400/40 bg-emerald-50 dark:bg-emerald-950/20",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Bell className="h-4 w-4 shrink-0 text-emerald-600" />
                          <p className="text-xs font-semibold text-emerald-700">
                            Your Rota Is Published
                          </p>
                          {staffState === "unread" && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                          )}
                        </div>
                        {staffState !== null && (
                          <button
                            type="button"
                            title={staffState === "unread" ? "Mark as read" : "Mark as unread"}
                            onClick={staffState === "unread" ? staffMarkRead : staffMarkUnread}
                            className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground shrink-0 underline"
                          >
                            {staffState === "unread" ? "Mark read" : "Mark unread"}
                          </button>
                        )}
                      </div>
                      <p className="text-xs">
                        {staffNotif.ward ? (
                          <>
                            <span className="font-medium">{staffNotif.ward}</span> schedule for{" "}
                          </>
                        ) : (
                          "Your schedule for "
                        )}
                        <span className="font-medium">
                          {fmtDate(staffNotif.periodStart)} — {fmtDate(staffNotif.periodEnd)}
                        </span>{" "}
                        is now live.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Open the Rota page to view your shifts.
                      </p>
                    </div>
                  ) : kind === "mgmt" && mgmtNotif ? (
                    <div
                      key="mgmt"
                      className={cn(
                        "rounded-lg border p-3 space-y-2 transition-opacity",
                        mgmtState === "read" && "opacity-60",
                        mgmtOverdue
                          ? "border-destructive/40 bg-destructive/5"
                          : mgmtUrgent
                            ? "border-amber-400/40 bg-amber-50 dark:bg-amber-950/20"
                            : "border-blue-400/40 bg-blue-50 dark:bg-blue-950/20",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {mgmtOverdue || mgmtUrgent ? (
                            <AlertCircle
                              className={cn(
                                "h-4 w-4 shrink-0",
                                mgmtOverdue ? "text-destructive" : "text-amber-500",
                              )}
                            />
                          ) : (
                            <Info className="h-4 w-4 shrink-0 text-blue-500" />
                          )}
                          <p
                            className={cn(
                              "text-xs font-semibold",
                              mgmtOverdue
                                ? "text-destructive"
                                : mgmtUrgent
                                  ? "text-amber-700"
                                  : "text-blue-700",
                            )}
                          >
                            {mgmtOverdue
                              ? "Next Rota Overdue"
                              : mgmtUrgent
                                ? "Next Rota Due Soon"
                                : "Next Rota Reminder"}
                          </p>
                          {mgmtState === "unread" && (
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full shrink-0",
                                mgmtOverdue ? "bg-destructive" : "bg-amber-500",
                              )}
                            />
                          )}
                        </div>
                        {mgmtState !== null && (
                          <button
                            type="button"
                            title={mgmtState === "unread" ? "Mark as read" : "Mark as unread"}
                            onClick={mgmtState === "unread" ? mgmtMarkRead : mgmtMarkUnread}
                            className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground shrink-0 underline"
                          >
                            {mgmtState === "unread" ? "Mark read" : "Mark unread"}
                          </button>
                        )}
                      </div>

                      <p className="text-xs">
                        Current rota:{" "}
                        <span className="font-medium">
                          {fmtDate(mgmtNotif.periodStart)} — {fmtDate(mgmtNotif.periodEnd)}
                        </span>
                      </p>
                      <p className="text-xs">
                        Next period:{" "}
                        <span className="font-medium">{fmtDate(mgmtNotif.nextPeriodStart)}</span>
                      </p>
                      <p className={cn("text-xs font-medium", mgmtOverdue && "text-destructive")}>
                        {mgmtOverdue
                          ? `Deadline passed (${fmtDate(mgmtNotif.deadline)}). Generate and approve the next rota now.`
                          : `Approve next rota by ${fmtDate(mgmtNotif.deadline)} — 2 weeks before the next period starts.`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Nurses need 2 weeks to apply for leave before the next rota is published.
                      </p>
                    </div>
                  ) : null,
                )}
              </div>
            )}
            {hasMore && (
              <button
                type="button"
                onClick={() => setShowAllNotifs(true)}
                className="cursor-pointer w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 underline"
              >
                See more ({allNotifItems.length - 3} more)
              </button>
            )}
            {showAllNotifs && allNotifItems.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAllNotifs(false)}
                className="cursor-pointer w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 underline"
              >
                Show less
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ForcePasswordChangeScreen({
  fullName,
  onChanged,
  signOut,
}: {
  fullName: string | null;
  onChanged: () => void;
  signOut: () => Promise<void>;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password: newPassword });
      if (authError) throw new Error(authError.message);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles").update({ must_change_password: false }).eq("id", user.id);
      }
      toast.success("Password updated successfully");
      onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setBusy(false);
    }
  }

  const cls = "w-full h-10 px-3 rounded-md border bg-background text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="min-h-screen bg-background text-foreground grid place-items-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-soft space-y-5"
      >
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-amber-100 text-amber-600 grid place-items-center shrink-0">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <p className="font-semibold leading-tight">Password change required</p>
            <p className="text-sm text-muted-foreground">
              {fullName ? `Welcome, ${fullName}.` : "Welcome."} Please set a new password to
              continue.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium" htmlFor="new-pw">
              New password
            </label>
            <input
              id="new-pw"
              type="password"
              required
              minLength={8}
              placeholder="Min. 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={cls + " mt-1"}
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="confirm-pw">
              Confirm password
            </label>
            <input
              id="confirm-pw"
              type="password"
              required
              placeholder="Repeat new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={cls + " mt-1"}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={busy || !newPassword || !confirm}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Set new password
        </button>
        <button
          type="button"
          onClick={signOut}
          className="h-9 w-full rounded-md border bg-background text-sm font-medium hover:bg-muted"
        >
          Sign out
        </button>
      </form>
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
            type="button"
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
        type="button"
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
