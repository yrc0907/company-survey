import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

/** 应用级元数据，避免把部署环境信息暴露在页面标题中。 */
export const metadata: Metadata = {
  title: "开源研报 · 开放知识协作平台",
  description: "可追溯、可审查、保留贡献署名的开放研究平台",
};

/** 根布局只提供全局样式和语言信息，不承载业务状态。 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
