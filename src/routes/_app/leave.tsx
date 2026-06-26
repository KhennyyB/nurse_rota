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
  review_note: string | null;
  created_at: string;
};

// Shift switch requests are stored as leave_requests with type="Swap" and
// a reason field that starts with the SWITCH_PREFIX sentinel.
const SWITCH_PREFIX = "SHIFT_SWITCH|";

function parseSwitch(row: LeaveRow) {
  if (!row.reason?.startsWith(SWITCH_PREFIX)) return null;
  const parts = row.reason.slice(SWITCH_PREFIX.length).split("|");
  const nurseBId = parts[0] ?? "";
  const nurseBName = parts[1] ?? "";
  const shiftA = parts[2] ?? "";
  const shiftB = parts[3] ?? "";
  let interWard = false;
  let note = "";
  for (let i = 4; i < parts.length; i++) {
    if (parts[i] === "INTER_WARD") interWard = true;
    else if (parts[i].startsWith("NOTE:")) note = parts.slice(i).join("|").slice(5);
  }
  return { nurseBId, nurseBName, shiftA, shiftB, date: row.from_date, interWard, note };
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
      // Fetch only working (M/N) locked assignments — these are the shifts that need cover.
      const { data: publishedShifts } = await supabase
        .from("shift_assignments")
        .select("id, shift_date, shift")
        .eq("nurse_id", l.nurse_id)
        .gte("shift_date", l.from_date)
        .lte("shift_date", l.to_date)
        .in("status", ["submitted", "approved_chief", "approved_cno", "published"])
        .in("shift", ["M", "N"]);

      if (publishedShifts && publishedShifts.length > 0) {
        // Mark each working shift as LEAVE while keeping the rota published.
        await Promise.all(
          publishedShifts.map((s) =>
            supabase.from("shift_assignments").update({ shift: "LEAVE" }).eq("id", s.id),
          ),
        );

        const { error } = await supabase
          .from("leave_requests")
          .update({
            status: "Approved",
            reviewed_by: user?.id,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", l.id);
        if (error) return toast.error(error.message);

        const mDates = publishedShifts.filter((s) => s.shift === "M").map((s) => s.shift_date);
        const nDates = publishedShifts.filter((s) => s.shift === "N").map((s) => s.shift_date);
        const parts: string[] = [];
        if (mDates.length > 0) parts.push(`${mDates.length} Morning (${mDates.join(", ")})`);
        if (nDates.length > 0) parts.push(`${nDates.length} Night (${nDates.join(", ")})`);
        toast.success(
          `Leave approved — rota updated. CNO action required: ${parts.join("; ")} need shift cover.`,
          { duration: 8000 },
        );
        logAudit(
          `Approved leave (post-publish): ${publishedShifts.length} shift(s) marked LEAVE`,
          l.nurse_name,
        );
        qc.invalidateQueries({ queryKey: ["leave"] });
        qc.invalidateQueries({ queryKey: ["assignments"] });
        return;
      }
    }

    // No locked working shifts in this window (draft rota or Rejected) — standard path.
    const { error } = await supabase
      .from("leave_requests")
      .update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
      .eq("id", l.id);
    if (error) return toast.error(error.message);
    toast.success(`Leave ${status.toLowerCase()}`);
    logAudit(`${status} leave request`, l.nurse_name);
    qc.invalidateQueries({ queryKey: ["leave"] });
  }

  async function reviewSwitch(l: LeaveRow, status: "Approved" | "Rejected", note = "") {
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

      if (assignA.shift === "LEAVE") {
        // Nurse A is on approved leave — only assign Nurse B the intended working shift.
        // sw.shiftA holds the shift type encoded at request time (M or N).
        const targetShift = sw.shiftA === "M" || sw.shiftA === "N" ? sw.shiftA : null;
        if (!targetShift) {
          return toast.error(
            "Cannot apply — no valid working shift (M/N) was recorded for Nurse A at request time. Please re-submit the switch request.",
          );
        }
        const { error } = await supabase
          .from("shift_assignments")
          .update({ shift: targetShift })
          .eq("id", assignB.id);
        if (error) return toast.error(error.message);
        qc.invalidateQueries({ queryKey: ["assignments"] });
        logAudit(
          `Leave coverage applied: ${sw.nurseBName} covers ${l.nurse_name}'s ${targetShift} shift`,
          sw.date,
        );
      } else {
        // Normal swap — both nurses exchange their current published shifts.
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
    }

    const { error } = await supabase
      .from("leave_requests")
      .update({
        status,
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
        review_note: note || null,
      })
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
              ? "Chief Matron can request a shift switch on a published rota."
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
  onReview: (l: LeaveRow, s: "Approved" | "Rejected", note: string) => void;
}) {
  const [reviewing, setReviewing] = useState<{
    row: LeaveRow;
    status: "Approved" | "Rejected";
  } | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  function submitReview() {
    if (!reviewing) return;
    onReview(reviewing.row, reviewing.status, reviewNote);
    setReviewing(null);
    setReviewNote("");
  }

  return (
    <>
      <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-4 py-3">Nurse A</th>
                <th className="text-left font-semibold px-4 py-3">Nurse B</th>
                <th className="text-left font-semibold px-4 py-3">Date</th>
                <th className="text-left font-semibold px-4 py-3">Shifts</th>
                <th className="text-left font-semibold px-4 py-3">Reason / Note</th>
                <th className="text-left font-semibold px-4 py-3">Status</th>
                {canApprove && <th className="text-right font-semibold px-4 py-3">Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={canApprove ? 7 : 6}
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
                          {sw.interWard && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                              Inter-Ward
                            </span>
                          )}
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
                    <td className="px-4 py-3 max-w-[180px]">
                      {sw?.note && (
                        <p className="text-xs text-muted-foreground truncate" title={sw.note}>
                          {sw.note}
                        </p>
                      )}
                      {l.review_note && (
                        <p
                          className="text-xs text-muted-foreground/70 truncate mt-0.5 italic"
                          title={`Review note: ${l.review_note}`}
                        >
                          Review: {l.review_note}
                        </p>
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
                            onClick={() => {
                              setReviewing({ row: l, status: "Approved" });
                              setReviewNote("");
                            }}
                            disabled={l.status !== "Pending"}
                            className="h-8 w-8 grid place-items-center rounded-md hover:bg-success/15 text-success disabled:opacity-30"
                            title="Approve and apply to published rota"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Reject shift switch"
                            onClick={() => {
                              setReviewing({ row: l, status: "Rejected" });
                              setReviewNote("");
                            }}
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

      {/* Review note dialog */}
      {reviewing && (
        <Modal
          title={reviewing.status === "Approved" ? "Approve switch" : "Reject switch"}
          onClose={() => setReviewing(null)}
        >
          <p className="text-sm text-muted-foreground mb-4">
            {reviewing.status === "Approved"
              ? "Add a note before approving this shift switch (optional)."
              : "Provide a reason for rejecting this shift switch."}
          </p>
          <textarea
            autoFocus
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            rows={3}
            placeholder={
              reviewing.status === "Approved" ? "Approval note…" : "Reason for rejection…"
            }
            className="w-full px-3 py-2 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={() => setReviewing(null)}
              className="h-9 px-4 rounded-md border bg-card text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={reviewing.status === "Rejected" && !reviewNote.trim()}
              onClick={submitReview}
              className={`h-9 px-4 rounded-md text-sm font-medium disabled:opacity-40 ${
                reviewing.status === "Approved"
                  ? "bg-success text-white hover:bg-success/90"
                  : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              }`}
            >
              {reviewing.status === "Approved" ? "Confirm approval" : "Confirm rejection"}
            </button>
          </div>
        </Modal>
      )}
    </>
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

  const datesReady = !!from && !!to;

  // Check if the selected date range overlaps a published rota.
  // Only runs once both dates are filled in.
  const { data: datesInPublishedRota = false, isFetching: checkingDates } = useQuery({
    queryKey: ["leave-dates-published", from, to],
    enabled: datesReady,
    queryFn: async () => {
      const { data } = await supabase
        .from("shift_assignments")
        .select("id")
        .eq("status", "published")
        .gte("shift_date", from)
        .lte("shift_date", to)
        .limit(1);
      return (data?.length ?? 0) > 0;
    },
  });

  const allowedTypes = datesInPublishedRota
    ? ["Sick", "Emergency"]
    : ["Sick", "Annual", "Emergency", "Public Holiday"];

  // Keep the selected type valid when the allowed list narrows.
  const effectiveType = allowedTypes.includes(type) ? type : allowedTypes[0];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const matchedNurse = nurses.find((n) => n.name === fullName);
    const { error } = await supabase.from("leave_requests").insert({
      nurse_id: matchedNurse?.id ?? null,
      nurse_name: fullName ?? "",
      requested_by: user?.id,
      type: effectiveType as "Sick" | "Annual" | "Emergency" | "Public Holiday" | "Swap",
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
        {/* Dates first — the type options depend on whether these fall in a published rota */}
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
              onChange={(e) => {
                const v = e.target.value;
                setFrom(v);
                if (!to || to < v) setTo(v);
              }}
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
              min={from}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {datesReady && datesInPublishedRota && (
          <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
            These dates fall within a <strong>published schedule</strong>. Only{" "}
            <strong>Sick</strong> and <strong>Emergency</strong> leave can be requested.
          </div>
        )}

        <div>
          <label htmlFor="leave-type" className="text-sm font-medium">
            Type
          </label>
          <select
            id="leave-type"
            value={effectiveType}
            onChange={(e) => setType(e.target.value)}
            disabled={checkingDates}
            className={inputCls}
          >
            {allowedTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          {checkingDates && (
            <p className="text-xs text-muted-foreground mt-1">Checking schedule…</p>
          )}
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
            disabled={busy || checkingDates}
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

const SWITCH_FACILITIES = ["Ikeja", "Ikoyi", "Ligali"] as const;

function splitWards(ward: string | null | undefined): string[] {
  if (!ward) return [];
  return ward
    .split("|")
    .map((w) => w.trim())
    .filter(Boolean);
}

function ShiftSwitchModal({ onClose }: { onClose: () => void }) {
  const { user, fullName } = useAuth();
  const qc = useQueryClient();

  const { data: nurses = [] } = useQuery({
    queryKey: ["nurses-switch"],
    queryFn: async () =>
      (await supabase.from("nurses").select("id, name, ward, facility").order("name")).data ?? [],
  });

  const [switchType, setSwitchType] = useState<"same-ward" | "inter-ward">("same-ward");
  const [facility, setFacility] = useState("");
  const [nurseAId, setNurseAId] = useState("");
  const [nurseBId, setNurseBId] = useState("");
  const [wardB, setWardB] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [shiftA, setShiftA] = useState("");
  const [shiftB, setShiftB] = useState("");
  const [coverShift, setCoverShift] = useState<"M" | "N" | "">("");
  const [busy, setBusy] = useState(false);

  const facilityNurses = nurses.filter((n) => n.facility === facility);
  const nurseA = nurses.find((n) => n.id === nurseAId);
  const nurseAWards = splitWards(nurseA?.ward);
  const allFacilityWards = [...new Set(facilityNurses.flatMap((n) => splitWards(n.ward)))].sort();
  const wardBOptions = allFacilityWards.filter((w) => !nurseAWards.includes(w));

  const nurseBList = nurseAId
    ? switchType === "inter-ward"
      ? wardB
        ? facilityNurses.filter((n) => n.id !== nurseAId && splitWards(n.ward).includes(wardB))
        : []
      : facilityNurses.filter(
          (n) => n.id !== nurseAId && splitWards(n.ward).some((w) => nurseAWards.includes(w)),
        )
    : [];

  async function fetchShift(nurseId: string, forDate: string, setShift: (s: string) => void) {
    if (!nurseId || !forDate) {
      setShift("");
      return;
    }
    const { data } = await supabase
      .from("shift_assignments")
      .select("shift")
      .eq("nurse_id", nurseId)
      .eq("shift_date", forDate)
      .eq("status", "published")
      .maybeSingle();
    setShift(data?.shift ?? "");
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (nurseAId === nurseBId) return toast.error("Please select two different nurses");
    if (!shiftA) return toast.error("Could not find published shift for Nurse A on that date");
    if (!shiftB) return toast.error("Could not find published shift for Nurse B on that date");
    if (shiftA === "LEAVE" && !coverShift)
      return toast.error("Nurse A is on leave — please select the shift type that needs covering");
    if (!reason.trim()) return toast.error("Please provide a reason for this shift switch");

    // 24-hour rule: the shift must start more than 24 hours from now.
    const shiftStart = new Date(`${date}T08:00:00`);
    const hoursUntil = (shiftStart.getTime() - Date.now()) / 3_600_000;
    if (hoursUntil < 24) {
      return toast.error(
        `Shift switch cannot be requested less than 24 hours before the shift (${Math.max(0, Math.floor(hoursUntil))}h remaining). Please contact the CNO directly.`,
      );
    }

    setBusy(true);
    const nurseB = nurses.find((n) => n.id === nurseBId);
    const effectiveShiftA = shiftA === "LEAVE" ? coverShift : shiftA;
    const flags = switchType === "inter-ward" ? "|INTER_WARD" : "";
    const reasonEncoded = `${SWITCH_PREFIX}${nurseBId}|${nurseB?.name ?? ""}|${effectiveShiftA}|${shiftB}${flags}|NOTE:${reason.trim()}`;

    const { error } = await supabase.from("leave_requests").insert({
      nurse_id: nurseAId,
      nurse_name: nurseA?.name ?? fullName ?? "",
      requested_by: user?.id,
      type: "Swap",
      from_date: date,
      to_date: date,
      reason: reasonEncoded,
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
        Switches are applied to the <strong>published rota</strong> only after CNO approval.
        Requests must be submitted at least <strong>24 hours</strong> before the shift.
      </p>
      <form onSubmit={submit} className="space-y-4">
        {/* Switch type */}
        <div>
          <p className="text-sm font-medium mb-1.5">Switch type</p>
          <div className="flex gap-2">
            {(["same-ward", "inter-ward"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setSwitchType(t);
                  setNurseBId("");
                  setWardB("");
                  setShiftB("");
                }}
                className={`h-9 px-4 rounded-md text-sm font-medium border transition-colors ${
                  switchType === t
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border hover:bg-muted text-muted-foreground"
                }`}
              >
                {t === "same-ward" ? "Same Ward" : "Inter Ward"}
              </button>
            ))}
          </div>
        </div>

        {/* Facility */}
        <div>
          <label htmlFor="sw-facility" className="text-sm font-medium">
            Facility <span className="text-destructive">*</span>
          </label>
          <select
            id="sw-facility"
            required
            value={facility}
            onChange={(e) => {
              setFacility(e.target.value);
              setNurseAId("");
              setNurseBId("");
              setWardB("");
              setShiftA("");
              setShiftB("");
            }}
            className={inputCls}
          >
            <option value="">Select facility…</option>
            {SWITCH_FACILITIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

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
              const newDate = e.target.value;
              setDate(newDate);
              setShiftA("");
              setShiftB("");
              // Re-fetch shifts immediately with the new date so already-selected
              // nurses don't stay blank until the user manually re-selects them.
              if (nurseAId) void fetchShift(nurseAId, newDate, setShiftA);
              if (nurseBId) void fetchShift(nurseBId, newDate, setShiftB);
            }}
            className={inputCls}
          />
        </div>

        {/* Nurse A — filtered by facility */}
        <div>
          <label htmlFor="sw-nurse-a" className="text-sm font-medium">
            Nurse A <span className="text-destructive">*</span>
          </label>
          <select
            id="sw-nurse-a"
            required
            disabled={!facility}
            value={nurseAId}
            onChange={(e) => {
              setNurseAId(e.target.value);
              setNurseBId("");
              setShiftA("");
              setShiftB("");
              setCoverShift("");
              void fetchShift(e.target.value, date, setShiftA);
            }}
            className={inputCls}
          >
            <option value="">{facility ? "Select nurse…" : "Select facility first…"}</option>
            {facilityNurses.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          {shiftA && shiftA !== "LEAVE" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Published shift: <span className="font-semibold text-foreground">{shiftA}</span>
            </p>
          )}
          {shiftA === "LEAVE" && (
            <div className="mt-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                Nurse A is on approved leave. Select the shift type that needs covering:
              </p>
              <div className="flex gap-2">
                {(["M", "N"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setCoverShift(s)}
                    className={`h-8 px-4 rounded-md text-sm font-medium border transition-colors ${
                      coverShift === s
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:bg-muted"
                    }`}
                  >
                    {s === "M" ? "Morning (M)" : "Night (N)"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {nurseAId && date && !shiftA && (
            <p className="mt-1 text-xs text-destructive">No published shift found for this date.</p>
          )}
        </div>

        {/* Ward B selector — inter-ward only */}
        {switchType === "inter-ward" && (
          <div>
            <label htmlFor="sw-ward-b" className="text-sm font-medium">
              Ward B (destination) <span className="text-destructive">*</span>
            </label>
            <select
              id="sw-ward-b"
              required
              disabled={!nurseAId}
              value={wardB}
              onChange={(e) => {
                setWardB(e.target.value);
                setNurseBId("");
                setShiftB("");
              }}
              className={inputCls}
            >
              <option value="">{nurseAId ? "Select ward…" : "Select Nurse A first…"}</option>
              {wardBOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Nurse B */}
        <div>
          <label htmlFor="sw-nurse-b" className="text-sm font-medium">
            Nurse B <span className="text-destructive">*</span>
          </label>
          <select
            id="sw-nurse-b"
            required
            disabled={switchType === "inter-ward" ? !wardB : !nurseAId}
            value={nurseBId}
            onChange={(e) => {
              setNurseBId(e.target.value);
              setShiftB("");
              void fetchShift(e.target.value, date, setShiftB);
            }}
            className={inputCls}
          >
            <option value="">
              {switchType === "inter-ward"
                ? wardB
                  ? "Select nurse…"
                  : "Select Ward B first…"
                : nurseAId
                  ? "Select nurse…"
                  : "Select Nurse A first…"}
            </option>
            {nurseBList.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          {nurseAId && nurseBList.length === 0 && (switchType === "same-ward" || wardB) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {switchType === "inter-ward"
                ? "No nurses found in the selected ward."
                : "No other nurses found in the same ward."}
            </p>
          )}
          {shiftB && (
            <p className="mt-1 text-xs text-muted-foreground">
              Published shift: <span className="font-semibold text-foreground">{shiftB}</span>
            </p>
          )}
          {nurseBId && date && !shiftB && (
            <p className="mt-1 text-xs text-destructive">No published shift found for this date.</p>
          )}
        </div>

        {/* Reason — required */}
        <div>
          <label htmlFor="sw-reason" className="text-sm font-medium">
            Reason <span className="text-destructive">*</span>
          </label>
          <textarea
            id="sw-reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Provide a reason for this shift switch…"
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
            disabled={
              busy ||
              !facility ||
              !nurseAId ||
              !nurseBId ||
              !date ||
              !reason.trim() ||
              (switchType === "inter-ward" && !wardB) ||
              (shiftA === "LEAVE" && !coverShift) ||
              // Block if no published shift was found for either nurse on this date.
              // shiftA/shiftB = "" means the fetch returned nothing (not a real shift value).
              // "LEAVE" is handled by the coverShift check above; "OFF", "M", "N" are valid.
              (!!nurseAId && !!date && shiftA !== "LEAVE" && !shiftA) ||
              (!!nurseBId && !!date && !shiftB)
            }
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
