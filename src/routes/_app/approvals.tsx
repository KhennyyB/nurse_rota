import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { FileCheck2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

export const Route = createFileRoute("/_app/approvals")({
  component: ApprovalsPage,
});

function ApprovalsPage() {
  return (
    <div>
      <PageHeader title="Approval Workflow" subtitle="Draft → Chief Matron → CNO → Published" />
      <EmptyState
        icon={<FileCheck2 className="h-6 w-6" />}
        title="No rotas pending approval"
        description="Once a rota is drafted, it will appear here for the Chief Matron and CNO to approve in sequence."
      />
    </div>
  );
}
