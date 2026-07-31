import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const target = new URL(request.url).searchParams.get("url");
  if (!target) return NextResponse.json({ error: "url이 필요합니다." }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "올바르지 않은 URL입니다." }, { status: 400 });
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "images.pexels.com") {
    return NextResponse.json({ error: "허용되지 않은 이미지 호스트입니다." }, { status: 403 });
  }

  const upstream = await fetch(parsed.toString(), { cache: "force-cache" });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "이미지를 가져오지 못했습니다." }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}
