import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import {
  FileCheck2,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  BookOpen,
  FileSpreadsheet,
  FileDown,
  Undo2,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { isGlobalHead } from "@/lib/auto-schedule";

export const Route = createFileRoute("/_app/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals — Nurses Rota" },
      {
        name: "description",
        content: "Rota approval workflow: Draft → Chief Matron → CNO → Published.",
      },
    ],
  }),
  component: ApprovalsPage,
});

type PendingRow = {
  id: string;
  shift_date: string;
  status: string;
  nurse_id: string;
};

type WindowStatus = "draft" | "submitted" | "approved_chief" | "approved_cno" | "published";

type RotaWindow = {
  startDate: string;
  endDate: string;
  status: WindowStatus;
  assignmentCount: number;
  nurseCount: number;
};

type ApprovalStep = { key: string; label: string; status: string };

const STEPS: ApprovalStep[] = [
  { key: "draft", label: "Draft", status: "draft" },
  { key: "submitted", label: "Submitted", status: "submitted" },
  { key: "approved_chief", label: "Chief Matron", status: "approved_chief" },
  { key: "approved_cno", label: "CNO", status: "approved_cno" },
  { key: "published", label: "Published", status: "published" },
];

function dominantStatus(statuses: string[]): WindowStatus {
  if (statuses.includes("published")) return "published";
  if (statuses.includes("approved_cno")) return "approved_cno";
  if (statuses.includes("approved_chief")) return "approved_chief";
  if (statuses.includes("submitted")) return "submitted";
  return "draft";
}

function groupIntoWindows(rows: PendingRow[]): RotaWindow[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.shift_date.localeCompare(b.shift_date));
  const windows: RotaWindow[] = [];
  let cluster: PendingRow[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = cluster[cluster.length - 1];
    const diff = Math.round(
      (new Date(sorted[i].shift_date).getTime() - new Date(prev.shift_date).getTime()) / 86400000,
    );
    if (diff > 14) {
      windows.push(makeWindow(cluster));
      cluster = [];
    }
    cluster.push(sorted[i]);
  }
  if (cluster.length) windows.push(makeWindow(cluster));
  return windows.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

function makeWindow(rows: PendingRow[]): RotaWindow {
  const dates = rows.map((r) => r.shift_date).sort();
  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    status: dominantStatus(rows.map((r) => r.status)),
    assignmentCount: rows.length,
    nurseCount: new Set(rows.map((r) => r.nurse_id)).size,
  };
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Always return the canonical 28-day end from a schedule start date,
// regardless of what the DB's max assignment date happens to be.
function scheduleEndDate(startDate: string): string {
  const d = new Date(startDate + "T00:00:00");
  d.setDate(d.getDate() + 27);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(start + "T00:00:00");
  const endDt = new Date(end + "T00:00:00");
  while (cur <= endDt) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const STATUS_LABELS: Record<WindowStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting Chief Matron",
  approved_chief: "Awaiting CNO",
  approved_cno: "Awaiting Publication",
  published: "Published",
};

const STATUS_COLORS: Record<WindowStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  submitted: "bg-amber-100 text-amber-800 border-amber-200",
  approved_chief: "bg-blue-100 text-blue-800 border-blue-200",
  approved_cno: "bg-violet-100 text-violet-800 border-violet-200",
  published: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

function parseWards(ward: string | null): string[] {
  if (!ward) return [];
  return ward.split("|").filter(Boolean);
}

