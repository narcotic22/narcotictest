import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { createMockResult } from "@/lib/mock";
import type {
  Audience,
  CaptionVariants,
  CardLayout,
  CardNewsResult,
  CardVisualKind,
  ContentMode,
  ContentTone,
  GeneratedContentType,
} from "@/lib/types";

const CONTENT_TYPES: GeneratedContentType[] = ["quick", "essay", "list"];
const LAYOUTS: CardLayout[] = ["cover", "split", "quote", "list", "clean"];
const VISUALS: CardVisualKind[] = [
  "auto", "none", "airflow", "water", "power", "warning", "check", "spark", "target", "steps",
  "heart", "chat", "connection", "distance", "wallet", "chart", "receipt", "calculator", "laptop",
  "document", "mail", "book", "timer", "plane", "map", "luggage", "camera", "home", "health",
  "sleep", "meal", "exercise", "beauty", "phone", "search", "calendar", "bell", "compare", "idea",
  "lock", "shield", "leaf", "temperature", "cleaning", "shopping",
];

const TYPE_LABELS: Record<GeneratedContentType, string> = {
  quick: "빠른 정보형",
  essay: "감성 에세이형",
  list: "리스트·자기계발형",
};

const CARD_NEWS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "topic",
    "contentType",
    "contentTypeLabel",
    "caption",
    "captionVariants",
    "titleCandidates",
    "hashtags",
    "references",
    "factWarnings",
    "slides",
  ],
  properties: {
    topic: { type: "string" },
    contentType: { type: "string", enum: CONTENT_TYPES },
    contentTypeLabel: { type: "string" },
    caption: { type: "string" },
    captionVariants: {
      type: "object",
      additionalProperties: false,
      required: ["auto", "short", "info", "emotional", "threads"],
      properties: {
        auto: { type: "string" },
        short: { type: "string" },
        info: { type: "string" },
        emotional: { type: "string" },
        threads: { type: "string" },
      },
    },
    titleCandidates: {
      type: "array",
      items: { type: "string" },
    },
    hashtags: {
      type: "array",
      items: { type: "string" },
    },
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
        },
      },
    },
    factWarnings: {
      type: "array",
      items: { type: "string" },
    },
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "layout",
          "eyebrow",
          "title",
          "body",
          "highlight",
          "items",
          "itemStart",
          "visualKind",
          "visualEnabled",
          "imagePrompt",
          "searchQuery",
        ],
        properties: {
          layout: { type: "string", enum: LAYOUTS },
          eyebrow: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          highlight: { type: "string" },
          items: {
            type: "array",
            items: { type: "string" },
          },
          itemStart: { type: "integer" },
          visualKind: { type: "string", enum: VISUALS },
          visualEnabled: { type: "boolean" },
          imagePrompt: { type: "string" },
          searchQuery: { type: "string" },
        },
      },
    },
  },
} as const;

function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("JSON 결과를 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(first, last + 1));
}

function asContentType(value: unknown): GeneratedContentType {
  return CONTENT_TYPES.includes(value as GeneratedContentType) ? value as GeneratedContentType : "quick";
}

function asLayout(value: unknown, index: number): CardLayout {
  if (index === 0) return "cover";
  return LAYOUTS.includes(value as CardLayout) ? value as CardLayout : "clean";
}

function asVisual(value: unknown): CardVisualKind {
  return VISUALS.includes(value as CardVisualKind) ? value as CardVisualKind : "auto";
}

function slideRange(type: GeneratedContentType) {
  if (type === "essay") return { min: 7, max: 12 };
  if (type === "list") return { min: 5, max: 10 };
  return { min: 4, max: 7 };
}

function normalizeCaptionVariants(value: unknown, fallback: string): CaptionVariants {
  const object = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    auto: String(object.auto ?? fallback).slice(0, 1800),
    short: String(object.short ?? fallback).slice(0, 700),
    info: String(object.info ?? fallback).slice(0, 1800),
    emotional: String(object.emotional ?? fallback).slice(0, 1800),
    threads: String(object.threads ?? fallback).slice(0, 650),
  };
}

