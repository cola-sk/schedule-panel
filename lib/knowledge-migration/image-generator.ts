import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import type { CycleStatsResult, TaskMigrationStats } from "./types";
import type { DirectoryStat } from "./stats";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

export function generateDashboardHtml(
  stats: TaskMigrationStats,
  taskName: string,
  cycleStats: CycleStatsResult,
  directories: DirectoryStat[],
): string {
  const nonWikiPct = stats.totalFeishuDocs > 0
    ? Math.round(stats.totalNonWikiDocs / stats.totalFeishuDocs * 100)
    : 0;
  const panels = directories.map((directory) => {
    const maxCount = Math.max(1, ...directory.subdirectories.map((child) => child.totalCount));
    const rows = directory.subdirectories.map((child) => `
      <div class="row">
        <div class="row-top">
          <span class="name">${escapeHtml(child.name)}</span>
          <span class="numbers">累计 <strong>${child.totalCount}</strong> 篇 <em>${escapeHtml(cycleStats.cycleShortLabel)} +${child.cycleCount}</em></span>
        </div>
        <div class="track"><div class="bar" style="width:${Math.max(2, child.totalCount / maxCount * 100)}%"></div></div>
      </div>`).join("");
    return `
      <section class="panel">
        <div class="panel-header">
          <h2>${escapeHtml(directory.name)}</h2>
          <div>子目录合计 <strong>${directory.totalCount}</strong> 篇 · ${escapeHtml(cycleStats.cycleShortLabel)} <strong>+${directory.cycleCount}</strong> 篇</div>
        </div>
        ${rows || '<div class="empty">暂无子目录数据</div>'}
      </section>`;
  }).join("");

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${escapeHtml(taskName)} - 知识库贡献统计</title>
<style>
  * { box-sizing: border-box; }
  body { width: 1040px; margin: 0; padding: 28px; background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #cbd5e1; padding-bottom: 16px; margin-bottom: 20px; }
  h1 { font-size: 23px; margin: 0 0 5px; }
  .subtitle, .date { color: #64748b; font-size: 12px; }
  .date { text-align: right; line-height: 1.6; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
  .kpi { min-height: 115px; padding: 15px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 1px 4px #0f172a0a; }
  .kpi:first-child { background: #eef2ff; border-color: #c7d2fe; }
  .kpi:nth-child(2) { background: #eff6ff; border-color: #bfdbfe; }
  .kpi-label { color: #475569; font-size: 12px; font-weight: 700; }
  .kpi-value { margin: 8px 0 4px; font-size: 32px; line-height: 1; font-weight: 800; }
  .kpi-value span { margin-left: 4px; font-size: 12px; font-weight: 500; color: #64748b; }
  .kpi-note { color: #64748b; font-size: 11px; }
  .section-title { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
  .section-title h2 { margin: 0; font-size: 19px; }
  .section-title span { color: #64748b; font-size: 12px; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
  .panel { background: white; border: 1px solid #e2e8f0; border-radius: 13px; padding: 17px; box-shadow: 0 2px 8px #0f172a0a; }
  .panel-header { border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 5px; }
  .panel-header h2 { margin: 0 0 6px; font-size: 17px; }
  .panel-header div { color: #64748b; font-size: 12px; }
  .panel-header strong { color: #4338ca; }
  .row { padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
  .row:last-child { border: 0; }
  .row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 7px; font-size: 12px; }
  .name { font-weight: 600; overflow-wrap: anywhere; }
  .numbers { flex: none; color: #64748b; font-size: 11px; }
  .numbers strong { color: #1e293b; font-size: 14px; }
  em { display: inline-block; margin-left: 6px; padding: 3px 5px; border-radius: 5px; background: #eef2ff; color: #4338ca; font-style: normal; font-weight: 700; }
  .track { height: 6px; background: #eef2ff; border-radius: 9px; overflow: hidden; }
  .bar { height: 100%; background: #818cf8; border-radius: 9px; }
  .empty { padding: 18px 0; color: #94a3b8; font-size: 12px; }
  footer { color: #94a3b8; margin-top: 20px; font-size: 11px; }
</style></head><body>
<header><div><h1>📊 飞书知识库贡献统计</h1><div class="subtitle">${escapeHtml(taskName)}</div></div><div class="date">${escapeHtml(cycleStats.cycleLabel)}<br>统计时间 ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</div></header>
<div class="kpis">
  <div class="kpi"><div class="kpi-label">非 Wiki 文档贡献</div><div class="kpi-value">${stats.totalNonWikiDocs}<span>篇</span></div><div class="kpi-note">${escapeHtml(cycleStats.cycleShortLabel)}新增 ${cycleStats.nonWikiCount} 篇 · 占全量 ${nonWikiPct}%</div></div>
  <div class="kpi"><div class="kpi-label">Wiki 归档迁移</div><div class="kpi-value">${stats.totalWikiDocs}<span>篇</span></div><div class="kpi-note">当前任务累计迁移</div></div>
  <div class="kpi"><div class="kpi-label">知识库文档总数</div><div class="kpi-value">${stats.totalFeishuDocs}<span>篇</span></div><div class="kpi-note">当前知识库全量</div></div>
  <div class="kpi"><div class="kpi-label">参与贡献成员</div><div class="kpi-value">${stats.personsRank.length}<span>人</span></div><div class="kpi-note">${escapeHtml(cycleStats.cycleShortLabel)} ${cycleStats.persons.filter((person) => person.nonWikiCount > 0).length} 人新增</div></div>
</div>
<div class="section-title"><h2>📂 重点目录 · 子目录贡献</h2><span>非 Wiki 文档 · 累计与${escapeHtml(cycleStats.cycleShortLabel)}新增</span></div>
<main>${panels}</main>
<footer>由 FEB 知识库迁移系统自动生成 · 累计按当前全量文档统计，新增按所选贡献周期统计</footer>
</body></html>`;
}

/** 将总量与子目录统计渲染为一张 PNG 图片。 */
export async function renderStatsDashboardImage(
  stats: TaskMigrationStats,
  taskName: string,
  cycleStats: CycleStatsResult,
  directories: DirectoryStat[],
): Promise<string> {
  if (!fs.existsSync(CHROME_PATH)) throw new Error(`未在系统找到 Google Chrome (${CHROME_PATH})`);

  const id = crypto.randomUUID();
  const htmlFile = path.join(os.tmpdir(), `km-dashboard-${id}.html`);
  const imgFile = path.join(os.tmpdir(), `km-dashboard-${id}.png`);
  const maxRows = Math.max(0, ...directories.map((directory) => directory.subdirectories.length));
  const height = Math.max(720, 430 + maxRows * 60);
  fs.writeFileSync(htmlFile, generateDashboardHtml(stats, taskName, cycleStats, directories), "utf-8");

  const capture = () => new Promise<string>((resolve, reject) => {
    const proc = spawn(CHROME_PATH, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      `--window-size=1080,${height}`,
      `--screenshot=${imgFile}`,
      htmlFile,
    ]);
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("截图渲染超时 (30s)"));
    }, 30000);

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(imgFile) && fs.statSync(imgFile).size > 0) {
        resolve(imgFile);
      } else {
        fs.rmSync(imgFile, { force: true });
        reject(new Error(`Chrome 截图失败，退出代码: ${code}，信号: ${signal || "无"}`));
      }
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  try {
    try {
      return await capture();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("SIGBUS")) throw error;
      return await capture();
    }
  } finally {
    fs.rmSync(htmlFile, { force: true });
  }
}
