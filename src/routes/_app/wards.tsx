import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useId } from "react";
import {
  Building2,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Users,
  Loader2,
  Pencil,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "./staff";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";

export const Route = createFileRoute("/_app/wards")({
  head: () => ({
    meta: [
      { title: "Wards — Nurses Rota" },
      {
        name: "description",
        content:
          "Manage hospital wards, nurse-to-patient ratios and minimum staffing requirements per shift.",
      },
      { property: "og:title", content: "Wards — Nurses Rota" },
      {
        property: "og:description",
        content: "Configure ward staffing minimums and monitor coverage.",
      },
    ],
  }),
  component: WardsPage,
});

type Ward = {
  id: string;
  name: string;
  ratio: string | null;
  min_morning_nurses: number;
  min_morning_supervisor: number;
  min_morning_na: number;
  min_night_nurses: number;
  min_night_supervisor: number;
  min_night_na: number;
  patients: number;
  staffed: number;
};

function WardsPage() {
  const { canManageStaff } = useAuth();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editingWard, setEditingWard] = useState<Ward | null>(null);

  const { data: wards = [], isLoading } = useQuery({
    queryKey: ["wards"],
    queryFn: async () => {
      const { data, error } = await supabase.from("wards").select("*").order("name");
      if (error) throw error;
      return data as Ward[];
    },
  });

  async function del(w: Ward) {
    if (!confirm(`Remove ward "${w.name}"?`)) return;
    const { error } = await supabase.from("wards").delete().eq("id", w.id);
    if (error) return toast.error(error.message);
    toast.success("Ward removed");
    logAudit("Removed ward", w.name);
    qc.invalidateQueries({ queryKey: ["wards"] });
  }

  return (
    <div>
      <PageHeader
        title="Wards & Safety Rules"
        subtitle="Minimum staffing rules enforced by the rota engine"
        actions={
          canManageStaff && (
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

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>
      ) : wards.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="No wards configured"
          description={
            canManageStaff
              ? "Add wards to define minimum staffing rules per shift."
              : "Ask an administrator to configure wards."
          }
          action={
            canManageStaff && (
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
          {wards.map((w) => {
            const minM = w.min_morning_nurses + w.min_morning_supervisor + w.min_morning_na;
            const ok = w.staffed >= minM;
            return (
              <div key={w.id} className="bg-card border rounded-xl p-5 shadow-soft">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{w.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Ratio: {w.ratio || "—"}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {ok ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-success/15 text-success font-semibold">
                        <CheckCircle2 className="h-3 w-3" /> Safe
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-destructive/15 text-destructive font-semibold">
                        <AlertTriangle className="h-3 w-3" /> Understaffed
                      </span>
                    )}
                    {canManageStaff && (
                      <>
                        <button
                          type="button"
                          aria-label={`Edit ${w.name}`}
                          onClick={() => setEditingWard(w)}
                          className="h-7 w-7 grid place-items-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${w.name}`}
                          onClick={() => del(w)}
                          className="h-7 w-7 grid place-items-center rounded-md hover:bg-destructive/10 text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="border rounded-lg p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                      Morning min
                    </p>
                    <p className="text-sm font-semibold mt-1">
                      {w.min_morning_nurses} N · {w.min_morning_supervisor} S · {w.min_morning_na}{" "}
                      NA
                    </p>
                  </div>
                  <div className="border rounded-lg p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                      Night min
                    </p>
                    <p className="text-sm font-semibold mt-1">
                      {w.min_night_nurses} N · {w.min_night_supervisor} S · {w.min_night_na} NA
                    </p>
                  </div>
                </div>

                {w.patients > 10 && (
                  <div className="mt-3 rounded-md bg-warning/15 text-warning-foreground px-3 py-2 text-xs">
                    <strong>Morning shift:</strong> {w.patients} patients — supervisor assigned to{" "}
                    {w.patients - 10} overflow patient{w.patients - 10 !== 1 ? "s" : ""}.
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> {w.staffed} staffed
                  </span>
                  <span>
                    Patients: <strong className="text-foreground">{w.patients}</strong>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && <AddWardModal onClose={() => setShowAdd(false)} />}
      {editingWard && <EditWardModal ward={editingWard} onClose={() => setEditingWard(null)} />}
    </div>
  );
}

function AddWardModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    ratio: "",
    min_morning_nurses: 2,
    min_morning_supervisor: 1,
    min_morning_na: 1,
    min_night_nurses: 2,
    min_night_supervisor: 0,
    min_night_na: 1,
    patients: 0,
    staffed: 0,
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("wards").insert(form);
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
        <div>
          <label htmlFor="ward-ratio" className="text-sm font-medium">
            Nurse-to-patient ratio
          </label>
          <input
            id="ward-ratio"
            type="text"
            value={form.ratio}
            onChange={(e) => setForm({ ...form, ratio: e.target.value })}
            placeholder="e.g. 1:8"
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
        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="Patients"
            value={form.patients}
            onChange={(v) => setForm({ ...form, patients: v })}
          />
          <NumField
            label="Currently staffed"
            value={form.staffed}
            onChange={(v) => setForm({ ...form, staffed: v })}
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

function EditWardModal({ ward, onClose }: { ward: Ward; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: ward.name,
    ratio: ward.ratio ?? "",
    min_morning_nurses: ward.min_morning_nurses,
    min_morning_supervisor: ward.min_morning_supervisor,
    min_morning_na: ward.min_morning_na,
    min_night_nurses: ward.min_night_nurses,
    min_night_supervisor: ward.min_night_supervisor,
    min_night_na: ward.min_night_na,
    patients: ward.patients,
    staffed: ward.staffed,
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase
      .from("wards")
      .update({ ...form, ratio: form.ratio || null })
      .eq("id", ward.id);
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
        <div>
          <label htmlFor="edit-ward-ratio" className="text-sm font-medium">
            Nurse-to-patient ratio
          </label>
          <input
            id="edit-ward-ratio"
            type="text"
            value={form.ratio}
            onChange={(e) => setForm({ ...form, ratio: e.target.value })}
            placeholder="e.g. 1:8"
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
        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="Patients"
            value={form.patients}
            onChange={(v) => setForm({ ...form, patients: v })}
          />
          <NumField
            label="Currently staffed"
            value={form.staffed}
            onChange={(v) => setForm({ ...form, staffed: v })}
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
