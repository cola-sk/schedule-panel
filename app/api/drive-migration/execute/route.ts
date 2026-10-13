import { NextResponse } from "next/server";
import { executeBatchMigration } from "@/lib/drive-migration/service";
import { MigrateItemParam } from "@/lib/drive-migration/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      sourceFolderUrl,
      sourceFolderToken,
      sourceFolderName,
      targetWikiUrl,
      targetParentNodeToken,
      items,
    } = body;

    if (!targetWikiUrl || typeof targetWikiUrl !== "string") {
      return NextResponse.json({ error: "目标知识库链接不能为空" }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "请至少选择一个待迁移的文件" }, { status: 400 });
    }

    const migrationItems: MigrateItemParam[] = items.map((item: any) => ({
      token: String(item.token),
      name: String(item.name || "未命名文件"),
      type: String(item.type || "docx"),
      customTargetParentToken: item.customTargetParentToken ? String(item.customTargetParentToken) : undefined,
    }));

    const result = await executeBatchMigration({
      sourceFolderUrl: typeof sourceFolderUrl === "string" ? sourceFolderUrl.trim() : undefined,
      sourceFolderToken: typeof sourceFolderToken === "string" ? sourceFolderToken.trim() : undefined,
      sourceFolderName: typeof sourceFolderName === "string" ? sourceFolderName.trim() : undefined,
      targetWikiUrl: targetWikiUrl.trim(),
      targetParentNodeToken: String(targetParentNodeToken || ""),
      items: migrationItems,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("批量迁移失败:", error);
    return NextResponse.json(
      { error: error?.message || "批量迁移执行失败" },
      { status: 500 },
    );
  }
}
