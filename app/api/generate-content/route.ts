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

function normalize(result: CardNewsResult): CardNewsResult {
  const rawSlides = Array.isArray(result.slides) ? result.slides.slice(0, 6) : [];
  if (rawSlides.length < 3) {
    throw new Error("카드가 3장보다 적게 생성되었습니다.");
  }

  return {
    topic: String(result.topic ?? "카드뉴스"),
    caption: String(result.caption ?? ""),
    hashtags: Array.isArray(result.hashtags) ? result.hashtags.map(String).slice(0, 12) : [],
    references: Array.isArray(result.references)
      ? result.references
          .filter((item) => item && typeof item.title === "string" && typeof item.url === "string")
          .slice(0, 8)
      : [],
    slides: rawSlides.map((slide, i) => ({
      id: `slide-${Date.now()}-${i}`,
      index: i + 1,
      eyebrow: String(slide.eyebrow ?? (i === 0 ? "HOT TOPIC" : "핵심 정리")).slice(0, 32),
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
    audience?: Audience;
    style?: ContentStyle;
  };

  const topic = body.topic?.trim() || "요즘 20~50대에게 핫한 주제";
  const audience = body.audience ?? "20~50대 전체";
  const style = body.style ?? "트렌드형";

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      ...createMockResult(topic, audience, style),
      warning: "OPENAI_API_KEY가 없어 데모 문구를 표시했습니다.",
    });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_TEXT_MODEL || "gpt-5";

    const research = await openai.responses.create({
      model,
      tools: [{ type: "web_search" }],
      reasoning: { effort: "low" },
      input: `오늘 기준으로 다음 주제를 조사해 카드뉴스 제작에 필요한 사실, 수치, 사람들이 관심을 갖는 이유, 공식 출처 URL을 한국어로 정리해. 공식 발표, 공공기관, 원문 자료를 우선하고 확인되지 않은 주장은 제외해. 주제: ${topic}`,
    });

    const prompt = `
너는 한국 인스타그램 카드뉴스 전문 기획자다.
웹 조사 내용을 바탕으로 ${audience}가 저장하고 공유하고 싶어 할 ${style} 카드뉴스를 만든다.
사용자 입력: ${topic}

가장 중요한 규칙:
- 카드 수는 사용자가 고르지 않는다. 정보량과 이야기 흐름을 판단해 3장, 4장, 5장, 6장 중 하나를 직접 선택한다.
- 같은 말을 반복해서 장수를 늘리지 않는다. 필요한 내용을 빠짐없이 전달하는 가장 짧은 장수를 선택한다.
- 단순한 핵심 정리는 3장, 원인과 방법이 있으면 4장, 배경·핵심·주의점이 필요하면 5장, 비교나 정보량이 많을 때만 6장을 쓴다.
- 1장은 강한 표지다. 뻔한 “왜 화제일까?” 대신 구체적인 궁금증, 반전, 숫자, 손해 회피 중 주제에 맞는 후킹을 쓴다.
- 중간 카드는 카드마다 하나의 역할만 가진다. 배경, 핵심 사실, 이유, 방법, 주의점, 비교 등을 자연스럽게 이어간다.
- 마지막 카드는 핵심 결론이나 현실적인 행동 제안으로 끝낸다. 억지로 “저장·공유”만 외치지 않는다.
- 사실과 의견을 섞지 말고, 확인할 수 없는 내용은 단정하지 않는다.
- 제목은 짧고 강하게, 본문은 한눈에 읽히도록 쓴다. 어려운 표현과 광고 문구는 피한다.
- 제목은 대체로 12~28자, 본문은 대체로 45~100자로 작성한다.
- 이미지에는 글자가 들어가지 않도록 imagePrompt를 영어로 작성한다.
- 이미지의 핵심 피사체는 중앙을 과하게 차지하지 않고, 카드 중앙에 글을 얹을 수 있는 여백이 있도록 한다.
- searchQuery는 영어 2~5단어로 작성한다.
- references에는 실제 조사에 사용한 출처의 제목과 URL만 넣는다.

반드시 설명 없이 아래 JSON 구조 하나만 출력한다. slides 배열 길이는 직접 선택한 3~6장이어야 한다.
{
  "topic": "string",
  "caption": "인스타 캡션과 핵심 요약",
  "hashtags": ["string"],
  "references": [{"title":"string","url":"https://..."}],
  "slides": [
    {
      "eyebrow":"string",
      "title":"string",
      "body":"string",
      "imagePrompt":"vertical editorial image prompt in English, centered text-safe space, no text, no logo",
      "searchQuery":"English stock photo query"
    }
  ]
}

웹 조사 메모:
${research.output_text}`;

    const response = await openai.responses.create({
      model,
      reasoning: { effort: "low" },
      input: prompt,
    });

    const parsed = extractJson(response.output_text) as CardNewsResult;
    return NextResponse.json(normalize(parsed));
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json(
      { error: `AI 카드뉴스 생성에 실패했습니다: ${message}` },
      { status: 502 },
    );
  }
}
