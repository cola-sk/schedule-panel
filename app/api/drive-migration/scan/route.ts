import { NextResponse } from "next/server";
import { performScan } from "@/lib/drive-migration/service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { folderUrlOrToken, targetWikiUrl, recursive } = body;

    if (!folderUrlOrToken || typeof folderUrlOrToken !== "string") {
      return NextResponse.json({ error: "请输入个人网盘文件夹链接或 Token" }, { status: 400 });
    }

    if (!targetWikiUrl || typeof targetWikiUrl !== "string") {
      return NextResponse.json({ error: "请输入目标知识库链接" }, { status: 400 });
    }

    const result = await performScan({
      folderUrlOrToken: folderUrlOrToken.trim(),
      targetWikiUrl: targetWikiUrl.trim(),
      recursive: recursive !== false,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("网盘扫描失败:", error);
    return NextResponse.json(
      { error: error?.message || "扫描个人网盘或获取知识库目录失败" },
      { status: 500 },
    );
  }
}
