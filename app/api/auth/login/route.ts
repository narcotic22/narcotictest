import { NextResponse } from "next/server";
import { createSessionToken, safePasswordEqual, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "APP_PASSWORD가 설정되지 않았습니다." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as { password?: string };
  const input = body.password ?? "";
  if (!safePasswordEqual(input, expected)) {
    return NextResponse.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
