import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRef, useState, type FormEvent } from "react";
import {
  UserPlus,
  Search,
  Upload,
  Trash2,
  Users,
  FileSpreadsheet,
  X,
  Loader2,
  Pencil,
  KeyRound,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { adminCreateUser } from "@/integrations/supabase/admin-client";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_app/staff")({
  head: () => ({
    meta: [
      { title: "Staff — Nurses Rota" },
      {
        name: "description",
        content:
          "Manage nursing staff records, roles, ward assignments and bulk import via Excel upload.",
      },
      { property: "og:title", content: "Staff — Nurses Rota" },
      { property: "og:description", content: "Manage nursing staff, roles and ward assignments." },
    ],
  }),
  component: StaffPage,
});

const FACILITIES = ["Ikeja", "Ikoyi", "Ligali"] as const;

const NURSE_ROLES = [
  "Nurse",
  "Matron",
  "Coverage Nurse",
  "Intern Nurse",
  "Nurse Assistant",
] as const;

// Coverage Nurses and Intern Nurses are scheduled independently — no ward is tagged.
function isNoWardRole(role: string) {
  return /^(head|coverage)\s*nurse$|^intern\s*nurse$|^nurse\s*intern$/i.test(role);
}

function parseWards(ward: string | null): string[] {
  if (!ward) return [];
  return ward.split("|").filter(Boolean);
}

function formatWards(wards: string[]): string | null {
  const f = wards.filter(Boolean);
  return f.length ? f.join("|") : null;
}

type Nurse = {
  id: string;
  name: string;
  role: string;
  facility: string | null;
  ward: string | null;
  hours_this_month: number;
  target_hours: number;
};

