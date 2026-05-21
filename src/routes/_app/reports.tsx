import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Download, FileText, FileSpreadsheet, BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const { data: wards = [] } = useQuery({
    queryKey: ["wards"],
    queryFn: async () => (await supabase.from("wards").select("*").order("name")).data ?? [],
  });
  const { data: nurses = [] } = useQuery({
    queryKey: ["nurses"],
    queryFn: async () => (await supabase.from("nurses").select("*")).data ?? [],
  });
  const { data: leave = [] } = useQuery({
    queryKey: ["leave"],
    queryFn: async () => (await supabase.from("leave_requests").select("*")).data ?? [],
  });

  const maxPatients = Math.max(1, ...wards.map((w) => w.patients));
  const totalHours = nurses.reduce((s, n) => s + (n.hours_this_month || 0), 0);

  function exportStaff() {
    if (nurses.length === 0) return toast.error("No staff to export");
    const ws = XLSX.utils.json_to_sheet(
      nurses.map((n) => ({
        Name: n.name,
        Role: n.role,
        Ward: n.ward ?? "",
        Certifications: (n.certifications ?? []).join(", "),
        Hours: n.hours_this_month,
        Target: n.target_hours,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Staff");
    XLSX.writeFile(wb, `staff-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Exported");
  }

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Coverage, hours and leave insights"
        actions={
          <>
            <button
              type="button"
              onClick={() => toast.info("PDF export coming soon")}
              className="inline-flex items-center gap-2 h-10 px-3 rounded-md border bg-card text-sm hover:bg-muted"
            >
              <FileText className="h-4 w-4" /> <span className="hidden sm:inline">PDF</span>
            </button>
            <button
              type="button"
              onClick={exportStaff}
              className="inline-flex items-center gap-2 h-10 px-3 rounded-md border bg-card text-sm hover:bg-muted"
            >
              <FileSpreadsheet className="h-4 w-4" />{" "}
              <span className="hidden sm:inline">Excel</span>
            </button>
            <button
              type="button"
              onClick={exportStaff}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              <Download className="h-4 w-4" /> Export
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Stat label="Staff" value={nurses.length} />
        <Stat label="Wards" value={wards.length} />
        <Stat label="Total Hours" value={totalHours} />
        <Stat label="Leave Requests" value={leave.length} />
      </div>

      <div className="bg-card border rounded-xl p-5 shadow-soft">
        <h2 className="font-semibold mb-4">Ward Utilization</h2>
        {wards.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" />}
            title="No data yet"
            description="Add wards to see utilization charts."
          />
        ) : (
          <div className="space-y-2.5">
            {wards.map((w) => {
              const pct = Math.round((w.patients / maxPatients) * 100);
              return (
                <div key={w.id} className="flex items-center gap-3 text-sm">
                  <div className="w-32 sm:w-40 truncate">{w.name}</div>
                  <div className="flex-1 h-6 rounded-md bg-muted overflow-hidden relative">
                    <svg
                      className="absolute inset-0 h-full w-full"
                      viewBox="0 0 100 1"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <rect width={pct} height="1" className="fill-primary/70" />
                    </svg>
                    <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium">
                      {w.patients} patients
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card border rounded-xl p-5 shadow-soft">
      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
    </div>
  );
}
