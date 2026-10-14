import { AppSidebar } from "@/components/app-sidebar";
import { KnowledgeMigrationPersonalPanel } from "@/components/knowledge-migration-personal-panel";
import { getTasks } from "@/lib/knowledge-migration/store";

export const dynamic = "force-dynamic";

export default function KnowledgeMigrationMembersPage() {
  const tasks = getTasks();
  const defaultTask = tasks[0];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppSidebar />
      <main className="ml-60 min-h-screen p-8 lg:p-10 max-w-[1500px]">
        {defaultTask ? (
          <KnowledgeMigrationPersonalPanel taskId={defaultTask.id} taskName={defaultTask.name} />
        ) : (
          <div className="py-12 text-center text-sm text-muted-foreground">未找到知识库迁移任务</div>
        )}
      </main>
    </div>
  );
}
