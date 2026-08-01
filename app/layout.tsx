import type { Metadata } from "next";
import "./globals.css";
import "./position-fix.css";
import "./detail-polish.css";
import "./final-editorial-theme.css";
import "./visual-details.css";
import "./studio-v16.css";

export const metadata: Metadata = {
  title: "InstaCard Editorial",
  description: "개인용 인스타그램 매거진형 카드뉴스 생성기",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
