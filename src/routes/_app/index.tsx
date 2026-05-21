import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  Building2,
  AlertTriangle,
  Clock,
  PlaneTakeoff,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import type { ComponentType, ReactNode } from "react";

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

interface StatProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "warn" | "danger" | "success";
}

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

function Dashboard() {
  const { fullName } = useAuth();

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
    <div>
      <PageHeader
        title={fullName ? `Welcome, ${fullName.split(" ")[0]}` : "Operations Dashboard"}
        subtitle="Live staffing, approvals and rota health across all wards"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
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
    </div>
  );
}
