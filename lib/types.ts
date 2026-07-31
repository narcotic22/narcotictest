export type Audience =
  | "20대"
  | "30대"
  | "40대"
  | "50대"
  | "20~30대"
  | "30~40대"
  | "40~50대"
  | "20~50대 전체";

export type ContentStyle = "뉴스형" | "정보형" | "트렌드형" | "강한 후킹형";
export type ImageMode = "mixed" | "ai" | "pexels" | "none";

export interface ReferenceItem {
  title: string;
  url: string;
}

export interface CardSlide {
  id: string;
  index: number;
  eyebrow: string;
  title: string;
  body: string;
  imagePrompt: string;
  searchQuery: string;
  imageUrl?: string;
  attribution?: string;
  sourceUrl?: string;
}

export interface CardNewsResult {
  topic: string;
  caption: string;
  hashtags: string[];
  references: ReferenceItem[];
  slides: CardSlide[];
}