function ApprovalsPage() {
  const { hasAnyRole, user } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  // exportScope keyed by window startDate: "" = all, "__HEAD__" = head nurses, ward name = that ward
  const [exportScope, setExportScope] = useState<Record<string, string>>({});

  const canApproveChief = hasAnyRole(["admin", "chief_matron"]);
  const canApproveCNO = hasAnyRole(["admin", "cno"]);
  const canPublish = hasAnyRole(["admin", "cno"]);
  const canSubmit = hasAnyRole(["admin", "cno", "chief_matron", "head_nurse", "hr_admin"]);
  const canRevertPublished = hasAnyRole(["admin"]);

  const { data: allNurses = [] } = useQuery({
    queryKey: ["nurses-approvals"],
    queryFn: async () =>
      ((await supabase.from("nurses").select("id, name, role, ward").order("name")).data ?? []) as {
        id: string;
        name: string;
        role: string;
        ward: string | null;
      }[],
  });

  // Fetch all assignment windows (all statuses, bounded to ±6 months for performance)
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["approvals"],
    queryFn: async () => {
      const sixAgo = new Date();
      sixAgo.setMonth(sixAgo.getMonth() - 6);
      const threeAhead = new Date();
      threeAhead.setMonth(threeAhead.getMonth() + 3);
      const ymd = (d: Date) => {
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${d.getFullYear()}-${m}-${day}`;
      };

      const { data, error } = await supabase
        .from("shift_assignments")
        .select("id, shift_date, status, nurse_id")
        .gte("shift_date", ymd(sixAgo))
        .lte("shift_date", ymd(threeAhead));
      if (error) throw error;
      return (data ?? []) as PendingRow[];
    },
  });

  const windows = groupIntoWindows(rows);

  type AssignmentStatus = "draft" | "submitted" | "approved_chief" | "approved_cno" | "published";

  async function submitDraft(win: RotaWindow) {
    setBusy(win.startDate);
    const { error } = await supabase
      .from("shift_assignments")
      .update({ status: "submitted" })
      .gte("shift_date", win.startDate)
      .lte("shift_date", win.endDate)
      .eq("status", "draft");
    setBusy(null);
    if (error) return toast.error(error.message);
    await supabase.from("audit_logs").insert({
      actor_id: user?.id,
      actor_name: user?.email ?? null,
      action: "Submitted rota for approval",
      target: `${win.startDate} → ${win.endDate}`,
    });
    toast.success("Submitted to Chief Matron");
    qc.invalidateQueries({ queryKey: ["approvals"] });
  }

  async function advance(win: RotaWindow, nextStatus: AssignmentStatus) {
    setBusy(win.startDate);
    const { error } = await supabase
      .from("shift_assignments")
      .update({ status: nextStatus })
      .gte("shift_date", win.startDate)
      .lte("shift_date", win.endDate)
      .eq("status", win.status);
    setBusy(null);
    if (error) return toast.error(error.message);
    await supabase.from("audit_logs").insert({
      actor_id: user?.id,
      actor_name: user?.email ?? null,
      action:
        nextStatus === "published"
          ? "Rota published"
          : `Rota approved (${nextStatus.replace(/_/g, " ")})`,
      target: `${win.startDate} → ${win.endDate}`,
    });
    toast.success(nextStatus === "published" ? "Rota published!" : "Approved — moving to next step");
    qc.invalidateQueries({ queryKey: ["approvals"] });
    qc.invalidateQueries({ queryKey: ["assignments"] });
  }

  async function reject(win: RotaWindow) {
    if (!confirm("Return this rota to draft? The submitter will need to resubmit.")) return;
    setBusy(win.startDate);
    const { error } = await supabase
      .from("shift_assignments")
      .update({ status: "draft" })
      .gte("shift_date", win.startDate)
      .lte("shift_date", win.endDate)
      .eq("status", win.status);
    setBusy(null);
    if (error) return toast.error(error.message);
    await supabase.from("audit_logs").insert({
      actor_id: user?.id,
      actor_name: user?.email ?? null,
      action: "Rota returned to draft",
      target: `${win.startDate} → ${win.endDate}`,
    });
    toast.success("Returned to draft");
    qc.invalidateQueries({ queryKey: ["approvals"] });
    qc.invalidateQueries({ queryKey: ["assignments"] });
  }

  async function revertPublished(win: RotaWindow) {
    if (
      !confirm(
        "Unpublish this rota and return it to Draft?\n\nThe schedule data is kept exactly as published. You can edit it or auto-generate a new schedule from the Rota page.",
      )
    )
      return;
    setBusy(win.startDate);
    const { error } = await supabase
      .from("shift_assignments")
      .update({ status: "draft" })
      .gte("shift_date", win.startDate)
      .lte("shift_date", win.endDate)
      .eq("status", "published");
    setBusy(null);
    if (error) return toast.error(error.message);
    await supabase.from("audit_logs").insert({
      actor_id: user?.id,
      actor_name: user?.email ?? null,
      action: "Unpublished rota — returned to Draft",
      target: `${win.startDate} → ${win.endDate}`,
    });
    toast.success("Rota unpublished — schedule is unchanged and now editable");
    qc.invalidateQueries({ queryKey: ["approvals"] });
    qc.invalidateQueries({ queryKey: ["assignments"] });
  }

  // Fetch published rota data for a window, optionally filtered by scope.
  // scope = "" → all staff  |  "__HEAD__" → head nurses only  |  ward name → that ward + its interns
  async function fetchWindowData(win: RotaWindow, scope = "") {
    const endDate = scheduleEndDate(win.startDate);
    const { data: assignData } = await supabase
      .from("shift_assignments")
      .select("nurse_id, shift_date, shift")
      .gte("shift_date", win.startDate)
      .lte("shift_date", endDate)
      .eq("status", "published");

    const assignments = (assignData ?? []) as { nurse_id: string; shift_date: string; shift: string }[];
    const assignMap = new Map<string, string>();
    assignments.forEach((a) => assignMap.set(`${a.nurse_id}|${a.shift_date}`, a.shift));

    const activeIds = new Set(assignments.map((a) => a.nurse_id));
    let activeNurses = allNurses.filter((n) => activeIds.has(n.id));

    if (scope === "__HEAD__") {
      activeNurses = activeNurses.filter((n) => isGlobalHead(n.role));
    } else if (scope) {
      // Ward export: ward nurses + interns whose assigned ward matches
      activeNurses = activeNurses.filter(
        (n) =>
          !isGlobalHead(n.role) &&
          parseWards(n.ward)[0] === scope,
      );
    }

    return { activeNurses, assignMap };
  }

  async function handleDownloadExcel(win: RotaWindow) {
    const scope = exportScope[win.startDate] ?? "";
    setDownloading(win.startDate + "-xlsx");
    try {
      const [XLSX, { activeNurses, assignMap }] = await Promise.all([
        import("xlsx"),
        fetchWindowData(win, scope),
      ]);
      const endDate = scheduleEndDate(win.startDate);
      const dates = dateRange(win.startDate, endDate);

      const scopeLabel =
        scope === "__HEAD__" ? " — Head Nurses" : scope ? ` — ${scope}` : "";
      const title = `Nurse Rota: ${fmtDate(win.startDate)} — ${fmtDate(endDate)}${scopeLabel}`;

      const headers = [
        "Nurse",
        "Role",
        "Ward",
        ...dates.map((d) => {
          const dt = new Date(d + "T00:00:00");
          return `${dt.toLocaleDateString("en-GB", { weekday: "short" })} ${dt.getDate()}/${dt.getMonth() + 1}`;
        }),
      ];

      const rowData = activeNurses.map((n) => [
        n.name,
        n.role,
        n.ward ? n.ward.split("|")[0] : "",
        ...dates.map((d) => assignMap.get(`${n.id}|${d}`) ?? ""),
      ]);

      const wb = XLSX.utils.book_new();
      // Title row, blank spacer row, then headers + data
      const ws = XLSX.utils.aoa_to_sheet([[title], [], headers, ...rowData]);
      ws["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 14 }, ...dates.map(() => ({ wch: 5 }))];
      XLSX.utils.book_append_sheet(wb, ws, "Rota");
      const fileSuffix = scope === "__HEAD__" ? "-head-nurses" : scope ? `-${scope.replace(/\s+/g, "-").toLowerCase()}` : "";
      XLSX.writeFile(wb, `rota-${win.startDate}-to-${win.endDate}${fileSuffix}.xlsx`);
    } catch {
      toast.error("Failed to generate Excel file");
    } finally {
      setDownloading(null);
    }
  }

  async function handleDownloadPdf(win: RotaWindow) {
    const scope = exportScope[win.startDate] ?? "";
    setDownloading(win.startDate + "-pdf");
    try {
      const { activeNurses, assignMap } = await fetchWindowData(win, scope);
      const endDate = scheduleEndDate(win.startDate);
      const dates = dateRange(win.startDate, endDate);

      const shiftBg: Record<string, string> = {
        M: "#fef3c7",
        N: "#e0e7ff",
        OFF: "#f3f4f6",
        LEAVE: "#fee2e2",
      };

      const dateHeaders = dates
        .map((d) => {
          const dt = new Date(d + "T00:00:00");
          return `<th>${dt.toLocaleDateString("en-GB", { weekday: "short" })}<br/>${dt.getDate()}/${dt.getMonth() + 1}</th>`;
        })
        .join("");

      const bodyRows = activeNurses
        .map((n) => {
          const cells = dates
            .map((d) => {
              const s = assignMap.get(`${n.id}|${d}`) ?? "";
              return `<td style="background:${shiftBg[s] ?? "#fff"}">${s || "—"}</td>`;
            })
            .join("");
          return `<tr><td class="nm">${n.name}</td><td class="sm">${n.role}</td><td class="sm">${n.ward ? n.ward.split("|")[0] : "—"}</td>${cells}</tr>`;
        })
        .join("");

      const pdfScopeLabel =
        scope === "__HEAD__" ? " — Head Nurses" : scope ? ` — ${scope}` : "";

      const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Nurse Rota ${win.startDate} — ${endDate}${pdfScopeLabel}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:7pt;padding:1cm}
