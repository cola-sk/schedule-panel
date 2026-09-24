import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import type { CycleStatsResult, TaskMigrationStats } from "./types";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function generateDashboardHtml(
  stats: TaskMigrationStats,
  taskName: string,
  cycleStats?: CycleStatsResult,
): string {
  const currentWeek = stats.weeks[0];
  const maxWeeklyCount = Math.max(...(stats.weeks || []).map((w) => w.totalCount), 1);
  const cycleLabel = cycleStats ? cycleStats.cycleLabel : (currentWeek?.weekLabel || "历史全量");
  const cycleShort = cycleStats?.cycleShortLabel || "本周";

  // 1. KPI 卡片数据
  const nonWikiPct =
    stats.totalFeishuDocs > 0 ? Math.round((stats.totalNonWikiDocs / stats.totalFeishuDocs) * 100) : 0;

  // 2. 分类累计
  const categoryBadgesHtml = (stats.categoryRank || [])
    .map((cat) => {
      const pct =
        stats.totalNonWikiDocs > 0 ? Math.round((cat.count / stats.totalNonWikiDocs) * 100) : 0;
      return `
        <div class="cat-badge">
          <span class="cat-name">${cat.category}</span>
          <span class="cat-count">${cat.count} 篇</span>
          <span class="cat-pct">(${pct}%)</span>
        </div>
      `;
    })
    .join("");

  // 3. 周度趋势柱状图
  const weekRowsHtml = (stats.weeks || [])
    .map((w) => {
      const nonWikiPct = Math.round((w.nonWikiCount / maxWeeklyCount) * 100);
      const wikiPct = Math.round((w.wikiCount / maxWeeklyCount) * 100);

      return `
        <div class="week-row">
          <div class="week-info">
            <span class="week-label">
              <span class="cal-icon">📅</span> ${w.weekLabel}
            </span>
            <div class="week-nums">
              <span class="nw-num">非Wiki: ${w.nonWikiCount}</span>
              <span class="dot">·</span>
              <span class="w-num">Wiki: ${w.wikiCount}</span>
              <span class="dot">·</span>
              <span class="tot-num">总计: ${w.totalCount} 篇</span>
            </div>
          </div>
          <div class="bar-track">
            ${
              w.nonWikiCount > 0
                ? `<div class="bar-nw" style="width: ${Math.max(nonWikiPct, 2)}%;"></div>`
                : ""
            }
            ${
              w.wikiCount > 0
                ? `<div class="bar-w" style="width: ${Math.max(wikiPct, 2)}%;"></div>`
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");

  // 4. 迁移人总榜（已排除机器人与Wiki系统）
  const humanRank = (stats.personsRank || []).filter(
    (p) =>
      p.personName !== "Wiki 归档系统" &&
      p.personName !== "迁移机器人" &&
      !p.personName.includes("8eb8") &&
      !p.personName.includes("机器人") &&
      p.userId !== "ou_8a0d18f26e02a0a5add005b36c2d8eb8"
  );

  const rankRowsHtml = humanRank
    .map((p, idx) => {
      const badgeClass =
        idx === 0
          ? "badge-gold"
          : idx === 1
          ? "badge-silver"
          : idx === 2
          ? "badge-bronze"
          : "badge-default";
      const catSub =
        p.categories && p.categories.length > 0
          ? p.categories
              .slice(0, 2)
              .map((c) => `${c.category}(${c.count})`)
              .join(", ")
          : "";

      const cycleCount = cycleStats?.persons.find((cp) => cp.personName === p.personName)?.nonWikiCount || 0;
      const cycleSub = cycleCount > 0 ? `<span style="color:#4f46e5;font-weight:700;margin-left:4px;">(+${cycleCount} ${cycleShort})</span>` : "";

      return `
        <div class="rank-item">
          <div class="rank-left">
            <span class="rank-badge ${badgeClass}">${idx + 1}</span>
            <div class="rank-meta">
              <div class="rank-name">${p.personName}</div>
              ${catSub ? `<div class="rank-sub">${catSub}</div>` : ""}
            </div>
          </div>
          <div class="rank-right">
            <span class="rank-main-count">${p.nonWikiCount} 篇${cycleSub}</span>
            <span class="rank-sub-count">(共 ${p.totalCount})</span>
          </div>
        </div>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${taskName} - 知识库归档全景看板</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: #f8fafc;
    color: #0f172a;
    padding: 24px;
    width: 1040px;
    margin: 0 auto;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 14px;
    border-bottom: 1px solid #e2e8f0;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .header-title {
    font-size: 18px;
    font-weight: 700;
    color: #1e293b;
    letter-spacing: -0.01em;
  }
  .header-tag {
    font-size: 11px;
    background: #e0e7ff;
    color: #4338ca;
    padding: 2px 8px;
    border-radius: 9999px;
    font-weight: 600;
  }
  .header-date {
    font-size: 12px;
    color: #64748b;
    font-family: monospace;
  }

  /* KPI Grid */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-bottom: 16px;
  }
  .kpi-card {
    border-radius: 12px;
    padding: 16px;
    border: 1px solid #e2e8f0;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  }
  .kpi-card.purple {
    background: linear-gradient(135deg, rgba(238,242,255,0.85) 0%, rgba(224,231,255,0.4) 100%);
    border-color: #c7d2fe;
  }
  .kpi-card.blue {
    background: linear-gradient(135deg, rgba(239,246,255,0.85) 0%, rgba(219,234,254,0.4) 100%);
    border-color: #bfdbfe;
  }
  .kpi-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    font-weight: 600;
  }
  .purple .kpi-header { color: #4338ca; }
  .blue .kpi-header { color: #1d4ed8; }
  .kpi-header.slate { color: #64748b; }
  .kpi-header.emerald { color: #047857; }
  .kpi-num {
    font-size: 32px;
    font-weight: 800;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    margin: 8px 0 2px 0;
    line-height: 1.1;
  }
  .purple .kpi-num { color: #1e1b4b; }
  .blue .kpi-num { color: #172554; }
  .kpi-unit {
    font-size: 13px;
    font-weight: normal;
    color: #64748b;
    margin-left: 4px;
  }
  .kpi-sub {
    font-size: 11px;
    color: #64748b;
  }

  /* Category rank */
  .section-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  }
  .sec-header {
    font-size: 12px;
    font-weight: 700;
    color: #334155;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sec-sub {
    font-weight: normal;
    color: #64748b;
    font-size: 11px;
  }
  .cat-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .cat-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 11px;
  }
  .cat-name { font-weight: 600; color: #1e293b; }
  .cat-count {
    background: #eef2ff;
    color: #4f46e5;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 700;
    font-family: monospace;
    font-size: 10px;
  }
  .cat-pct { color: #64748b; font-size: 10px; font-family: monospace; }

  /* Two Column Split */
  .split-row {
    display: grid;
    grid-template-columns: 6.2fr 3.8fr;
    gap: 16px;
  }
  .panel-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  }
  .panel-header {
    padding: 12px 16px;
    border-bottom: 1px solid #f1f5f9;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .panel-title {
    font-size: 13px;
    font-weight: 700;
    color: #1e293b;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .panel-legend {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 11px;
    color: #64748b;
  }
  .leg-item { display: flex; align-items: center; gap: 4px; }
  .leg-box { width: 10px; height: 10px; border-radius: 2px; }
  .bg-nw { background: #6366f1; }
  .bg-w { background: #93c5fd; }

  /* Week rows */
  .panel-body { padding: 12px 16px; }
  .week-row {
    margin-bottom: 12px;
    padding: 6px 8px;
    border-radius: 6px;
    background: #f8fafc;
  }
  .week-row:last-child { margin-bottom: 0; }
  .week-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    margin-bottom: 6px;
  }
  .week-label { font-weight: 600; color: #1e293b; }
  .cal-icon { font-size: 10px; }
  .week-nums { font-family: monospace; font-size: 10px; }
  .nw-num { color: #4f46e5; font-weight: 700; }
  .w-num { color: #2563eb; }
  .tot-num { color: #0f172a; font-weight: 700; }
  .dot { color: #cbd5e1; margin: 0 4px; }
  .bar-track {
    display: flex;
    height: 10px;
    width: 100%;
    background: #e2e8f0;
    border-radius: 9999px;
    overflow: hidden;
  }
  .bar-nw { background: #6366f1; height: 100%; }
  .bar-w { background: #93c5fd; height: 100%; }

  /* Rank items */
  .rank-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid #f1f5f9;
  }
  .rank-item:last-child { border-bottom: none; }
  .rank-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .rank-badge {
    width: 20px;
    height: 20px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
  }
  .badge-gold { background: #f59e0b; color: #fff; }
  .badge-silver { background: #94a3b8; color: #fff; }
  .badge-bronze { background: #b45309; color: #fff; }
  .badge-default { background: #f1f5f9; color: #64748b; }
  .rank-meta { display: flex; flex-direction: column; }
  .rank-name { font-size: 12px; font-weight: 600; color: #1e293b; }
  .rank-sub { font-size: 10px; color: #64748b; margin-top: 1px; }
  .rank-right { text-align: right; font-family: monospace; }
  .rank-main-count { font-size: 12px; font-weight: 800; color: #4f46e5; display: block; }
  .rank-sub-count { font-size: 10px; color: #94a3b8; }

  .footer {
    margin-top: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: #94a3b8;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <span class="header-title">📊 飞书知识库全景归档与周度迁移分析</span>
      <span class="header-tag">${taskName}</span>
    </div>
    <div class="header-date">统计周期: ${cycleLabel}</div>
  </div>

  <!-- 1. KPI 核心指标 -->
  <div class="kpi-grid">
    <div class="kpi-card purple">
      <div class="kpi-header">
        <span>非 Wiki 外部迁移 / 新增</span>
        <span>✨</span>
      </div>
      <div class="kpi-num">${stats.totalNonWikiDocs}<span class="kpi-unit">篇</span></div>
      <div class="kpi-sub">占飞书全量文档的 ${nonWikiPct}%</div>
    </div>

    <div class="kpi-card blue">
      <div class="kpi-header">
        <span>Wiki 归档系统迁移文档</span>
        <span>✅</span>
      </div>
      <div class="kpi-num">${stats.totalWikiDocs}<span class="kpi-unit">篇</span></div>
      <div class="kpi-sub">由当前归档任务成功导入飞书</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-header slate">
        <span>飞书知识库全量文档总数</span>
        <span>📚</span>
      </div>
      <div class="kpi-num">${stats.totalFeishuDocs}<span class="kpi-unit">篇</span></div>
      <div class="kpi-sub">${cycleStats ? `${cycleStats.cycleShortLabel}新增贡献 ${cycleStats.nonWikiCount} 篇` : `涵盖 ${stats.weeks?.length || 0} 个自然周的历史增量`}</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-header emerald">
        <span>涉及迁移 / 创建人员</span>
        <span>👥</span>
      </div>
      <div class="kpi-num">${humanRank.length}<span class="kpi-unit">人</span></div>
      <div class="kpi-sub" style="font-size:11px;color:#64748b;margin-top:2px;">${cycleStats ? `${cycleStats.cycleShortLabel}共 ${cycleStats.persons.filter((p) => p.nonWikiCount > 0).length} 人贡献` : "累计参与贡献成员"}</div>
    </div>
  </div>

  <!-- 2. 分类累计分布 -->
  ${
    stats.categoryRank && stats.categoryRank.length > 0
      ? `
  <div class="section-card">
    <div class="sec-header">
      <span>📂 除 Wiki 之外 · 分类累计分布</span>
      <span class="sec-sub">(共 ${stats.totalNonWikiDocs} 篇，涵盖 ${stats.categoryRank.length} 个分类)</span>
    </div>
    <div class="cat-list">
      ${categoryBadgesHtml}
    </div>
  </div>
  `
      : ""
  }

  <!-- 3. 趋势柱状图与贡献榜 -->
  <div class="split-row">
    <div class="panel-card">
      <div class="panel-header">
        <span class="panel-title">📈 各周迁移量趋势对比</span>
        <div class="panel-legend">
          <div class="leg-item"><div class="leg-box bg-nw"></div><span>非 Wiki 外部迁移</span></div>
          <div class="leg-item"><div class="leg-box bg-w"></div><span>Wiki 归档迁移</span></div>
        </div>
      </div>
      <div class="panel-body">
        ${weekRowsHtml}
      </div>
    </div>

    <div class="panel-card">
      <div class="panel-header">
        <span class="panel-title">👤 迁移人总贡献榜 (按非 Wiki)</span>
        ${cycleStats ? `<span style="font-size:11px;color:#4f46e5;font-weight:600;">含 ${cycleStats.cycleShortLabel}增量</span>` : ""}
      </div>
      <div>
        ${rankRowsHtml}
      </div>
    </div>
  </div>

  <div class="footer">
    <span>由 FEB 知识库迁移系统自动生成 · 数据实时同步飞书知识库</span>
    <span>统计时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</span>
  </div>
</body>
</html>`;
}

/**
 * 将数据看板渲染为高精度的 PNG 图像
 */
export async function renderStatsDashboardImage(
  stats: TaskMigrationStats,
  taskName: string,
  cycleStats?: CycleStatsResult,
): Promise<string> {
  const htmlContent = generateDashboardHtml(stats, taskName, cycleStats);
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const htmlFile = path.join(tmpDir, `km-dashboard-${id}.html`);
  const imgFile = path.join(tmpDir, `km-dashboard-${id}.png`);

  fs.writeFileSync(htmlFile, htmlContent, "utf-8");

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CHROME_PATH)) {
      try {
        fs.unlinkSync(htmlFile);
      } catch {}
      return reject(new Error(`未在系统找到 Google Chrome (${CHROME_PATH})，无法生成长图截图`));
    }

    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--force-device-scale-factor=2", // 2x Retina 高清输出
      "--window-size=1080,780",
      `--screenshot=${imgFile}`,
      htmlFile,
    ];

    const proc = spawn(CHROME_PATH, args);

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("截图渲染超时 (15s)"));
    }, 15000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      try {
        fs.unlinkSync(htmlFile);
      } catch {}

      if (code === 0 && fs.existsSync(imgFile) && fs.statSync(imgFile).size > 0) {
        resolve(imgFile);
      } else {
        reject(new Error(`Chrome 截图失败，退出代码: ${code}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
