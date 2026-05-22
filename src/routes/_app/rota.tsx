import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  CalendarDays,
  Users,
  Wand2,
  Trash2,
  Send,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Lock,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  generateSchedule,
  type ShiftCode,
  type NurseInput,
  type WardInput,
  type LeaveInput,
} from "@/lib/auto-schedule";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/rota")({
  head: () => ({
    meta: [
      { title: "Rota — Nurses Rota" },
      {
        name: "description",
        content: "28-day staff rota with auto-scheduling and drag-and-drop manual edits.",
      },
    ],
  }),
  component: RotaPage,
});

const DAYS = 28;
const SHIFT_CYCLE: ShiftCode[] = ["M", "N", "OFF", "LEAVE"];
const FACILITIES = ["Ikeja", "Ikeja Clinic", "Idejo", "LSS", "Ikoyi", "Ligali", "Wellness"];

const shiftStyles: Record<ShiftCode, string> = {
  M: "bg-amber-100 text-amber-900 border-amber-200",
  N: "bg-indigo-200 text-indigo-900 border-indigo-300",
  OFF: "bg-muted text-muted-foreground border-transparent",
  LEAVE: "bg-rose-100 text-rose-900 border-rose-200",
};

function parseWards(ward: string | null): string[] {
  if (!ward) return [];
  return ward.split("|").filter(Boolean);
}

