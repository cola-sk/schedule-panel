import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "前端机器人管理台",
  description: "飞书轮值提醒与定时任务管理",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}


