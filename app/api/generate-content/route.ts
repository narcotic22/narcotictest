import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { createMockResult } from "@/lib/mock";
import type {
  Audience,
  CardLayout,
  CardNewsResult,
  ContentMode,
  ContentTone,
  GeneratedContentType,
} from "@/lib/types";

const CONTENT_TYPES: GeneratedContentType[] = ["quick", "essay", "list"];
const LAYOUTS: CardLayout[] = ["cover", "split", "quote", "list", "clean"];

const TYPE_LABELS: Record<GeneratedContentType, string> = {
  quick: "빠른 정보형",
  essay: "감성 에세이형",
  list: "리스트·자기계발형",
};

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("JSON 결과를 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(first, last + 1));
}

function asContentType(value: unknown): GeneratedContentType {
  return CONTENT_TYPES.includes(value as GeneratedContentType)
    ? (value as GeneratedContentType)
    : "quick";
}

function asLayout(value: unknown, index: number): CardLayout {
  if (index === 0) return "cover";
  return LAYOUTS.includes(value as CardLayout) ? (value as CardLayout) : "split";
}

function slideRange(type: GeneratedContentType) {
  if (type === "essay") return { min: 8, max: 13 };
  if (type === "list") return { min: 6, max: 12 };
  return { min: 3, max: 6 };
}

