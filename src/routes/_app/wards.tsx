import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useId } from "react";
import { Building2, Plus, Trash2, Loader2, Pencil, Download } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "./staff";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import {
  IKOYI_WARD_MINIMUMS,
  IKOYI_WARD_NAMES,
  IKEJA_WARD_MINIMUMS,
  IKEJA_WARD_NAMES,
  LIGALI_WARD_MINIMUMS,
  LIGALI_WARD_NAMES,
} from "@/lib/auto-schedule";

export const Route = createFileRoute("/_app/wards")({
  head: () => ({
    meta: [
      { title: "Wards — Nurses Rota" },
      {
        name: "description",
        content:
          "Manage hospital wards, nurse-to-patient ratios and minimum staffing requirements per shift.",
      },
    ],
  }),
  component: WardsPage,
});

const FACILITIES = ["Ikeja", "Ikoyi", "Ligali"] as const;

type Ward = {
  id: string;
  name: string;
  facility: string | null;
  min_morning_nurses: number;
  min_morning_supervisor: number;
  min_morning_na: number;
  min_night_nurses: number;
  min_night_supervisor: number;
  min_night_na: number;
};

function WardsPage() {
  const { canManageWards, nurseFacility, isAdmin, activeRole } = useAuth();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editingWard, setEditingWard] = useState<Ward | null>(null);
  const [seeding, setSeeding] = useState(false);

  // Admin, CNO and HR/Admin oversee all facilities; facility-bound roles start on their own.
  const isMultiFacility =
    isAdmin || activeRole === "cno" || activeRole === "hr_admin";
  const defaultFacility = nurseFacility && !isMultiFacility ? nurseFacility : "";
  const [selectedFacility, setSelectedFacility] = useState(defaultFacility);

  const { data: wards = [], isLoading } = useQuery({
    queryKey: ["wards"],
    queryFn: async () => {
      const { data, error } = await supabase.from("wards").select("*").order("name");
      if (error) throw error;
      return data as Ward[];
    },
  });

  // Wards are filtered by their facility column.
  const visibleWards = selectedFacility
    ? wards.filter((w) => w.facility === selectedFacility)
    : wards;

  // Wards that haven't been seeded yet per facility.
  const missingIkoyiWards = IKOYI_WARD_NAMES.filter(
    (n) => !wards.some((w) => w.name === n && w.facility === "Ikoyi"),
  );
  const missingIkejaWards = IKEJA_WARD_NAMES.filter(
    (n) => !wards.some((w) => w.name === n && w.facility === "Ikeja"),
  );
  const missingLigaliWards = LIGALI_WARD_NAMES.filter(
    (n) => !wards.some((w) => w.name === n && w.facility === "Ligali"),
  );

  async function del(w: Ward) {
    if (!confirm(`Remove ward "${w.name}"?`)) return;
    const { error } = await supabase.from("wards").delete().eq("id", w.id);
    if (error) return toast.error(error.message);
    toast.success("Ward removed");
    logAudit("Removed ward", w.name);
    qc.invalidateQueries({ queryKey: ["wards"] });
  }

  // Seed all Ikoyi wards into the DB from the hardcoded defaults.
  // Uses upsert so it's safe to run multiple times — existing rows are updated,
  // missing rows are created.
  async function seedIkoyiWards() {
    setSeeding(true);
    try {
      const rows = IKOYI_WARD_NAMES.map((name) => ({
        name,
        facility: "Ikoyi",
        ...IKOYI_WARD_MINIMUMS[name],
      }));

      // Insert all; on name+facility conflict update the staffing numbers so the DB
      // always reflects the correct hardcoded values.
      for (const row of rows) {
        const existing = wards.find((w) => w.name === row.name && w.facility === "Ikoyi");
        if (existing) {
          const { error } = await supabase
            .from("wards")
            .update({
              facility: "Ikoyi",
              min_morning_nurses: row.min_morning_nurses,
              min_morning_supervisor: row.min_morning_supervisor,
              min_morning_na: row.min_morning_na,
              min_night_nurses: row.min_night_nurses,
              min_night_supervisor: row.min_night_supervisor,
              min_night_na: row.min_night_na,
            })
            .eq("id", existing.id);
          if (error) {
            toast.error(`Failed on "${row.name}": ${error.message}`);
            return;
          }
        } else {
          const { error } = await supabase.from("wards").insert(row);
          if (error) {
            toast.error(`Failed on "${row.name}": ${error.message}`);
            return;
          }
        }
      }

      toast.success(`All ${rows.length} Ikoyi wards seeded / updated`);
      logAudit("Seeded Ikoyi ward defaults", IKOYI_WARD_NAMES.join(", "));
      qc.invalidateQueries({ queryKey: ["wards"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  async function seedIkejaWards() {
    setSeeding(true);
    try {
      const rows = IKEJA_WARD_NAMES.map((name) => ({
        name,
        facility: "Ikeja",
        ...IKEJA_WARD_MINIMUMS[name],
      }));
      for (const row of rows) {
        const existing = wards.find((w) => w.name === row.name && w.facility === "Ikeja");
        if (existing) {
          const { error } = await supabase
            .from("wards")
            .update({
              min_morning_nurses: row.min_morning_nurses,
              min_morning_supervisor: row.min_morning_supervisor,
              min_morning_na: row.min_morning_na,
              min_night_nurses: row.min_night_nurses,
              min_night_supervisor: row.min_night_supervisor,
              min_night_na: row.min_night_na,
            })
            .eq("id", existing.id);
          if (error) { toast.error(`Failed on "${row.name}": ${error.message}`); return; }
        } else {
          const { error } = await supabase.from("wards").insert(row);
          if (error) { toast.error(`Failed on "${row.name}": ${error.message}`); return; }
        }
      }
      toast.success(`All ${rows.length} Ikeja wards seeded / updated`);
      logAudit("Seeded Ikeja ward defaults", IKEJA_WARD_NAMES.join(", "));
      qc.invalidateQueries({ queryKey: ["wards"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  async function seedLigaliWards() {
    setSeeding(true);
    try {
      const rows = LIGALI_WARD_NAMES.map((name) => ({
        name,
        facility: "Ligali",
        ...LIGALI_WARD_MINIMUMS[name],
      }));
      for (const row of rows) {
        const existing = wards.find((w) => w.name === row.name && w.facility === "Ligali");
        if (existing) {
          const { error } = await supabase
            .from("wards")
            .update({
              min_morning_nurses: row.min_morning_nurses,
              min_morning_supervisor: row.min_morning_supervisor,
              min_morning_na: row.min_morning_na,
              min_night_nurses: row.min_night_nurses,
              min_night_supervisor: row.min_night_supervisor,
              min_night_na: row.min_night_na,
            })
            .eq("id", existing.id);
          if (error) { toast.error(`Failed on "${row.name}": ${error.message}`); return; }
        } else {
          const { error } = await supabase.from("wards").insert(row);
          if (error) { toast.error(`Failed on "${row.name}": ${error.message}`); return; }
        }
      }
      toast.success(`All ${rows.length} Ligali wards seeded / updated`);
      logAudit("Seeded Ligali ward defaults", LIGALI_WARD_NAMES.join(", "));
      qc.invalidateQueries({ queryKey: ["wards"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Wards & Safety Rules"
        subtitle="Minimum staffing rules enforced by the rota engine"
        actions={
          canManageWards &&
          selectedFacility && (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Add ward
            </button>
          )
        }
      />

      {/* Facility selector */}
      {!selectedFacility ? (
        <div className="flex flex-col items-center justify-center py-24 gap-6">
          <Building2 className="h-10 w-10 text-muted-foreground" />
          <div className="text-center">
            <p className="font-semibold text-lg">Select a facility</p>
            <p className="text-sm text-muted-foreground mt-1">
              Ward rules are configured per facility
            </p>
          </div>
          <div className="flex gap-3">
            {FACILITIES.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSelectedFacility(f)}
                className="h-10 px-5 rounded-md border bg-card text-sm font-medium hover:bg-muted transition"
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Facility tab bar */}
          <div className="flex items-center gap-2 mb-5">
            {(isMultiFacility ? FACILITIES : [selectedFacility as (typeof FACILITIES)[number]]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSelectedFacility(f)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                  selectedFacility === f
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card hover:bg-muted"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Seed banners — shown when default wards are missing from DB */}
          {selectedFacility === "Ikoyi" && canManageWards && missingIkoyiWards.length > 0 && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/30">
              <Download className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  {missingIkoyiWards.length} ward{missingIkoyiWards.length > 1 ? "s" : ""} not yet
                  created
                </p>
                <p className="text-xs text-blue-800 dark:text-blue-300 mt-0.5">
                  {missingIkoyiWards.join(", ")}
                </p>
              </div>
              <button
                type="button"
                disabled={seeding}
                onClick={seedIkoyiWards}
                className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-medium inline-flex items-center gap-1.5 hover:bg-blue-700 disabled:opacity-50 shrink-0"
              >
                {seeding && <Loader2 className="h-3 w-3 animate-spin" />}
                {seeding ? "Syncing…" : "Sync defaults"}
              </button>
            </div>
          )}
          {selectedFacility === "Ikeja" && canManageWards && missingIkejaWards.length > 0 && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/30">
              <Download className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  {missingIkejaWards.length} ward{missingIkejaWards.length > 1 ? "s" : ""} not yet
                  created
                </p>
                <p className="text-xs text-blue-800 dark:text-blue-300 mt-0.5">
                  {missingIkejaWards.join(", ")}
                </p>
              </div>
              <button
                type="button"
                disabled={seeding}
                onClick={seedIkejaWards}
                className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-medium inline-flex items-center gap-1.5 hover:bg-blue-700 disabled:opacity-50 shrink-0"
              >
                {seeding && <Loader2 className="h-3 w-3 animate-spin" />}
                {seeding ? "Syncing…" : "Sync defaults"}
              </button>
            </div>
          )}
          {selectedFacility === "Ligali" && canManageWards && missingLigaliWards.length > 0 && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/30">
              <Download className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  {missingLigaliWards.length} ward{missingLigaliWards.length > 1 ? "s" : ""} not
                  yet created
                </p>
                <p className="text-xs text-blue-800 dark:text-blue-300 mt-0.5">
                  {missingLigaliWards.join(", ")}
                </p>
              </div>
              <button
                type="button"
                disabled={seeding}
                onClick={seedLigaliWards}
                className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-medium inline-flex items-center gap-1.5 hover:bg-blue-700 disabled:opacity-50 shrink-0"
              >
                {seeding && <Loader2 className="h-3 w-3 animate-spin" />}
                {seeding ? "Syncing…" : "Sync defaults"}
              </button>
            </div>
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>
          ) : visibleWards.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-6 w-6" />}
              title="No wards configured"
              description={
                canManageWards
                  ? ["Ikoyi", "Ikeja", "Ligali"].includes(selectedFacility)
                    ? "Click 'Sync defaults' above to populate wards, or add them manually."
                    : "Add wards to define minimum staffing rules per shift."
                  : "Ask an administrator to configure wards."
              }
              action={
                canManageWards && (
                  <button
                    type="button"
                    onClick={() => setShowAdd(true)}
                    className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm"
                  >
                    <Plus className="h-4 w-4" /> Add ward
                  </button>
                )
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleWards.map((w) => (
                <WardCard
                  key={w.id}
                  ward={w}
                  canManage={canManageWards}
                  onEdit={() => setEditingWard(w)}
                  onDelete={() => del(w)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showAdd && <AddWardModal facility={selectedFacility} onClose={() => setShowAdd(false)} />}
      {editingWard && <EditWardModal ward={editingWard} onClose={() => setEditingWard(null)} />}
    </div>
  );
}

// ── Reusable ward card ────────────────────────────────────────────────────────

function WardCard({
  ward: w,
  canManage,
  onEdit,
  onDelete,
}: {
  ward: Ward;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const nightOnly =
    w.min_night_nurses === 0 && w.min_night_supervisor === 0 && w.min_night_na === 0;
  return (
    <div className="bg-card border rounded-xl p-5 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{w.name}</h3>
        </div>
        {canManage && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-label={`Edit ${w.name}`}
              onClick={onEdit}
              className="h-7 w-7 grid place-items-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Remove ${w.name}`}
              onClick={onDelete}
              className="h-7 w-7 grid place-items-center rounded-md hover:bg-destructive/10 text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="border rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            Morning min
          </p>
          <p className="text-sm font-semibold mt-1">
            {w.min_morning_supervisor}S · {w.min_morning_nurses}N · {w.min_morning_na}NA
          </p>
        </div>
        <div className="border rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            Night min
          </p>
          {nightOnly ? (
            <p className="text-sm font-semibold mt-1 text-muted-foreground">Morning only</p>
          ) : (
            <p className="text-sm font-semibold mt-1">
              {w.min_night_supervisor}S · {w.min_night_nurses}N · {w.min_night_na}NA
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add ward modal ────────────────────────────────────────────────────────────

function AddWardModal({
  facility: defaultFacility,
  onClose,
}: {
  facility: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selectedFac, setSelectedFac] = useState(defaultFacility || FACILITIES[0]);
  const [form, setForm] = useState({
    name: "",
    min_morning_nurses: 2,
    min_morning_supervisor: 0,
    min_morning_na: 1,
    min_night_nurses: 2,
    min_night_supervisor: 0,
    min_night_na: 1,
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("wards").insert({ ...form, facility: selectedFac });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Ward added");
    logAudit("Added ward", form.name);
    qc.invalidateQueries({ queryKey: ["wards"] });
    onClose();
  }

  const inputCls =
    "w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <Modal title="Add ward" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="ward-facility" className="text-sm font-medium">
            Facility
          </label>
          <select
            id="ward-facility"
            value={selectedFac}
            onChange={(e) => setSelectedFac(e.target.value)}
            className={inputCls}
          >
            {FACILITIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ward-name" className="text-sm font-medium">
            Ward name
          </label>
          <input
            id="ward-name"
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <NumField
            label="AM Nurses"
            value={form.min_morning_nurses}
            onChange={(v) => setForm({ ...form, min_morning_nurses: v })}
          />
          <NumField
            label="AM Supervisor"
            value={form.min_morning_supervisor}
            onChange={(v) => setForm({ ...form, min_morning_supervisor: v })}
          />
          <NumField
            label="AM NA"
            value={form.min_morning_na}
            onChange={(v) => setForm({ ...form, min_morning_na: v })}
          />
          <NumField
            label="PM Nurses"
            value={form.min_night_nurses}
            onChange={(v) => setForm({ ...form, min_night_nurses: v })}
          />
          <NumField
            label="PM Supervisor"
            value={form.min_night_supervisor}
            onChange={(v) => setForm({ ...form, min_night_supervisor: v })}
          />
          <NumField
            label="PM NA"
            value={form.min_night_na}
            onChange={(v) => setForm({ ...form, min_night_na: v })}
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
            {busy && <Loader2 className="h-3 w-3 animate-spin" />} Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Edit ward modal ───────────────────────────────────────────────────────────

function EditWardModal({ ward, onClose }: { ward: Ward; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: ward.name,
    min_morning_nurses: ward.min_morning_nurses,
    min_morning_supervisor: ward.min_morning_supervisor,
    min_morning_na: ward.min_morning_na,
    min_night_nurses: ward.min_night_nurses,
    min_night_supervisor: ward.min_night_supervisor,
    min_night_na: ward.min_night_na,
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("wards").update(form).eq("id", ward.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Ward updated");
    logAudit("Updated ward", form.name);
    qc.invalidateQueries({ queryKey: ["wards"] });
    onClose();
  }

  const inputCls =
    "w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <Modal title={`Edit "${ward.name}"`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="edit-ward-name" className="text-sm font-medium">
            Ward name
          </label>
          <input
            id="edit-ward-name"
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <NumField
            label="AM Nurses"
            value={form.min_morning_nurses}
            onChange={(v) => setForm({ ...form, min_morning_nurses: v })}
          />
          <NumField
            label="AM Supervisor"
            value={form.min_morning_supervisor}
            onChange={(v) => setForm({ ...form, min_morning_supervisor: v })}
          />
          <NumField
            label="AM NA"
            value={form.min_morning_na}
            onChange={(v) => setForm({ ...form, min_morning_na: v })}
          />
          <NumField
            label="PM Nurses"
            value={form.min_night_nurses}
            onChange={(v) => setForm({ ...form, min_night_nurses: v })}
          />
          <NumField
            label="PM Supervisor"
            value={form.min_night_supervisor}
            onChange={(v) => setForm({ ...form, min_night_supervisor: v })}
          />
          <NumField
            label="PM NA"
            value={form.min_night_na}
            onChange={(v) => setForm({ ...form, min_night_na: v })}
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
            {busy && <Loader2 className="h-3 w-3 animate-spin" />} Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-full h-9 px-2 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}