h1{font-size:11pt;margin-bottom:4px}
p{font-size:8pt;color:#555;margin-bottom:8px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccc;padding:2px 3px;text-align:center;white-space:nowrap}
th{background:#e5e7eb;font-size:6pt;font-weight:600}
td.nm{text-align:left;font-weight:500;min-width:80px}
td.sm{text-align:left;color:#444;min-width:55px}
.legend{display:flex;gap:12px;margin-top:8px;font-size:7pt}
.lb{display:inline-block;width:10px;height:10px;border:1px solid #aaa;margin-right:2px;vertical-align:middle}
@media print{@page{size:A3 landscape;margin:1cm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<h1>Nurse Rota${pdfScopeLabel}</h1>
<p>${fmtDate(win.startDate)} — ${fmtDate(endDate)} &nbsp;·&nbsp; ${activeNurses.length} staff</p>
<table>
<thead><tr><th>Nurse</th><th>Role</th><th>Ward</th>${dateHeaders}</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
<div class="legend">
<span><span class="lb" style="background:#fef3c7"></span>M Morning</span>
<span><span class="lb" style="background:#e0e7ff"></span>N Night</span>
<span><span class="lb" style="background:#f3f4f6"></span>OFF</span>
<span><span class="lb" style="background:#fee2e2"></span>LEAVE</span>
</div>
<script>window.onload=()=>{window.print()}</script>
</body></html>`;

      const pw = window.open("", "_blank");
      if (!pw) {
        toast.error("Pop-up blocked — allow pop-ups to download the PDF");
        return;
      }
      pw.document.write(html);
      pw.document.close();
    } catch {
      toast.error("Failed to generate PDF");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Approval Workflow" subtitle="Draft → Chief Matron → CNO → Published" />

      {isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      ) : windows.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 className="h-6 w-6" />}
          title="No rotas found"
          description="Generate a rota from the Rota page — it will appear here once created."
        />
      ) : (
        <div className="space-y-4">
          {windows.map((win) => {
            const isBusy = busy === win.startDate;
            const isDownloading = downloading?.startsWith(win.startDate);
            // For published: treat all steps as done by using STEPS.length as the index
            const stepIndex =
              win.status === "published"
                ? STEPS.length
                : STEPS.findIndex((s) => s.status === win.status);

            let canApprove = false;
            let nextStatus: AssignmentStatus = "draft";
            let approveLabel = "";
            if (win.status === "submitted" && canApproveChief) {
              canApprove = true;
              nextStatus = "approved_chief";
              approveLabel = "Approve (Chief Matron)";
            } else if (win.status === "approved_chief" && canApproveCNO) {
              canApprove = true;
              nextStatus = "approved_cno";
              approveLabel = "Approve (CNO)";
            } else if (win.status === "approved_cno" && canPublish) {
              canApprove = true;
              nextStatus = "published";
              approveLabel = "Publish Rota";
            }

            const canReject =
              win.status !== "draft" &&
              win.status !== "published" &&
              ((win.status === "submitted" && canApproveChief) ||
                (win.status === "approved_chief" && canApproveCNO) ||
                (win.status === "approved_cno" && canPublish));

            const showActions =
              (win.status === "draft" && canSubmit) ||
              canApprove ||
              canReject ||
              win.status === "published";

            return (
              <div key={win.startDate} className="rounded-xl border bg-card overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {fmtDate(win.startDate)} → {fmtDate(win.endDate)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {win.nurseCount} nurses · {win.assignmentCount} assignments
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border",
                      STATUS_COLORS[win.status],
                    )}
                  >
                    {win.status === "published" ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <Clock className="h-3 w-3" />
                    )}
                    {STATUS_LABELS[win.status]}
                  </span>
                </div>

                {/* Step tracker */}
                <div className="px-5 py-4">
                  <ol className="flex items-center gap-0">
                    {STEPS.map((step, idx) => {
                      const done = idx < stepIndex;
                      const active = idx === stepIndex;
                      const last = idx === STEPS.length - 1;
                      return (
                        <li key={step.key} className="flex items-center">
                          <div className="flex flex-col items-center gap-1">
                            <div
                              className={cn(
                                "h-7 w-7 rounded-full border-2 flex items-center justify-center text-xs font-bold",
                                done
                                  ? "bg-emerald-500 border-emerald-500 text-white"
                                  : active
                                    ? "bg-primary border-primary text-primary-foreground"
                                    : "bg-muted border-border text-muted-foreground",
                              )}
                            >
                              {done ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : (
                                <span>{idx + 1}</span>
                              )}
                            </div>
                            <span
                              className={cn(
                                "text-[10px] whitespace-nowrap",
                                active ? "font-semibold text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {step.label}
                            </span>
                          </div>
                          {!last && (
                            <div
                              className={cn(
                                "h-0.5 w-8 sm:w-14 mx-1 mb-4",
                                done ? "bg-emerald-500" : "bg-border",
                              )}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>

                {/* Actions row */}
                {showActions && (
                  <div className="px-5 py-3 border-t bg-muted/30 flex items-center justify-end gap-2 flex-wrap">
                    {/* Draft: submit */}
                    {win.status === "draft" && canSubmit && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => submitDraft(win)}
                        className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Send className="h-3.5 w-3.5" /> Submit for Approval
                      </button>
                    )}

                    {/* Pending: reject / approve */}
                    {canReject && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => reject(win)}
                        className="h-8 px-3 rounded-md border bg-card text-xs inline-flex items-center gap-1.5 hover:bg-destructive/10 hover:border-destructive hover:text-destructive disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Return to Draft
                      </button>
                    )}
                    {canApprove && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => advance(win, nextStatus)}
                        className={cn(
                          "h-8 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50",
                          nextStatus === "published"
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-primary text-primary-foreground hover:opacity-90",
                        )}
                      >
                        {nextStatus === "published" ? (
                          <BookOpen className="h-3.5 w-3.5" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        {approveLabel}
                      </button>
                    )}

                    {/* Published: revert (admin only) + downloads */}
                    {win.status === "published" && (() => {
                      // Derive ward list + head nurse presence for this window
                      const winNurseIds = new Set(
                        rows
                          .filter((r) => r.shift_date >= win.startDate && r.shift_date <= win.endDate)
                          .map((r) => r.nurse_id),
                      );
                      const winNurses = allNurses.filter((n) => winNurseIds.has(n.id));
                      const hasHeads = winNurses.some((n) => isGlobalHead(n.role));
                      const wardNames = [
                        ...new Set(
                          winNurses
                            .filter((n) => !isGlobalHead(n.role))
                            .map((n) => parseWards(n.ward)[0])
                            .filter((w): w is string => !!w),
                        ),
                      ].sort();
                      const currentScope = exportScope[win.startDate] ?? "";
                      return (
                        <>
                          {canRevertPublished && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => revertPublished(win)}
                              className="h-8 px-3 rounded-md border bg-card text-xs inline-flex items-center gap-1.5 hover:bg-amber-50 hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
                              title="Admin only — returns schedule to Draft (data unchanged)"
                            >
                              <Undo2 className="h-3.5 w-3.5" /> Unpublish to Draft
                            </button>
                          )}

                          {/* Export scope selector */}
                          <select
                            title="Export scope"
                            value={currentScope}
                            onChange={(e) =>
                              setExportScope((prev) => ({
                                ...prev,
                                [win.startDate]: e.target.value,
                              }))
                            }
                            className="h-8 px-2 rounded-md border bg-card text-xs outline-none focus:ring-2 focus:ring-ring"
                          >
                            <option value="">All Staff</option>
                            {hasHeads && <option value="__HEAD__">Head Nurses</option>}
                            {wardNames.map((w) => (
                              <option key={w} value={w}>
                                {w}
                              </option>
                            ))}
                          </select>
                        <button
                          type="button"
                          disabled={!!isDownloading}
                          onClick={() => handleDownloadExcel(win)}
                          className="h-8 px-3 rounded-md border bg-card text-xs inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                          {downloading === win.startDate + "-xlsx" ? "Generating…" : "Excel"}
                        </button>
                        <button
                          type="button"
                          disabled={!!isDownloading}
                          onClick={() => handleDownloadPdf(win)}
                          className="h-8 px-3 rounded-md border bg-card text-xs inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
                        >
                          <FileDown className="h-3.5 w-3.5 text-red-500" />
                          {downloading === win.startDate + "-pdf" ? "Generating…" : "PDF"}
                        </button>
                      </>
                    );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
