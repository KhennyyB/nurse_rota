import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Plus, Check, X, PlaneTakeoff, ArrowLeftRight, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "./staff";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { isNAType, isWardSupervisor } from "@/lib/auto-schedule";

export const Route = createFileRoute("/_app/leave")({
  component: LeavePage,
});

type LeaveRow = {
  id: string;
  nurse_id: string | null;
  nurse_name: string;
  type: string;
  from_date: string;
  to_date: string;
  status: "Pending" | "Approved" | "Rejected";
  reason: string | null;
  created_at: string;
};

// Shift switch requests are stored as leave_requests with type="Swap" and
// a reason field that starts with the SWITCH_PREFIX sentinel.
const SWITCH_PREFIX = "SHIFT_SWITCH|";

function parseSwitch(row: LeaveRow) {
  if (!row.reason?.startsWith(SWITCH_PREFIX)) return null;
  const parts = row.reason.slice(SWITCH_PREFIX.length).split("|");
  return {
    nurseBId: parts[0] ?? "",
    nurseBName: parts[1] ?? "",
    shiftA: parts[2] ?? "",
    shiftB: parts[3] ?? "",
    date: row.from_date,
  };
}

function isShiftSwitch(row: LeaveRow) {
  return row.type === "Swap" && row.reason?.startsWith(SWITCH_PREFIX);
}

const statusStyle: Record<string, string> = {
  Pending: "bg-warning/20 text-warning-foreground",
  Approved: "bg-success/15 text-success",
  Rejected: "bg-destructive/15 text-destructive",
};

type StatusFilter = "All" | "Pending" | "Approved" | "Rejected";
type ActiveTab = "leave" | "switches";

