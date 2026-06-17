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
  Building2,
  CalendarRange,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { isGlobalHead, isInternType } from "@/lib/auto-schedule";

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
  ward: string | null;
  shift: string | null;
};

type WindowStatus = "draft" | "submitted" | "approved_chief" | "approved_cno" | "published";

type RotaWindow = {
  startDate: string;
  endDate: string;
  status: WindowStatus;
  assignmentCount: number;
  nurseCount: number;
  ward: string | null;
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

  const byWard = new Map<string, PendingRow[]>();
  for (const row of rows) {
    const key = row.ward ?? "__NONE__";
    if (!byWard.has(key)) byWard.set(key, []);
    byWard.get(key)!.push(row);
  }

  const windows: RotaWindow[] = [];
  for (const [wardKey, wardRows] of byWard) {
    const ward = wardKey === "__NONE__" ? null : wardKey;
    const sorted = [...wardRows].sort((a, b) => a.shift_date.localeCompare(b.shift_date));
    let cluster: PendingRow[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = cluster[cluster.length - 1];
      const diff = Math.round(
        (new Date(sorted[i].shift_date).getTime() - new Date(prev.shift_date).getTime()) /
          86400000,
      );
      if (diff > 14) {
        windows.push(makeWindow(cluster, ward));
        cluster = [];
      }
      cluster.push(sorted[i]);
    }
    if (cluster.length) windows.push(makeWindow(cluster, ward));
  }

  return windows.sort(
    (a, b) =>
      b.startDate.localeCompare(a.startDate) || (a.ward ?? "").localeCompare(b.ward ?? ""),
  );
}

function makeWindow(rows: PendingRow[], ward: string | null): RotaWindow {
  const dates = rows.map((r) => r.shift_date).sort();
  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    status: dominantStatus(rows.map((r) => r.status)),
    assignmentCount: rows.length,
    nurseCount: new Set(rows.map((r) => r.nurse_id)).size,
    ward,
  };
}

