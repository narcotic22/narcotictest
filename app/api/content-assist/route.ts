import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import type { Audience, CardSlide, ContentTone } from "@/lib/types";

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("JSON 결과를 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY가 필요합니다." }, { status: 400 });

  const body = await request.json() as {
    action?: "titleCandidates" | "refineSlide" | "captionVariants";
    topic?: string;
    audience?: Audience;
    tone?: ContentTone;
    category?: string;
    hookStrength?: string;
    currentTitle?: string;
    instruction?: string;
    slide?: CardSlide;
    slides?: CardSlide[];
    currentCaption?: string;
  };

  let prompt = "";
  if (body.action === "titleCandidates") {
    prompt = `주제: ${body.topic}\n현재 제목: ${body.currentTitle ?? ""}\n대상: ${body.audience}\n훅 강도: ${body.hookStrength}\n한국 인스타 카드뉴스 표지 제목 후보 5개를 만든다. 서로 비슷하지 않게 하고 16~38자, 과장과 낚시를 피한다. JSON만 출력: {"titleCandidates":["string"]}`;
  } else if (body.action === "refineSlide") {
    prompt = `주제: ${body.topic}\n대상: ${body.audience}\n문체: ${body.tone}\n분류: ${body.category}\n수정 요청: ${body.instruction}\n현재 카드: ${JSON.stringify(body.slide)}\n카드의 핵심 의미와 layout은 유지하면서 title, body, highlight, items를 요청대로 개선한다. visualKind도 내용과 맞지 않으면 바꾼다. JSON만 출력: {"slide":{"title":"string","body":"string","highlight":"string","items":["string"],"visualKind":"string"}}`;
  } else if (body.action === "captionVariants") {
    prompt = `주제: ${body.topic}\n대상: ${body.audience}\n문체: ${body.tone}\n카드 요약: ${JSON.stringify((body.slides ?? []).map((slide) => ({ title: slide.title, body: slide.body, items: slide.items })))}\n현재 캡션: ${body.currentCaption ?? ""}\n캡션 auto, short, info, emotional, threads 다섯 버전과 해시태그 8~12개를 만든다. threads는 500자 안쪽. JSON만 출력: {"captionVariants":{"auto":"string","short":"string","info":"string","emotional":"string","threads":"string"},"hashtags":["string"]}`;
  } else {
    return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({ model: process.env.OPENAI_TEXT_MODEL || "gpt-5", reasoning: { effort: "low" }, input: prompt });
    return NextResponse.json(extractJson(response.output_text));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: `AI 보조 기능 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}` }, { status: 502 });
  }
}
