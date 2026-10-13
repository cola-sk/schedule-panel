import "./globals.css";
import type { Metadata } from "next";
import { AccessGuard } from "@/components/access-guard";

export const metadata: Metadata = {
  title: "Orbit",
  description: "自动化调度与效能管理平台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="font-sans antialiased">
        <AccessGuard />
        {children}
      </body>
    </html>
  );
}


