import { KnowledgeMigrationDashboard } from "@/components/knowledge-migration-dashboard";
import { AppSidebar } from "@/components/app-sidebar";

export default function KnowledgeMigrationPage() {
  return <div className="min-h-screen bg-background"><AppSidebar /><div className="ml-60"><KnowledgeMigrationDashboard /></div></div>;
}
