import type { CardNewsResult, ContentStyle, Audience } from "@/lib/types";

function chooseMockSlideCount(topic: string) {
  const normalized = topic.replace(/\s+/g, "");
  if (normalized.length <= 10) return 3;
  if (normalized.length <= 22) return 4;
  if (normalized.length <= 38) return 5;
  return 6;
}

export function createMockResult(
  topic: string,
  audience: Audience,
  style: ContentStyle,
): CardNewsResult {
  const slideCount = chooseMockSlideCount(topic);
  const templates = [
    ["핵심부터 짚어볼게", `${topic}에 관해 실제 제작 화면을 확인하기 위한 데모 문구야.`],
    ["관심이 커진 이유", "실제 API가 연결되면 최신 자료를 조사해 구체적인 이유와 근거를 작성해."],
    ["가장 중요한 포인트", "지금 보이는 내용은 기능 확인용이며 실제 게시용 결과가 아니야."],
    ["확인해야 할 조건", "정확한 수치나 최신 정보는 OpenAI API 연결 후 공식 출처를 바탕으로 생성돼."],
    ["실제로는 이렇게 구성돼", "정보량에 따라 카드 수를 자동으로 정하고 반복 없이 핵심만 나눠 담아."],
    ["한 줄 결론", "API 연결이 완료되면 이 데모 대신 조사된 실제 내용이 표시돼."],
  ];

  const slides = Array.from({ length: slideCount }, (_, i) => {
    const [title, body] = templates[i] ?? templates[templates.length - 1];
    return {
      id: `slide-${Date.now()}-${i}`,
      index: i + 1,
      eyebrow: i === 0 ? `${audience} DEMO` : style,
      title: i === 0 ? `${topic}\n자동 구성 데모` : title,
      body,
      imagePrompt: `${topic}, editorial lifestyle image, centered text-safe space, modern Korean social media aesthetic, no text, no logo`,
      searchQuery: topic,
    };
  });

  return {
    topic,
    caption: `${topic} 카드뉴스 데모 결과입니다. 실제 API 연결 시 최신 자료를 조사해 작성합니다.`,
    hashtags: ["카드뉴스", "데모", topic.replace(/\s+/g, "")],
    references: [],
    slides,
  };
}