function normalize(result: CardNewsResult, forcedType?: GeneratedContentType): CardNewsResult {
  const contentType = forcedType ?? asContentType(result.contentType);
  const range = slideRange(contentType);
  const rawSlides = Array.isArray(result.slides) ? result.slides.slice(0, range.max) : [];
  if (rawSlides.length < range.min) {
    throw new Error(`${TYPE_LABELS[contentType]}은 최소 ${range.min}장이 필요하지만 ${rawSlides.length}장만 생성되었습니다.`);
  }

  const caption = String(result.caption ?? "").slice(0, 1800);
  return {
    topic: String(result.topic ?? "카드뉴스").slice(0, 140),
    contentType,
    contentTypeLabel: TYPE_LABELS[contentType],
    caption,
    captionVariants: normalizeCaptionVariants(result.captionVariants, caption),
    hashtags: Array.isArray(result.hashtags) ? result.hashtags.map(String).filter(Boolean).slice(0, 12) : [],
    references: Array.isArray(result.references)
      ? result.references.filter((item) => item && typeof item.title === "string" && typeof item.url === "string").slice(0, 12)
      : [],
    factWarnings: Array.isArray(result.factWarnings) ? result.factWarnings.map(String).filter(Boolean).slice(0, 8) : [],
    titleCandidates: Array.isArray(result.titleCandidates) ? result.titleCandidates.map(String).filter(Boolean).slice(0, 5) : [],
    slides: rawSlides.map((slide, index) => ({
      id: `slide-${Date.now()}-${index}`,
      index: index + 1,
      layout: asLayout(slide.layout, index),
      eyebrow: String(slide.eyebrow ?? (index === 0 ? "EDITORIAL" : TYPE_LABELS[contentType])).slice(0, 34),
      title: String(slide.title ?? "").slice(0, 110),
      body: String(slide.body ?? "").slice(0, 380),
      highlight: String(slide.highlight ?? "").slice(0, 100),
      items: Array.isArray(slide.items) ? slide.items.map(String).filter(Boolean).slice(0, 6).map((item: string) => item.slice(0, 90)) : [],
      itemStart: Number.isFinite(Number(slide.itemStart)) ? Math.max(1, Math.floor(Number(slide.itemStart))) : 1,
      imagePrompt: String(slide.imagePrompt ?? result.topic ?? "editorial lifestyle photography").slice(0, 900),
      searchQuery: String(slide.searchQuery ?? result.topic ?? "editorial lifestyle").slice(0, 120),
      visualKind: asVisual(slide.visualKind),
      visualEnabled: slide.visualEnabled !== false,
      imagePositionX: 50,
      imagePositionY: 50,
      imageZoom: 100,
      isLocked: false,
    })),
  };
}

async function requestStructuredResult(
  openai: OpenAI,
  model: string,
  prompt: string,
  factCheck: boolean,
  retryNote = "",
) {
  const response = await openai.responses.create({
    model,
    ...(factCheck ? { tools: [{ type: "web_search" as const }] } : {}),
    reasoning: { effort: "low" },
    input: `${prompt}${retryNote}`,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "instacard_news",
        description: "Nuvé Studio Instagram card-news data",
        strict: true,
        schema: CARD_NEWS_SCHEMA,
      },
    },
  });
  return extractJsonObject(response.output_text) as CardNewsResult;
}