function normalize(result: CardNewsResult, forcedType?: GeneratedContentType): CardNewsResult {
  const contentType = forcedType ?? asContentType(result.contentType);
  const range = slideRange(contentType);
  const rawSlides = Array.isArray(result.slides) ? result.slides.slice(0, range.max) : [];

  if (rawSlides.length < range.min) {
    throw new Error(`${TYPE_LABELS[contentType]}은 최소 ${range.min}장이 필요하지만 ${rawSlides.length}장만 생성되었습니다.`);
  }

  return {
    topic: String(result.topic ?? "카드뉴스").slice(0, 140),
    contentType,
    contentTypeLabel: TYPE_LABELS[contentType],
    caption: String(result.caption ?? "").slice(0, 1600),
    hashtags: Array.isArray(result.hashtags) ? result.hashtags.map(String).slice(0, 12) : [],
    references: Array.isArray(result.references)
      ? result.references
          .filter((item) => item && typeof item.title === "string" && typeof item.url === "string")
          .slice(0, 10)
      : [],
    slides: rawSlides.map((slide, index) => ({
      id: `slide-${Date.now()}-${index}`,
      index: index + 1,
      layout: asLayout(slide.layout, index),
      eyebrow: String(slide.eyebrow ?? (index === 0 ? "EDITORIAL" : TYPE_LABELS[contentType])).slice(0, 34),
      title: String(slide.title ?? "").slice(0, 110),
      body: String(slide.body ?? "").slice(0, 360),
      highlight: String(slide.highlight ?? "").slice(0, 100),
      items: Array.isArray(slide.items)
        ? slide.items.map(String).filter(Boolean).slice(0, 5).map((item) => item.slice(0, 90))
        : [],
      itemStart: Number.isFinite(Number(slide.itemStart)) ? Math.max(1, Math.floor(Number(slide.itemStart))) : 1,
      imagePrompt: String(slide.imagePrompt ?? result.topic ?? "editorial lifestyle photography").slice(0, 900),
      searchQuery: String(slide.searchQuery ?? result.topic ?? "emotional lifestyle").slice(0, 120),
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
    mode?: ContentMode;
    tone?: ContentTone;
  };

  const topic = body.topic?.trim() || "요즘 20~50대에게 필요한 이야기";
  const audience = body.audience ?? "20~50대 전체";
  const mode = body.mode ?? "auto";
  const tone = body.tone ?? "magazine";

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      ...createMockResult(topic, audience, mode, tone),
      warning: "OPENAI_API_KEY가 없어 레이아웃 데모를 표시했습니다.",
    });
  }

  const modeInstruction = mode === "auto"
    ? `주제를 분석해 contentType을 직접 결정해라.
- quick: 뉴스·생활정보·핵심 요약처럼 짧게 전달할 주제. 3~6장.
- essay: 연애·감정·관계·자존감·인생 조언처럼 흐름과 여운이 중요한 주제. 8~12장, 정말 필요한 경우만 13장.
- list: 추천 목록·해야 할 일·습관·체크리스트·아이디어 모음. 6~12장.`
    : `contentType은 반드시 "${mode}"로 하고 해당 유형의 장수 규칙을 지켜라.`;

  const toneInstruction: Record<ContentTone, string> = {
    magazine: "차분하고 세련된 한국 매거진 문체. 과장하지 말고 문장에 여백과 리듬을 준다.",
    hook: "첫 장은 강하게 후킹하되 낚시성 과장이나 공포 조장은 피한다.",
    warm: "따뜻하고 공감되는 말투를 사용하되 지나친 감상이나 훈계조는 피한다.",
    news: "사실 중심으로 간결하게 쓰고 수치·조건·예외를 명확히 구분한다.",
  };

  const prompt = `
너는 한국 인스타그램용 카드뉴스를 만드는 편집자이자 카피라이터다.
사용자 입력을 바탕으로 독자적인 매거진형 카드뉴스를 만든다. 특정 계정의 문장이나 디자인을 복제하지 말고, 여백이 넓고 사진과 글의 호흡이 좋은 편집 원칙만 활용한다.

주제: ${topic}
대상: ${audience}
문체: ${toneInstruction[tone]}

유형과 장수 결정:
${modeInstruction}

사실 확인 규칙:
- 최신 뉴스, 정책, 가격, 통계, 건강·금융·법률처럼 사실 확인이 필요한 주제는 웹 검색을 사용한다.
- 공식기관, 원문 발표, 신뢰도 높은 1차 자료를 우선한다.
- 감성 에세이처럼 외부 사실이 불필요한 주제는 억지로 검색하거나 통계를 끼워 넣지 않는다.
- 확인하지 못한 주장이나 심리학적 단정은 쓰지 않는다.
- 실제로 참고한 자료만 references에 넣고, 자료가 필요 없는 글이면 빈 배열로 둔다.

구성 규칙:
- 첫 장은 layout="cover". 풀사진 위에 짧고 강한 제목만 배치할 수 있게 작성한다.
- quick은 3~6장. 표지 → 핵심 설명 → 조건·방법·주의점 → 결론 순서로 가장 짧게 구성한다.
- essay는 8~12장, 필요한 경우만 13장. 표지 → 문제 제기 → 번호가 붙은 핵심 주장들 → 중간 quote 카드 1~2장 → 여운 있는 결론으로 구성한다.
- list는 6~12장. 표지 → 한 장당 3~4개 항목을 담은 list 카드 → 중간 quote 카드 → 현실적인 마무리로 구성한다.
- 같은 말을 표현만 바꿔 반복하지 않는다.
- 각 카드는 단독으로 읽혀도 이해되지만, 넘기면 이야기가 자연스럽게 이어져야 한다.
- 마지막 장은 무조건적인 저장·공유 요청 대신 핵심 정리, 질문, 작은 행동 제안 또는 여운 있는 문장으로 끝낸다.

레이아웃 규칙:
- cover: 풀화면 사진 + 큰 표지 제목. body는 한 문장 이하.
- split: 위쪽 흰 배경에 왼쪽 정렬 제목·본문, 아래쪽에 사진. 번호가 붙은 주장에 사용한다.
- list: 위쪽 흰 배경에 제목과 items 3~4개, 아래쪽에 사진. body는 짧은 보충 설명만 사용한다. 여러 list 카드가 이어지면 itemStart를 1, 5, 9처럼 이어지게 지정한다.
- quote: 어두운 사진 위에 중앙 정렬 문장. body가 중심이고 highlight에는 body에 실제로 포함된 강조 구절을 정확히 넣는다.
- clean: 사진 없이 흰 배경 텍스트 중심. 수치·비교·체크 포인트처럼 글 자체가 중요한 경우에만 사용한다.
- essay와 list에는 split/list/quote를 섞어 호흡을 만든다. quote를 연속으로 배치하지 않는다.

문장 규칙:
- 표지 제목은 16~38자 정도, 본문 카드 제목은 10~32자 정도로 쓴다.
- split 본문은 45~120자 정도로 쓰고 2~4줄로 읽히게 한다.
- quote 본문은 45~110자 정도로 쓰고 핵심 구절 하나를 highlight로 지정한다.
- list의 items는 각 12~32자 정도, 한 장에 3~4개를 기본으로 한다.
- 어려운 말, AI가 쓴 듯한 상투어, 뻔한 “왜 화제일까?”, 억지 감동, 과도한 느낌표를 피한다.
- 제목과 본문에 마크다운 기호를 넣지 않는다.

이미지 규칙:
- imagePrompt는 영어로 작성한다. 사진 안에 글자·로고·워터마크가 없도록 한다.
- 감성 에세이는 muted colors, cinematic natural light, candid moment, subtle film grain 같은 분위기를 우선한다.
- 리스트형은 여행·취미·공부·일상처럼 항목과 연결되는 자연스러운 생활 사진을 사용한다.
- split/list는 사진이 카드 아래쪽에 들어가므로 핵심 피사체가 중앙 또는 아래쪽에서 잘 보이게 한다.
- searchQuery는 Pexels 검색에 적합한 영어 2~6단어로 쓴다.

반드시 설명 없이 JSON 객체 하나만 출력한다.
{
  "topic": "string",
  "contentType": "quick | essay | list",
  "contentTypeLabel": "string",
  "caption": "인스타그램 게시용 캡션",
  "hashtags": ["string"],
  "references": [{"title":"string","url":"https://..."}],
  "slides": [
    {
      "layout":"cover | split | quote | list | clean",
      "eyebrow":"string",
      "title":"string",
      "body":"string",
      "highlight":"body 안에 실제로 들어 있는 강조 구절 또는 빈 문자열",
      "items":["list 레이아웃에서만 사용"],
      "itemStart":1,
      "imagePrompt":"English photo prompt, no text, no logo",
      "searchQuery":"English stock photo query"
    }
  ]
}`;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_TEXT_MODEL || "gpt-5";
    const response = await openai.responses.create({
      model,
      tools: [{ type: "web_search" }],
      reasoning: { effort: "low" },
      input: prompt,
    });

    const parsed = extractJson(response.output_text) as CardNewsResult;
    return NextResponse.json(normalize(parsed, mode === "auto" ? undefined : mode));
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json(
      { error: `AI 카드뉴스 생성에 실패했습니다: ${message}` },
      { status: 502 },
    );
  }
}
