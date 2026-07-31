import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { createMockResult } from "@/lib/mock";
import type { Audience, CardNewsResult, ContentStyle } from "@/lib/types";

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("JSON 결과를 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(first, last + 1));
}

function normalize(result: CardNewsResult, slideCount: number): CardNewsResult {
  return {
    topic: String(result.topic ?? "카드뉴스"),
    caption: String(result.caption ?? ""),
    hashtags: Array.isArray(result.hashtags) ? result.hashtags.map(String).slice(0, 12) : [],
    references: Array.isArray(result.references)
      ? result.references
          .filter((item) => item && typeof item.title === "string" && typeof item.url === "string")
          .slice(0, 8)
      : [],
    slides: (Array.isArray(result.slides) ? result.slides : []).slice(0, slideCount).map((slide, i) => ({
      id: `slide-${Date.now()}-${i}`,
      index: i + 1,
      eyebrow: String(slide.eyebrow ?? (i === 0 ? "HOT TOPIC" : "핵심 정리")),
      title: String(slide.title ?? "제목을 입력하세요").slice(0, 80),
      body: String(slide.body ?? "내용을 입력하세요").slice(0, 220),
      imagePrompt: String(slide.imagePrompt ?? result.topic ?? "editorial lifestyle").slice(0, 700),
      searchQuery: String(slide.searchQuery ?? result.topic ?? "lifestyle").slice(0, 100),
    })),
  };
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json()) as {
    topic?: string;
    slideCount?: number;
    audience?: Audience;
    style?: ContentStyle;
  };
  const topic = body.topic?.trim() || "요즘 20~50대에게 핫한 주제";
  const slideCount = Math.min(6, Math.max(3, Number(body.slideCount) || 4));
  const audience = body.audience ?? "20~50대 전체";
  const style = body.style ?? "트렌드형";

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(createMockResult(topic, slideCount, audience, style));
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `
한국 인스타그램 카드뉴스 기획자처럼 작업해.
오늘 기준으로 사용자가 입력한 주제를 조사하고, ${audience}가 저장·공유하고 싶어 할 ${style} 카드뉴스를 만들어.
주제 입력: ${topic}
카드 수: 정확히 ${slideCount}장

규칙:
- 최신 이슈나 수치가 들어가면 웹 검색으로 공식 발표, 공공기관, 원문 보도자료를 우선 확인해.
- 확인할 수 없는 내용은 단정하지 마.
- 1장은 표지다. 마지막 장은 요약이나 자연스러운 저장·공유 유도다.
- 제목은 한 카드당 한국어 26자 안팎, 본문은 90자 안팎으로 짧게.
- 20~50대가 모두 이해할 수 있게 어려운 말은 풀어 써.
- 이미지에는 글자가 들어가지 않도록 imagePrompt를 작성해.
- 외부 사진 검색어 searchQuery는 영어 2~5단어로 작성해.
- references에는 실제 확인한 정보 출처의 제목과 URL을 넣어.

반드시 설명 없이 아래 JSON 구조 하나만 출력해:
{
  "topic": "string",
  "caption": "인스타 캡션과 정보 출처 요약",
  "hashtags": ["string"],
  "references": [{"title":"string","url":"https://..."}],
  "slides": [
    {
      "eyebrow":"string",
      "title":"string",
      "body":"string",
      "imagePrompt":"vertical editorial image prompt in English, no text, no logo",
      "searchQuery":"English stock photo query"
    }
  ]
}`;

    const model = process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna";
    const research = await openai.responses.create({
      model,
      tools: [{ type: "web_search" }],
      reasoning: { effort: "low" },
      input: `오늘 기준으로 다음 주제를 조사해 카드뉴스 제작에 필요한 사실, 수치, 사람들이 관심을 갖는 이유, 공식 출처 URL을 한국어로 정리해. 확인되지 않은 주장은 제외해. 주제: ${topic}`,
    });

    const response = await openai.responses.create({
      model,
      reasoning: { effort: "low" },
      input: `${prompt}

웹 조사 메모:
${research.output_text}`,
    });

    const parsed = extractJson(response.output_text) as CardNewsResult;
    const normalized = normalize(parsed, slideCount);
    if (normalized.slides.length !== slideCount) {
      throw new Error("요청한 카드 수와 생성 결과가 다릅니다.");
    }
    return NextResponse.json(normalized);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        ...createMockResult(topic, slideCount, audience, style),
        warning: "AI 호출에 실패해 데모 문구를 표시했습니다.",
      },
      { status: 200 },
    );
  }
}
