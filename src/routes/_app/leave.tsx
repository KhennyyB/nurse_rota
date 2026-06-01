import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Plus, Check, X, PlaneTakeoff, Loader2 } from "lucide-react";
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
  created_at: string;
};

const statusStyle: Record<string, string> = {
  Pending: "bg-warning/20 text-warning-foreground",
  Approved: "bg-success/15 text-success",
  Rejected: "bg-destructive/15 text-destructive",
};

function LeavePage() {
  const { user, canApproveLeave } = useAuth();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

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

  async function review(l: LeaveRow, status: "Approved" | "Rejected") {
    if (status === "Approved" && l.nurse_id) {
      const { data: lockedShifts } = await supabase
        .from("shift_assignments")
        .select("id")
        .eq("nurse_id", l.nurse_id)
        .gte("shift_date", l.from_date)
        .lte("shift_date", l.to_date)
        .in("status", ["approved_chief", "approved_cno", "published"])
        .limit(1);
      if (lockedShifts && lockedShifts.length > 0) {
        return toast.error(
          "Cannot approve — the rota for this period has already been approved. The schedule must be revised before leave can be accepted.",
        );
      }
    }
    const { error } = await supabase
      .from("leave_requests")
      .update({
        status,
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", l.id);
    if (error) return toast.error(error.message);
    toast.success(`Leave ${status.toLowerCase()}`);
    logAudit(`${status} leave request`, l.nurse_name);
    qc.invalidateQueries({ queryKey: ["leave"] });
  }

  const counts = {
    Pending: rows.filter((r) => r.status === "Pending").length,
    Approved: rows.filter((r) => r.status === "Approved").length,
    Rejected: rows.filter((r) => r.status === "Rejected").length,
  };

  return (
    <div>
      <PageHeader
        title="Leave & Requests"
        subtitle="Self-service requests from nursing staff"
        actions={
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New request
          </button>
        }
      />

      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        {(["Pending", "Approved", "Rejected"] as const).map((s) => (
          <div key={s} className="bg-card border rounded-xl p-4 shadow-soft">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{s}</p>
            <p className="text-2xl font-bold mt-1">{counts[s]}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<PlaneTakeoff className="h-6 w-6" />}
          title="No leave requests yet"
          description="Submit a new request to get started."
          action={
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm"
            >
              <Plus className="h-4 w-4" /> New request
            </button>
          }
        />
      ) : (
        <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {canApproveLeave && <th className="text-left font-semibold px-4 py-3">Nurse</th>}
                  <th className="text-left font-semibold px-4 py-3">Type</th>
                  <th className="text-left font-semibold px-4 py-3">Period</th>
                  <th className="text-left font-semibold px-4 py-3">Status</th>
                  {canApproveLeave && (
                    <th className="text-right font-semibold px-4 py-3">Action</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="border-t hover:bg-muted/30">
                    {canApproveLeave && <td className="px-4 py-3 font-medium">{l.nurse_name}</td>}
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
                    {canApproveLeave && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <button
                            type="button"
                            aria-label="Approve leave request"
                            onClick={() => review(l, "Approved")}
                            disabled={l.status !== "Pending"}
                            className="h-8 w-8 grid place-items-center rounded-md hover:bg-success/15 text-success disabled:opacity-30"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Reject leave request"
                            onClick={() => review(l, "Rejected")}
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
      )}

      {showAdd && <NewLeaveModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

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
            {["Sick", "Annual", "Emergency", "Public Holiday", "Swap"].map((t) => (
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