function LeavePage() {
  const { user, canApproveLeave, canRequestShiftSwitch, canApproveShiftSwitch } = useAuth();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [activeTab, setActiveTab] = useState<ActiveTab>("leave");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: canApproveLeave ? ["leave"] : ["leave", "mine", user?.id],
    queryFn: async () => {
      let q = supabase.from("leave_requests").select("*").order("created_at", { ascending: false });
      if (!canApproveLeave) q = q.eq("requested_by", user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return data as LeaveRow[];
    },
  });

  // Split into leave requests and shift switch requests
  const leaveRows = rows.filter((r) => !isShiftSwitch(r));
  const switchRows = rows.filter((r) => isShiftSwitch(r));
  const activeRows = activeTab === "leave" ? leaveRows : switchRows;

  async function reviewLeave(l: LeaveRow, status: "Approved" | "Rejected") {
    if (status === "Approved" && l.nurse_id) {
      // Fetch the nurse's locked assignments during the leave window.
      const [{ data: leavingShifts }, { data: leavingNurse }] = await Promise.all([
        supabase
          .from("shift_assignments")
          .select("id, shift_date, shift, ward")
          .eq("nurse_id", l.nurse_id)
          .gte("shift_date", l.from_date)
          .lte("shift_date", l.to_date)
          .in("status", ["submitted", "approved_chief", "approved_cno", "published"]),
        supabase.from("nurses").select("role").eq("id", l.nurse_id).maybeSingle(),
      ]);

      if (leavingShifts && leavingShifts.length > 0) {
        const ward = leavingShifts.find((s) => s.ward)?.ward ?? null;
        const workingShifts = leavingShifts.filter(
          (s): s is typeof s & { shift: "M" | "N" } => s.shift === "M" || s.shift === "N",
        );

        if (ward) {
          // Revert ALL locked assignments for the entire ward (the scheduling period)
          // to draft so the ward reappears in the generate dropdown for regeneration.
          // We find the period bounds from the ward's currently locked assignments.
          const { data: periodBounds } = await supabase
            .from("shift_assignments")
            .select("shift_date")
            .eq("ward", ward)
            .in("status", ["submitted", "approved_chief", "approved_cno", "published"])
            .order("shift_date", { ascending: true });

          if (periodBounds && periodBounds.length > 0) {
            const periodStart = periodBounds[0].shift_date;
            const periodEnd = periodBounds[periodBounds.length - 1].shift_date;

            await supabase
              .from("shift_assignments")
              .update({ status: "draft" })
              .eq("ward", ward)
              .gte("shift_date", periodStart)
              .lte("shift_date", periodEnd)
              .in("status", ["submitted", "approved_chief", "approved_cno", "published"]);
          }
        }

        // Mark the leave nurse's working shifts as LEAVE + find immediate replacements
        // (so the schedule is correct even if the admin re-approves without regenerating).
        let offCandidates: { id: string; nurse_id: string; shift_date: string }[] = [];
        let roleMap = new Map<string, string>();
        const nYesterdaySet = new Set<string>(); // "nurseId|mDate" — had N day before M

        if (workingShifts.length > 0 && ward) {
          const leaveDates = workingShifts.map((s) => s.shift_date);
          const prevToM = new Map(
            workingShifts
              .filter((s) => s.shift === "M")
              .map((s) => {
                const prev = new Date(s.shift_date + "T00:00:00");
                prev.setDate(prev.getDate() - 1);
                return [prev.toISOString().slice(0, 10), s.shift_date];
              }),
          );

          const { data: offData } = await supabase
            .from("shift_assignments")
            .select("id, nurse_id, shift_date")
            .in("shift_date", leaveDates)
            .eq("ward", ward)
            .eq("shift", "OFF")
            .neq("nurse_id", l.nurse_id);

          offCandidates = offData ?? [];
          const candidateIds = [...new Set(offCandidates.map((c) => c.nurse_id))];

          if (candidateIds.length > 0) {
            const prevDates = [...prevToM.keys()];
            const [{ data: nurseData }, { data: prevNData }] = await Promise.all([
              supabase.from("nurses").select("id, role").in("id", candidateIds),
              prevDates.length > 0
                ? supabase
                    .from("shift_assignments")
                    .select("nurse_id, shift_date")
                    .in("shift_date", prevDates)
                    .in("nurse_id", candidateIds)
                    .eq("shift", "N")
                : Promise.resolve({ data: [] as { nurse_id: string; shift_date: string }[] }),
            ]);

            roleMap = new Map((nurseData ?? []).map((n) => [n.id, n.role]));
            for (const row of prevNData ?? []) {
              const mDate = prevToM.get(row.shift_date);
              if (mDate) nYesterdaySet.add(`${row.nurse_id}|${mDate}`);
            }
          }
        }

        const updates: PromiseLike<unknown>[] = leavingShifts.map((s) =>
          supabase
            .from("shift_assignments")
            .update({ shift: "LEAVE", status: "draft" })
            .eq("id", s.id),
        );

        const leavingRole = leavingNurse?.role ?? "";
        const leavingIsNA = isNAType(leavingRole);
        const leavingIsSupervisor = isWardSupervisor(leavingRole);
        let covered = 0;
        let uncovered = 0;

        for (const s of workingShifts) {
          const eligible = offCandidates.filter(
            (c) =>
              c.shift_date === s.shift_date &&
              !(s.shift === "M" && nYesterdaySet.has(`${c.nurse_id}|${s.shift_date}`)),
          );
          const chosen =
            eligible.find((c) => {
              const role = roleMap.get(c.nurse_id) ?? "";
              return isNAType(role) === leavingIsNA && isWardSupervisor(role) === leavingIsSupervisor;
            }) ?? eligible[0];

          if (chosen) {
            updates.push(
              supabase
                .from("shift_assignments")
                .update({ shift: s.shift, status: "draft" })
                .eq("id", chosen.id),
            );
            covered++;
          } else {
            uncovered++;
          }
        }

        await Promise.all(updates);

        const { error } = await supabase
          .from("leave_requests")
          .update({ status: "Approved", reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
          .eq("id", l.id);
        if (error) return toast.error(error.message);

        const coverNote = covered > 0 ? ` ${covered} shift(s) reassigned from available staff.` : "";
        const warnNote =
          uncovered > 0 ? ` ${uncovered} shift(s) need manual cover — regenerate the ward.` : "";
        toast.success(
          `Leave approved. Ward rota reverted to draft — regenerate or re-approve.${coverNote}${warnNote}`,
        );
        logAudit(
          `Approved leave (post-publish): ward reverted to draft, ${covered} shift(s) reassigned`,
          l.nurse_name,
        );
        qc.invalidateQueries({ queryKey: ["leave"] });
        qc.invalidateQueries({ queryKey: ["assignments"] });
        qc.invalidateQueries({ queryKey: ["gen-scheduled-wards"] });
        return;
      }
    }

    // No locked shifts in this window (draft rota or Rejected) — standard path.
    const { error } = await supabase
      .from("leave_requests")
      .update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
      .eq("id", l.id);
    if (error) return toast.error(error.message);
    toast.success(`Leave ${status.toLowerCase()}`);
    logAudit(`${status} leave request`, l.nurse_name);
    qc.invalidateQueries({ queryKey: ["leave"] });
  }

  async function reviewSwitch(l: LeaveRow, status: "Approved" | "Rejected") {
    if (status === "Approved") {
      const sw = parseSwitch(l);
      if (!sw) return toast.error("Invalid shift switch data");

      // Fetch both nurses' published assignments for the switch date
      const [{ data: assignA }, { data: assignB }] = await Promise.all([
        supabase
          .from("shift_assignments")
          .select("id, shift")
          .eq("nurse_id", l.nurse_id ?? "")
          .eq("shift_date", sw.date)
          .eq("status", "published")
          .maybeSingle(),
        supabase
          .from("shift_assignments")
          .select("id, shift")
          .eq("nurse_id", sw.nurseBId)
          .eq("shift_date", sw.date)
          .eq("status", "published")
          .maybeSingle(),
      ]);

      if (!assignA || !assignB) {
        return toast.error(
          "Cannot apply switch — one or both nurses have no published shift on that date.",
        );
      }

      // Swap the shifts on the published rota
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from("shift_assignments").update({ shift: assignB.shift }).eq("id", assignA.id),
        supabase.from("shift_assignments").update({ shift: assignA.shift }).eq("id", assignB.id),
      ]);
      if (e1 || e2) return toast.error((e1 ?? e2)!.message);
      qc.invalidateQueries({ queryKey: ["assignments"] });
      logAudit(
        `Applied shift switch on published rota: ${l.nurse_name} ↔ ${sw.nurseBName}`,
        sw.date,
      );
    }

    const { error } = await supabase
      .from("leave_requests")
      .update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
      .eq("id", l.id);
    if (error) return toast.error(error.message);
    toast.success(
      status === "Approved" ? "Switch approved and applied to published rota" : "Switch rejected",
    );
    qc.invalidateQueries({ queryKey: ["leave"] });
  }

  const counts = {
    Pending: activeRows.filter((r) => r.status === "Pending").length,
    Approved: activeRows.filter((r) => r.status === "Approved").length,
    Rejected: activeRows.filter((r) => r.status === "Rejected").length,
  };

  const visibleRows =
    statusFilter === "All" ? activeRows : activeRows.filter((r) => r.status === statusFilter);

  const filterActiveStyle = "ring-2 ring-primary";
  const cardStyle = (s: StatusFilter) =>
    `bg-card border rounded-xl p-4 shadow-soft cursor-pointer transition hover:shadow-md ${statusFilter === s ? filterActiveStyle : ""}`;

  const tabCls = (t: ActiveTab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeTab === t
        ? "border-primary text-primary"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div>
      <PageHeader
        title="Leave & Requests"
        subtitle="Self-service requests from nursing staff"
        actions={
          <div className="flex gap-2">
            {canRequestShiftSwitch && (
              <button
                type="button"
                onClick={() => setShowSwitch(true)}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-md border bg-card text-sm font-medium hover:bg-muted"
              >
                <ArrowLeftRight className="h-4 w-4" /> Shift Switch
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> New request
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex border-b mb-4">
        <button
          type="button"
          className={tabCls("leave")}
          onClick={() => {
            setActiveTab("leave");
            setStatusFilter("All");
          }}
        >
          Leave Requests
          {leaveRows.filter((r) => r.status === "Pending").length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              {leaveRows.filter((r) => r.status === "Pending").length}
            </span>
          )}
        </button>
        <button
          type="button"
          className={tabCls("switches")}
          onClick={() => {
            setActiveTab("switches");
            setStatusFilter("All");
          }}
        >
          Shift Switches
          {switchRows.filter((r) => r.status === "Pending").length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              {switchRows.filter((r) => r.status === "Pending").length}
            </span>
          )}
        </button>
      </div>

      {/* Status filter cards */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        {(["Pending", "Approved", "Rejected"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter((f) => (f === s ? "All" : s))}
            className={cardStyle(s)}
          >
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium text-left">
              {s}
            </p>
            <p className="text-2xl font-bold mt-1 text-left">{counts[s]}</p>
            {statusFilter === s && (
              <p className="text-[10px] text-primary font-medium mt-0.5 text-left">Filtering ↑</p>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>
      ) : activeRows.length === 0 ? (
        <EmptyState
          icon={
            activeTab === "switches" ? (
              <ArrowLeftRight className="h-6 w-6" />
            ) : (
              <PlaneTakeoff className="h-6 w-6" />
            )
          }
          title={activeTab === "switches" ? "No shift switch requests" : "No leave requests yet"}
          description={
            activeTab === "switches"
              ? "CNO can request a shift switch on a published rota."
              : "Submit a new request to get started."
          }
          action={
            activeTab === "leave" ? (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm"
              >
                <Plus className="h-4 w-4" /> New request
              </button>
            ) : canRequestShiftSwitch ? (
              <button
                type="button"
                onClick={() => setShowSwitch(true)}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm"
              >
                <ArrowLeftRight className="h-4 w-4" /> Request switch
              </button>
            ) : null
          }
        />
      ) : activeTab === "leave" ? (
        <LeaveTable rows={visibleRows} canApprove={canApproveLeave} onReview={reviewLeave} />
      ) : (
        <SwitchTable
          rows={visibleRows}
          canApprove={canApproveShiftSwitch}
          onReview={reviewSwitch}
        />
      )}

      {showAdd && <NewLeaveModal onClose={() => setShowAdd(false)} />}
      {showSwitch && <ShiftSwitchModal onClose={() => setShowSwitch(false)} />}
    </div>
  );
}

// ── Leave table ──────────────────────────────────────────────────────────────

function LeaveTable({
  rows,
  canApprove,
  onReview,
}: {
  rows: LeaveRow[];
  canApprove: boolean;
  onReview: (l: LeaveRow, s: "Approved" | "Rejected") => void;
}) {
  return (
    <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {canApprove && <th className="text-left font-semibold px-4 py-3">Nurse</th>}
              <th className="text-left font-semibold px-4 py-3">Type</th>
              <th className="text-left font-semibold px-4 py-3">Period</th>
              <th className="text-left font-semibold px-4 py-3">Status</th>
              {canApprove && <th className="text-right font-semibold px-4 py-3">Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={canApprove ? 5 : 3}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  No requests match the current filter.
                </td>
              </tr>
            ) : null}
            {rows.map((l) => (
              <tr key={l.id} className="border-t hover:bg-muted/30">
                {canApprove && <td className="px-4 py-3 font-medium">{l.nurse_name}</td>}
                <td className="px-4 py-3 text-muted-foreground">{l.type}</td>
                <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                  {l.from_date} → {l.to_date}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[10px] px-2 py-1 rounded-full font-semibold ${statusStyle[l.status]}`}
                  >
                    {l.status}
                  </span>
                </td>
                {canApprove && (
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <button
                        type="button"
                        aria-label="Approve leave request"
                        onClick={() => onReview(l, "Approved")}
                        disabled={l.status !== "Pending"}
                        className="h-8 w-8 grid place-items-center rounded-md hover:bg-success/15 text-success disabled:opacity-30"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Reject leave request"
                        onClick={() => onReview(l, "Rejected")}
                        disabled={l.status !== "Pending"}
                        className="h-8 w-8 grid place-items-center rounded-md hover:bg-destructive/15 text-destructive disabled:opacity-30"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Shift switch table ───────────────────────────────────────────────────────

function SwitchTable({
  rows,
  canApprove,
  onReview,
}: {
  rows: LeaveRow[];
  canApprove: boolean;
  onReview: (l: LeaveRow, s: "Approved" | "Rejected") => void;
}) {
  return (
    <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left font-semibold px-4 py-3">Nurse A</th>
              <th className="text-left font-semibold px-4 py-3">Nurse B</th>
              <th className="text-left font-semibold px-4 py-3">Date</th>
              <th className="text-left font-semibold px-4 py-3">Shifts</th>
              <th className="text-left font-semibold px-4 py-3">Status</th>
              {canApprove && <th className="text-right font-semibold px-4 py-3">Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={canApprove ? 6 : 5}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  No switch requests match the current filter.
                </td>
              </tr>
            ) : null}
            {rows.map((l) => {
              const sw = parseSwitch(l);
              return (
                <tr key={l.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{l.nurse_name}</td>
                  <td className="px-4 py-3 font-medium">{sw?.nurseBName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                    {sw?.date ?? l.from_date}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {sw ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          {sw.shiftA || "—"}
                        </span>
                        <ArrowLeftRight className="h-3 w-3" />
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                          {sw.shiftB || "—"}
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[10px] px-2 py-1 rounded-full font-semibold ${statusStyle[l.status]}`}
                    >
                      {l.status}
                    </span>
                  </td>
                  {canApprove && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <button
                          type="button"
                          aria-label="Approve shift switch"
                          onClick={() => onReview(l, "Approved")}
                          disabled={l.status !== "Pending"}
                          className="h-8 w-8 grid place-items-center rounded-md hover:bg-success/15 text-success disabled:opacity-30"
                          title="Approve and apply to published rota"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Reject shift switch"
                          onClick={() => onReview(l, "Rejected")}
                          disabled={l.status !== "Pending"}
                          className="h-8 w-8 grid place-items-center rounded-md hover:bg-destructive/15 text-destructive disabled:opacity-30"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── New leave request modal ──────────────────────────────────────────────────

function NewLeaveModal({ onClose }: { onClose: () => void }) {
  const { user, fullName } = useAuth();
  const qc = useQueryClient();
  const { data: nurses = [] } = useQuery({
    queryKey: ["nurses-min"],
    queryFn: async () =>
      (await supabase.from("nurses").select("id, name").order("name")).data ?? [],
  });

  const [type, setType] = useState("Annual");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const matchedNurse = nurses.find((n) => n.name === fullName);
    const { error } = await supabase.from("leave_requests").insert({
      nurse_id: matchedNurse?.id ?? null,
      nurse_name: fullName ?? "",
      requested_by: user?.id,
      type: type as "Sick" | "Annual" | "Emergency" | "Public Holiday" | "Swap",
      from_date: from,
      to_date: to,
      reason: reason || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Request submitted");
    logAudit("Submitted leave request", fullName ?? "");
    qc.invalidateQueries({ queryKey: ["leave"] });
    onClose();
  }

  const inputCls =
    "w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <Modal title="New leave request" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="leave-type" className="text-sm font-medium">
            Type
          </label>
          <select
            id="leave-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={inputCls}
          >
            {["Sick", "Annual", "Emergency", "Public Holiday"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="leave-from" className="text-sm font-medium">
              From
            </label>
            <input
              id="leave-from"
              required
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="leave-to" className="text-sm font-medium">
              To
            </label>
            <input
              id="leave-to"
              required
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label htmlFor="leave-reason" className="text-sm font-medium">
            Reason (optional)
          </label>
          <textarea
            id="leave-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-md border bg-card text-sm"
          >
            Cancel
          </button>
          <button
            disabled={busy}
            type="submit"
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />} Submit
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Shift switch request modal ───────────────────────────────────────────────

function ShiftSwitchModal({ onClose }: { onClose: () => void }) {
  const { user, fullName } = useAuth();
  const qc = useQueryClient();

  const { data: nurses = [] } = useQuery({
    queryKey: ["nurses-min"],
    queryFn: async () =>
      (await supabase.from("nurses").select("id, name").order("name")).data ?? [],
  });

  const [nurseAId, setNurseAId] = useState("");
  const [nurseBId, setNurseBId] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [shiftA, setShiftA] = useState("");
  const [shiftB, setShiftB] = useState("");
  const [busy, setBusy] = useState(false);

  // When a nurse and date are selected, auto-fetch their published shift
  async function fetchShift(nurseId: string, setShift: (s: string) => void) {
    if (!nurseId || !date) return;
    const { data } = await supabase
      .from("shift_assignments")
      .select("shift")
      .eq("nurse_id", nurseId)
      .eq("shift_date", date)
      .eq("status", "published")
      .maybeSingle();
    setShift(data?.shift ?? "");
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (nurseAId === nurseBId) return toast.error("Please select two different nurses");
    if (!shiftA || !shiftB)
      return toast.error("Could not find published shifts for both nurses on that date");

    setBusy(true);
    const nurseA = nurses.find((n) => n.id === nurseAId);
    const nurseB = nurses.find((n) => n.id === nurseBId);

    const reasonEncoded = `${SWITCH_PREFIX}${nurseBId}|${nurseB?.name ?? ""}|${shiftA}|${shiftB}`;

    const { error } = await supabase.from("leave_requests").insert({
      nurse_id: nurseAId,
      nurse_name: nurseA?.name ?? fullName ?? "",
      requested_by: user?.id,
      type: "Swap",
      from_date: date,
      to_date: date,
      reason: reason ? `${reasonEncoded}|NOTE:${reason}` : reasonEncoded,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Shift switch request submitted for approval");
    logAudit(`Shift switch request submitted: ${nurseA?.name} ↔ ${nurseB?.name}`, date);
    qc.invalidateQueries({ queryKey: ["leave"] });
    onClose();
  }

  const inputCls =
    "w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <Modal title="Request shift switch" onClose={onClose}>
      <p className="text-xs text-muted-foreground mb-4">
        Switches are applied to the <strong>published rota</strong> only after admin approval.
      </p>
      <form onSubmit={submit} className="space-y-4">
        {/* Date */}
        <div>
          <label htmlFor="sw-date" className="text-sm font-medium">
            Switch date <span className="text-destructive">*</span>
          </label>
          <input
            id="sw-date"
            required
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setShiftA("");
              setShiftB("");
            }}
            className={inputCls}
          />
        </div>

        {/* Nurse A */}
        <div>
          <label htmlFor="sw-nurse-a" className="text-sm font-medium">
            Nurse A <span className="text-destructive">*</span>
          </label>
          <select
            id="sw-nurse-a"
            required
            value={nurseAId}
            onChange={(e) => {
              setNurseAId(e.target.value);
              setShiftA("");
              fetchShift(e.target.value, setShiftA);
            }}
            className={inputCls}
          >
            <option value="">Select nurse…</option>
            {nurses.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          {shiftA && (
            <p className="mt-1 text-xs text-muted-foreground">
              Published shift: <span className="font-semibold text-foreground">{shiftA}</span>
            </p>
          )}
          {nurseAId && date && !shiftA && (
            <p className="mt-1 text-xs text-destructive">No published shift found for this date.</p>
          )}
        </div>

        {/* Nurse B */}
        <div>
          <label htmlFor="sw-nurse-b" className="text-sm font-medium">
            Nurse B <span className="text-destructive">*</span>
          </label>
          <select
            id="sw-nurse-b"
            required
            value={nurseBId}
            onChange={(e) => {
              setNurseBId(e.target.value);
              setShiftB("");
              fetchShift(e.target.value, setShiftB);
            }}
            className={inputCls}
          >
            <option value="">Select nurse…</option>
            {nurses
              .filter((n) => n.id !== nurseAId)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
          {shiftB && (
            <p className="mt-1 text-xs text-muted-foreground">
              Published shift: <span className="font-semibold text-foreground">{shiftB}</span>
            </p>
          )}
          {nurseBId && date && !shiftB && (
            <p className="mt-1 text-xs text-destructive">No published shift found for this date.</p>
          )}
        </div>

        {/* Optional note */}
        <div>
          <label htmlFor="sw-reason" className="text-sm font-medium">
            Reason / note (optional)
          </label>
          <textarea
            id="sw-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-md border bg-card text-sm"
          >
            Cancel
          </button>
          <button
            disabled={busy || !nurseAId || !nurseBId || !date}
            type="submit"
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />} Submit for approval
          </button>
        </div>
      </form>
    </Modal>
  );
}
