import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import {
  Download,
  FileSpreadsheet,
  BarChart3,
  Clock,
  Users,
  Archive,
  PlaneTakeoff,
  CheckCircle2,
  XCircle,
  CalendarDays,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
});

type Nurse = {
  id: string;
  name: string;
  role: string;
  ward: string | null;
  facility: string | null;
  hours_this_month: number;
  target_hours: number;
};
type ShiftLog = {
  nurse_id: string;
  shift_date: string;
  shift_type: string;
  started_at: string;
  ended_at: string | null;
  hours_logged: number | null;
  period_start: string;
};
type PeriodHours = {
  nurse_id: string;
  period_start: string;
  period_end: string;
  total_hours: number;
  total_shifts: number;
};

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ReportsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "hours" | "periods" | "leave">("overview");
  const [closingPeriod, setClosingPeriod] = useState(false);

  const { data: nurses = [] } = useQuery<Nurse[]>({
    queryKey: ["nurses"],
    queryFn: async () => (await supabase.from("nurses").select("*")).data ?? [],
  });
  const { data: wards = [] } = useQuery({
    queryKey: ["wards"],
    queryFn: async () => (await supabase.from("wards").select("*").order("name")).data ?? [],
  });
  const { data: leave = [] } = useQuery({
    queryKey: ["leave"],
    queryFn: async () => (await supabase.from("leave_requests").select("*")).data ?? [],
  });

  // Current period shift logs (last 28 days)
  const { data: shiftLogs = [] } = useQuery<ShiftLog[]>({
    queryKey: ["shift-logs-current"],
    queryFn: async () => {
      const lookback = new Date();
      lookback.setDate(lookback.getDate() - 27);
      const lb = `${lookback.getFullYear()}-${String(lookback.getMonth() + 1).padStart(2, "0")}-${String(lookback.getDate()).padStart(2, "0")}`;
      const { data } = await supabase
        .from("shift_logs")
        .select("*")
        .gte("shift_date", lb)
        .order("shift_date", { ascending: false });
      return (data ?? []) as ShiftLog[];
    },
  });

  // All saved period summaries
  const { data: periodSummaries = [] } = useQuery<PeriodHours[]>({
    queryKey: ["period-hours-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("nurse_period_hours")
        .select("*")
        .order("period_start", { ascending: false });
      return (data ?? []) as PeriodHours[];
    },
  });

  // Build per-nurse hours for current period
  const nurseHoursMap = new Map<string, number>();
  const nurseShiftCountMap = new Map<string, number>();
  for (const log of shiftLogs) {
    if (log.hours_logged != null) {
      nurseHoursMap.set(log.nurse_id, (nurseHoursMap.get(log.nurse_id) ?? 0) + log.hours_logged);
      nurseShiftCountMap.set(log.nurse_id, (nurseShiftCountMap.get(log.nurse_id) ?? 0) + 1);
    }
  }

  const totalLoggedHours = [...nurseHoursMap.values()].reduce((s, h) => s + h, 0);
  const activeNurses = nurses.filter((n) => nurseHoursMap.has(n.id));

  // ── Close Period ──────────────────────────────────────────────────────────
  async function closePeriod() {
    if (
      !confirm(
        "Close the current period? This will save all nurses' hours to the period archive and reset their monthly hour counter to 0.",
      )
    )
      return;
    setClosingPeriod(true);
    try {
      const today = todayYmd();
      const lookback = new Date();
      lookback.setDate(lookback.getDate() - 27);
      const lb = `${lookback.getFullYear()}-${String(lookback.getMonth() + 1).padStart(2, "0")}-${String(lookback.getDate()).padStart(2, "0")}`;

      // Determine period start from earliest assignment in window
      const { data: winRow } = await supabase
        .from("shift_assignments")
        .select("shift_date")
        .gte("shift_date", lb)
        .order("shift_date", { ascending: true })
        .limit(1);
      const periodStart = winRow?.[0]?.shift_date ?? lb;

      // Save per-nurse summaries
      for (const nurse of nurses) {
        const totalHours = nurseHoursMap.get(nurse.id) ?? 0;
        const totalShifts = nurseShiftCountMap.get(nurse.id) ?? 0;
        if (totalHours === 0) continue;
        await supabase.from("nurse_period_hours").upsert(
          {
            nurse_id: nurse.id,
            period_start: periodStart,
            period_end: today,
            total_hours: totalHours,
            total_shifts: totalShifts,
          },
          { onConflict: "nurse_id,period_start" },
        );
        // Reset hours_this_month
        await supabase.from("nurses").update({ hours_this_month: 0 }).eq("id", nurse.id);
      }

      toast.success("Period closed — hours archived and counters reset");
      qc.invalidateQueries({ queryKey: ["nurses"] });
      qc.invalidateQueries({ queryKey: ["period-hours-all"] });
      qc.invalidateQueries({ queryKey: ["shift-logs-current"] });
    } catch {
      toast.error("Failed to close period");
    } finally {
      setClosingPeriod(false);
    }
  }

  // ── Exports ───────────────────────────────────────────────────────────────
  function exportCurrentHours() {
    if (activeNurses.length === 0) return toast.error("No hours logged yet");
    const rows = nurses.map((n) => ({
      Name: n.name,
      Role: n.role,
      Ward: n.ward ?? "",
      Facility: n.facility ?? "",
      "Shifts Completed": nurseShiftCountMap.get(n.id) ?? 0,
      "Hours Logged": (nurseHoursMap.get(n.id) ?? 0).toFixed(2),
      "Target Hours": n.target_hours,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Current Period");
    XLSX.writeFile(wb, `shift-hours-${todayYmd()}.xlsx`);
    toast.success("Exported");
  }

  function exportDetailedLogs() {
    if (shiftLogs.length === 0) return toast.error("No shift logs to export");
    const nurseMap = new Map(nurses.map((n) => [n.id, n]));
    const rows = shiftLogs.map((l) => {
      const nurse = nurseMap.get(l.nurse_id);
      return {
        Name: nurse?.name ?? "Unknown",
        Role: nurse?.role ?? "",
        Ward: nurse?.ward ?? "",
        Date: l.shift_date,
        "Shift Type": l.shift_type === "M" ? "Morning" : "Night",
        "Started At": l.started_at ? new Date(l.started_at).toLocaleString("en-GB") : "",
        "Ended At": l.ended_at ? new Date(l.ended_at).toLocaleString("en-GB") : "In Progress",
        "Hours Logged": l.hours_logged != null ? Number(l.hours_logged).toFixed(2) : "",
        "Period Start": l.period_start,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Shift Logs");
    XLSX.writeFile(wb, `shift-logs-${todayYmd()}.xlsx`);
    toast.success("Exported");
  }

  function exportPeriodArchive() {
    if (periodSummaries.length === 0) return toast.error("No archived periods yet");
    const nurseMap = new Map(nurses.map((n) => [n.id, n]));
    const rows = periodSummaries.map((p) => {
      const nurse = nurseMap.get(p.nurse_id);
      return {
        Name: nurse?.name ?? "Unknown",
        Role: nurse?.role ?? "",
        Ward: nurse?.ward ?? "",
        Facility: nurse?.facility ?? "",
        "Period Start": p.period_start,
        "Period End": p.period_end,
        "Total Hours": Number(p.total_hours).toFixed(2),
        "Total Shifts": p.total_shifts,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Period Archive");
    XLSX.writeFile(wb, `period-archive-${todayYmd()}.xlsx`);
    toast.success("Exported");
  }

  const tabCls = (t: typeof tab) =>
    `px-4 py-2 text-sm font-medium rounded-md transition ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`;

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Coverage, hours and shift insights"
        actions={
          <button
            type="button"
            disabled={closingPeriod}
            onClick={closePeriod}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-md border bg-card text-sm hover:bg-amber-50 hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
          >
            <Archive className="h-4 w-4" />
            {closingPeriod ? "Closing…" : "Close Period"}
          </button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1 mb-6 w-fit flex-wrap">
        <button type="button" className={tabCls("overview")} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button type="button" className={tabCls("hours")} onClick={() => setTab("hours")}>
          Shift Hours
        </button>
        <button type="button" className={tabCls("periods")} onClick={() => setTab("periods")}>
          Period Archive
        </button>
        <button type="button" className={tabCls("leave")} onClick={() => setTab("leave")}>
          Leave & Requests
        </button>
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <Stat icon={Users} label="Staff" value={nurses.length} />
            <Stat icon={BarChart3} label="Wards" value={wards.length} />
            <Stat icon={Clock} label="Hours (period)" value={totalLoggedHours.toFixed(1)} />
            <Stat icon={BarChart3} label="Leave Requests" value={leave.length} />
          </div>
          <div className="bg-card border rounded-xl p-5 shadow-soft">
            <h2 className="font-semibold mb-4">Staff Hours — Current Period</h2>
            {activeNurses.length === 0 ? (
              <EmptyState
                icon={<Clock className="h-6 w-6" />}
                title="No hours logged yet"
                description="Hours appear here as nurses start and complete their shifts."
              />
            ) : (
              <div className="space-y-2">
                {nurses
                  .filter((n) => nurseHoursMap.has(n.id))
                  .map((n) => {
                    const hrs = nurseHoursMap.get(n.id) ?? 0;
                    const pct = Math.round((hrs / Math.max(n.target_hours, 1)) * 100);
                    return (
                      <div key={n.id} className="flex items-center gap-3 text-sm">
                        <div className="w-36 truncate font-medium">{n.name}</div>
                        <div className="flex-1 h-5 rounded-full bg-muted overflow-hidden">
                          <Progress
                            value={Math.min(pct, 100)}
                            className="h-full rounded-full bg-primary/70"
                          />
                        </div>
                        <div className="w-20 text-right tabular-nums text-muted-foreground text-xs">
                          {hrs.toFixed(1)} / {n.target_hours} h
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Shift Hours ──────────────────────────────────────────────────── */}
      {tab === "hours" && (
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={exportCurrentHours}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-card text-sm hover:bg-muted"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Summary Excel
            </button>
            <button
              type="button"
              onClick={exportDetailedLogs}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-card text-sm hover:bg-muted"
            >
              <Download className="h-4 w-4" /> Detailed Logs
            </button>
          </div>

          {shiftLogs.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-6 w-6" />}
              title="No shift logs"
              description="Shift logs appear here once nurses start tracking their shifts."
            />
          ) : (
            <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Nurse</th>
                    <th className="text-left px-4 py-3 font-semibold">Date</th>
                    <th className="text-left px-4 py-3 font-semibold">Shift</th>
                    <th className="text-left px-4 py-3 font-semibold">Started</th>
                    <th className="text-left px-4 py-3 font-semibold">Ended</th>
                    <th className="text-right px-4 py-3 font-semibold">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {shiftLogs.map((log) => {
                    const nurse = nurses.find((n) => n.id === log.nurse_id);
                    return (
                      <tr
                        key={`${log.nurse_id}-${log.shift_date}`}
                        className="border-t hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 font-medium">{nurse?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{log.shift_date}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-semibold ${log.shift_type === "M" ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"}`}
                          >
                            {log.shift_type === "M" ? "Morning" : "Night"}
                          </span>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {log.started_at
                            ? new Date(log.started_at).toLocaleTimeString("en-GB", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {log.ended_at ? (
                            new Date(log.ended_at).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          ) : (
                            <span className="text-emerald-600 text-xs font-medium">Running</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">
                          {log.hours_logged != null
                            ? `${Number(log.hours_logged).toFixed(2)}h`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Leave & Requests ─────────────────────────────────────────────── */}
      {tab === "leave" &&
        (() => {
          const leaveOnly = leave.filter((l: { type: string }) => l.type !== "Swap");
          const switches = leave.filter((l: { type: string }) => l.type === "Swap");
          const pending = leaveOnly.filter((l: { status: string }) => l.status === "Pending");
          const approved = leaveOnly.filter((l: { status: string }) => l.status === "Approved");
          const rejected = leaveOnly.filter((l: { status: string }) => l.status === "Rejected");

          // Group by leave type
          const byType: Record<string, number> = {};
          for (const l of leaveOnly) {
            byType[l.type] = (byType[l.type] ?? 0) + 1;
          }

          return (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
                <Stat icon={PlaneTakeoff} label="Total Leave Requests" value={leaveOnly.length} />
                <Stat icon={Clock} label="Pending" value={pending.length} />
                <Stat icon={CheckCircle2} label="Approved" value={approved.length} />
                <Stat icon={XCircle} label="Rejected" value={rejected.length} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                {/* Leave by type */}
                <div className="bg-card border rounded-xl p-5 shadow-soft">
                  <h2 className="font-semibold mb-4">Leave by Type</h2>
                  {Object.keys(byType).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No leave requests
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(byType)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <div key={type} className="flex items-center gap-3 text-sm">
                            <span className="w-36 truncate font-medium">{type}</span>
                            <div className="flex-1 h-4 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-primary/70 rounded-full"
                                style={{
                                  width: `${Math.round((count / leaveOnly.length) * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="w-8 text-right tabular-nums text-muted-foreground text-xs">
                              {count}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Shift switch requests */}
                <div className="bg-card border rounded-xl p-5 shadow-soft">
                  <div className="flex items-center gap-2 mb-4">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <h2 className="font-semibold">Shift Switch Requests</h2>
                    <span className="ml-auto text-sm font-bold">{switches.length}</span>
                  </div>
                  {switches.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No switch requests
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(
                        switches as Array<{
                          id: string;
                          nurse_name: string;
                          from_date: string;
                          status: string;
                        }>
                      )
                        .slice(0, 6)
                        .map((s) => (
                          <div
                            key={s.id}
                            className="flex items-center justify-between text-sm border rounded-lg px-3 py-2"
                          >
                            <div>
                              <p className="font-medium">{s.nurse_name}</p>
                              <p className="text-xs text-muted-foreground">{s.from_date}</p>
                            </div>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                                s.status === "Approved"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : s.status === "Rejected"
                                    ? "bg-rose-100 text-rose-700"
                                    : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {s.status}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Full leave table */}
              <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Nurse</th>
                      <th className="text-left px-4 py-3 font-semibold">Type</th>
                      <th className="text-left px-4 py-3 font-semibold">From</th>
                      <th className="text-left px-4 py-3 font-semibold">To</th>
                      <th className="text-left px-4 py-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      leaveOnly as Array<{
                        id: string;
                        nurse_name: string;
                        type: string;
                        from_date: string;
                        to_date: string;
                        status: string;
                      }>
                    ).map((l) => (
                      <tr key={l.id} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{l.nurse_name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{l.type}</td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {l.from_date}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {l.to_date}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                              l.status === "Approved"
                                ? "bg-emerald-100 text-emerald-700"
                                : l.status === "Rejected"
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {l.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}

      {/* ── Period Archive ────────────────────────────────────────────────── */}
      {tab === "periods" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={exportPeriodArchive}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-card text-sm hover:bg-muted"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Export Archive
            </button>
          </div>

          {periodSummaries.length === 0 ? (
            <EmptyState
              icon={<Archive className="h-6 w-6" />}
              title="No archived periods"
              description='Use "Close Period" at the end of each 28-day cycle to save a snapshot here.'
            />
          ) : (
            <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Nurse</th>
                    <th className="text-left px-4 py-3 font-semibold">Period</th>
                    <th className="text-right px-4 py-3 font-semibold">Shifts</th>
                    <th className="text-right px-4 py-3 font-semibold">Total Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {periodSummaries.map((p) => {
                    const nurse = nurses.find((n) => n.id === p.nurse_id);
                    return (
                      <tr key={p.nurse_id + p.period_start} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{nurse?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums">
                          {p.period_start} → {p.period_end}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{p.total_shifts}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">
                          {Number(p.total_hours).toFixed(2)}h
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-card border rounded-xl p-5 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {label}
          </p>
          <p className="text-3xl font-bold mt-2">{value}</p>
        </div>
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
