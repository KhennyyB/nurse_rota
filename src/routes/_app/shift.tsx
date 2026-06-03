import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { Clock, PlayCircle, StopCircle, CheckCircle2, CalendarDays, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/shift")({
  head: () => ({
    meta: [{ title: "My Shift — Nurses Rota" }],
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
};

type Assignment = {
  id: string;
  shift: "M" | "N" | "OFF" | "LEAVE";
  shift_date: string;
  ward: string | null;
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

function ShiftPage() {
  const { nurseId, fullName } = useAuth();
  const qc = useQueryClient();
  const today = todayYmd();
  const [now, setNow] = useState(new Date());
  const autoEndRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live clock tick every minute
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // ── Queries ───────────────────────────────────────────────────────────────

  // Today's rota assignment
  const { data: assignment } = useQuery<Assignment | null>({
    queryKey: ["my-assignment", nurseId, today],
    enabled: !!nurseId,
    queryFn: async () => {
      const { data } = await supabase
        .from("shift_assignments")
        .select("id, shift, shift_date, ward")
        .eq("nurse_id", nurseId!)
        .eq("shift_date", today)
        .maybeSingle();
      return data as Assignment | null;
    },
  });

  // Today's shift log
  const { data: shiftLog } = useQuery<ShiftLog | null>({
    queryKey: ["my-shift-log", nurseId, today],
    enabled: !!nurseId,
    queryFn: async () => {
      const { data } = await supabase
        .from("shift_logs")
        .select("*")
        .eq("nurse_id", nurseId!)
        .eq("shift_date", today)
        .maybeSingle();
      return data as ShiftLog | null;
    },
    refetchInterval: 30000, // refresh every 30s
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

  const currentPeriodHours = currentPeriodLogs.reduce(
    (s, l) => s + (l.hours_logged ?? 0),
    0,
  );

  // ── Auto-end active shift at expected_end_at ─────────────────────────────
  useEffect(() => {
    if (!shiftLog || shiftLog.ended_at) return;

    const expectedEnd = new Date(shiftLog.expected_end_at);
    const msLeft = expectedEnd.getTime() - Date.now();

    if (msLeft <= 0) {
      void endShift(shiftLog, true);
      return;
    }

    autoEndRef.current = setTimeout(() => {
      void endShift(shiftLog, true);
    }, msLeft);

    return () => {
      if (autoEndRef.current) clearTimeout(autoEndRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftLog?.id]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function startShift() {
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

    const { error } = await supabase.from("shift_logs").insert({
      nurse_id: nurseId,
      shift_date: today,
      shift_type: shiftType,
      started_at: startedAt.toISOString(),
      expected_end_at: expectedEnd.toISOString(),
      period_start: periodStart,
    });

    if (error) return toast.error(error.message);
    toast.success("Shift started — clock is running");
    qc.invalidateQueries({ queryKey: ["my-shift-log"] });
    qc.invalidateQueries({ queryKey: ["my-period-logs"] });
  }

  async function endShift(log: ShiftLog, isAuto = false) {
    if (autoEndRef.current) clearTimeout(autoEndRef.current);

    const endedAt = isAuto ? new Date(log.expected_end_at) : new Date();
    const hours = hoursLogged(log.started_at, endedAt.toISOString());

    const { error } = await supabase
      .from("shift_logs")
      .update({ ended_at: endedAt.toISOString(), hours_logged: hours })
      .eq("id", log.id);

    if (error) return toast.error(error.message);

    // Accumulate hours into nurses.hours_this_month
    await supabase.rpc("increment_nurse_hours", { p_nurse_id: nurseId, p_hours: hours });

    if (!isAuto) toast.success(`Shift ended — ${fmtHours(hours)} logged`);
    qc.invalidateQueries({ queryKey: ["my-shift-log"] });
    qc.invalidateQueries({ queryKey: ["my-period-logs"] });
    qc.invalidateQueries({ queryKey: ["nurses"] });
  }

  // ── Derived state ─────────────────────────────────────────────────────────

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
              Today · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
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
                {assignment ? (assignment.shift === "LEAVE" ? "On Leave" : "Day Off") : "No assignment"}
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
          <div className="grid grid-cols-3 gap-3 mb-5">
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
        )}

        {/* Completed shift info */}
        {isEnded && (
          <div className="grid grid-cols-3 gap-3 mb-5">
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
        )}

        {/* Action buttons */}
        {hasShiftToday && !isEnded && (
          <div className="flex gap-3">
            {!shiftLog && (
              <button
                type="button"
                onClick={startShift}
                className="flex-1 h-11 rounded-lg bg-emerald-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-emerald-700 transition"
              >
                <PlayCircle className="h-5 w-5" /> Start Shift
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
                {periodHours.total_shifts} shifts · {periodHours.period_start} → {periodHours.period_end}
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
                    <p className="font-medium">{log.shift_date}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtTime(log.started_at)} → {log.ended_at ? fmtTime(log.ended_at) : "in progress"}
                    </p>
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
