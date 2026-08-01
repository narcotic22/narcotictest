import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json()) as {
    mode?: "ai" | "pexels" | "none";
    imagePrompt?: string;
    searchQuery?: string;
  };

  if (body.mode === "none") return NextResponse.json({ imageUrl: "" });

  if (body.mode === "pexels") {
    if (!process.env.PEXELS_API_KEY) {
      return NextResponse.json({ error: "PEXELS_API_KEY가 설정되지 않았습니다." }, { status: 400 });
    }
    const query = encodeURIComponent(body.searchQuery || "modern lifestyle");
    const response = await fetch(
      `https://api.pexels.com/v1/search?query=${query}&orientation=portrait&per_page=8`,
      { headers: { Authorization: process.env.PEXELS_API_KEY }, cache: "no-store" },
    );
    if (!response.ok) return NextResponse.json({ error: "Pexels 이미지 검색에 실패했습니다." }, { status: 502 });
    const data = (await response.json()) as {
      photos?: Array<{
        id: number;
        url: string;
        photographer: string;
        src: { large2x?: string; portrait?: string; large?: string };
      }>;
    };
    const photos = data.photos ?? [];
    if (!photos.length) return NextResponse.json({ error: "검색된 이미지가 없습니다." }, { status: 404 });
    const photo = photos[Math.floor(Math.random() * Math.min(photos.length, 5))];
    const rawUrl = photo.src.large2x || photo.src.portrait || photo.src.large;
    if (!rawUrl) return NextResponse.json({ error: "사용 가능한 이미지 주소가 없습니다." }, { status: 404 });
    return NextResponse.json({
      imageUrl: `/api/image-proxy?url=${encodeURIComponent(rawUrl)}`,
      attribution: `Photo by ${photo.photographer} on Pexels`,
      sourceUrl: photo.url,
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY가 설정되지 않았습니다." }, { status: 400 });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await openai.images.generate({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt: `${body.imagePrompt || "modern editorial lifestyle photography"}. Vertical 4:5 composition, visually strong focal point, clean space for overlay text, realistic editorial lighting, no words, no letters, no logo, no watermark.`,
      size: "1024x1536",
    });
    const base64 = result.data?.[0]?.b64_json;
    if (!base64) throw new Error("이미지 데이터가 없습니다.");
    return NextResponse.json({
      imageUrl: `data:image/png;base64,${base64}`,
      attribution: "AI generated image",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "AI 이미지 생성에 실패했습니다." }, { status: 502 });
  }
}