function StaffPage() {
  const { canManageStaff, canCreateLogin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterFacility, setFilterFacility] = useState("");
  const [filterWard, setFilterWard] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editingNurse, setEditingNurse] = useState<Nurse | null>(null);
  const [createLoginNurse, setCreateLoginNurse] = useState<Nurse | null>(null);

  const { data: nurses = [], isLoading } = useQuery({
    queryKey: ["nurses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nurses")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Nurse[];
    },
  });

  // Nurse names that already have a login (matched by full_name in profiles).
  const { data: profileNames = [] } = useQuery({
    queryKey: ["profile-names"],
    enabled: canCreateLogin,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name");
      return (data ?? []).map((p) => p.full_name?.toLowerCase() ?? "").filter(Boolean);
    },
  });
  const hasLogin = (name: string) => profileNames.includes(name.toLowerCase());

  const { data: wards = [] } = useQuery<{ name: string }[]>({
    queryKey: ["wards"],
    queryFn: async () => (await supabase.from("wards").select("name").order("name")).data ?? [],
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("nurses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async (_, id) => {
      toast.success("Nurse removed");
      qc.invalidateQueries({ queryKey: ["nurses"] });
      logAudit("Removed nurse", id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = nurses.filter((n) => {
    if (
      search &&
      !`${n.name} ${n.role} ${n.facility ?? ""} ${n.ward ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
      return false;
    if (filterRole && n.role !== filterRole) return false;
    if (filterFacility && n.facility !== filterFacility) return false;
    if (filterWard && !parseWards(n.ward).includes(filterWard)) return false;
    return true;
  });

  const activeFilters = [filterRole, filterFacility, filterWard].filter(Boolean).length;
  const clearFilters = () => {
    setFilterRole("");
    setFilterFacility("");
    setFilterWard("");
    setSearch("");
  };

  const wardNames = wards.map((w) => w.name);

  return (
    <div>
      <PageHeader
        title="Nursing Staff"
        subtitle={`${nurses.length} nurse${nurses.length === 1 ? "" : "s"} registered`}
        actions={
          canManageStaff && (
            <>
              <button
                type="button"
                onClick={() => setShowUpload(true)}
                className="inline-flex items-center gap-2 h-10 px-3 rounded-md border bg-card text-sm hover:bg-muted"
              >
                <Upload className="h-4 w-4" />{" "}
                <span className="hidden sm:inline">Upload Excel</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
              >
                <UserPlus className="h-4 w-4" /> Add nurse
              </button>
            </>
          )
        }
      />

      <div className="bg-card border rounded-xl shadow-soft mb-4 p-3 flex flex-wrap items-center gap-2">
        {/* Name search */}
        <div className="relative min-w-44 flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            aria-label="Search staff"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-md bg-muted/60 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="Search by name…"
          />
        </div>

        {/* Role filter */}
        <select
          aria-label="Filter by role"
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="h-9 px-2 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All roles</option>
          {NURSE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        {/* Facility filter */}
        <select
          aria-label="Filter by facility"
          value={filterFacility}
          onChange={(e) => setFilterFacility(e.target.value)}
          className="h-9 px-2 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All facilities</option>
          {FACILITIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        {/* Ward filter */}
        <select
          aria-label="Filter by ward"
          value={filterWard}
          onChange={(e) => setFilterWard(e.target.value)}
          className="h-9 px-2 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All wards</option>
          {wardNames.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>

        {/* Clear filters */}
        {(activeFilters > 0 || search) && (
          <button
            type="button"
            onClick={clearFilters}
            className="h-9 px-3 rounded-md border text-sm inline-flex items-center gap-1.5 hover:bg-muted text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" /> Clear
            {activeFilters > 0 && (
              <span className="ml-0.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] grid place-items-center font-bold">
                {activeFilters}
              </span>
            )}
          </button>
        )}

        <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} of {nurses.length}
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>
      ) : nurses.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No nurses yet"
          description={
            canManageStaff
              ? "Add your first nurse manually or upload an Excel file with name, role and ward columns."
              : "Ask an administrator to add staff."
          }
          action={
            canManageStaff && (
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowUpload(true)}
                  className="inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-card text-sm hover:bg-muted"
                >
                  <FileSpreadsheet className="h-4 w-4" /> Upload Excel
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90"
                >
                  <UserPlus className="h-4 w-4" /> Add manually
                </button>
              </div>
            )
          }
        />
      ) : (
        <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left font-semibold px-4 py-3">Name</th>
                  <th className="text-left font-semibold px-4 py-3">Role</th>
                  <th className="text-left font-semibold px-4 py-3 hidden sm:table-cell">
                    Facility
                  </th>
                  <th className="text-left font-semibold px-4 py-3">Ward</th>
                  <th className="text-right font-semibold px-4 py-3 hidden sm:table-cell">Hours</th>
                  {canCreateLogin && <th className="text-center font-semibold px-4 py-3">Login</th>}
                  {canManageStaff && (
                    <th className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => (
                  <tr key={n.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/15 text-primary grid place-items-center text-xs font-semibold shrink-0">
                          {n.name
                            .split(" ")
                            .map((s) => s[0])
                            .slice(0, 2)
                            .join("")}
                        </div>
                        <span className="truncate">{n.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{n.role}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                      {n.facility ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isNoWardRole(n.role) ? (
                        <span className="text-xs italic opacity-50">—</span>
                      ) : (
                        parseWards(n.ward).join(", ") || "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">
                      {n.hours_this_month}/{n.target_hours}
                    </td>
                    {canCreateLogin && (
                      <td className="px-4 py-3 text-center">
                        {hasLogin(n.name) ? (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] text-success font-medium"
                            title="Login exists"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Active
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setCreateLoginNurse(n)}
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border text-[11px] hover:bg-primary hover:text-primary-foreground hover:border-primary transition"
                            title="Create login for this nurse"
                          >
                            <KeyRound className="h-3 w-3" /> Create
                          </button>
                        )}
                      </td>
                    )}
                    {canManageStaff && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-label={`Edit ${n.name}`}
                            onClick={() => setEditingNurse(n)}
                            className="h-8 w-8 grid place-items-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${n.name}`}
                            onClick={() => {
                              if (confirm(`Remove ${n.name}?`)) delMut.mutate(n.id);
                            }}
                            className="h-8 w-8 grid place-items-center rounded-md hover:bg-destructive/10 text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
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

      {showAdd && <AddNurseModal onClose={() => setShowAdd(false)} wards={wardNames} />}
      {editingNurse && (
        <EditNurseModal
          nurse={editingNurse}
          wards={wardNames}
          onClose={() => setEditingNurse(null)}
        />
      )}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
      {createLoginNurse && (
        <CreateLoginModal
          nurse={createLoginNurse}
          onClose={() => {
            setCreateLoginNurse(null);
            qc.invalidateQueries({ queryKey: ["profile-names"] });
          }}
        />
      )}
    </div>
  );
}

function WardMultiField({
  selectedWards,
  allWards,
  onChange,
}: {
  selectedWards: string[];
  allWards: string[];
  onChange: (v: string[]) => void;
}) {
  const available = allWards.filter((w) => !selectedWards.includes(w));

  return (
    <div>
      <p className="text-sm font-medium">
        Wards <span className="text-xs font-normal text-muted-foreground">(max 3)</span>
      </p>
      {selectedWards.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {selectedWards.map((w, i) => (
            <span
              key={w}
              className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2.5 py-1 rounded-full"
            >
              {i === 0 && (
                <span className="text-[9px] uppercase tracking-wide opacity-60 mr-0.5">
                  primary
                </span>
              )}
              {w}
              <button
                type="button"
                onClick={() => onChange(selectedWards.filter((x) => x !== w))}
                className="hover:text-destructive"
                aria-label={`Remove ${w}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {selectedWards.length < 3 &&
        (allWards.length > 0 ? (
          <select
            title="Add ward"
            value=""
            onChange={(e) => {
              if (e.target.value) onChange([...selectedWards, e.target.value]);
            }}
            className={inputCls + " mt-1.5"}
          >
            <option value="" disabled>
              {selectedWards.length === 0 ? "Select primary ward…" : "Add another ward…"}
            </option>
            {available.map((w) => (
              <option key={w}>{w}</option>
            ))}
            {available.length === 0 && (
              <option value="" disabled>
                All wards assigned
              </option>
            )}
          </select>
        ) : (
          <p className="text-xs text-muted-foreground mt-1.5">
            No wards configured. Add wards first.
          </p>
        ))}
    </div>
  );
}

function AddNurseModal({ onClose, wards }: { onClose: () => void; wards: string[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [role, setRole] = useState("Nurse");
  const [facility, setFacility] = useState("");
  const [nurseWards, setNurseWards] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const noWard = isNoWardRole(role);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("nurses").insert({
      name,
      role,
      facility: facility || null,
      ward: noWard ? null : formatWards(nurseWards),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Nurse added");
    logAudit("Added nurse", name);
    qc.invalidateQueries({ queryKey: ["nurses"] });
    onClose();
  }

  return (
    <Modal title="Add nurse" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field id="nurse-name" label="Full name">
          <input
            id="nurse-name"
            type="text"
            required
            placeholder="Enter full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field id="nurse-role" label="Role">
          <select
            id="nurse-role"
            title="Role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setNurseWards([]);
            }}
            className={inputCls}
          >
            {NURSE_ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field id="nurse-facility" label="Facility">
          <select
            id="nurse-facility"
            title="Facility"
            value={facility}
            onChange={(e) => setFacility(e.target.value)}
            className={inputCls}
          >
            <option value="">— Unassigned —</option>
            {FACILITIES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Field>
        {noWard ? (
          <p className="text-xs text-muted-foreground rounded-lg border border-dashed px-3 py-2">
            Ward assignment is not applicable for {role}s — their schedule is managed independently.
          </p>
        ) : (
          <WardMultiField selectedWards={nurseWards} allWards={wards} onChange={setNurseWards} />
        )}
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

function EditNurseModal({
  nurse,
  onClose,
  wards,
}: {
  nurse: Nurse;
  onClose: () => void;
  wards: string[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(nurse.name);
  const [role, setRole] = useState(nurse.role);
  const [facility, setFacility] = useState(nurse.facility ?? "");
  const [nurseWards, setNurseWards] = useState<string[]>(parseWards(nurse.ward));
  const [busy, setBusy] = useState(false);

  const noWard = isNoWardRole(role);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase
      .from("nurses")
      .update({
        name,
        role,
        facility: facility || null,
        ward: noWard ? null : formatWards(nurseWards),
      })
      .eq("id", nurse.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    logAudit("Updated nurse profile", name);
    qc.invalidateQueries({ queryKey: ["nurses"] });
    onClose();
  }

  return (
    <Modal title="Edit nurse" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field id="edit-name" label="Full name">
          <input
            id="edit-name"
            type="text"
            required
            placeholder="Enter full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field id="edit-role" label="Role">
          <select
            id="edit-role"
            title="Role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setNurseWards([]);
            }}
            className={inputCls}
          >
            {NURSE_ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field id="edit-facility" label="Facility">
          <select
            id="edit-facility"
            title="Facility"
            value={facility}
            onChange={(e) => setFacility(e.target.value)}
            className={inputCls}
          >
            <option value="">— Unassigned —</option>
            {FACILITIES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Field>
        {noWard ? (
          <p className="text-xs text-muted-foreground rounded-lg border border-dashed px-3 py-2">
            Ward assignment is not applicable for {role}s — their schedule is managed independently.
          </p>
        ) : (
          <WardMultiField selectedWards={nurseWards} allWards={wards} onChange={setNurseWards} />
        )}
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

function UploadModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [facility, setFacility] = useState("");
  const [rows, setRows] = useState<{ name: string; role: string; ward: string }[]>([]);
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setParsing(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const norm = raw
        .map((r) => {
          const keys = Object.fromEntries(Object.keys(r).map((k) => [k.trim().toLowerCase(), k]));
          const get = (...names: string[]) => {
            for (const n of names) if (keys[n]) return String(r[keys[n]] ?? "").trim();
            return "";
          };
          return {
            name: get("name", "full name", "nurse"),
            role: get("role", "position") || "Nurse",
            ward: get("ward", "department", "unit"),
          };
        })
        .filter((r) => r.name);
      setRows(norm);
      if (norm.length === 0) toast.error("No valid rows found. Need columns: Name, Role, Ward.");
    } catch (e: unknown) {
      toast.error("Could not parse file: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setParsing(false);
    }
  }

  async function importAll() {
    if (!facility) return toast.error("Select a facility before importing");
    setBusy(true);
    const { error } = await supabase.from("nurses").insert(
      rows.map((r) => ({
        name: r.name,
        role: r.role,
        facility,
        ward: r.ward || null,
      })),
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Imported ${rows.length} nurses into ${facility}`);
    logAudit("Imported nurses from Excel", `${rows.length} rows — ${facility}`);
    qc.invalidateQueries({ queryKey: ["nurses"] });
    onClose();
  }

  return (
    <Modal title="Upload Excel" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label htmlFor="upload-facility" className="text-sm font-medium">
            Facility <span className="text-destructive">*</span>
          </label>
          <select
            id="upload-facility"
            value={facility}
            onChange={(e) => setFacility(e.target.value)}
            className={inputCls + " mt-1"}
          >
            <option value="">— Select facility —</option>
            {FACILITIES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload an <code className="text-foreground">.xlsx</code> or{" "}
          <code className="text-foreground">.csv</code> with headers: <strong>Name</strong>,{" "}
          <strong>Role</strong>, <strong>Ward</strong>.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full h-32 rounded-lg border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors grid place-items-center text-sm text-muted-foreground"
        >
          {parsing ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Parsing…
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" /> Click to choose file
            </span>
          )}
        </button>

        {rows.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 text-xs font-semibold flex justify-between">
              <span>Preview ({rows.length} rows)</span>
            </div>
            <div className="max-h-56 overflow-y-auto text-sm">
              <table className="w-full">
                <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-1.5">Name</th>
                    <th className="text-left px-3 py-1.5">Role</th>
                    <th className="text-left px-3 py-1.5">Ward</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.role}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.ward || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-md border bg-card text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={importAll}
            disabled={!rows.length || busy}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />} Import {rows.length || ""}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const inputCls =
  "w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring";

function Field({
  label,
  hint,
  children,
  id,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card border rounded-xl shadow-card w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Create Login modal ────────────────────────────────────────────────────────

const LOGIN_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "nurse", label: "Nurse" },
  { value: "head_nurse", label: "Coverage Nurse" },
  { value: "hr_admin", label: "HR / Admin" },
  { value: "chief_matron", label: "Chief Matron" },
  { value: "cno", label: "Chief Nursing Officer (CNO)" },
  { value: "admin", label: "System Administrator" },
];

function CreateLoginModal({ nurse, onClose }: { nurse: Nurse; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("nurse");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      // adminCreateUser uses the service-role key — creates the account
      // instantly with email already confirmed. No confirmation email is sent.
      const userId = await adminCreateUser({ email, password, fullName: nurse.name });

      await Promise.all([
        supabase.from("user_roles").insert({
          user_id: userId,
          role: role as import("@/integrations/supabase/types").Database["public"]["Enums"]["app_role"],
        }),
        supabase.from("profiles").upsert({
          id: userId,
          full_name: nurse.name,
          email,
          updated_at: new Date().toISOString(),
        }),
      ]);

      logAudit("Created login", `${nurse.name} (${email}) — role: ${role}`);
      toast.success(`Login created for ${nurse.name} — can log in immediately`);
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create login");
    } finally {
      setBusy(false);
    }
  }

  const cls =
    "w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <Modal title={`Create login — ${nurse.name}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground mb-4">
        Creates a system account. The user will log in with the email and password below. Their
        dashboard will be scoped to the <strong>{nurse.facility ?? "assigned"}</strong> facility.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="text-sm font-medium">
            Email address <span className="text-destructive">*</span>
          </label>
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nurse@hospital.com"
            className={cls}
          />
        </div>
        <div>
          <label htmlFor="login-password" className="text-sm font-medium">
            Password <span className="text-destructive">*</span>
          </label>
          <input
            id="login-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            className={cls}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Share these credentials securely with the user.
          </p>
        </div>
        <div>
          <label htmlFor="login-role" className="text-sm font-medium">
            System role <span className="text-destructive">*</span>
          </label>
          <select
            id="login-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={cls}
          >
            {LOGIN_ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Determines what this user can see and do in the system.
          </p>
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
            type="submit"
            disabled={busy || !email || !password}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
            Create login
          </button>
        </div>
      </form>
    </Modal>
  );
}
