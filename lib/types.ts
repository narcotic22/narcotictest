export type Audience =
  | "20대"
  | "30대"
  | "40대"
  | "50대"
  | "20~30대"
  | "30~40대"
  | "40~50대"
  | "20~50대 전체";

export type ContentMode = "auto" | "quick" | "essay" | "list";
export type GeneratedContentType = Exclude<ContentMode, "auto">;
export type ContentTone = "magazine" | "hook" | "warm" | "news";
export type ImageMode = "economy" | "ai" | "pexels" | "none";
export type ImageRequestMode = "ai" | "pexels" | "none";
export type CardLayout = "cover" | "split" | "quote" | "list" | "clean";

export interface ReferenceItem {
  title: string;
  url: string;
}

export interface CardSlide {
  id: string;
  index: number;
  layout: CardLayout;
  eyebrow: string;
  title: string;
  body: string;
  highlight?: string;
  items?: string[];
  itemStart?: number;
  imagePrompt: string;
  searchQuery: string;
  imageUrl?: string;
  attribution?: string;
  sourceUrl?: string;
}

export interface CardNewsResult {
  topic: string;
  contentType: GeneratedContentType;
  contentTypeLabel: string;
  caption: string;
  hashtags: string[];
  references: ReferenceItem[];
  slides: CardSlide[];
}
