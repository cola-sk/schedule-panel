import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Orbit",
  description: "自动化调度与效能管理平台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}


