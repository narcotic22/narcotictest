import type { CardNewsResult, ContentStyle, Audience } from "@/lib/types";

export function createMockResult(
  topic: string,
  slideCount: number,
  audience: Audience,
  style: ContentStyle,
): CardNewsResult {
  const templates = [
    ["왜 지금 화제일까?", `${topic}이 최근 다시 주목받는 이유를 핵심만 정리했어.`],
    ["사람들이 반응한 포인트", "복잡한 설명보다 내 생활에 어떤 변화가 생기는지가 관심을 끌고 있어."],
    ["알아둘 핵심", "유행이라는 이유만으로 믿기보다 공식 자료와 조건을 함께 확인하는 게 중요해."],
    ["장점만 있는 건 아니다", "누구에게나 같은 결과가 나오는 것은 아니므로 상황에 맞게 판단해야 해."],
    ["이렇게 활용해봐", "오늘 바로 적용할 수 있는 작은 방법부터 시험해보고 반응을 기록해봐."],
    ["한 줄 결론", `${topic}, 남들이 한다고 따라가기보다 내게 필요한 부분만 가져오면 돼.`],
  ];

  const slides = Array.from({ length: slideCount }, (_, i) => {
    const [title, body] = templates[i] ?? templates[templates.length - 1];
    return {
      id: `slide-${Date.now()}-${i}`,
      index: i + 1,
      eyebrow: i === 0 ? `${audience} HOT TOPIC` : style,
      title: i === 0 ? `${topic}\n요즘 왜 이렇게 뜰까?` : title,
      body: i === 0 ? "지금 사람들이 저장하고 공유하는 이유를 빠르게 정리했어." : body,
      imagePrompt: `${topic}, editorial lifestyle image, modern Korean social media aesthetic, no text, no logo`,
      searchQuery: topic,
    };
  });

  return {
    topic,
    caption: `${topic}이 왜 화제인지 ${slideCount}장으로 정리했어. 저장해두고 필요할 때 다시 봐 👀`,
    hashtags: ["카드뉴스", "핫이슈", "생활정보", topic.replace(/\s+/g, "")],
    references: [],
    slides,
  };
}
