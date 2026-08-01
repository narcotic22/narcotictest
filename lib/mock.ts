import type {
  Audience,
  CardLayout,
  CardNewsResult,
  ContentMode,
  ContentTone,
  GeneratedContentType,
} from "@/lib/types";

function resolveMockType(mode: ContentMode, topic: string): GeneratedContentType {
  if (mode !== "auto") return mode;
  if (/연애|외로|마음|감정|관계|인생|상처|자존감|행복/.test(topic)) return "essay";
  if (/가지|목록|추천|방법|습관|해야 할|체크리스트/.test(topic)) return "list";
  return "quick";
}

function mockCount(type: GeneratedContentType) {
  if (type === "essay") return 9;
  if (type === "list") return 7;
  return 4;
}

function layoutFor(type: GeneratedContentType, index: number, count: number): CardLayout {
  if (index === 0) return "cover";
  if (index === count - 1) return "quote";
  if (type === "list") return index % 3 === 0 ? "quote" : "list";
  if (type === "essay") return index % 4 === 0 ? "quote" : "split";
  return index % 3 === 0 ? "clean" : "split";
}

export function createMockResult(
  topic: string,
  audience: Audience,
  mode: ContentMode,
  tone: ContentTone,
): CardNewsResult {
  const contentType = resolveMockType(mode, topic);
  const count = mockCount(contentType);
  const labels: Record<GeneratedContentType, string> = {
    quick: "빠른 정보형",
    essay: "감성 에세이형",
    list: "리스트·자기계발형",
  };

  const slides = Array.from({ length: count }, (_, index) => {
    const layout = layoutFor(contentType, index, count);
    const items = layout === "list"
      ? ["첫 번째 데모 항목", "두 번째 데모 항목", "세 번째 데모 항목", "네 번째 데모 항목"]
      : undefined;

    return {
      id: `slide-${Date.now()}-${index}`,
      index: index + 1,
      layout,
      eyebrow: index === 0 ? `${audience} DEMO` : labels[contentType],
      title: index === 0 ? `${topic}\n레이아웃 데모` : `${index}. 실제 API 연결 후 문구가 생성돼요`,
      body: index === 0
        ? "지금은 레이아웃 확인용 데모입니다."
        : "OpenAI API가 연결되면 주제에 맞는 실제 내용과 카드 흐름을 자동으로 작성합니다.",
      highlight: layout === "quote" ? "실제 내용" : "",
      items,
      itemStart: layout === "list" ? Math.max(1, (index - 1) * 4 + 1) : undefined,
      imagePrompt: `${topic}, emotional editorial photography, muted colors, Korean magazine mood, no text, no logo`,
      searchQuery: `${topic} emotional lifestyle`,
    };
  });

  return {
    topic,
    contentType,
    contentTypeLabel: labels[contentType],
    caption: `${topic} 카드뉴스 레이아웃 데모입니다. 실제 API 연결 후 게시용 문구가 생성됩니다.`,
    hashtags: ["카드뉴스", "콘텐츠제작", tone, topic.replace(/\s+/g, "")],
    references: [],
    slides,
  };
}
