import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  Building2,
  Clock,
  PlaneTakeoff,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { type ComponentType, type ReactNode } from "react";

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

// ── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { fullName, isAdmin, nurseFacility, canApproveLeave } = useAuth();

  // Admins/management see all facilities; regular nurses see only their facility.
  const facilityFilter = !isAdmin && nurseFacility ? nurseFacility : null;

  const { data: allNurses = [] } = useQuery({
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

  const nurses = facilityFilter
    ? allNurses.filter((n) => n.facility === facilityFilter)
    : allNurses;

  // For the pending leave panel, non-approvers see only their facility's leave.
  const facilityNurseNames = new Set(nurses.map((n) => n.name));
  const visibleLeave =
    facilityFilter && !canApproveLeave
      ? leave.filter((l) => facilityNurseNames.has(l.nurse_name))
      : leave;

  const pendingLeave = visibleLeave.filter((l) => l.status === "Pending");

  const subtitle = facilityFilter
    ? `Live staffing and rota health · ${facilityFilter}`
    : "Live staffing, approvals and rota health across all facilities";

  return (
    <div className="space-y-6">
      <PageHeader
        title={fullName ? `Welcome, ${fullName.split(" ")[0]}` : "Operations Dashboard"}
        subtitle={subtitle}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat icon={Users} label="Staff" value={nurses.length} hint="Active nurses" />
        <Stat icon={Building2} label="Wards" value={wards.length} hint="Configured wards" />
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
            <div className="space-y-2">
              {wards.slice(0, 8).map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-3 text-sm py-1">
                  <span className="truncate font-medium w-32 sm:w-40">{w.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    AM: {w.min_morning_supervisor}S · {w.min_morning_nurses}N+I ·{" "}
                    {w.min_morning_na}NA &nbsp;·&nbsp; PM: {w.min_night_supervisor}S ·{" "}
                    {w.min_night_nurses}N+I · {w.min_night_na}NA
                  </span>
                </div>
              ))}
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

    </div>
  );
}