function todayYmd() {
  const t = new Date();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${t.getFullYear()}-${m}-${d}`;
}

function ymd(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

type Assignment = {
  id: string;
  nurse_id: string;
  ward: string | null;
  shift_date: string;
  shift: ShiftCode;
  status: string;
};

type GenForm = {
  startDate: string;
  facility: string;
  ward: string;
};

function RotaPage() {
  const { canManageStaff, hasAnyRole, user } = useAuth();
  const canEdit = canManageStaff;
  const canGenerate = hasAnyRole(["admin", "cno", "chief_matron"]);
  const qc = useQueryClient();

  // View state
  const [busy, setBusy] = useState(false);
  const [startOffset, setStartOffset] = useState(0);
  const [selectedFacility, setSelectedFacility] = useState("");
  const [selectedWard, setSelectedWard] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Generate dialog
  const [genOpen, setGenOpen] = useState(false);
  const [genForm, setGenForm] = useState<GenForm>({
    startDate: todayYmd(),
    facility: "",
    ward: "",
  });

  // Drag — ref for event handlers (synchronous), state only for visual ring
  const draggingRef = useRef<Assignment | null>(null);
  const [dragging, setDragging] = useState<Assignment | null>(null);

  // ── Computed dates ────────────────────────────────────────────────────────
  const startDate = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() + startOffset * 7);
    return t;
  }, [startOffset]);

  const endDate = useMemo(() => {
    const e = new Date(startDate);
    e.setDate(e.getDate() + DAYS - 1);
    return e;
  }, [startDate]);

  const days = useMemo(
    () =>
      Array.from({ length: DAYS }).map((_, d) => {
        const dt = new Date(startDate);
        dt.setDate(dt.getDate() + d);
        return dt;
      }),
    [startDate],
  );

  // ── Data queries ─────────────────────────────────────────────────────────
  const { data: nurses = [] } = useQuery<NurseInput[]>({
    queryKey: ["nurses"],
    queryFn: async () =>
      ((await supabase.from("nurses").select("*").order("name")).data ?? []) as NurseInput[],
  });

  const { data: wards = [] } = useQuery<WardInput[]>({
    queryKey: ["wards"],
    queryFn: async () =>
      ((await supabase.from("wards").select("*").order("name")).data ?? []) as WardInput[],
  });

  const { data: leave = [] } = useQuery<LeaveInput[]>({
    queryKey: ["leave"],
    queryFn: async () =>
      ((await supabase.from("leave_requests").select("nurse_id,from_date,to_date,status")).data ??
        []) as LeaveInput[],
  });

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ["assignments", ymd(startDate), ymd(endDate)],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_assignments")
        .select("*")
        .gte("shift_date", ymd(startDate))
        .lte("shift_date", ymd(endDate));
      if (error) throw error;
      return (data ?? []) as Assignment[];
    },
  });

  // ── Derived data ─────────────────────────────────────────────────────────
  const cellMap = useMemo(() => {
    const m = new Map<string, Assignment>();
    assignments.forEach((a) => m.set(`${a.nurse_id}|${a.shift_date}`, a));
    return m;
  }, [assignments]);

  // View: nurses filtered by toolbar selects + search
  const filteredNurses = useMemo(() => {
    let list = nurses;
    if (selectedFacility) list = list.filter((n) => n.facility === selectedFacility);
    if (selectedWard) list = list.filter((n) => parseWards(n.ward).includes(selectedWard));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((n) => n.name.toLowerCase().includes(q));
    }
    return list;
  }, [nurses, selectedFacility, selectedWard, searchQuery]);

  // Generate dialog: wards that belong to nurses in the selected facility
  const genWards = useMemo(() => {
    if (!genForm.facility) return wards;
    const wardNames = new Set(
      nurses
        .filter((n) => n.facility === genForm.facility && n.ward)
        .flatMap((n) => parseWards(n.ward)),
    );
    return wards.filter((w) => wardNames.has(w.name));
  }, [wards, nurses, genForm.facility]);

  const leaveConflicts = useMemo(() => {
    return leave
      .filter((l) => {
        if (l.status !== "Approved" || !l.nurse_id) return false;
        return days.some((dt) => {
          const dateStr = ymd(dt);
          if (l.from_date > dateStr || l.to_date < dateStr) return false;
          const cell = cellMap.get(`${l.nurse_id}|${dateStr}`);
          return cell !== undefined && cell.shift !== "LEAVE";
        });
      })
      .map((l) => ({
        ...l,
        nurseName: nurses.find((n) => n.id === l.nurse_id)?.name ?? "Unknown",
      }));
  }, [leave, days, cellMap, nurses]);

  // True when the current 28-day window contains any published assignments.
  // Published windows are fully read-only: all cells and actions are locked.
  const isWindowPublished = useMemo(
    () => assignments.some((a) => a.status === "published"),
    [assignments],
  );

  // ── Actions ───────────────────────────────────────────────────────────────
  function openGenDialog() {
    setGenForm({ startDate: ymd(startDate), facility: "", ward: "" });
    setGenOpen(true);
  }

  async function handleGenerate() {
    if (!genForm.facility) {
      toast.error("Select a facility");
      return;
    }

    const genStart = new Date(genForm.startDate + "T00:00:00");
    const genEnd = new Date(genStart);
    genEnd.setDate(genEnd.getDate() + DAYS - 1);

    let targetNurses = nurses.filter((n) => n.facility === genForm.facility);
    if (genForm.ward)
      targetNurses = targetNurses.filter((n) => parseWards(n.ward).includes(genForm.ward));

    if (!targetNurses.length) {
      toast.error("No staff found for the selected facility / ward");
      return;
    }

    setGenOpen(false);
    setBusy(true);
    try {
      const draft = generateSchedule({
        nurses: targetNurses,
        wards,
        leave,
        startDate: genStart,
        days: DAYS,
      });

      await supabase
        .from("shift_assignments")
        .delete()
        .gte("shift_date", ymd(genStart))
        .lte("shift_date", ymd(genEnd))
        .neq("status", "published");

      const rows = draft.map((d) => ({
        ...d,
        created_by: user?.id ?? null,
        status: "draft" as const,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from("shift_assignments").insert(rows.slice(i, i + 500));
        if (error) throw error;
      }

      await supabase.from("audit_logs").insert({
        actor_id: user?.id,
        actor_name: user?.email ?? null,
        action: "Generated 28-day rota draft",
        target: `${genForm.facility}${genForm.ward ? ` / ${genForm.ward}` : ""} · ${ymd(genStart)} → ${ymd(genEnd)}`,
      });

      toast.success(`28-day draft generated for ${genForm.facility}`);
      qc.invalidateQueries({ queryKey: ["assignments"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to generate");
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    if (!confirm("Clear the draft for this 28-day window? Published shifts will be kept.")) return;
    setBusy(true);
    const { error } = await supabase
      .from("shift_assignments")
      .delete()
      .gte("shift_date", ymd(startDate))
      .lte("shift_date", ymd(endDate))
      .neq("status", "published");
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Draft cleared");
    qc.invalidateQueries({ queryKey: ["assignments"] });
  }

  async function handleSubmitRota() {
    setBusy(true);
    const { error } = await supabase
      .from("shift_assignments")
      .update({ status: "submitted" })
      .gte("shift_date", ymd(startDate))
      .lte("shift_date", ymd(endDate))
      .eq("status", "draft");
    setBusy(false);
    if (error) return toast.error(error.message);
    await supabase.from("audit_logs").insert({
      actor_id: user?.id,
      actor_name: user?.email ?? null,
      action: "Submitted rota for approval",
      target: `${ymd(startDate)} → ${ymd(endDate)}`,
    });
    toast.success("Submitted to Chief Matron");
    qc.invalidateQueries({ queryKey: ["assignments"] });
  }

  async function cycleCell(nurseId: string, dateStr: string, ward: string | null) {
    if (!canEdit) return;
    const existing = cellMap.get(`${nurseId}|${dateStr}`);
    if (isWindowPublished || existing?.status === "published") return;
    const next = existing
      ? SHIFT_CYCLE[(SHIFT_CYCLE.indexOf(existing.shift) + 1) % SHIFT_CYCLE.length]
      : "M";
    if (existing) {
      const { error } = await supabase
        .from("shift_assignments")
        .update({ shift: next })
        .eq("id", existing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("shift_assignments").insert({
        nurse_id: nurseId,
        ward,
        shift_date: dateStr,
        shift: next,
        status: "draft",
        created_by: user?.id ?? null,
      });
      if (error) return toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["assignments"] });
  }

  async function swapCells(a: Assignment, b: Assignment) {
    if (!canEdit) return;
    if (isWindowPublished || a.status === "published" || b.status === "published") return;
    if (a.shift_date !== b.shift_date)
      return toast.error("You can only swap shifts on the same day");
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("shift_assignments").update({ shift: b.shift }).eq("id", a.id),
      supabase.from("shift_assignments").update({ shift: a.shift }).eq("id", b.id),
    ]);
    if (e1 || e2) return toast.error((e1 ?? e2)!.message);
    await supabase.from("audit_logs").insert({
      actor_id: user?.id,
      actor_name: user?.email ?? null,
      action: "Swapped shifts",
      target: a.shift_date,
    });
    qc.invalidateQueries({ queryKey: ["assignments"] });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="Rota"
        subtitle={`28-day view · ${days[0].toLocaleDateString()} → ${days[DAYS - 1].toLocaleDateString()}`}
      />

      {/* Toolbar row 1 */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {/* Week nav */}
        <div className="inline-flex rounded-md border bg-card">
          <button
            type="button"
            onClick={() => setStartOffset((o) => o - 4)}
            className="h-9 w-9 grid place-items-center hover:bg-muted"
            title="Previous 4 weeks"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setStartOffset(0)}
            className="px-3 text-xs font-medium hover:bg-muted"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setStartOffset((o) => o + 4)}
            className="h-9 w-9 grid place-items-center hover:bg-muted"
            title="Next 4 weeks"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Facility filter */}
        <select
          title="Facility"
          value={selectedFacility}
          onChange={(e) => {
            setSelectedFacility(e.target.value);
            setSelectedWard("");
          }}
          className="h-9 px-2 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Facilities</option>
          {FACILITIES.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>

        {/* Ward filter */}
        <select
          title="Ward"
          value={selectedWard}
          onChange={(e) => setSelectedWard(e.target.value)}
          className="h-9 px-2 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Wards</option>
          {wards.map((w) => (
            <option key={w.name}>{w.name}</option>
          ))}
        </select>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search nurse…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-8 pr-7 w-44 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1" />

        {/* Actions */}
        {isWindowPublished ? (
          <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-medium dark:bg-emerald-950/30 dark:border-emerald-700 dark:text-emerald-400">
            <Lock className="h-3.5 w-3.5" /> Published — read only
          </span>
        ) : (
          <>
            {canGenerate && (
              <button
                type="button"
                onClick={openGenDialog}
                disabled={busy}
                className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Wand2 className="h-4 w-4" /> Auto-generate
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={handleClear}
                disabled={busy}
                className="h-9 px-3 rounded-md border text-sm inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Clear draft
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={handleSubmitRota}
                disabled={busy}
                className="h-9 px-3 rounded-md border text-sm inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
              >
                <Send className="h-4 w-4" /> Submit for approval
              </button>
            )}
          </>
        )}
      </div>

      {/* Leave conflict warning */}
      {leaveConflicts.length > 0 && (
        <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              Rota needs regeneration
            </p>
            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
              Leave was approved after the schedule was generated for:{" "}
              {leaveConflicts
                .map((c) => `${c.nurseName} (${c.from_date} → ${c.to_date})`)
                .join(", ")}
              . Regenerate the rota to apply the changes.
            </p>
          </div>
        </div>
      )}

      <Legend />

      {/* Rota table */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>
      ) : filteredNurses.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title={searchQuery ? "No nurses match your search" : "No nurses to schedule"}
          description={
            searchQuery ? `No results for "${searchQuery}".` : "Add staff before generating a rota."
          }
          action={
            searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-md border text-sm hover:bg-muted"
              >
                <X className="h-4 w-4" /> Clear search
              </button>
            ) : (
              <Link
                to="/staff"
                className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm"
              >
                <Users className="h-4 w-4" /> Manage staff
              </Link>
            )
          }
        />
      ) : (
        <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left font-semibold px-3 py-3 sticky left-0 bg-muted/50 z-10 min-w-40">
                    Nurse
                  </th>
                  <th className="text-left font-semibold px-2 py-3 min-w-24">Ward</th>
                  {days.map((dt) => (
                    <th
                      key={ymd(dt)}
                      className={cn(
                        "text-center font-semibold px-1 py-3 min-w-11",
                        (dt.getDay() === 0 || dt.getDay() === 6) && "bg-muted",
                      )}
                    >
                      <div>{dt.toLocaleDateString("en", { weekday: "short" })}</div>
                      <div className="text-[10px] font-normal text-muted-foreground">
                        {dt.getDate()}/{dt.getMonth() + 1}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredNurses.map((n) => (
                  <tr key={n.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 sticky left-0 bg-card z-10">
                      <div className="font-medium">{n.name}</div>
                      <div className="text-[11px] text-muted-foreground">{n.role}</div>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">
                      {(() => {
                        const ws = parseWards(n.ward);
                        if (!ws.length) return "—";
                        return (
                          <>
                            {ws[0]}
                            {ws.length > 1 && (
                              <span className="ml-0.5 text-[10px] opacity-60">
                                +{ws.length - 1}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    {days.map((dt) => {
                      const dateStr = ymd(dt);
                      const cell = cellMap.get(`${n.id}|${dateStr}`);
                      // Visual-only: uses state (safe to lag one render behind)
                      const isDragOver =
                        dragging &&
                        dragging.shift_date === dateStr &&
                        cell &&
                        dragging.id !== cell.id;
                      return (
                        <td key={dateStr} className="px-0.5 py-1 text-center">
                          <button
                            type="button"
                            draggable={!!cell && canEdit && !isWindowPublished}
                            onClick={() => cycleCell(n.id, dateStr, n.ward)}
                            onDragStart={(e) => {
                              if (!cell || !canEdit || isWindowPublished) return;
                              // Write to ref immediately — visible to all handlers this frame
                              draggingRef.current = cell;
                              setDragging(cell);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", cell.id);
                            }}
                            onDragEnd={() => {
                              draggingRef.current = null;
                              setDragging(null);
                            }}
                            onDragOver={(e) => {
                              if (isWindowPublished) return;
                              // Use ref — guaranteed current even before React re-renders
                              const src = draggingRef.current;
                              if (src && cell && src.id !== cell.id && src.shift_date === dateStr) {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (isWindowPublished) return;
                              const src = draggingRef.current;
                              if (src && cell && src.id !== cell.id) {
                                swapCells(src, cell);
                              }
                              draggingRef.current = null;
                              setDragging(null);
                            }}
                            className={cn(
                              "block w-full text-[10px] font-bold py-1.5 rounded border transition",
                              cell
                                ? shiftStyles[cell.shift]
                                : "bg-muted/30 text-muted-foreground/40 border-transparent hover:bg-muted",
                              isDragOver && !isWindowPublished && "ring-2 ring-primary scale-105",
                              dragging && dragging.id === cell?.id && "opacity-40",
                              isWindowPublished
                                ? "cursor-not-allowed opacity-80"
                                : !canEdit
                                  ? "cursor-default"
                                  : "",
                            )}
                            title={
                              isWindowPublished
                                ? "Published — this schedule is locked"
                                : canEdit
                                  ? "Click to cycle · drag to swap with same-day shift"
                                  : "View only"
                            }
                          >
                            {cell?.shift ?? "—"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 text-xs text-muted-foreground border-t flex items-center justify-between">
            <span>
              {isWindowPublished ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <Lock className="h-3 w-3" /> Published schedule — read only
                </span>
              ) : (
                "Click a cell to cycle shifts · Drag a shift onto another nurse's same-day cell to swap."
              )}
            </span>
            <span>
              {filteredNurses.length} staff ·{" "}
              {assignments.filter((a) => filteredNurses.some((n) => n.id === a.nurse_id)).length}{" "}
              assignments
            </span>
          </div>
        </div>
      )}

      {/* Auto-generate dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Generate 28-day schedule</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Start date */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Start date</label>
              <input
                type="date"
                title="Schedule start date"
                value={genForm.startDate}
                onChange={(e) => setGenForm((f) => ({ ...f, startDate: e.target.value }))}
                className="w-full h-9 px-3 rounded-md border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Schedule runs {DAYS} days from this date.
              </p>
            </div>

            {/* Facility */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Facility <span className="text-destructive">*</span>
              </label>
              <select
                title="Facility"
                value={genForm.facility}
                onChange={(e) => setGenForm((f) => ({ ...f, facility: e.target.value, ward: "" }))}
                className="w-full h-9 px-2 rounded-md border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select facility…</option>
                {FACILITIES.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>

            {/* Ward */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Ward <span className="text-destructive">*</span>
              </label>
              <select
                title="Ward"
                value={genForm.ward}
                onChange={(e) => setGenForm((f) => ({ ...f, ward: e.target.value }))}
                disabled={!genForm.facility}
                className="w-full h-9 px-2 rounded-md border bg-background text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                <option value="">Select ward…</option>
                {genWards.map((w) => (
                  <option key={w.name}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="h-9 px-4 rounded-md border text-sm hover:bg-muted">
                Cancel
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!genForm.facility || !genForm.ward || !genForm.startDate || busy}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Wand2 className="h-4 w-4" />
              Generate
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Legend() {
  const items: { code: ShiftCode; label: string; time: string }[] = [
    { code: "M", label: "Morning", time: "08:00–17:00" },
    { code: "N", label: "Night", time: "17:00–08:00" },
    { code: "OFF", label: "Off", time: "" },
    { code: "LEAVE", label: "Leave", time: "" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
      {items.map((i) => (
        <span
          key={i.code}
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded border",
            shiftStyles[i.code],
          )}
        >
          <span className="font-bold">{i.code}</span> {i.label}
          {i.time && <span className="opacity-60">{i.time}</span>}
        </span>
      ))}
    </div>
  );
}
