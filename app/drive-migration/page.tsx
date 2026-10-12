import { DriveMigrationDashboard } from "@/components/drive-migration-dashboard";
import { AppSidebar } from "@/components/app-sidebar";

export default function DriveMigrationPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppSidebar />
      <div className="ml-60 min-h-screen">
        <DriveMigrationDashboard />
      </div>
    </div>
  );
}
