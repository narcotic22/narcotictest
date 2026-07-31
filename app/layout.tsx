import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InstaCard Private",
  description: "개인용 인스타그램 카드뉴스 생성기",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