function winKey(win: RotaWindow): string {
  return `${win.startDate}|${win.ward ?? ""}`;
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

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
  const { hasAnyRole, user, isAdmin, nurseFacility } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [exportFacility, setExportFacility] = useState<Record<string, string>>({});

  // Non-admins are locked to their own facility.
  const lockedFacility = !isAdmin && nurseFacility ? nurseFacility : null;
  const [selectedFacility, setSelectedFacility] = useState<string>(lockedFacility ?? "");

  const canApproveChief = hasAnyRole(["admin", "chief_matron"]);
  const canApproveCNO = hasAnyRole(["admin", "cno"]);
  const canPublish = hasAnyRole(["admin", "cno"]);
  const canSubmit = hasAnyRole(["admin", "cno", "chief_matron", "head_nurse", "hr_admin"]);
  const canRevertPublished = hasAnyRole(["admin"]);

  const { data: allNurses = [] } = useQuery({
    queryKey: ["nurses-approvals"],
    queryFn: async () =>
      ((await supabase.from("nurses").select("id, name, role, ward, facility").order("name"))
        .data ?? []) as {
        id: string;
        name: string;
        role: string;
        ward: string | null;
        facility: string | null;
      }[],
  });

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
        .select("id, shift_date, status, nurse_id, ward, shift")
        .gte("shift_date", ymd(sixAgo))
        .lte("shift_date", ymd(threeAhead))
        .limit(50000);
      if (error) throw error;
      return (data ?? []) as PendingRow[];
    },
  });

  const windows = groupIntoWindows(rows);

  // Precompute per-window metadata once so it can drive both filtering and rendering.
  const windowMeta = useMemo(() => {
    return new Map(
      windows.map((win) => {
        const winRows = rows.filter(
          (r) =>
            r.shift_date >= win.startDate &&
            r.shift_date <= win.endDate &&
            (win.ward !== null ? r.ward === win.ward : r.ward === null),
        );
        const winNurseIds = new Set(winRows.map((r) => r.nurse_id));
        const winNurses = allNurses.filter((n) => winNurseIds.has(n.id));
        const winFacilities = [
          ...new Set(winNurses.map((n) => n.facility).filter((f): f is string => !!f)),
        ].sort();

        // Nurses with above-baseline working shifts = enforcement added extra shifts.
        const winShiftCounts = new Map<string, number>();
        for (const r of winRows) {
          if (r.shift === "M" || r.shift === "N")
            winShiftCounts.set(r.nurse_id, (winShiftCounts.get(r.nurse_id) ?? 0) + 1);
        }
        const byRole = new Map<string, string[]>();
        for (const n of winNurses) {
          const g = byRole.get(n.role) ?? [];
          g.push(n.id);
          byRole.set(n.role, g);
        }
        const extraStaff: { name: string; extra: number }[] = [];
        for (const ids of byRole.values()) {
          const counts = ids.map((id) => winShiftCounts.get(id) ?? 0);
          const baseline = Math.min(...counts);
          for (const id of ids) {
            const diff = (winShiftCounts.get(id) ?? 0) - baseline;
            if (diff > 0) {
              const nurse = winNurses.find((n) => n.id === id);
              if (nurse) extraStaff.push({ name: nurse.name, extra: diff });
            }
          }
        }

        return [winKey(win), { winFacilities, extraStaff }] as const;
      }),
    );
  }, [windows, rows, allNurses]);

  // Facilities that have at least one window.
  const availableFacilities = useMemo(() => {
    const facs = new Set<string>();
    for (const meta of windowMeta.values()) {
      meta.winFacilities.forEach((f) => facs.add(f));
    }
    return [...facs].sort();
  }, [windowMeta]);

  // Auto-select first available facility when data loads (admin only — non-admins are locked).
  const effectiveFacility =
    selectedFacility ||
    (lockedFacility ?? (availableFacilities.length > 0 ? availableFacilities[0] : ""));

  // Windows that belong to the selected facility.
  const facilityWindows = useMemo(() => {
    if (!effectiveFacility) return windows;
    return windows.filter((win) => {
      const meta = windowMeta.get(winKey(win));
      return meta?.winFacilities.includes(effectiveFacility) ?? false;
    });
  }, [windows, windowMeta, effectiveFacility]);

  // Group filtered windows by period (startDate), newest period first.
  const windowsByPeriod = useMemo(() => {
    const map = new Map<string, RotaWindow[]>();
    for (const win of facilityWindows) {
      const arr = map.get(win.startDate) ?? [];
      arr.push(win);
      map.set(win.startDate, arr);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [facilityWindows]);

  // ── DB actions ─────────────────────────────────────────────────────────────

  async function submitDraft(win: RotaWindow) {
    setBusy(winKey(win));
    const base = supabase
      .from("shift_assignments")
      .update({ status: "submitted" })
      .gte("shift_date", win.startDate)
      .lte("shift_date", win.endDate)
      .eq("status", "draft");
    const { error } = await (win.ward !== null ? base.eq("ward", win.ward) : base.is("ward", null));
    if (error) {
      setBusy(null);
      return toast.error(error.message);
    }

    // When a ward window is submitted, co-submit coverage nurses and interns for
    // the same facility whose assignments still sit at draft (ward = null in DB).
    if (win.ward !== null) {
      const winNurseIds = new Set(
        rows
          .filter(
            (r) => r.shift_date >= win.startDate && r.shift_date <= win.endDate && r.ward === win.ward,
          )
          .map((r) => r.nurse_id),
      );
      const facility = allNurses.find((n) => winNurseIds.has(n.id))?.facility ?? null;
      const globalIds = allNurses
        .filter((n) => n.facility === facility && (isGlobalHead(n.role) || isInternType(n.role)))
        .map((n) => n.id);
      for (let i = 0; i < globalIds.length; i += 200) {
        await supabase
          .from("shift_assignments")
          .update({ status: "submitted" })
          .gte("shift_date", win.startDate)
          .lte("shift_date", win.endDate)
          .eq("status", "draft")
          .in("nurse_id", globalIds.slice(i, i + 200));
      }
    }

    setBusy(null);
    await supabase.from("audit_logs").insert({
      actor_id: user?.id,
      actor_name: user?.email ?? null,
      action: "Submitted rota for approval",
      target: `${win.ward ?? "Coverage Nurses"} · ${win.startDate} → ${win.endDate}`,
    });
    toast.success("Submitted to Chief Matron");
    qc.invalidateQueries({ queryKey: ["approvals"] });
  }

  type AssignmentStatus = "draft" | "submitted" | "approved_chief" | "approved_cno" | "published";

  async function advance(win: RotaWindow, nextStatus: AssignmentStatus) {
    setBusy(winKey(win));
    const buildBase = (statusFilter: AssignmentStatus) =>
      supabase
        .from("shift_assignments")
        .update({ status: nextStatus })
        .gte("shift_date", win.startDate)
        .lte("shift_date", win.endDate)
        .neq("status", statusFilter);
    const buildExact = () =>
      supabase
        .from("shift_assignments")
        .update({ status: nextStatus })
        .gte("shift_date", win.startDate)
        .lte("shift_date", win.endDate)
        .eq("status", win.status);
    const base = nextStatus === "published" ? buildBase("published") : buildExact();
    const { error } = await (win.ward !== null ? base.eq("ward", win.ward) : base.is("ward", null));
    if (error) {
      setBusy(null);
      return toast.error(error.message);
    }

    // When publishing a ward window, also publish the coverage nurses and intern
    // assignments (ward = null) for the same facility so they become available
    // for print and export alongside the ward schedule.
    if (nextStatus === "published" && win.ward !== null) {
      const winNurseIds = new Set(
        rows
          .filter(
            (r) =>
              r.shift_date >= win.startDate && r.shift_date <= win.endDate && r.ward === win.ward,
          )
          .map((r) => r.nurse_id),
      );
      const facility = allNurses.find((n) => winNurseIds.has(n.id))?.facility ?? null;
      const globalIds = allNurses
        .filter((n) => n.facility === facility && (isGlobalHead(n.role) || isInternType(n.role)))
        .map((n) => n.id);
      for (let i = 0; i < globalIds.length; i += 200) {
        await supabase
          .from("shift_assignments")
          .update({ status: "published" })
          .gte("shift_date", win.startDate)
          .lte("shift_date", win.endDate)
          .neq("status", "published")
          .in("nurse_id", globalIds.slice(i, i + 200));
      }
    }

    setBusy(null);
    await supabase.from("audit_logs").insert({
      actor_id: user?.id,
      actor_name: user?.email ?? null,
      action:
        nextStatus === "published"
          ? "Rota published"
          : `Rota approved (${nextStatus.replace(/_/g, " ")})`,
      target: `${win.ward ?? "Coverage Nurses"} · ${win.startDate} → ${win.endDate}`,
    });
    toast.success(
      nextStatus === "published" ? "Rota published!" : "Approved — moving to next step",
    );
    qc.invalidateQueries({ queryKey: ["approvals"] });
    qc.invalidateQueries({ queryKey: ["assignments"] });
  }

  async function reject(win: RotaWindow) {
    if (!confirm("Return this rota to draft? The submitter will need to resubmit.")) return;
    setBusy(winKey(win));
    const base = supabase
      .from("shift_assignments")
      .update({ status: "draft" })
      .gte("shift_date", win.startDate)
      .lte("shift_date", win.endDate)
      .eq("status", win.status);
    const { error } = await (win.ward !== null ? base.eq("ward", win.ward) : base.is("ward", null));
    setBusy(null);
    if (error) return toast.error(error.message);
    await supabase.from("audit_logs").insert({
      actor_id: user?.id,
      actor_name: user?.email ?? null,
      action: "Rota returned to draft",
      target: `${win.ward ?? "Coverage Nurses"} · ${win.startDate} → ${win.endDate}`,
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
    setBusy(winKey(win));
    const base = supabase
      .from("shift_assignments")
      .update({ status: "draft" })
      .gte("shift_date", win.startDate)
      .lte("shift_date", win.endDate)
      .eq("status", "published");
    const { error } = await (win.ward !== null ? base.eq("ward", win.ward) : base.is("ward", null));
    setBusy(null);
    if (error) return toast.error(error.message);
    await supabase.from("audit_logs").insert({
      actor_id: user?.id,
      actor_name: user?.email ?? null,
      action: "Unpublished rota — returned to Draft",
      target: `${win.ward ?? "Coverage Nurses"} · ${win.startDate} → ${win.endDate}`,
    });
    toast.success("Rota unpublished — schedule is unchanged and now editable");
    qc.invalidateQueries({ queryKey: ["approvals"] });
    qc.invalidateQueries({ queryKey: ["assignments"] });
  }

  async function fetchWindowData(win: RotaWindow, facility = "", scope = "") {
    const endDate = scheduleEndDate(win.startDate);
    type NurseRow = { id: string; name: string; role: string; ward: string | null; facility: string | null };
    let scopedNurses: NurseRow[] = allNurses as NurseRow[];
    if (facility) scopedNurses = scopedNurses.filter((n) => n.facility === facility);
    if (scope === "__HEAD__") {
      scopedNurses = scopedNurses.filter((n) => isGlobalHead(n.role) || isInternType(n.role));
    } else if (scope) {
      scopedNurses = scopedNurses.filter(
        (n) => !isGlobalHead(n.role) && parseWards(n.ward)[0] === scope,
      );
    }
    const allAssignments: { nurse_id: string; shift_date: string; shift: string }[] = [];
    const nurseIds = scopedNurses.map((n) => n.id);
    const BATCH = 50;
    for (let i = 0; i < nurseIds.length; i += BATCH) {
      const { data } = await supabase
        .from("shift_assignments")
        .select("nurse_id, shift_date, shift")
        .gte("shift_date", win.startDate)
        .lte("shift_date", endDate)
        .eq("status", "published")
        .in("nurse_id", nurseIds.slice(i, i + BATCH));
      if (data)
        allAssignments.push(
          ...(data as { nurse_id: string; shift_date: string; shift: string }[]),
        );
    }
    const assignMap = new Map<string, string>();
    allAssignments.forEach((a) => assignMap.set(`${a.nurse_id}|${a.shift_date}`, a.shift));
    const activeIds = new Set(allAssignments.map((a) => a.nurse_id));
    const activeNurses = scopedNurses.filter((n) => activeIds.has(n.id));
    return { activeNurses, assignMap };
  }

  async function handleDownloadExcel(win: RotaWindow) {
    const key = winKey(win);
    const scope = win.ward !== null ? win.ward : "__HEAD__";
    const facility = win.ward !== null ? "" : (exportFacility[key] ?? "");
    setDownloading(key + "-xlsx");
    try {
      const [XLSX, { activeNurses, assignMap }] = await Promise.all([
        import("xlsx"),
        fetchWindowData(win, facility, scope),
      ]);
      const endDate = scheduleEndDate(win.startDate);
      const dates = dateRange(win.startDate, endDate);
      const facilityLabel = facility ? ` · ${facility}` : "";
      const scopeLabel = scope === "__HEAD__" ? " — Coverage Nurses" : scope ? ` — ${scope}` : "";
      const title = `Nurse Rota: ${fmtDate(win.startDate)} — ${fmtDate(endDate)}${facilityLabel}${scopeLabel}`;
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
      const ws = XLSX.utils.aoa_to_sheet([[title], [], headers, ...rowData]);
      ws["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 14 }, ...dates.map(() => ({ wch: 5 }))];
      XLSX.utils.book_append_sheet(wb, ws, "Rota");
      const facilitySlug = facility ? `-${facility.replace(/\s+/g, "-").toLowerCase()}` : "";
      const fileSuffix =
        scope === "__HEAD__"
          ? "-coverage-nurses"
          : scope
            ? `-${scope.replace(/\s+/g, "-").toLowerCase()}`
            : "";
      XLSX.writeFile(wb, `rota-${win.startDate}-to-${win.endDate}${facilitySlug}${fileSuffix}.xlsx`);
    } catch {
      toast.error("Failed to generate Excel file");
    } finally {
      setDownloading(null);
    }
  }

  async function handleDownloadPdf(win: RotaWindow) {
    const key = winKey(win);
    const scope = win.ward !== null ? win.ward : "__HEAD__";
    const facility = win.ward !== null ? "" : (exportFacility[key] ?? "");
    setDownloading(key + "-pdf");
    try {
      const { activeNurses, assignMap } = await fetchWindowData(win, facility, scope);
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
      const pdfFacilityLabel = facility ? ` · ${facility}` : "";
      const pdfScopeLabel =
        scope === "__HEAD__" ? " — Coverage Nurses" : scope ? ` — ${scope}` : "";
      const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Nurse Rota ${win.startDate} — ${endDate}${pdfFacilityLabel}${pdfScopeLabel}</title>
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
<h1>Nurse Rota${pdfFacilityLabel}${pdfScopeLabel}</h1>
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

  // ── Render a single approval card ──────────────────────────────────────────
  function renderCard(win: RotaWindow) {
    const key = winKey(win);
    const isBusy = busy === key;
    const isDownloadingCard = downloading?.startsWith(key);
    const stepIndex =
      win.status === "published"
        ? STEPS.length
        : STEPS.findIndex((s) => s.status === win.status);

    const meta = windowMeta.get(key);
    const winFacilities = meta?.winFacilities ?? [];
    const extraStaff = meta?.extraStaff ?? [];
    const currentFacility = exportFacility[key] ?? "";

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
      <div key={key} className="rounded-xl border bg-card overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3.5 border-b flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">{win.ward ?? "Coverage Nurses"}</p>
            {win.ward === null && winFacilities.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">{winFacilities.join(" · ")}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {win.nurseCount} nurses · {win.assignmentCount} assignments
            </p>
            {extraStaff.length > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                Extra shifts:{" "}
                {extraStaff.map((e) => `${e.name} +${e.extra} extra shift${e.extra > 1 ? "s" : ""}`).join(", ")}
              </p>
            )}
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border shrink-0",
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
        <div className="px-4 py-3">
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
                        "h-6 w-6 rounded-full border-2 flex items-center justify-center text-xs font-bold",
                        done
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : active
                            ? "bg-primary border-primary text-primary-foreground"
                            : "bg-muted border-border text-muted-foreground",
                      )}
                    >
                      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{idx + 1}</span>}
                    </div>
                    <span
                      className={cn(
                        "text-[9px] whitespace-nowrap",
                        active ? "font-semibold text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                  {!last && (
                    <div
                      className={cn(
                        "h-0.5 w-6 sm:w-10 mx-1 mb-4",
                        done ? "bg-emerald-500" : "bg-border",
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Actions */}
        {showActions && (
          <div className="px-4 py-2.5 border-t bg-muted/30 flex items-center justify-end gap-2 flex-wrap mt-auto">
            {win.status === "draft" && canSubmit && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => submitDraft(win)}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" /> Submit
              </button>
            )}
            {canReject && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => reject(win)}
                className="h-8 px-3 rounded-md border bg-card text-xs inline-flex items-center gap-1.5 hover:bg-destructive/10 hover:border-destructive hover:text-destructive disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" /> Return
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
            {win.status === "published" && (
              <>
                {canRevertPublished && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => revertPublished(win)}
                    className="h-8 px-3 rounded-md border bg-card text-xs inline-flex items-center gap-1.5 hover:bg-amber-50 hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
                    title="Admin only — returns schedule to Draft (data unchanged)"
                  >
                    <Undo2 className="h-3.5 w-3.5" /> Unpublish
                  </button>
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {win.ward === null && winFacilities.length > 1 && (
                    <label className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground font-medium">Facility:</span>
                      <select
                        value={currentFacility}
                        onChange={(e) =>
                          setExportFacility((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        className="h-8 px-2 rounded-md border bg-card text-xs outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">All</option>
                        {winFacilities.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    disabled={!!isDownloadingCard}
                    onClick={() => handleDownloadExcel(win)}
                    className="h-8 px-3 rounded-md border bg-card text-xs inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                    {downloading === key + "-xlsx" ? "…" : "Excel"}
                  </button>
                  <button
                    type="button"
                    disabled={!!isDownloadingCard}
                    onClick={() => handleDownloadPdf(win)}
                    className="h-8 px-3 rounded-md border bg-card text-xs inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
                  >
                    <FileDown className="h-3.5 w-3.5 text-red-500" />
                    {downloading === key + "-pdf" ? "…" : "PDF"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Page render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
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
        <>
          {/* Facility tab bar */}
          {availableFacilities.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              {availableFacilities.map((f) => (
                <button
                  key={f}
                  type="button"
                  disabled={!!lockedFacility && lockedFacility !== f}
                  onClick={() => setSelectedFacility(f)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-sm font-medium border transition",
                    effectiveFacility === f
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card hover:bg-muted border-border",
                    !!lockedFacility && lockedFacility !== f && "opacity-40 cursor-not-allowed",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          )}

          {/* Periods for the selected facility */}
          {windowsByPeriod.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No schedules for {effectiveFacility}.
            </p>
          ) : (
            <div className="space-y-8">
              {windowsByPeriod.map(([periodStart, periodWins]) => {
                const periodEnd = scheduleEndDate(periodStart);
                const coverageWins = periodWins.filter((w) => w.ward === null);
                const wardWins = periodWins.filter((w) => w.ward !== null);
                return (
                  <div key={periodStart}>
                    {/* Period header */}
                    <div className="flex items-center gap-2 mb-4">
                      <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
                      <h2 className="text-sm font-semibold text-foreground">
                        {fmtDate(periodStart)} — {fmtDate(periodEnd)}
                      </h2>
                      <span className="text-xs text-muted-foreground">
                        · {periodWins.length} schedule{periodWins.length !== 1 ? "s" : ""}
                      </span>
                      <div className="flex-1 h-px bg-border ml-1" />
                    </div>

                    <div className="space-y-3">
                      {/* Coverage Nurses — full width */}
                      {coverageWins.map((win) => renderCard(win))}

                      {/* Ward cards — 2-col grid */}
                      {wardWins.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                          {wardWins.map((win) => renderCard(win))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
