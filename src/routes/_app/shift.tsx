import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Lock,
  PlayCircle,
  StopCircle,
  Timer,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_app/shift")({
  head: () => ({
    meta: [{ title: "Shift — Nurses Rota" }],
  }),
  component: ShiftPage,
});

type ShiftLog = {
  id: string;
  nurse_id: string;
  shift_date: string;
  shift_type: "M" | "N";
  started_at: string;
  ended_at: string | null;
  expected_end_at: string;
  hours_logged: number | null;
  period_start: string;
  is_late: boolean;
  late_minutes: number | null;
  late_reason: string | null;
};

type Assignment = {
  id: string;
  shift: "M" | "N" | "OFF" | "LEAVE";
  shift_date: string;
  ward: string | null;
  status: string;
};

type PeriodHours = {
  period_start: string;
  period_end: string;
  total_hours: number;
  total_shifts: number;
};

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(ms: number) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Convert decimal hours (e.g. 2.58) to "2h 35m" */
function fmtHours(decHours: number) {
  const h = Math.floor(decHours);
  const m = Math.round((decHours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Calculate the expected end timestamp for a shift started at `startedAt`. */
function calcExpectedEnd(shiftType: "M" | "N", startedAt: Date): Date {
  const d = new Date(startedAt);
  if (shiftType === "M") {
    d.setHours(17, 0, 0, 0);
    // If started after 17:00 (late start) add a day grace
    if (d <= startedAt) d.setDate(d.getDate() + 1);
  } else {
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  }
  return d;
}

function hoursLogged(startedAt: string, endedAt: string) {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.round((ms / 3600000) * 100) / 100;
}

function fmtHHMM(d: Date) {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function ShiftPage() {
  const { nurseId, fullName, activeRole } = useAuth();

  // All hooks must be called unconditionally (Rules of Hooks).
  // The management-role early return is placed after every hook call below.
  const qc = useQueryClient();
  const today = todayYmd();
  const [now, setNow] = useState(new Date());
  const autoEndingRef = useRef(false);
  const [lateDialog, setLateDialog] = useState<{
    open: boolean;
    reason: string;
    capturedMinutes: number;
  }>({ open: false, reason: "", capturedMinutes: 0 });

  // Live clock tick every minute
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // ── Queries ───────────────────────────────────────────────────────────────

  // Today's rota assignment — poll every 30 s so the Start Shift button unlocks
  // automatically once an admin publishes the rota without the nurse needing to reload.
  const { data: queryAssignment } = useQuery<Assignment | null>({
    queryKey: ["my-assignment", nurseId, today],
    enabled: !!nurseId,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("shift_assignments")
        .select("id, shift, shift_date, ward, status")
        .eq("nurse_id", nurseId!)
        .eq("shift_date", today)
        .eq("status", "published")
        .maybeSingle();
      return data as Assignment | null;
    },
  });

  // Fetch the nurse's job role (e.g. "Matron") to detect matron nurses who log
  // in as the regular "nurse" AppRole and have no auto-generated assignments.
  const { data: nurseJobRole } = useQuery<string | null>({
    queryKey: ["nurse-job-role", nurseId],
    enabled: !!nurseId,
    queryFn: async () => {
      const { data } = await supabase
        .from("nurses")
        .select("role")
        .eq("id", nurseId!)
        .maybeSingle();
      return data?.role ?? null;
    },
  });
  const isMatronNurse = /^matron$/i.test(nurseJobRole ?? "");

  // Matrons have no auto-generated assignments. Synthesise a Mon–Fri morning shift
  // so they can use the tracker without a published rota entry.
  const matronAssignment = useMemo<Assignment | null>(() => {
    if (!isMatronNurse) return null;
    const dow = new Date().getDay();
    const isWeekend = dow === 0 || dow === 6;
    return {
      id: "",
      shift: isWeekend ? "OFF" : "M",
      shift_date: today,
      ward: null,
      status: "published",
    };
  }, [isMatronNurse, today]);

  // Active shift (may span midnight for night shifts) or today's completed shift.
  // Filtering by ended_at IS NULL catches a night shift started yesterday that hasn't
  // auto-ended yet; including shift_date = today catches a completed morning shift.
  const { data: shiftLog } = useQuery<ShiftLog | null>({
    queryKey: ["my-shift-log", nurseId, today],
    enabled: !!nurseId,
    queryFn: async () => {
      const { data } = await supabase
        .from("shift_logs")
        .select("*")
        .eq("nurse_id", nurseId!)
        .or(`ended_at.is.null,shift_date.eq.${today}`)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as ShiftLog | null;
    },
    refetchInterval: 30000,
  });

  // Current period summary
  const { data: periodHours } = useQuery<PeriodHours | null>({
    queryKey: ["my-period-hours", nurseId],
    enabled: !!nurseId,
    queryFn: async () => {
      const { data } = await supabase
        .from("nurse_period_hours")
        .select("*")
        .eq("nurse_id", nurseId!)
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as PeriodHours | null;
    },
  });

  // Running hours this period from shift_logs (live sum)
  const { data: currentPeriodLogs = [] } = useQuery<ShiftLog[]>({
    queryKey: ["my-period-logs", nurseId],
    enabled: !!nurseId,
    queryFn: async () => {
      // Find the active period window start (earliest assignment in last 27 days)
      const lookback = new Date();
      lookback.setDate(lookback.getDate() - 27);
      const lb = `${lookback.getFullYear()}-${String(lookback.getMonth() + 1).padStart(2, "0")}-${String(lookback.getDate()).padStart(2, "0")}`;

      const { data: winRow } = await supabase
        .from("shift_assignments")
        .select("shift_date")
        .eq("nurse_id", nurseId!)
        .gte("shift_date", lb)
        .eq("status", "published")
        .order("shift_date", { ascending: true })
        .limit(1);

      const periodStart = winRow?.[0]?.shift_date ?? lb;
      const periodEnd = new Date(periodStart + "T00:00:00");
      periodEnd.setDate(periodEnd.getDate() + 27);
      const pe = `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, "0")}-${String(periodEnd.getDate()).padStart(2, "0")}`;

      const { data } = await supabase
        .from("shift_logs")
        .select("*")
        .eq("nurse_id", nurseId!)
        .gte("shift_date", periodStart)
        .lte("shift_date", pe)
        .order("shift_date", { ascending: false });
      return (data ?? []) as ShiftLog[];
    },
  });

  const currentPeriodHours = currentPeriodLogs.reduce((s, l) => s + (l.hours_logged ?? 0), 0);

  // ── Auto-end: check every minute whether the shift's expected end has passed ──
  useEffect(() => {
    if (!shiftLog || shiftLog.ended_at || autoEndingRef.current) return;
    const expectedEnd = new Date(shiftLog.expected_end_at);
    if (now < expectedEnd) return;
    autoEndingRef.current = true;
    void endShift(shiftLog, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  // Management roles see all nurses' shift hours; regular nurses see personal tracker.
  if (activeRole && activeRole !== "nurse") {
    return <AllNursesShiftView />;
  }

  // Matrons (job role "Matron") have no rota assignments — fall back to synthetic.
  const assignment = queryAssignment ?? matronAssignment;

  // ── Actions ───────────────────────────────────────────────────────────────

  async function startShift(lateReason?: string, lateMins?: number) {
    if (!nurseId || !assignment || !["M", "N"].includes(assignment.shift)) return;

    const shiftType = assignment.shift as "M" | "N";
    const startedAt = new Date();
    const expectedEnd = calcExpectedEnd(shiftType, startedAt);

    // Find the period start
    const lookback = new Date();
    lookback.setDate(lookback.getDate() - 27);
    const lb = `${lookback.getFullYear()}-${String(lookback.getMonth() + 1).padStart(2, "0")}-${String(lookback.getDate()).padStart(2, "0")}`;
    const { data: winRow } = await supabase
      .from("shift_assignments")
      .select("shift_date")
      .eq("nurse_id", nurseId)
      .gte("shift_date", lb)
      .order("shift_date", { ascending: true })
      .limit(1);
    const periodStart = winRow?.[0]?.shift_date ?? today;

    const recordedLate = (lateMins ?? 0) > 0;

    const { error } = await supabase.from("shift_logs").insert({
      nurse_id: nurseId,
      shift_date: today,
      shift_type: shiftType,
      started_at: startedAt.toISOString(),
      expected_end_at: expectedEnd.toISOString(),
      period_start: periodStart,
      is_late: recordedLate,
      late_minutes: recordedLate ? lateMins : null,
      late_reason: lateReason?.trim() || null,
    });

    if (error) return toast.error(error.message);
    setLateDialog({ open: false, reason: "", capturedMinutes: 0 });
    toast.success(
      recordedLate
        ? `Shift started — ${lateMins}m late. Reason recorded.`
        : "Shift started — clock is running",
    );
    qc.invalidateQueries({ queryKey: ["my-shift-log"] });
    qc.invalidateQueries({ queryKey: ["my-period-logs"] });
  }

  async function endShift(log: ShiftLog, isAuto = false) {
    const endedAt = isAuto ? new Date(log.expected_end_at) : new Date();
    const hours = hoursLogged(log.started_at, endedAt.toISOString());

    const { error } = await supabase
      .from("shift_logs")
      .update({ ended_at: endedAt.toISOString(), hours_logged: hours })
      .eq("id", log.id);

    if (error) return toast.error(error.message);

    // Accumulate hours into nurses.hours_this_month
    if (nurseId)
      await supabase.rpc("increment_nurse_hours", { p_nurse_id: nurseId, p_hours: hours });

    if (!isAuto) toast.success(`Shift ended — ${fmtHours(hours)} logged`);
    qc.invalidateQueries({ queryKey: ["my-shift-log"] });
    qc.invalidateQueries({ queryKey: ["my-period-logs"] });
    qc.invalidateQueries({ queryKey: ["nurses"] });
  }

  // ── Timing: when this shift is allowed to start ───────────────────────────

  // The official start time for the nurse's shift today (08:00 M / 17:00 N).
  const shiftStartTime = (() => {
    if (!assignment || (assignment.shift !== "M" && assignment.shift !== "N")) return null;
    const t = new Date();
    t.setHours(assignment.shift === "M" ? 8 : 17, 0, 0, 0);
    return t;
  })();

  // Minutes elapsed since the scheduled start (negative = not started yet).
  const minutesSinceStart = shiftStartTime
    ? Math.floor((now.getTime() - shiftStartTime.getTime()) / 60000)
    : -Infinity;

  // Button is only enabled once the shift has officially begun.
  const canStartShift = minutesSinceStart >= 0;
  // Late = more than 15 minutes after the scheduled start.
  const isLate = minutesSinceStart > 15;

  // ── Derived state ─────────────────────────────────────────────────────────

  const isSchedulePublished = assignment?.status === "published";
  const hasShiftToday = assignment && (assignment.shift === "M" || assignment.shift === "N");
  const isActive = shiftLog && !shiftLog.ended_at;
  const isEnded = shiftLog && !!shiftLog.ended_at;
  const elapsed = isActive
    ? fmtDuration(now.getTime() - new Date(shiftLog.started_at).getTime())
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader
        title="My Shift"
        subtitle={fullName ? `Tracking for ${fullName}` : "Shift time tracker"}
      />

      {/* Today's shift card */}
      <div className="bg-card border rounded-xl p-6 shadow-soft">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Today ·{" "}
              {new Date().toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
            {hasShiftToday ? (
              <p className="text-2xl font-bold mt-1">
                {assignment.shift === "M" ? "Morning Shift" : "Night Shift"}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {assignment.shift === "M" ? "08:00 – 17:00" : "17:00 – 08:00"}
                </span>
              </p>
            ) : (
              <p className="text-2xl font-bold mt-1 text-muted-foreground">
                {assignment
                  ? assignment.shift === "LEAVE"
                    ? "On Leave"
                    : "Day Off"
                  : "No assignment"}
              </p>
            )}
            {assignment?.ward && (
              <p className="text-sm text-muted-foreground mt-0.5">Ward: {assignment.ward}</p>
            )}
          </div>

          {/* Status badge */}
          {isActive && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Active
            </span>
          )}
          {isEnded && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-semibold border">
              <CheckCircle2 className="h-3 w-3" />
              Completed
            </span>
          )}
        </div>

        {/* Active shift info */}
        {isActive && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Started</p>
                <p className="font-semibold mt-0.5">{fmtTime(shiftLog.started_at)}</p>
              </div>
              <div className="rounded-lg border bg-emerald-50 border-emerald-200 px-3 py-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wide text-emerald-600">Elapsed</p>
                <p className="font-semibold text-emerald-700 mt-0.5">{elapsed}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ends at</p>
                <p className="font-semibold mt-0.5">{fmtTime(shiftLog.expected_end_at)}</p>
              </div>
            </div>
            {shiftLog.is_late && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 mb-3 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-amber-800">
                    Late start · {shiftLog.late_minutes}m after scheduled time
                  </span>
                  {shiftLog.late_reason && (
                    <p className="text-amber-700 text-xs mt-0.5">{shiftLog.late_reason}</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Completed shift info */}
        {isEnded && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Started</p>
                <p className="font-semibold mt-0.5">{fmtTime(shiftLog.started_at)}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ended</p>
                <p className="font-semibold mt-0.5">{fmtTime(shiftLog.ended_at!)}</p>
              </div>
              <div className="rounded-lg border bg-primary/5 border-primary/20 px-3 py-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Hours</p>
                <p className="font-semibold text-primary mt-0.5">
                  {shiftLog.hours_logged != null ? fmtHours(Number(shiftLog.hours_logged)) : "—"}
                </p>
              </div>
            </div>
            {shiftLog.is_late && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 mb-3 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-amber-800">
                    Late start · {shiftLog.late_minutes}m after scheduled time
                  </span>
                  {shiftLog.late_reason && (
                    <p className="text-amber-700 text-xs mt-0.5">{shiftLog.late_reason}</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Action buttons */}
        {hasShiftToday && !isEnded && (
          <div className="space-y-3">
            {/* Late reason prompt — shown when nurse is overdue and clicks Start */}
            {lateDialog.open && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">
                      Late start — {lateDialog.capturedMinutes} minutes past scheduled time
                    </p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      A reason is required before the shift can be started.
                    </p>
                  </div>
                </div>
                <textarea
                  value={lateDialog.reason}
                  onChange={(e) => setLateDialog((d) => ({ ...d, reason: e.target.value }))}
                  placeholder="e.g. Traffic delay, ward handover overran, personal emergency…"
                  className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void startShift(lateDialog.reason, lateDialog.capturedMinutes)}
                    disabled={!lateDialog.reason.trim()}
                    className="flex-1 h-9 rounded-md bg-amber-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    <PlayCircle className="h-4 w-4" /> Confirm & Start Shift
                  </button>
                  <button
                    type="button"
                    onClick={() => setLateDialog({ open: false, reason: "", capturedMinutes: 0 })}
                    className="px-4 h-9 rounded-md border text-sm font-medium hover:bg-muted transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Unpublished schedule warning */}
            {!shiftLog && !isSchedulePublished && (
              <div className="flex items-start gap-2 rounded-lg border border-muted bg-muted/40 px-3 py-2.5 text-sm">
                <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-muted-foreground">
                  The rota schedule has not been published yet.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              {!shiftLog && !lateDialog.open && (
                <button
                  type="button"
                  disabled={!canStartShift || !isSchedulePublished}
                  onClick={() => {
                    if (isLate) {
                      setLateDialog({
                        open: true,
                        reason: "",
                        capturedMinutes: minutesSinceStart,
                      });
                    } else {
                      void startShift();
                    }
                  }}
                  className={cn(
                    "flex-1 h-11 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2 transition",
                    canStartShift && isSchedulePublished
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-muted text-muted-foreground cursor-not-allowed",
                  )}
                >
                  <PlayCircle className="h-5 w-5" />
                  {!isSchedulePublished
                    ? "Schedule Not Published"
                    : canStartShift
                      ? "Start Shift"
                      : shiftStartTime
                        ? `Shift begins at ${fmtHHMM(shiftStartTime)}`
                        : "Start Shift"}
                </button>
              )}
              {isActive && (
                <button
                  type="button"
                  onClick={() => endShift(shiftLog!)}
                  className="flex-1 h-11 rounded-lg border border-destructive/40 text-destructive text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-destructive/5 transition"
                >
                  <StopCircle className="h-5 w-5" /> End Shift Early
                </button>
              )}
            </div>

            {/* Help text when button is time-locked */}
            {!shiftLog && isSchedulePublished && !canStartShift && shiftStartTime && (
              <p className="text-xs text-center text-muted-foreground">
                The button unlocks at {fmtHHMM(shiftStartTime)} when your shift begins.
              </p>
            )}
          </div>
        )}

        {!hasShiftToday && !assignment && (
          <p className="text-sm text-muted-foreground text-center py-2">
            No shift assignment found for today. Check with your ward manager.
          </p>
        )}
      </div>

      {/* Period summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card border rounded-xl p-5 shadow-soft">
          <div className="flex items-center gap-2 mb-2 text-muted-foreground">
            <Timer className="h-4 w-4" />
            <p className="text-xs uppercase tracking-wide font-medium">Hours this period</p>
          </div>
          <p className="text-3xl font-bold">{fmtHours(currentPeriodHours)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {currentPeriodLogs.filter((l) => l.ended_at).length} shifts completed
          </p>
        </div>
        <div className="bg-card border rounded-xl p-5 shadow-soft">
          <div className="flex items-center gap-2 mb-2 text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
            <p className="text-xs uppercase tracking-wide font-medium">Last period</p>
          </div>
          {periodHours ? (
            <>
              <p className="text-3xl font-bold">{fmtHours(Number(periodHours.total_hours))}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {periodHours.total_shifts} shifts · {periodHours.period_start} →{" "}
                {periodHours.period_end}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No saved period yet</p>
          )}
        </div>
      </div>

      {/* Recent shift history */}
      {currentPeriodLogs.length > 0 && (
        <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h2 className="font-semibold text-sm">Shift history — current period</h2>
          </div>
          <div className="divide-y">
            {currentPeriodLogs.map((log) => (
              <div key={log.id} className="px-5 py-3 flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "h-7 w-7 rounded-full grid place-items-center text-xs font-bold",
                      log.shift_type === "M"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-indigo-100 text-indigo-700",
                    )}
                  >
                    {log.shift_type}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{log.shift_date}</p>
                      {log.is_late && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {log.late_minutes}m late
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {fmtTime(log.started_at)} →{" "}
                      {log.ended_at ? fmtTime(log.ended_at) : "in progress"}
                    </p>
                    {log.is_late && log.late_reason && (
                      <p className="text-xs text-amber-700 mt-0.5 italic">{log.late_reason}</p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  {log.hours_logged != null ? (
                    <span className="font-semibold">{fmtHours(Number(log.hours_logged))}</span>
                  ) : (
                    <span className="text-emerald-600 text-xs font-medium flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Running
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── All-nurses shift hours view (admin / management roles) ────────────────────

type NurseRow = {
  id: string;
  name: string;
  role: string;
  ward: string | null;
  facility: string | null;
  target_hours: number;
};
type AllShiftLog = {
  nurse_id: string;
  hours_logged: number | null;
  shift_date: string;
  shift_type: string;
  started_at: string;
  ended_at: string | null;
  is_late: boolean;
  late_minutes: number | null;
};

function AllNursesShiftView() {
  const [search, setSearch] = useState("");

  const lookback = new Date();
  lookback.setDate(lookback.getDate() - 27);
  const lbStr = `${lookback.getFullYear()}-${String(lookback.getMonth() + 1).padStart(2, "0")}-${String(lookback.getDate()).padStart(2, "0")}`;

  const { data: nurses = [] } = useQuery<NurseRow[]>({
    queryKey: ["nurses"],
    queryFn: async () =>
      ((
        await supabase
          .from("nurses")
          .select("id,name,role,ward,facility,target_hours")
          .order("name")
      ).data ?? []) as NurseRow[],
  });

  const { data: logs = [] } = useQuery<AllShiftLog[]>({
    queryKey: ["all-shift-logs-current"],
    queryFn: async () => {
      const { data } = await supabase
        .from("shift_logs")
        .select(
          "nurse_id,hours_logged,shift_date,shift_type,started_at,ended_at,is_late,late_minutes",
        )
        .gte("shift_date", lbStr)
        .order("shift_date", { ascending: false });
      return (data ?? []) as AllShiftLog[];
    },
  });

  // Build per-nurse totals
  const hoursMap = new Map<string, number>();
  const shiftsMap = new Map<string, number>();
  const activeMap = new Map<string, boolean>(); // currently running
  const lateMap = new Map<string, number>(); // late-start count
  for (const l of logs) {
    if (l.hours_logged != null) {
      hoursMap.set(l.nurse_id, (hoursMap.get(l.nurse_id) ?? 0) + l.hours_logged);
      shiftsMap.set(l.nurse_id, (shiftsMap.get(l.nurse_id) ?? 0) + 1);
    } else if (!l.ended_at) {
      activeMap.set(l.nurse_id, true);
    }
    if (l.is_late) {
      lateMap.set(l.nurse_id, (lateMap.get(l.nurse_id) ?? 0) + 1);
    }
  }

  const filtered = nurses.filter((n) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      n.name.toLowerCase().includes(q) ||
      (n.ward ?? "").toLowerCase().includes(q) ||
      (n.facility ?? "").toLowerCase().includes(q)
    );
  });

  const totalHours = [...hoursMap.values()].reduce((s, h) => s + h, 0);
  const activeCount = activeMap.size;

  return (
    <div className="space-y-6">
      <PageHeader title="Shift Hours" subtitle="All staff · current 28-day period" />

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border rounded-xl p-5 shadow-soft">
          <div className="flex items-center gap-2 mb-1 text-muted-foreground">
            <Users className="h-4 w-4" />
            <p className="text-xs uppercase tracking-wide font-medium">Total staff</p>
          </div>
          <p className="text-3xl font-bold">{nurses.length}</p>
        </div>
        <div className="bg-card border rounded-xl p-5 shadow-soft">
          <div className="flex items-center gap-2 mb-1 text-muted-foreground">
            <Timer className="h-4 w-4" />
            <p className="text-xs uppercase tracking-wide font-medium">Hours logged</p>
          </div>
          <p className="text-3xl font-bold">{fmtHours(totalHours)}</p>
          <p className="text-xs text-muted-foreground mt-1">this 28-day period</p>
        </div>
        <div className="bg-card border rounded-xl p-5 shadow-soft">
          <div className="flex items-center gap-2 mb-1 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <p className="text-xs uppercase tracking-wide font-medium">Active now</p>
          </div>
          <p className="text-3xl font-bold text-emerald-600">{activeCount}</p>
          <p className="text-xs text-muted-foreground mt-1">shifts in progress</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          type="search"
          placeholder="Search by name, ward or facility…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 px-3 w-72 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">{filtered.length} staff</span>
      </div>

      {/* Table */}
      <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Nurse</th>
              <th className="text-left px-4 py-3 font-semibold">Ward</th>
              <th className="text-left px-4 py-3 font-semibold">Facility</th>
              <th className="text-right px-4 py-3 font-semibold">Shifts</th>
              <th className="text-right px-4 py-3 font-semibold">Hours</th>
              <th className="text-left px-4 py-3 font-semibold w-40">Progress</th>
              <th className="text-right px-4 py-3 font-semibold">Late</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((n) => {
              const hrs = hoursMap.get(n.id) ?? 0;
              const shifts = shiftsMap.get(n.id) ?? 0;
              const lateCount = lateMap.get(n.id) ?? 0;
              const target = n.target_hours || 185;
              const pct = Math.min(Math.round((hrs / target) * 100), 100);
              const isActive = activeMap.get(n.id) ?? false;
              return (
                <tr key={n.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-medium">{n.name}</p>
                    <p className="text-xs text-muted-foreground">{n.role}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {n.ward?.split("|")[0] ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{n.facility ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{shifts}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">
                    {fmtHours(hrs)}
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      / {target}h
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-2 rounded-full bg-muted overflow-hidden w-32">
                      <Progress value={pct} className="h-full rounded-full" />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{pct}%</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {lateCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                        <AlertTriangle className="h-3 w-3" />
                        {lateCount}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Active
                      </span>
                    ) : hrs > 0 ? (
                      <span className="text-xs text-muted-foreground">Logged hours</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No logs yet</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
