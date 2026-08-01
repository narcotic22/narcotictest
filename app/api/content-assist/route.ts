import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import type { Audience, CardSlide, ContentTone } from "@/lib/types";

const VISUALS: string[] = [
  "auto", "none", "airflow", "water", "power", "warning", "check", "spark", "target", "steps",
  "heart", "chat", "connection", "distance", "wallet", "chart", "receipt", "calculator", "laptop",
  "document", "mail", "book", "timer", "plane", "map", "luggage", "camera", "home", "health",
  "sleep", "meal", "exercise", "beauty", "phone", "search", "calendar", "bell", "compare", "idea",
  "lock", "shield", "leaf", "temperature", "cleaning", "shopping",
];

const SCHEMAS = {
  titleCandidates: {
    type: "object",
    additionalProperties: false,
    required: ["titleCandidates"],
    properties: {
      titleCandidates: { type: "array", items: { type: "string" } },
    },
  },
  refineSlide: {
    type: "object",
    additionalProperties: false,
    required: ["slide"],
    properties: {
      slide: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body", "highlight", "items", "visualKind"],
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          highlight: { type: "string" },
          items: { type: "array", items: { type: "string" } },
          visualKind: { type: "string", enum: VISUALS },
        },
      },
    },
  },
  captionVariants: {
    type: "object",
    additionalProperties: false,
    required: ["captionVariants", "hashtags"],
    properties: {
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
      hashtags: { type: "array", items: { type: "string" } },
    },
  },
} as const;

function extractJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("JSON 결과를 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>;
}

type Action = keyof typeof SCHEMAS;

async function createStructured(
  openai: OpenAI,
  action: Action,
  prompt: string,
  retryNote = "",
) {
  const response = await openai.responses.create({
    model: process.env.OPENAI_TEXT_MODEL || "gpt-5",
    reasoning: { effort: "low" },
    input: `${prompt}${retryNote}`,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: `instacard_${action}`,
        strict: true,
        schema: SCHEMAS[action],
      },
    },
  });
  return extractJsonObject(response.output_text);
}

async function createFallback(openai: OpenAI, prompt: string) {
  const response = await openai.responses.create({
    model: process.env.OPENAI_TEXT_MODEL || "gpt-5",
    reasoning: { effort: "low" },
    input: `${prompt}

반드시 문법적으로 완전한 JSON 객체만 출력한다. 배열 요소 사이의 쉼표를 빠뜨리지 않는다.`,
    store: false,
    text: { format: { type: "json_object" } },
  });
  return extractJsonObject(response.output_text);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY가 필요합니다." }, { status: 400 });
  }

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
  let action: Action;
  if (body.action === "titleCandidates") {
    action = "titleCandidates";
    prompt = `주제: ${body.topic}\n현재 제목: ${body.currentTitle ?? ""}\n대상: ${body.audience}\n훅 강도: ${body.hookStrength}\n한국 인스타 카드뉴스 표지 제목 후보 5개를 만든다. 서로 비슷하지 않게 하고 16~38자, 과장과 낚시를 피한다.`;
  } else if (body.action === "refineSlide") {
    action = "refineSlide";
    prompt = `주제: ${body.topic}\n대상: ${body.audience}\n문체: ${body.tone}\n분류: ${body.category}\n수정 요청: ${body.instruction}\n현재 카드: ${JSON.stringify(body.slide)}\n카드의 핵심 의미와 layout은 유지하면서 title, body, highlight, items를 요청대로 개선한다. visualKind도 내용과 맞지 않으면 바꾼다.`;
  } else if (body.action === "captionVariants") {
    action = "captionVariants";
    prompt = `주제: ${body.topic}\n대상: ${body.audience}\n문체: ${body.tone}\n카드 요약: ${JSON.stringify((body.slides ?? []).map((slide) => ({ title: slide.title, body: slide.body, items: slide.items })))}\n현재 캡션: ${body.currentCaption ?? ""}\n캡션 auto, short, info, emotional, threads 다섯 버전과 해시태그 8~12개를 만든다. threads는 500자 안쪽.`;
  } else {
    return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await createStructured(
        openai,
        action,
        prompt,
        attempt === 0 ? "" : "\n\n이전 응답이 형식 검증에 실패했다. 이번에는 스키마를 정확히 지킨다.",
      );
      return NextResponse.json(result);
    } catch (error) {
      lastError = error;
      console.error(`Content assist structured attempt ${attempt + 1} failed`, error);
    }
  }

  try {
    return NextResponse.json(await createFallback(openai, prompt));
  } catch (fallbackError) {
    console.error("Content assist JSON fallback failed", fallbackError);
    const message = fallbackError instanceof Error
      ? fallbackError.message
      : lastError instanceof Error
        ? lastError.message
        : "알 수 없는 오류";
    return NextResponse.json({ error: `AI 보조 기능 실패: ${message}` }, { status: 502 });
  }
}
