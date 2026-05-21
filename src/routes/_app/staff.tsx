import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRef, useState } from "react";
import { UserPlus, Search, Upload, Trash2, Users, FileSpreadsheet, X, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
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

const FACILITIES = [
  "Ikeja",
  "Ikeja Clinic",
  "Idejo",
  "LSS",
  "Ikoyi",
  "Ligali",
  "Wellness",
] as const;

type Nurse = {
  id: string;
  name: string;
  role: string;
  facility: string | null;
  ward: string | null;
  certifications: string[];
  hours_this_month: number;
  target_hours: number;
};

function StaffPage() {
  const { canManageStaff } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

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

  const { data: wards = [] } = useQuery({
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

  const filtered = nurses.filter((n) =>
    [n.name, n.role, n.facility ?? "", n.ward ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

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

      <div className="bg-card border rounded-xl shadow-soft mb-4 p-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            aria-label="Search staff"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-md bg-muted/60 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="Search staff..."
          />
        </div>
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
                  <th className="text-left font-semibold px-4 py-3 hidden md:table-cell">
                    Certifications
                  </th>
                  <th className="text-right font-semibold px-4 py-3 hidden sm:table-cell">Hours</th>
                  {canManageStaff && <th className="px-4 py-3"></th>}
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
                    <td className="px-4 py-3 text-muted-foreground">{n.ward ?? "—"}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex gap-1 flex-wrap">
                        {n.certifications.map((c) => (
                          <span
                            key={c}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground font-medium"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">
                      {n.hours_this_month}/{n.target_hours}
                    </td>
                    {canManageStaff && (
                      <td className="px-4 py-3 text-right">
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
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAdd && (
        <AddNurseModal onClose={() => setShowAdd(false)} wards={wards.map((w) => w.name)} />
      )}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
    </div>
  );
}

function AddNurseModal({ onClose, wards }: { onClose: () => void; wards: string[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [role, setRole] = useState("Nurse");
  const [facility, setFacility] = useState("");
  const [ward, setWard] = useState(wards[0] ?? "");
  const [certs, setCerts] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const certifications = certs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const { error } = await supabase
      .from("nurses")
      .insert({ name, role, facility: facility || null, ward: ward || null, certifications });
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
            onChange={(e) => setRole(e.target.value)}
            className={inputCls}
          >
            {[
              "Nurse",
              "Head Nurse",
              "Ward Manager",
              "Intern Nurse",
              "Nursing Assistant",
              "Porter",
            ].map((r) => (
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
        <Field id="nurse-ward" label="Ward">
          {wards.length === 0 ? (
            <input
              type="text"
              aria-label="Ward"
              value={ward}
              onChange={(e) => setWard(e.target.value)}
              placeholder="Type ward name"
              className={inputCls}
            />
          ) : (
            <select
              id="nurse-ward"
              title="Ward"
              value={ward}
              onChange={(e) => setWard(e.target.value)}
              className={inputCls}
            >
              <option value="">— Unassigned —</option>
              {wards.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          )}
        </Field>
        <Field id="nurse-certs" label="Certifications" hint="Comma-separated (e.g. BLS, ACLS)">
          <input
            id="nurse-certs"
            type="text"
            placeholder="e.g. BLS, ACLS"
            value={certs}
            onChange={(e) => setCerts(e.target.value)}
            className={inputCls}
          />
        </Field>
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

function UploadModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [facility, setFacility] = useState("");
  const [rows, setRows] = useState<
    { name: string; role: string; ward: string; certifications: string[] }[]
  >([]);
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
          const certsRaw = get("certifications", "certs", "certification");
          return {
            name: get("name", "full name", "nurse"),
            role: get("role", "position") || "Nurse",
            ward: get("ward", "department", "unit"),
            certifications: certsRaw
              ? certsRaw
                  .split(/[,;|]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [],
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
        certifications: r.certifications,
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
          <strong>Role</strong>, <strong>Ward</strong> (and optional <strong>Certifications</strong>
          ).
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