async function requestJsonFallback(
  openai: OpenAI,
  model: string,
  prompt: string,
  factCheck: boolean,
) {
  const response = await openai.responses.create({
    model,
    ...(factCheck ? { tools: [{ type: "web_search" as const }] } : {}),
    reasoning: { effort: "low" },
    input: `${prompt}

반드시 문법적으로 완전한 JSON 객체만 출력한다. 문자열 내부의 따옴표는 이스케이프하고 배열 요소 사이의 쉼표를 빠뜨리지 않는다.`,
    store: false,
    text: { format: { type: "json_object" } },
  });
  return extractJsonObject(response.output_text) as CardNewsResult;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json() as {
    topic?: string;
    audience?: Audience;
    mode?: ContentMode;
    tone?: ContentTone;
    category?: string;
    hookStrength?: "soft" | "balanced" | "strong";
    ctaStyle?: "soft" | "save" | "engage" | "follow";
    captionStyle?: "auto" | "short" | "info" | "emotional" | "threads";
    avoidPhrases?: string;
    mustInclude?: string;
    factCheck?: boolean;
  };

  const topic = body.topic?.trim() || "요즘 20~50대에게 필요한 이야기";
  const audience = body.audience ?? "20~50대 전체";
  const mode = body.mode ?? "auto";
  const tone = body.tone ?? "magazine";
  const category = body.category?.trim() || "auto";
  const hookStrength = body.hookStrength ?? "balanced";
  const ctaStyle = body.ctaStyle ?? "soft";
  const captionStyle = body.captionStyle ?? "auto";
  const avoidPhrases = body.avoidPhrases?.trim() || "없음";
  const mustInclude = body.mustInclude?.trim() || "없음";
  const factCheck = body.factCheck !== false;

  if (!process.env.OPENAI_API_KEY) {
    const mock = createMockResult(topic, audience, mode, tone);
    return NextResponse.json({
      ...mock,
      titleCandidates: [mock.slides[0]?.title].filter(Boolean),
      captionVariants: { auto: mock.caption, short: mock.caption, info: mock.caption, emotional: mock.caption, threads: mock.caption },
      factWarnings: [],
      warning: "OPENAI_API_KEY가 없어 레이아웃 데모를 표시했습니다.",
    });
  }

  const modeInstruction = mode === "auto"
    ? `주제를 분석해 contentType을 결정한다. quick은 4~7장, essay는 7~12장, list는 5~10장이다.`
    : `contentType은 반드시 "${mode}"로 하고 해당 유형의 장수 규칙을 지킨다.`;

  const toneInstruction: Record<ContentTone, string> = {
    magazine: "차분하고 세련된 한국 매거진 문체. 여백과 리듬을 살린다.",
    hook: "첫 장은 강하게 후킹하되 낚시성 과장이나 공포 조장은 피한다.",
    warm: "따뜻하고 공감되게 쓰되 지나친 감상과 훈계를 피한다.",
    news: "사실 중심으로 간결하게 쓰고 조건과 예외를 분명히 한다.",
  };
  const hookInstruction = hookStrength === "strong" ? "첫 장을 강하게 시작" : hookStrength === "soft" ? "첫 장을 부드럽게 시작" : "궁금증을 주되 과장하지 않게 시작";
  const ctaInstruction = ctaStyle === "save" ? "저장하고 싶은 실용적 마무리" : ctaStyle === "engage" ? "댓글과 의견을 자연스럽게 유도" : ctaStyle === "follow" ? "같은 주제를 더 보고 싶게 팔로우를 자연스럽게 유도" : "잔잔한 정리나 작은 행동 제안";

  const prompt = `
너는 한국 인스타그램 카드뉴스 편집자다. Nuvé Studio의 디자인 방향은 순백색 카드, 검정 타이포, 검정 카드의 노란 핵심 강조, 절제된 선형 미니 그림이다.

주제: ${topic}
대상: ${audience}
주제 분류 힌트: ${category}
문체: ${toneInstruction[tone]}
첫 장: ${hookInstruction}
마지막 장: ${ctaInstruction}
캡션 선택: ${captionStyle}
반드시 넣을 내용: ${mustInclude}
피해야 할 표현: ${avoidPhrases}

${modeInstruction}

구성 원칙:
- 첫 장은 cover. 짧고 강한 제목과 한 문장 이하의 본문.
- 밝은 clean/split/list 카드와 어두운 quote 카드를 섞는다.
- 같은 layout을 세 장 연속 사용하지 않는다.
- 텍스트만 반복하지 말고, 정보 카드에는 내용에 맞는 visualKind를 지정한다.
- 마지막 카드는 핵심 정리 또는 선택한 CTA 방향으로 끝낸다.
- 카드끼리 같은 문장을 표현만 바꿔 반복하지 않는다.
- 줄바꿈은 단어 중간이 아닌 의미 단위로 한다.
- 표지 title에는 필요한 경우 \\n을 넣어 2~3줄로 나눈다.

미니 그림 visualKind 선택값:
airflow, water, power, warning, check, spark, target, steps, heart, chat, connection, distance, wallet, chart, receipt, calculator, laptop, document, mail, book, timer, plane, map, luggage, camera, home, health, sleep, meal, exercise, beauty, phone, search, calendar, bell, compare, idea, lock, shield, leaf, temperature, cleaning, shopping.
정확히 맞는 그림이 없거나 글이 긴 카드는 visualKind="none"으로 지정한다.

사실 확인:
- ${factCheck ? "최신 뉴스·정책·가격·통계·건강·금융·법률 주제는 웹 검색으로 확인하고 실제 사용한 출처만 references에 넣는다." : "외부 검색은 필요할 때만 최소한으로 사용한다."}
- 출처로 확인하지 못한 수치나 단정은 쓰지 않는다.
- 불확실하거나 주의가 필요한 부분은 factWarnings에 짧게 기록한다.

캡션:
- caption은 사용자가 고른 ${captionStyle} 방향의 기본 캡션.
- captionVariants에는 auto, short, info, emotional, threads 다섯 버전을 모두 작성한다.
- threads는 500자 안쪽으로 작성한다.
- titleCandidates에는 첫 장 제목 후보 5개를 서로 다른 강도로 작성한다.

이미지:
- imagePrompt는 영어. 사진 안 글자·로고·워터마크 금지.
- split/list는 피사체가 중앙 또는 아래쪽에서 잘 보이게 한다.
- searchQuery는 Pexels용 영어 2~6단어.
`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-5";

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const parsed = await requestStructuredResult(
        openai,
        model,
        prompt,
        factCheck,
        attempt === 0 ? "" : "\n\n이전 생성이 형식 검증에 실패했다. 이번에는 스키마를 정확히 지키고 모든 필수 필드를 채운다.",
      );
      return NextResponse.json(normalize(parsed, mode === "auto" ? undefined : mode));
    } catch (error) {
      lastError = error;
      console.error(`Structured output attempt ${attempt + 1} failed`, error);
    }
  }

  try {
    const parsed = await requestJsonFallback(openai, model, prompt, factCheck);
    return NextResponse.json({
      ...normalize(parsed, mode === "auto" ? undefined : mode),
      warning: "AI 응답 형식을 자동 복구해 생성했습니다.",
    });
  } catch (fallbackError) {
    console.error("JSON fallback failed", fallbackError);
    const message = fallbackError instanceof Error
      ? fallbackError.message
      : lastError instanceof Error
        ? lastError.message
        : "알 수 없는 오류";
    return NextResponse.json(
      { error: `AI 카드뉴스 생성에 실패했습니다. 자동 재시도와 JSON 복구도 실패했습니다: ${message}` },
      { status: 502 },
    );
  }
}
