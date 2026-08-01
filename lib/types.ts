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

export type CardVisualKind =
  | "auto"
  | "none"
  | "airflow"
  | "water"
  | "power"
  | "warning"
  | "check"
  | "spark"
  | "target"
  | "steps"
  | "heart"
  | "chat"
  | "connection"
  | "distance"
  | "wallet"
  | "chart"
  | "receipt"
  | "calculator"
  | "laptop"
  | "document"
  | "mail"
  | "book"
  | "timer"
  | "plane"
  | "map"
  | "luggage"
  | "camera"
  | "home"
  | "health"
  | "sleep"
  | "meal"
  | "exercise"
  | "beauty"
  | "phone"
  | "search"
  | "calendar"
  | "bell"
  | "compare"
  | "idea"
  | "lock"
  | "shield"
  | "leaf"
  | "temperature"
  | "cleaning"
  | "shopping";

export type CaptionVariantKey = "auto" | "short" | "info" | "emotional" | "threads";

export interface ReferenceItem {
  title: string;
  url: string;
}

export interface CaptionVariants {
  auto?: string;
  short?: string;
  info?: string;
  emotional?: string;
  threads?: string;
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
  visualKind?: CardVisualKind;
  visualEnabled?: boolean;
  imagePositionX?: number;
  imagePositionY?: number;
  imageZoom?: number;
  isLocked?: boolean;
}

export interface CardNewsResult {
  topic: string;
  contentType: GeneratedContentType;
  contentTypeLabel: string;
  caption: string;
  captionVariants?: CaptionVariants;
  hashtags: string[];
  references: ReferenceItem[];
  factWarnings?: string[];
  titleCandidates?: string[];
  slides: CardSlide[];
}
