"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import type {
  Audience,
  CaptionVariantKey,
  CardVisualKind,
  CardLayout,
  CardNewsResult,
  ContentMode,
  ContentTone,
  ImageMode,
  ImageRequestMode,
} from "@/lib/types";

const audiences: Audience[] = [
  "20대",
  "30대",
  "40대",
  "50대",
  "20~30대",
  "30~40대",
  "40~50대",
  "20~50대 전체",
];

const modeOptions: Array<{ value: ContentMode; label: string; description: string }> = [
  { value: "auto", label: "자동 판단", description: "주제에 따라 정보형·에세이형·리스트형을 자동 선택" },
  { value: "quick", label: "빠른 정보형", description: "뉴스·생활정보를 3~6장으로 압축" },
  { value: "essay", label: "감성 에세이형", description: "관계·감정·인생 이야기를 8~12장으로 전개" },
  { value: "list", label: "리스트·자기계발형", description: "추천·체크리스트를 6~12장으로 정리" },
];

const toneOptions: Array<{ value: ContentTone; label: string }> = [
  { value: "magazine", label: "차분한 매거진형" },
  { value: "warm", label: "따뜻한 공감형" },
  { value: "hook", label: "강한 후킹형" },
  { value: "news", label: "담백한 뉴스·정보형" },
];

const layoutOptions: Array<{ value: CardLayout; label: string }> = [
  { value: "cover", label: "풀사진 표지" },
  { value: "split", label: "상단 글 + 하단 사진" },
  { value: "list", label: "리스트 + 하단 사진" },
  { value: "quote", label: "어두운 사진 인용문" },
  { value: "clean", label: "흰 배경 텍스트" },
];

const STORAGE_KEY = "instacard-editorial-v3-result";
const HANDLE_KEY = "instacard-account-handle";
const PROJECTS_KEY = "instacard-projects-v16";
const PRESETS_KEY = "instacard-presets-v16";
const SETTINGS_KEY = "instacard-settings-v16";
const USAGE_KEY = "instacard-usage-v16";

function downloadFile(data: string | Blob, filename: string) {
  const href = typeof data === "string" ? data : URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (data instanceof Blob) {
    window.setTimeout(() => URL.revokeObjectURL(href), 1500);
  }
}

async function dataUrlToFile(dataUrl: string, filename: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: "image/png" });
}

function fallbackBackground(index: number) {
  const options = [
    "linear-gradient(145deg,#405047,#17201c 70%)",
    "linear-gradient(145deg,#5c4e49,#211b19 70%)",
    "linear-gradient(145deg,#38434d,#141a20 70%)",
    "linear-gradient(145deg,#5d5861,#201e23 70%)",
    "linear-gradient(145deg,#6c6656,#242219 70%)",
  ];
  return options[index % options.length];
}

function compactLength(value: string) {
  return value.replace(/\s+/g, "").length;
}

function titleSizeClass(title: string, layout: CardLayout) {
  const length = compactLength(title);
  if (layout === "cover") {
    if (length >= 44) return "title-xs";
    if (length >= 31) return "title-sm";
    return "";
  }
  if (length >= 52) return "title-xs";
  if (length >= 36) return "title-sm";
  return "";
}

function bodySizeClass(body: string, layout: CardLayout) {
  const length = compactLength(body);
  if (layout === "quote") {
    if (length >= 105) return "body-xs";
    if (length >= 76) return "body-sm";
    return "";
  }
  if (length >= 165) return "body-xs";
  if (length >= 115) return "body-sm";
  return "";
}

function HighlightedText({ text, highlight }: { text: string; highlight?: string }) {
  const keyword = highlight?.trim();
  if (!keyword || !text.includes(keyword)) return <>{text}</>;
  const [before, ...rest] = text.split(keyword);
  return (
    <>
      {before}
      <span className="highlight-text">{keyword}</span>
      {rest.join(keyword)}
    </>
  );
}

function normalizeHandle(value: string) {
  const trimmed = value.trim().replace(/^@/, "");
  return trimmed ? `@${trimmed}` : "@YOUR_ACCOUNT";
}

function protectQuotedTitlePhrases(text: string) {
  return text.replace(
    /([‘“'\"])(.+?)([’”'\"])([가-힣]*)/g,
    (match) => match.replace(/\s+/g, "\u00A0"),
  );
}

function titleLinePenalty(line: string, nextLineStart = "") {
  const length = compactLength(line);
  let penalty = 0;

  if (length < 5) penalty += (5 - length) * 24;
  if (length > 18) penalty += (length - 18) * 16;
  if (/(?:의|과|와|및|또는|그리고|하지만|때문에)$/.test(line)) penalty += 45;
  if (/^(?:수|때|것|점|중|및|과|와)$/.test(nextLineStart)) penalty += 42;

  return penalty;
}

function splitSemanticTitle(title: string, preferredLines = 2) {
  const protectedTitle = protectQuotedTitlePhrases(title.trim());
  const words = protectedTitle.split(/ +/).filter(Boolean);
  if (words.length <= 1) return protectedTitle;

  const totalLength = compactLength(protectedTitle);
  const lineCount = Math.min(3, totalLength >= 39 ? 3 : Math.max(1, preferredLines));
  if (lineCount === 1) return protectedTitle;

  type Candidate = { lines: string[]; score: number };
  const candidates: Candidate[] = [];

  function collect(startIndex: number, lines: string[]) {
    const remainingLines = lineCount - lines.length;

    if (remainingLines === 1) {
      const finalLine = words.slice(startIndex).join(" ");
      if (!finalLine) return;
      const result = [...lines, finalLine];
      const lengths = result.map(compactLength);
      const target = totalLength / result.length;
      const balanceScore = lengths.reduce((sum, length) => sum + Math.pow(length - target, 2), 0);
      const maxLengthScore = Math.max(...lengths) * 1.8;
      const semanticScore = result.reduce((sum, line, index) => {
        const nextStart = result[index + 1]?.split(/ +/)[0] ?? "";
        return sum + titleLinePenalty(line, nextStart);
      }, 0);
      const quoteBreakBonus = result.reduce((bonus, line, index) => {
        const next = result[index + 1] ?? "";
        return bonus + (/^[‘“'\"]/.test(next) ? -18 : 0) + (/[’”'\"](?:이자|이며|이고|인)?$/.test(line) ? -10 : 0);
      }, 0);
      candidates.push({ lines: result, score: balanceScore + maxLengthScore + semanticScore + quoteBreakBonus });
      return;
    }

    const maxEnd = words.length - (remainingLines - 1);
    for (let endIndex = startIndex + 1; endIndex <= maxEnd; endIndex += 1) {
      const line = words.slice(startIndex, endIndex).join(" ");
      const length = compactLength(line);
      if (length > 22 && endIndex > startIndex + 1) break;
      collect(endIndex, [...lines, line]);
    }
  }

  collect(0, []);
  const best = candidates.sort((a, b) => a.score - b.score)[0];
  return (best?.lines ?? [protectedTitle]).join("\n");
}

function formatCoverTitle(title: string) {
  const original = title.trim();
  if (!original || original.includes("\n")) return protectQuotedTitlePhrases(original);

  const commaIndex = original.indexOf(",");
  if (commaIndex > 0 && commaIndex <= 14) {
    const firstLine = protectQuotedTitlePhrases(original.slice(0, commaIndex + 1).trim());
    const remainder = original.slice(commaIndex + 1).trim();
    const rest = splitSemanticTitle(remainder, compactLength(remainder) >= 17 ? 2 : 1);
    return `${firstLine}\n${rest}`.split("\n").slice(0, 3).join("\n");
  }

  return splitSemanticTitle(original, compactLength(original) >= 28 ? 3 : 2);
}

function formatCardTitle(title: string, layout: CardLayout) {
  const original = title.trim();
  if (!original || original.includes("\n")) return protectQuotedTitlePhrases(original);
  if (layout === "cover") return formatCoverTitle(original);

  if (compactLength(original) < 13) return protectQuotedTitlePhrases(original);
  return splitSemanticTitle(original, compactLength(original) >= 31 ? 3 : 2);
}

function formatArrowSequence(text: string, maxCompactLength = 20) {
  const parts = text.split("→").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return text;

  const lines: string[] = [];
  let current = parts[0];
  for (const part of parts.slice(1)) {
    const candidate = `${current} → ${part}`;
    if (compactLength(candidate) > maxCompactLength && current) {
      lines.push(`${current} →`);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

function formatEditorialBody(body: string, layout: CardLayout) {
  const original = body.trim();
  if (!original) return original;
  if (original.includes("\n")) return original;

  let prepared = original
    .replace(/,\s*(이 흐름|이 순서|이 과정을|이것만|이 점을)/g, ".\n$1")
    .replace(/([.!?])\s+(?=[가-힣A-Za-z0-9])/g, "$1\n");

  if (prepared.includes("→")) {
    prepared = prepared
      .split("\n")
      .map((line) => line.includes("→") ? formatArrowSequence(line, layout === "quote" ? 14 : 22) : line)
      .join("\n");
  }

  return prepared;
}

function normalizeHighlight(value?: string) {
  return (value ?? "").replace(/\s+/g, " ").replace(/[“”"']/g, "").trim();
}

function getQuoteParts(body: string, highlight?: string) {
  const cleanedBody = body.replace(/\s+/g, " ").trim();
  const emphasis = normalizeHighlight(highlight);
  if (!emphasis) return { lead: cleanedBody, emphasis: "" };

  if (!cleanedBody.includes(emphasis)) {
    return { lead: cleanedBody, emphasis };
  }

  const index = cleanedBody.indexOf(emphasis);
  const before = cleanedBody.slice(0, index).trim();
  const after = cleanedBody.slice(index + emphasis.length).trim();
  const trailing = after && compactLength(after) <= 10 ? ` ${after}` : "";
  const lead = before;
  const emphasisLine = `${emphasis}${trailing}`.trim();

  if (!lead) return { lead: "", emphasis: emphasisLine };
  return { lead, emphasis: emphasisLine };
}



type HookStrength = "soft" | "balanced" | "strong";
type CtaStyle = "soft" | "save" | "engage" | "follow";
type ProjectVersion = {
  id: string;
  createdAt: string;
  settings: StudioSettings;
  result: CardNewsResult | null;
};
type SavedProject = {
  id: string;
  name: string;
  favorite: boolean;
  updatedAt: string;
  versions: ProjectVersion[];
};
type SavedPreset = {
  id: string;
  name: string;
  updatedAt: string;
  settings: StudioSettings;
};
type StudioSettings = {
  topic: string;
  audience: Audience;
  mode: ContentMode;
  tone: ContentTone;
  imageMode: ImageMode;
  accountHandle: string;
  brandName: string;
  category: string;
  hookStrength: HookStrength;
  ctaStyle: CtaStyle;
  captionStyle: CaptionVariantKey;
  avoidPhrases: string;
  mustInclude: string;
  factCheck: boolean;
  safeArea: boolean;
  brandLocked: boolean;
  dailyGenerationLimit: number;
  aiImageLimit: number;
};

type AssistResponse = {
  slide?: Partial<CardNewsResult["slides"][number]>;
  titleCandidates?: string[];
  captionVariants?: CardNewsResult["captionVariants"];
  hashtags?: string[];
  error?: string;
};

const categoryOptions = [
  ["auto", "자동 판단"],
  ["news", "뉴스·정보"],
  ["checklist", "체크리스트"],
  ["emotional", "감성·연애"],
  ["growth", "자기계발"],
  ["lifestyle", "생활·건강"],
  ["finance", "돈·소비"],
  ["work", "직장·공부"],
  ["travel", "여행·취미"],
  ["beauty", "뷰티·패션"],
  ["digital", "디지털·SNS"],
] as const;

const visualOptions: Array<{ value: CardVisualKind; label: string }> = [
  { value: "auto", label: "자동 선택" },
  { value: "none", label: "미니 그림 없음" },
  { value: "airflow", label: "바람·환기" },
  { value: "water", label: "물·배수" },
  { value: "power", label: "전기·전원" },
  { value: "warning", label: "경고·주의" },
  { value: "check", label: "체크리스트" },
  { value: "spark", label: "강조·반짝임" },
  { value: "target", label: "목표·기준" },
  { value: "steps", label: "단계·성장" },
  { value: "heart", label: "감정·연애" },
  { value: "chat", label: "대화·소통" },
  { value: "connection", label: "관계·연결" },
  { value: "distance", label: "거리·경계" },
  { value: "wallet", label: "돈·지갑" },
  { value: "chart", label: "그래프·성과" },
  { value: "receipt", label: "영수증·소비" },
  { value: "calculator", label: "계산·비교" },
  { value: "laptop", label: "업무·노트북" },
  { value: "document", label: "문서·정보" },
  { value: "mail", label: "메일·연락" },
  { value: "book", label: "책·공부" },
  { value: "timer", label: "시간·집중" },
  { value: "plane", label: "비행기·여행" },
  { value: "map", label: "지도·위치" },
  { value: "luggage", label: "짐·준비" },
  { value: "camera", label: "사진·콘텐츠" },
  { value: "home", label: "집·생활" },
  { value: "health", label: "건강·심장" },
  { value: "sleep", label: "수면·휴식" },
  { value: "meal", label: "식사·영양" },
  { value: "exercise", label: "운동·활동" },
  { value: "beauty", label: "뷰티·관리" },
  { value: "phone", label: "휴대폰·SNS" },
  { value: "search", label: "검색·확인" },
  { value: "calendar", label: "날짜·일정" },
  { value: "bell", label: "알림·뉴스" },
  { value: "compare", label: "비교·선택" },
  { value: "idea", label: "아이디어·팁" },
  { value: "lock", label: "보안·잠금" },
  { value: "shield", label: "안전·보호" },
  { value: "leaf", label: "자연·환경" },
  { value: "temperature", label: "온도·날씨" },
  { value: "cleaning", label: "청소·정리" },
  { value: "shopping", label: "쇼핑·제품" },
];

function normalizeResult(result: CardNewsResult): CardNewsResult {
  return {
    ...result,
    captionVariants: result.captionVariants ?? { auto: result.caption },
    factWarnings: result.factWarnings ?? [],
    titleCandidates: result.titleCandidates ?? [],
    slides: result.slides.map((slide, index) => ({
      ...slide,
      id: slide.id || `slide-${Date.now()}-${index}`,
      index: index + 1,
      visualKind: slide.visualKind ?? "auto",
      visualEnabled: slide.visualEnabled ?? true,
      imagePositionX: slide.imagePositionX ?? 50,
      imagePositionY: slide.imagePositionY ?? 50,
      imageZoom: slide.imageZoom ?? 100,
      isLocked: slide.isLocked ?? false,
    })),
  };
}

function cloneResult(result: CardNewsResult) {
  return JSON.parse(JSON.stringify(result)) as CardNewsResult;
}

function makeSettings(payload: Partial<StudioSettings> = {}): StudioSettings {
  return {
    topic: payload.topic ?? "외로워서 시작한 연애가 나를 더 외롭게 만들 때",
    audience: payload.audience ?? "20~50대 전체",
    mode: payload.mode ?? "auto",
    tone: payload.tone ?? "magazine",
    imageMode: payload.imageMode ?? "economy",
    accountHandle: payload.accountHandle ?? "@nuve_studio",
    brandName: payload.brandName ?? "Nuvé Studio",
    category: payload.category ?? "auto",
    hookStrength: payload.hookStrength ?? "balanced",
    ctaStyle: payload.ctaStyle ?? "soft",
    captionStyle: payload.captionStyle ?? "auto",
    avoidPhrases: payload.avoidPhrases ?? "",
    mustInclude: payload.mustInclude ?? "",
    factCheck: payload.factCheck ?? true,
    safeArea: payload.safeArea ?? false,
    brandLocked: payload.brandLocked ?? false,
    dailyGenerationLimit: payload.dailyGenerationLimit ?? 30,
    aiImageLimit: payload.aiImageLimit ?? 6,
  };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function shortenText(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trim()}…`;
}

function estimateCostText(mode: ContentMode, imageMode: ImageMode, aiImageLimit: number) {
  const slides = mode === "essay" ? "8~12장" : mode === "list" ? "6~12장" : mode === "quick" ? "3~6장" : "3~12장";
  if (imageMode === "none") return `텍스트 중심 · ${slides} · 이미지 생성 비용 없음`;
  if (imageMode === "economy") return `절약형 · 표지 AI 이미지 1장 · ${slides}`;
  if (imageMode === "pexels") return `무료 사진 검색 중심 · ${slides}`;
  return `고화질형 · AI 이미지는 최대 ${aiImageLimit}장까지만 자동 적용 · ${slides}`;
}

function buildCta(style: CtaStyle) {
  if (style === "save") return "필요할 때 다시 볼 수 있게 저장해두세요.";
  if (style === "engage") return "너라면 무엇부터 해볼지 댓글로 남겨줘.";
  if (style === "follow") return "이런 카드뉴스를 계속 보고 싶다면 팔로우해줘.";
  return "오늘 한 가지라도 가볍게 실천해보면 충분합니다.";
}

function detectCardVisual(slide: CardNewsResult["slides"][number], index: number): CardVisualKind {
  if (slide.visualEnabled === false) return "none";
  if (slide.visualKind && slide.visualKind !== "auto") return slide.visualKind;

  const text = `${slide.eyebrow} ${slide.title} ${slide.body} ${(slide.items ?? []).join(" ")}`;
  const rules: Array<[RegExp, CardVisualKind]> = [
    [/배수|호스|누수|물기|수분|물\b|세척|습기|샤워|세안/, "water"],
    [/배선|전선|전원|전기|콘센트|플러그|차단기|충전/, "power"],
    [/화재|폭발|가스|위험|주의|경고|사고|금지/, "warning"],
    [/통풍|바람|환기|과열|냉방|공기|실외기|에어컨/, "airflow"],
    [/온도|더위|추위|날씨|기온|냉장|보온/, "temperature"],
    [/청소|정리|먼지|빨래|세탁|수납|위생/, "cleaning"],
    [/건강|병원|통증|심장|혈압|진료|약|영양제/, "health"],
    [/잠|수면|숙면|피로|휴식|밤/, "sleep"],
    [/식사|음식|영양|단백질|칼로리|요리|간식/, "meal"],
    [/운동|러닝|헬스|근육|스트레칭|체중/, "exercise"],
    [/연애|사랑|감정|마음|호감|이별|외로움/, "heart"],
    [/대화|말|소통|댓글|질문|답장|연락/, "chat"],
    [/관계|연결|인맥|친구|가족|동료/, "connection"],
    [/거리|경계|간격|선긋기|멀어|가까이/, "distance"],
    [/돈|저축|지갑|현금|수입|예산|재테크/, "wallet"],
    [/가격|영수증|지출|소비|결제|할인/, "receipt"],
    [/계산|세금|퍼센트|비율|수수료|금액/, "calculator"],
    [/그래프|상승|하락|성과|조회수|수익|통계/, "chart"],
    [/직장|업무|컴퓨터|노트북|재택|회사/, "laptop"],
    [/문서|자료|요약|보고서|정보|정책/, "document"],
    [/메일|이메일|문의|회신|연락처/, "mail"],
    [/공부|책|독서|시험|학습|자격증/, "book"],
    [/시간|집중|마감|분|초|타이머/, "timer"],
    [/비행기|항공|공항|출국|입국|여행/, "plane"],
    [/지도|위치|지역|근처|주소|길찾기/, "map"],
    [/짐|수하물|가방|준비물|캐리어/, "luggage"],
    [/사진|카메라|촬영|영상|릴스|쇼츠/, "camera"],
    [/집|주거|방|욕실|주방|이사/, "home"],
    [/피부|화장품|세안|머리|헤어|향수|뷰티/, "beauty"],
    [/휴대폰|스마트폰|인스타|스레드|SNS|앱/, "phone"],
    [/검색|찾기|확인|조사|비교 검색/, "search"],
    [/날짜|일정|예약|캘린더|주간|월간/, "calendar"],
    [/알림|속보|뉴스|업데이트|공지/, "bell"],
    [/비교|차이|장단점|선택|대안/, "compare"],
    [/아이디어|팁|방법|요령|추천|노하우/, "idea"],
    [/잠금|비밀번호|보안|인증|계정/, "lock"],
    [/보호|보험|안전|예방|대처/, "shield"],
    [/환경|자연|식물|친환경|재활용/, "leaf"],
    [/쇼핑|제품|구매|쿠팡|아마존|리뷰/, "shopping"],
    [/루틴|순서|단계|습관|과정|성장/, "steps"],
    [/목표|기준|핵심|중심|포인트/, "target"],
  ];

  for (const [pattern, kind] of rules) {
    if (pattern.test(text)) return kind;
  }
  if (slide.layout === "list") return "check";
  if (slide.layout === "quote") return "spark";
  return (["target", "steps", "check", "idea"] as CardVisualKind[])[index % 4];
}

function GenericVisual({ kind }: { kind: CardVisualKind }) {
  const common = { className: "visual-ink" };
  const accent = { className: "visual-accent" };

  switch (kind) {
    case "heart": return <><path {...common} d="M90 82 40 44c-18-14-5-43 17-35 14 5 25 19 33 31 8-12 19-26 33-31 22-8 35 21 17 35Z" /><path {...accent} d="M54 27c9-8 18-2 24 7" /></>;
    case "chat": return <><path {...common} d="M34 22h112v54H82L58 92V76H34Z" /><path {...common} d="M55 43h70M55 58h47" /><circle className="visual-accent-fill" cx="132" cy="58" r="5" /></>;
    case "connection": return <><circle {...common} cx="52" cy="50" r="22" /><circle {...common} cx="128" cy="50" r="22" /><path {...accent} d="M74 50h32m-9-8 9 8-9 8" /></>;
    case "distance": return <><path {...common} d="M42 24v58M138 24v58" /><path {...accent} d="M55 52h70m-62-8-8 8 8 8m54-16 8 8-8 8" /><circle className="visual-ink-fill" cx="42" cy="24" r="5" /><circle className="visual-ink-fill" cx="138" cy="82" r="5" /></>;
    case "wallet": return <><rect {...common} x="31" y="27" width="118" height="58" rx="9" /><path {...common} d="M31 40h103c10 0 15 7 15 16v12h-36c-13 0-13-21 0-21h36" /><circle className="visual-accent-fill" cx="119" cy="57" r="4" /></>;
    case "chart": return <><path {...common} d="M30 82V18M30 82h128" /><path {...accent} d="M42 69 70 52l23 9 35-35 26 8" /><circle className="visual-accent-fill" cx="128" cy="26" r="5" /></>;
    case "receipt": return <><path {...common} d="M52 15h76v72l-10-7-9 7-9-7-10 7-9-7-10 7-9-7-10 7Z" /><path {...common} d="M68 35h44M68 49h44M68 63h28" /><path {...accent} d="M105 63h7" /></>;
    case "calculator": return <><rect {...common} x="57" y="13" width="66" height="78" rx="8" /><rect {...common} x="69" y="25" width="42" height="15" rx="2" /><circle className="visual-ink-fill" cx="73" cy="55" r="4" /><circle className="visual-ink-fill" cx="90" cy="55" r="4" /><circle className="visual-accent-fill" cx="107" cy="55" r="4" /><circle className="visual-ink-fill" cx="73" cy="72" r="4" /><circle className="visual-ink-fill" cx="90" cy="72" r="4" /><circle className="visual-accent-fill" cx="107" cy="72" r="4" /></>;
    case "laptop": return <><rect {...common} x="47" y="18" width="86" height="57" rx="5" /><path {...common} d="M32 82h116l-10 8H42Z" /><path {...accent} d="m76 47 10 10 21-24" /></>;
    case "document": return <><path {...common} d="M57 12h48l20 20v58H57Z" /><path {...common} d="M105 12v20h20M72 48h38M72 61h38M72 74h24" /><path {...accent} d="M42 37h9M42 52h9M42 67h9" /></>;
    case "mail": return <><rect {...common} x="32" y="24" width="116" height="63" rx="6" /><path {...common} d="m34 30 56 40 56-40" /><path {...accent} d="m42 80 35-31m61 31-35-31" /></>;
    case "book": return <><path {...common} d="M30 22c25-8 45-2 60 10v58c-15-12-35-18-60-10Zm120 0c-25-8-45-2-60 10v58c15-12 35-18 60-10Z" /><path {...accent} d="M90 32v58" /></>;
    case "timer": return <><circle {...common} cx="90" cy="57" r="34" /><path {...common} d="M90 23V12M75 12h30M90 57l18-14" /><path {...accent} d="M127 28l9-9" /><circle className="visual-accent-fill" cx="90" cy="57" r="4" /></>;
    case "plane": return <><path {...common} d="m25 56 130-32-43 37 12 28-16 4-22-24-30 13-10-8 28-21-49 3Z" /><path {...accent} d="M126 20l15-4" /></>;
    case "map": return <><path {...common} d="m28 25 41-12 42 12 41-12v66l-41 12-42-12-41 12Z" /><path {...common} d="M69 13v66M111 25v66" /><path {...accent} d="M95 42c0 13-14 24-14 24S67 55 67 42c0-18 28-18 28 0Z" /><circle className="visual-accent-fill" cx="81" cy="42" r="4" /></>;
    case "luggage": return <><rect {...common} x="53" y="26" width="74" height="60" rx="9" /><path {...common} d="M74 26v-9h32v9M75 39v34M105 39v34" /><circle className="visual-ink-fill" cx="70" cy="91" r="4" /><circle className="visual-ink-fill" cx="110" cy="91" r="4" /><path {...accent} d="M90 41v30" /></>;
    case "camera": return <><rect {...common} x="30" y="29" width="120" height="60" rx="8" /><path {...common} d="M55 29l10-14h50l10 14" /><circle {...common} cx="90" cy="59" r="20" /><circle className="visual-accent-fill" cx="90" cy="59" r="7" /><circle className="visual-ink-fill" cx="132" cy="42" r="4" /></>;
    case "home": return <><path {...common} d="m27 50 63-38 63 38M42 43v47h96V43" /><path {...common} d="M76 90V60h28v30" /><path {...accent} d="M118 28v-13h13v21" /></>;
    case "health": return <><path {...common} d="M90 87 45 52c-22-17-5-50 20-39 11 5 19 16 25 27 6-11 14-22 25-27 25-11 42 22 20 39Z" /><path {...accent} d="M41 53h29l8-15 13 31 10-20 7 12h31" /></>;
    case "sleep": return <><path {...common} d="M109 18c-23 5-36 29-26 51 10 22 38 29 57 13-12 5-29-1-37-15-9-16-6-37 6-49Z" /><path {...accent} d="M47 28h24L51 49h24M35 61h18L39 78h18" /></>;
    case "meal": return <><circle {...common} cx="91" cy="55" r="31" /><circle {...accent} cx="91" cy="55" r="18" /><path {...common} d="M43 19v68M33 19v25c0 13 20 13 20 0V19M139 19v68M139 19c15 16 15 34 0 41" /></>;
    case "exercise": return <><path {...common} d="M34 34v32M46 26v48M134 34v32M146 26v48M46 50h88" /><path {...accent} d="M68 28v44M112 28v44" /></>;
    case "beauty": return <><path {...common} d="M58 22h64v67H58Z" /><path {...common} d="M68 22V12h44v10M72 39h36M90 39v37" /><path {...accent} d="m90 50-8 11 8 11 8-11Z" /></>;
    case "phone": return <><rect {...common} x="62" y="10" width="56" height="82" rx="9" /><path {...common} d="M76 22h28M83 80h14" /><path {...accent} d="M78 47h24M90 35v24" /></>;
    case "search": return <><circle {...common} cx="74" cy="44" r="28" /><path {...common} d="m94 64 35 27" /><path {...accent} d="M62 44h24M74 32v24" /></>;
    case "calendar": return <><rect {...common} x="41" y="22" width="98" height="68" rx="7" /><path {...common} d="M41 42h98M63 13v18M117 13v18" /><circle className="visual-accent-fill" cx="69" cy="59" r="5" /><circle className="visual-ink-fill" cx="91" cy="59" r="5" /><circle className="visual-ink-fill" cx="113" cy="59" r="5" /><circle className="visual-ink-fill" cx="69" cy="76" r="5" /></>;
    case "bell": return <><path {...common} d="M52 72h76l-10-14V42c0-17-12-28-28-28S62 25 62 42v16Z" /><path {...common} d="M78 78c2 12 22 12 24 0" /><path {...accent} d="M42 23 31 12M138 23l11-11" /></>;
    case "compare": return <><rect {...common} x="27" y="24" width="50" height="58" rx="7" /><rect {...common} x="103" y="24" width="50" height="58" rx="7" /><path {...accent} d="M82 42h16m-8-8 8 8-8 8M98 65H82m8-8-8 8 8 8" /></>;
    case "idea": return <><path {...common} d="M90 12c-22 0-37 17-37 37 0 15 8 25 20 34h34c12-9 20-19 20-34 0-20-15-37-37-37Z" /><path {...common} d="M74 84h32M78 93h24" /><path {...accent} d="M90 28v30M77 46h26" /></>;
    case "lock": return <><rect {...common} x="48" y="43" width="84" height="49" rx="8" /><path {...common} d="M66 43V29c0-31 48-31 48 0v14" /><circle className="visual-accent-fill" cx="90" cy="64" r="6" /><path {...accent} d="M90 70v10" /></>;
    case "shield": return <><path {...common} d="M90 10 136 27v27c0 21-16 34-46 43-30-9-46-22-46-43V27Z" /><path {...accent} d="m68 53 14 14 31-34" /></>;
    case "leaf": return <><path {...common} d="M139 15C85 13 45 34 45 67c0 27 38 30 59 10 19-18 25-42 35-62Z" /><path {...accent} d="M45 86c22-27 45-42 76-57M81 58l-4-20M96 47l17 4" /></>;
    case "temperature": return <><path {...common} d="M78 17v45a21 21 0 1 0 24 0V17a12 12 0 0 0-24 0Z" /><path {...accent} d="M90 32v42" /><circle className="visual-accent-fill" cx="90" cy="76" r="10" /><path {...common} d="M121 29h23M121 48h17" /></>;
    case "cleaning": return <><path {...common} d="M55 18h70l-8 73H63Z" /><path {...common} d="M75 18v-8h30v8M71 38h38" /><path {...accent} d="M135 25c4 14 11 21 25 25-14 4-21 11-25 25-4-14-11-21-25-25 14-4 21-11 25-25Z" /></>;
    case "shopping": return <><path {...common} d="M48 35h84l-6 56H54Z" /><path {...common} d="M70 35c0-27 40-27 40 0" /><path {...accent} d="M75 58h30M90 43v30" /></>;
    default: return <><path {...common} d="M90 13c4 23 16 35 39 39-23 4-35 16-39 39-4-23-16-35-39-39 23-4 35-16 39-39Z" /><path {...accent} d="M143 16v18M134 25h18M38 69v14M31 76h14" /></>;
  }
}

function CardVisual({ kind, compact = false, dark = false }: { kind: CardVisualKind; compact?: boolean; dark?: boolean }) {
  if (kind === "none") return null;
  const className = `card-visual visual-${kind}${compact ? " is-compact" : ""}${dark ? " is-dark" : ""}`;

  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 180 100" role="presentation">
        {kind === "airflow" ? <>
          <rect className="visual-ink" x="60" y="24" width="60" height="52" rx="6" />
          <circle className="visual-ink" cx="90" cy="50" r="17" />
          <path className="visual-ink" d="M90 34c9 5 10 12 2 17M106 50c-5 9-12 10-17 2M90 66c-9-5-10-12-2-17M74 50c5-9 12-10 17-2" />
          <path className="visual-ink" d="M44 42H18m0 0 8-7m-8 7 8 7M136 58h26m0 0-8-7m8 7-8 7" />
          <circle className="visual-accent" cx="90" cy="50" r="28" strokeDasharray="4 5" />
        </> : kind === "water" ? <>
          <path className="visual-ink" d="M54 18v20h48c18 0 27 10 27 26v17" />
          <path className="visual-ink" d="M47 18h14M122 81h14" />
          <path className="visual-ink" d="M43 56c0 8-10 8-10 0 0-4 5-10 5-10s5 6 5 10ZM68 76c0 9-11 9-11 0 0-5 5.5-11 5.5-11S68 71 68 76Z" />
          <path className="visual-accent" d="M130 62c0 12-15 12-15 0 0-6 7.5-15 7.5-15S130 56 130 62Z" />
        </> : kind === "power" ? <>
          <rect className="visual-ink" x="67" y="20" width="46" height="43" rx="7" />
          <path className="visual-ink" d="M78 20V9M102 20V9M90 63v16c0 8 7 12 17 12h18" />
          <path className="visual-accent" d="m91 31-8 13h9l-4 12 13-17h-9l5-8Z" />
        </> : kind === "warning" ? <>
          <path className="visual-ink" d="M90 15 144 83H36Z" />
          <path className="visual-ink" d="M90 36v24" />
          <circle className="visual-ink-fill" cx="90" cy="70" r="3.5" />
          <path className="visual-accent" d="M145 22l8-8M151 36h12M35 24l-8-8M29 38H17" />
        </> : kind === "check" ? <>
          <circle className="visual-ink-fill" cx="42" cy="27" r="14" />
          <path className="visual-check" d="m35 27 5 5 10-12" />
          <path className="visual-ink" d="M68 22h76M68 32h52" />
          <circle className="visual-ink-fill" cx="42" cy="70" r="14" />
          <path className="visual-check" d="m35 70 5 5 10-12" />
          <path className="visual-ink" d="M68 65h76M68 75h60" />
        </> : kind === "target" ? <>
          <circle className="visual-ink" cx="82" cy="53" r="34" />
          <circle className="visual-ink" cx="82" cy="53" r="20" />
          <circle className="visual-accent-fill" cx="82" cy="53" r="6" />
          <path className="visual-ink" d="M106 29l40-18m0 0-6 13m6-13-14-3" />
        </> : kind === "steps" ? <>
          <path className="visual-ink" d="M30 80h34V62h34V44h34V26h22" />
          <path className="visual-accent" d="M43 67 75 49l31 5 42-35m0 0-3 15m3-15-15 3" />
        </> : <GenericVisual kind={kind} />}
      </svg>
    </div>
  );
}

function makeNewSlide(index: number): CardNewsResult["slides"][number] {
  return {
    id: `slide-${Date.now()}-${index}`,
    index: index + 1,
    layout: "clean",
    eyebrow: "NEW CARD",
    title: "새 카드 제목",
    body: "이곳에 내용을 입력해 주세요.",
    highlight: "",
    items: [],
    itemStart: 1,
    imagePrompt: "minimal editorial lifestyle photography, no text, no logo",
    searchQuery: "minimal lifestyle",
    visualKind: "auto",
    visualEnabled: true,
    imagePositionX: 50,
    imagePositionY: 50,
    imageZoom: 100,
    isLocked: false,
  };
}

function staticQualityChecks(result: CardNewsResult) {
  const messages: string[] = [];
  result.slides.forEach((slide, index) => {
    if (compactLength(slide.title) > 44) messages.push(`${index + 1}번 카드 제목이 길어. 36자 안쪽이 안전해.`);
    if (slide.layout !== "list" && compactLength(slide.body) > 175) messages.push(`${index + 1}번 카드 본문이 길어서 잘릴 수 있어.`);
    if (slide.layout === "list" && (slide.items?.length ?? 0) < 3) messages.push(`${index + 1}번 리스트 카드 항목을 3개 이상으로 채우는 게 좋아.`);
    if ((slide.layout === "cover" || slide.layout === "quote") && !slide.imageUrl) messages.push(`${index + 1}번 사진 카드에 실제 사진이 없어.`);
  });
  for (let index = 0; index < result.slides.length - 2; index += 1) {
    const layout = result.slides[index].layout;
    if (layout === result.slides[index + 1].layout && layout === result.slides[index + 2].layout) {
      messages.push(`${index + 1}~${index + 3}번 카드 레이아웃이 연속 반복돼.`);
      break;
    }
  }
  if (!result.references.length && /세금|법률|건강|의학|가격|정책|뉴스|통계/.test(result.topic)) {
    messages.push("사실 확인이 필요한 주제인데 표시된 출처가 없어. 출처를 다시 확인해줘.");
  }
  return messages;
}

async function waitForCardReady(node: HTMLElement) {
  if ("fonts" in document) await document.fonts.ready;
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(images.map((image) => image.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      })));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export default function GeneratorApp() {
  const [topic, setTopic] = useState("외로워서 시작한 연애가 나를 더 외롭게 만들 때");
  const [audience, setAudience] = useState<Audience>("20~50대 전체");
  const [mode, setMode] = useState<ContentMode>("auto");
  const [tone, setTone] = useState<ContentTone>("magazine");
  const [imageMode, setImageMode] = useState<ImageMode>("economy");
  const [accountHandle, setAccountHandle] = useState("@nuve_studio");
  const [brandName, setBrandName] = useState("Nuvé Studio");
  const [category, setCategory] = useState("auto");
  const [hookStrength, setHookStrength] = useState<HookStrength>("balanced");
  const [ctaStyle, setCtaStyle] = useState<CtaStyle>("soft");
  const [captionStyle, setCaptionStyle] = useState<CaptionVariantKey>("auto");
  const [avoidPhrases, setAvoidPhrases] = useState("");
  const [mustInclude, setMustInclude] = useState("");
  const [factCheck, setFactCheck] = useState(true);
  const [safeArea, setSafeArea] = useState(false);
  const [brandLocked, setBrandLocked] = useState(false);
  const [dailyGenerationLimit, setDailyGenerationLimit] = useState(30);
  const [aiImageLimit, setAiImageLimit] = useState(6);
  const [projectName, setProjectName] = useState("Nuvé Studio 초안");
  const [projectSearch, setProjectSearch] = useState("");
  const [presetName, setPresetName] = useState("Nuvé Basic");
  const [result, setResult] = useState<CardNewsResult | null>(null);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>([]);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [qualityMessages, setQualityMessages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [assistLoading, setAssistLoading] = useState("");
  const [status, setStatus] = useState("");
  const [warning, setWarning] = useState("");
  const [usage, setUsage] = useState({ date: todayKey(), generations: 0, aiImages: 0 });
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const importRef = useRef<HTMLInputElement | null>(null);

  const currentSettings = useMemo(() => makeSettings({
    topic, audience, mode, tone, imageMode, accountHandle, brandName, category,
    hookStrength, ctaStyle, captionStyle, avoidPhrases, mustInclude, factCheck,
    safeArea, brandLocked, dailyGenerationLimit, aiImageLimit,
  }), [topic, audience, mode, tone, imageMode, accountHandle, brandName, category, hookStrength, ctaStyle, captionStyle, avoidPhrases, mustInclude, factCheck, safeArea, brandLocked, dailyGenerationLimit, aiImageLimit]);

  const estimatedCost = useMemo(() => estimateCostText(mode, imageMode, aiImageLimit), [mode, imageMode, aiImageLimit]);
  const filteredProjects = useMemo(() => savedProjects
    .filter((project) => project.name.toLowerCase().includes(projectSearch.toLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt)), [savedProjects, projectSearch]);

  useEffect(() => {
    const savedResult = localStorage.getItem(STORAGE_KEY);
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    const projects = localStorage.getItem(PROJECTS_KEY);
    const presets = localStorage.getItem(PRESETS_KEY);
    const savedUsage = localStorage.getItem(USAGE_KEY);

    if (savedSettings) {
      try { applySettings(makeSettings(JSON.parse(savedSettings) as Partial<StudioSettings>), false); } catch { localStorage.removeItem(SETTINGS_KEY); }
    }
    if (projects) {
      try { setSavedProjects(JSON.parse(projects) as SavedProject[]); } catch { localStorage.removeItem(PROJECTS_KEY); }
    }
    if (presets) {
      try { setSavedPresets(JSON.parse(presets) as SavedPreset[]); } catch { localStorage.removeItem(PRESETS_KEY); }
    }
    if (savedUsage) {
      try {
        const parsed = JSON.parse(savedUsage) as typeof usage;
        setUsage(parsed.date === todayKey() ? parsed : { date: todayKey(), generations: 0, aiImages: 0 });
      } catch { localStorage.removeItem(USAGE_KEY); }
    }
    if (savedResult) {
      try { setResult(normalizeResult(JSON.parse(savedResult) as CardNewsResult)); } catch { localStorage.removeItem(STORAGE_KEY); }
    }
  }, []);

  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings)); }, [currentSettings]);
  useEffect(() => { localStorage.setItem(PROJECTS_KEY, JSON.stringify(savedProjects)); }, [savedProjects]);
  useEffect(() => { localStorage.setItem(PRESETS_KEY, JSON.stringify(savedPresets)); }, [savedPresets]);
  useEffect(() => { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)); }, [usage]);
  useEffect(() => {
    if (!result) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(result)); } catch { /* uploaded data URL may exceed storage */ }
  }, [result]);

  function applySettings(settings: StudioSettings, showStatus = true) {
    setTopic(settings.topic); setAudience(settings.audience); setMode(settings.mode); setTone(settings.tone);
    setImageMode(settings.imageMode); setAccountHandle(settings.accountHandle); setBrandName(settings.brandName);
    setCategory(settings.category); setHookStrength(settings.hookStrength); setCtaStyle(settings.ctaStyle);
    setCaptionStyle(settings.captionStyle); setAvoidPhrases(settings.avoidPhrases); setMustInclude(settings.mustInclude);
    setFactCheck(settings.factCheck); setSafeArea(settings.safeArea); setBrandLocked(settings.brandLocked);
    setDailyGenerationLimit(settings.dailyGenerationLimit); setAiImageLimit(settings.aiImageLimit);
    if (showStatus) setStatus("설정을 적용했어.");
  }

  function snapshot() {
    if (!result) return;
    const serialized = JSON.stringify(result);
    setUndoStack((stack) => stack[stack.length - 1] === serialized ? stack : [...stack.slice(-29), serialized]);
    setRedoStack([]);
  }

  function replaceResult(updater: (previous: CardNewsResult) => CardNewsResult, record = true) {
    if (record) snapshot();
    setResult((previous) => previous ? normalizeResult(updater(previous)) : previous);
  }

  function patchSlide(index: number, patch: Partial<CardNewsResult["slides"][number]>, record = false) {
    replaceResult((previous) => ({
      ...previous,
      slides: previous.slides.map((slide, slideIndex) => slideIndex === index ? { ...slide, ...patch } : slide),
    }), record);
  }

  function undo() {
    if (!result || !undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-29), JSON.stringify(result)]);
    setResult(normalizeResult(JSON.parse(previous) as CardNewsResult));
  }

  function redo() {
    if (!result || !redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-29), JSON.stringify(result)]);
    setResult(normalizeResult(JSON.parse(next) as CardNewsResult));
  }

  function addSlide(afterIndex = result?.slides.length ? result.slides.length - 1 : 0) {
    if (!result) return;
    replaceResult((previous) => {
      const copy = cloneResult(previous);
      copy.slides.splice(afterIndex + 1, 0, makeNewSlide(afterIndex + 1));
      return copy;
    });
    setStatus("새 카드를 추가했어.");
  }

  function duplicateSlide(index: number) {
    if (!result) return;
    replaceResult((previous) => {
      const copy = cloneResult(previous);
      const base = copy.slides[index];
      copy.slides.splice(index + 1, 0, { ...base, id: `slide-${Date.now()}-${index}-copy`, isLocked: false });
      return copy;
    });
    setStatus(`${index + 1}번 카드를 복제했어.`);
  }

  function deleteSlide(index: number) {
    if (!result || result.slides.length <= 1) return;
    replaceResult((previous) => ({ ...previous, slides: previous.slides.filter((_, slideIndex) => slideIndex !== index) }));
    setStatus(`${index + 1}번 카드를 삭제했어.`);
  }

  function moveSlide(from: number, to: number) {
    if (!result || from === to || to < 0 || to >= result.slides.length) return;
    replaceResult((previous) => {
      const copy = cloneResult(previous);
      const [item] = copy.slides.splice(from, 1);
      copy.slides.splice(to, 0, item);
      return copy;
    });
  }

  function savePreset() {
    const preset: SavedPreset = { id: `preset-${Date.now()}`, name: presetName.trim() || "새 프리셋", updatedAt: new Date().toISOString(), settings: currentSettings };
    setSavedPresets((items) => [preset, ...items.filter((item) => item.name !== preset.name)].slice(0, 30));
    setStatus(`프리셋 “${preset.name}”을 저장했어.`);
  }

  function saveProject() {
    const name = projectName.trim() || "새 프로젝트";
    const version: ProjectVersion = { id: `version-${Date.now()}`, createdAt: new Date().toISOString(), settings: currentSettings, result };
    setSavedProjects((items) => {
      const existing = items.find((item) => item.name === name);
      if (!existing) return [{ id: `project-${Date.now()}`, name, favorite: false, updatedAt: version.createdAt, versions: [version] }, ...items].slice(0, 50);
      return items.map((item) => item.id === existing.id
        ? { ...item, updatedAt: version.createdAt, versions: [version, ...item.versions].slice(0, 15) }
        : item);
    });
    setStatus(`프로젝트 “${name}” 저장 완료. 이전 버전도 보관했어.`);
  }

  function loadProject(project: SavedProject, versionIndex = 0) {
    const version = project.versions[versionIndex];
    if (!version) return;
    setProjectName(project.name);
    applySettings(makeSettings(version.settings), false);
    setResult(version.result ? normalizeResult(version.result) : null);
    setUndoStack([]); setRedoStack([]);
    setStatus(`“${project.name}” ${versionIndex ? "이전 버전" : "최신 버전"}을 불러왔어.`);
  }

  function exportProjectJson() {
    const payload = { projectName, exportedAt: new Date().toISOString(), settings: currentSettings, result };
    downloadFile(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `${projectName.replace(/\s+/g, "-").toLowerCase() || "instacard-project"}.json`);
  }

  function importProjectJson(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result ?? "{}")) as { projectName?: string; settings?: Partial<StudioSettings>; result?: CardNewsResult | null };
        if (data.projectName) setProjectName(data.projectName);
        if (data.settings) applySettings(makeSettings(data.settings), false);
        if (data.result) setResult(normalizeResult(data.result));
        setStatus("프로젝트 JSON을 불러왔어.");
      } catch { setWarning("프로젝트 JSON을 읽지 못했어."); }
    };
    reader.readAsText(file, "utf-8");
  }

  async function callAssist(payload: Record<string, unknown>) {
    const response = await fetch("/api/content-assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json() as AssistResponse;
    if (!response.ok) throw new Error(data.error ?? "AI 보조 기능에 실패했어.");
    return data;
  }

  async function suggestTitles() {
    if (!result) return;
    setAssistLoading("titles"); setWarning("");
    try {
      const data = await callAssist({ action: "titleCandidates", topic: result.topic, audience, tone, hookStrength, currentTitle: result.slides[0]?.title });
      setResult((previous) => previous ? { ...previous, titleCandidates: data.titleCandidates ?? [] } : previous);
      setStatus("표지 제목 후보를 만들었어.");
    } catch (error) { setWarning(error instanceof Error ? error.message : "제목 추천 실패"); }
    finally { setAssistLoading(""); }
  }

  async function refineSlide(index: number, instruction: string) {
    if (!result) return;
    const slide = result.slides[index];
    if (slide.isLocked) { setWarning("잠긴 카드는 먼저 잠금을 풀어줘."); return; }
    setAssistLoading(`slide-${index}`); setWarning(""); snapshot();
    try {
      const data = await callAssist({ action: "refineSlide", topic: result.topic, audience, tone, category, instruction, slide });
      if (data.slide) patchSlide(index, data.slide, false);
      setStatus(`${index + 1}번 카드만 다시 다듬었어.`);
    } catch (error) { setWarning(error instanceof Error ? error.message : "카드 수정 실패"); }
    finally { setAssistLoading(""); }
  }

  async function regenerateCaptions() {
    if (!result) return;
    setAssistLoading("caption"); setWarning("");
    try {
      const data = await callAssist({ action: "captionVariants", topic: result.topic, audience, tone, slides: result.slides, currentCaption: result.caption });
      setResult((previous) => previous ? { ...previous, captionVariants: data.captionVariants ?? previous.captionVariants, hashtags: data.hashtags ?? previous.hashtags } : previous);
      setStatus("캡션 버전을 새로 만들었어.");
    } catch (error) { setWarning(error instanceof Error ? error.message : "캡션 생성 실패"); }
    finally { setAssistLoading(""); }
  }

  async function generateImage(slideIndex: number, current: CardNewsResult, requestMode: ImageRequestMode) {
    if (requestMode === "ai" && usage.aiImages >= aiImageLimit) throw new Error(`AI 이미지 한도를 ${aiImageLimit}장으로 설정해뒀어.`);
    const slide = current.slides[slideIndex];
    setStatus(`${slideIndex + 1}번 카드 이미지를 준비하는 중...`);
    const response = await fetch("/api/generate-image", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: requestMode, layout: slide.layout, imagePrompt: slide.imagePrompt, searchQuery: slide.searchQuery }),
    });
    const data = await response.json() as { imageUrl?: string; attribution?: string; sourceUrl?: string; error?: string };
    if (!response.ok) throw new Error(data.error ?? "이미지 생성에 실패했어.");
    setResult((previous) => {
      const base = previous?.slides.some((item) => item.id === slide.id) ? previous : current;
      return normalizeResult({ ...base, slides: base.slides.map((item, index) => index === slideIndex ? { ...item, ...data } : item) });
    });
    if (requestMode === "ai") setUsage((value) => ({ ...value, date: todayKey(), aiImages: value.aiImages + 1 }));
  }

  async function applyAutomaticImages(data: CardNewsResult) {
    if (imageMode === "none") return;
    if (imageMode === "economy") { await generateImage(0, data, "ai"); return; }
    const requestMode: ImageRequestMode = imageMode === "ai" ? "ai" : "pexels";
    const max = imageMode === "ai" ? Math.min(data.slides.length, aiImageLimit - usage.aiImages) : data.slides.length;
    for (let index = 0; index < max; index += 1) {
      try { await generateImage(index, data, requestMode); }
      catch (error) { setWarning((previous) => `${previous ? `${previous}\n` : ""}${index + 1}번 이미지: ${error instanceof Error ? error.message : "실패"}`); }
    }
  }

  async function generate() {
    if (usage.date === todayKey() && usage.generations >= dailyGenerationLimit) {
      setWarning(`오늘 생성 한도 ${dailyGenerationLimit}회에 도달했어. 설정에서 한도를 바꿀 수 있어.`); return;
    }
    setLoading(true); setWarning(""); setStatus("주제와 흐름을 분석하는 중...");
    try {
      const response = await fetch("/api/generate-content", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, audience, mode, tone, category, hookStrength, ctaStyle, captionStyle, avoidPhrases, mustInclude, factCheck }),
      });
      const data = await response.json() as CardNewsResult & { error?: string; warning?: string };
      if (!response.ok) throw new Error(data.error ?? "카드뉴스 생성에 실패했어.");
      const normalized = normalizeResult(data);
      setResult(normalized); setUndoStack([]); setRedoStack([]);
      setUsage((value) => ({ date: todayKey(), generations: (value.date === todayKey() ? value.generations : 0) + 1, aiImages: value.date === todayKey() ? value.aiImages : 0 }));
      if (data.warning) setWarning(data.warning);
      await applyAutomaticImages(normalized);
      setStatus(`${data.contentTypeLabel}으로 ${data.slides.length}장을 만들었어.`);
    } catch (error) { setStatus(""); setWarning(error instanceof Error ? error.message : "생성 실패"); }
    finally { setLoading(false); }
  }

  function uploadImage(index: number, file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setWarning("이미지 파일만 올릴 수 있어."); return; }
    if (file.size > 12 * 1024 * 1024) { setWarning("이미지는 12MB 이하로 올려줘."); return; }
    snapshot();
    const reader = new FileReader();
    reader.onload = () => patchSlide(index, { imageUrl: String(reader.result ?? ""), attribution: "User uploaded image", sourceUrl: "" }, false);
    reader.onerror = () => setWarning("이미지를 읽지 못했어.");
    reader.readAsDataURL(file);
  }

  async function runQualityCheck() {
    if (!result) return;
    const messages = staticQualityChecks(result);
    if ("fonts" in document) await document.fonts.ready;
    result.slides.forEach((slide, index) => {
      const node = cardRefs.current[slide.id];
      const content = node?.querySelector<HTMLElement>(".card-content");
      if (content && (content.scrollHeight > content.clientHeight + 4 || content.scrollWidth > content.clientWidth + 4)) messages.push(`${index + 1}번 카드 글자가 영역을 넘을 가능성이 있어.`);
    });
    if (!messages.length) messages.push("출력 검사 통과 — 현재 상태로 저장해도 괜찮아 보여.");
    setQualityMessages(messages); setStatus("출력 검사를 완료했어.");
  }

  async function renderCard(index: number) {
    if (!result) throw new Error("저장할 카드가 없어.");
    const node = cardRefs.current[result.slides[index].id];
    if (!node) throw new Error("카드 화면을 찾지 못했어.");
    await waitForCardReady(node);
    return toPng(node, { pixelRatio: 2.5, cacheBust: true, backgroundColor: "#ffffff" });
  }

  async function exportOne(index: number) {
    setStatus(`${index + 1}번 카드를 PNG로 만드는 중...`);
    try { downloadFile(await renderCard(index), `instacard-${String(index + 1).padStart(2, "0")}.png`); setStatus("PNG 저장 완료."); }
    catch (error) { setWarning(error instanceof Error ? error.message : "PNG 저장 실패"); }
  }

  async function exportAllPng() {
    if (!result) return;
    try {
      const files: File[] = [];
      for (let index = 0; index < result.slides.length; index += 1) {
        setStatus(`${index + 1}/${result.slides.length} PNG 만드는 중...`);
        files.push(await dataUrlToFile(await renderCard(index), `instacard-${String(index + 1).padStart(2, "0")}.png`));
      }
      type ShareDataWithFiles = ShareData & { files: File[] };
      const shareData: ShareDataWithFiles = { files, title: `${result.topic} 카드뉴스` };
      if (navigator.share && navigator.canShare?.(shareData)) { await navigator.share(shareData); setStatus("전체 PNG 저장·공유 완료."); return; }
      const zip = new JSZip();
      for (const file of files) zip.file(file.name, file);
      downloadFile(await zip.generateAsync({ type: "blob" }), "instacard-all-png.zip");
      setStatus("브라우저의 다중 저장 제한을 피하려고 PNG ZIP으로 저장했어.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") { setStatus("저장을 취소했어."); return; }
      setWarning(error instanceof Error ? error.message : "전체 PNG 저장 실패");
    }
  }

  async function exportAll() {
    if (!result) return;
    setStatus("업로드 패키지를 만드는 중...");
    const zip = new JSZip();
    for (let index = 0; index < result.slides.length; index += 1) {
      const dataUrl = await renderCard(index);
      zip.file(`instacard-${String(index + 1).padStart(2, "0")}.png`, dataUrl.split(",")[1], { base64: true });
    }
    const hashtags = result.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ");
    const references = result.references.map((item) => `${item.title}\n${item.url}`).join("\n\n");
    const imageCredits = result.slides.map((slide, index) => slide.attribution ? `${index + 1}번: ${slide.attribution}${slide.sourceUrl ? `\n${slide.sourceUrl}` : ""}` : "").filter(Boolean).join("\n\n");
    zip.file("caption.txt", result.caption);
    zip.file("caption-threads.txt", result.captionVariants?.threads ?? "");
    zip.file("hashtags.txt", hashtags);
    zip.file("references.txt", `[정보 출처]\n${references || "없음"}\n\n[이미지 출처]\n${imageCredits || "직접 제작 또는 출처 없음"}`);
    zip.file("upload-order.txt", result.slides.map((slide, index) => `${index + 1}. ${slide.title.replace(/\n/g, " ")}`).join("\n"));
    zip.file("project.json", JSON.stringify({ projectName, settings: currentSettings, result }, null, 2));
    downloadFile(await zip.generateAsync({ type: "blob" }), "instacard-editorial-package.zip");
    setStatus("전체 패키지 저장 완료.");
  }

  function applyTitleCandidate(title: string) {
    if (!result) return;
    snapshot(); patchSlide(0, { title }, false); setStatus("표지 제목을 바꿨어.");
  }

  function applyCaptionVariant(key: CaptionVariantKey) {
    if (!result) return;
    const value = result.captionVariants?.[key];
    if (!value) return;
    setResult({ ...result, caption: value }); setCaptionStyle(key); setStatus("캡션 버전을 적용했어.");
  }

  function applyCta() {
    if (!result) return;
    const index = result.slides.length - 1;
    snapshot(); patchSlide(index, { body: buildCta(ctaStyle), highlight: ctaStyle === "soft" ? "" : buildCta(ctaStyle) }, false);
    setStatus("마지막 장 CTA를 적용했어.");
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); location.href = "/login"; }

  return (
    <main className="shell studio-v16">
      <header className="topbar">
        <div className="brand"><h1>InstaCard Editorial</h1><p>주제 분석부터 디자인·검수·저장까지 한 번에 하는 개인용 콘텐츠 스튜디오</p></div>
        <div className="actions"><button className="secondary" onClick={undo} disabled={!undoStack.length}>실행 취소</button><button className="secondary" onClick={redo} disabled={!redoStack.length}>다시 실행</button><button className="secondary" onClick={logout}>로그아웃</button></div>
      </header>

      <div className="grid">
        <aside className="panel form-panel">
          <div className="form-group"><label className="label">프로젝트 이름</label><input className="input" value={projectName} onChange={(event) => setProjectName(event.target.value)} /></div>
          <div className="form-group"><label className="label">주제 또는 요청</label><textarea className="textarea topic-input" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="주제와 원하는 방향을 자세히 적어줘" /></div>

          <details className="studio-section" open>
            <summary>생성 설정</summary>
            <div className="form-row"><div className="form-group"><label className="label">콘텐츠 형식</label><select className="select" value={mode} onChange={(event) => setMode(event.target.value as ContentMode)}>{modeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div className="form-group"><label className="label">주제 분류</label><select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
            <div className="form-row"><div className="form-group"><label className="label">대상</label><select className="select" value={audience} onChange={(event) => setAudience(event.target.value as Audience)}>{audiences.map((item) => <option key={item}>{item}</option>)}</select></div><div className="form-group"><label className="label">문체</label><select className="select" value={tone} onChange={(event) => setTone(event.target.value as ContentTone)}>{toneOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></div>
            <div className="form-row"><div className="form-group"><label className="label">첫 장 훅</label><select className="select" value={hookStrength} onChange={(event) => setHookStrength(event.target.value as HookStrength)}><option value="soft">부드럽게</option><option value="balanced">균형 있게</option><option value="strong">강하게</option></select></div><div className="form-group"><label className="label">마지막 CTA</label><select className="select" value={ctaStyle} onChange={(event) => setCtaStyle(event.target.value as CtaStyle)}><option value="soft">잔잔한 마무리</option><option value="save">저장 유도</option><option value="engage">댓글 유도</option><option value="follow">팔로우 유도</option></select></div></div>
            <div className="form-row"><div className="form-group"><label className="label">캡션 스타일</label><select className="select" value={captionStyle} onChange={(event) => setCaptionStyle(event.target.value as CaptionVariantKey)}><option value="auto">자동</option><option value="short">짧게</option><option value="info">정보형</option><option value="emotional">감성형</option><option value="threads">Threads용</option></select></div><div className="form-group"><label className="label">이미지 모드</label><select className="select" value={imageMode} onChange={(event) => setImageMode(event.target.value as ImageMode)}><option value="economy">절약형</option><option value="ai">모든 카드 AI</option><option value="pexels">무료 사진</option><option value="none">이미지 없음</option></select></div></div>
            <div className="form-group"><label className="label">꼭 넣을 내용</label><textarea className="textarea compact-textarea" value={mustInclude} onChange={(event) => setMustInclude(event.target.value)} /></div>
            <div className="form-group"><label className="label">피할 표현</label><textarea className="textarea compact-textarea" value={avoidPhrases} onChange={(event) => setAvoidPhrases(event.target.value)} /></div>
            <label className="toggle-row"><input type="checkbox" checked={factCheck} onChange={(event) => setFactCheck(event.target.checked)} /> 최신 정보가 필요한 주제는 웹 검색·출처 확인</label>
          </details>

          <details className="studio-section">
            <summary>브랜드·출력 설정</summary>
            <label className="toggle-row"><input type="checkbox" checked={brandLocked} onChange={(event) => setBrandLocked(event.target.checked)} /> 브랜드 설정 잠금</label>
            <div className="form-row"><div className="form-group"><label className="label">브랜드명</label><input className="input" disabled={brandLocked} value={brandName} onChange={(event) => setBrandName(event.target.value)} /></div><div className="form-group"><label className="label">계정명</label><input className="input" disabled={brandLocked} value={accountHandle} onChange={(event) => setAccountHandle(event.target.value)} /></div></div>
            <label className="toggle-row"><input type="checkbox" checked={safeArea} onChange={(event) => setSafeArea(event.target.checked)} /> 편집 화면 안전 영역 표시</label>
            <div className="form-row"><div className="form-group"><label className="label">일일 생성 한도</label><input className="input" type="number" min={1} max={200} value={dailyGenerationLimit} onChange={(event) => setDailyGenerationLimit(Math.max(1, Number(event.target.value) || 1))} /></div><div className="form-group"><label className="label">AI 이미지 한도</label><input className="input" type="number" min={1} max={30} value={aiImageLimit} onChange={(event) => setAiImageLimit(Math.max(1, Number(event.target.value) || 1))} /></div></div>
            <div className="auto-count-box"><strong>사용량·비용 안내</strong><span>{estimatedCost}</span><span>오늘 생성 {usage.generations}/{dailyGenerationLimit}회 · AI 이미지 {usage.aiImages}/{aiImageLimit}장</span></div>
          </details>

          <details className="studio-section">
            <summary>프리셋·프로젝트</summary>
            <div className="edit-row two"><input className="input" value={presetName} onChange={(event) => setPresetName(event.target.value)} /><button className="secondary" onClick={savePreset}>프리셋 저장</button></div>
            <div className="saved-list">{savedPresets.slice(0, 8).map((preset) => <div className="saved-row" key={preset.id}><button className="secondary grow" onClick={() => applySettings(makeSettings(preset.settings))}>{preset.name}</button><button className="secondary" onClick={() => setSavedPresets((items) => items.filter((item) => item.id !== preset.id))}>삭제</button></div>)}</div>
            <div className="actions project-actions"><button className="secondary" onClick={saveProject}>현재 프로젝트 저장</button><button className="secondary" onClick={exportProjectJson}>JSON 내보내기</button><button className="secondary" onClick={() => importRef.current?.click()}>JSON 불러오기</button><input ref={importRef} type="file" accept="application/json" hidden onChange={(event) => { importProjectJson(event.target.files?.[0]); event.currentTarget.value = ""; }} /></div>
            <input className="input" value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="저장 프로젝트 검색" />
            <div className="saved-list">{filteredProjects.slice(0, 12).map((project) => <div className="saved-project" key={project.id}><div className="saved-project-head"><button className="favorite-button" onClick={() => setSavedProjects((items) => items.map((item) => item.id === project.id ? { ...item, favorite: !item.favorite } : item))}>{project.favorite ? "★" : "☆"}</button><button className="secondary grow" onClick={() => loadProject(project)}>{project.name} · {project.versions.length}개 버전</button><button className="secondary" onClick={() => setSavedProjects((items) => items.filter((item) => item.id !== project.id))}>삭제</button></div>{project.versions.length > 1 && <button className="version-button" onClick={() => loadProject(project, 1)}>바로 전 버전 복원</button>}</div>)}</div>
          </details>

          <button className="primary" disabled={loading || !topic.trim()} onClick={generate}>{loading ? "제작 중..." : "카드뉴스 만들기"}</button>
          <div className="actions bottom-tools"><button className="secondary" disabled={!result} onClick={() => addSlide()}>카드 추가</button><button className="secondary" disabled={!result} onClick={suggestTitles}>{assistLoading === "titles" ? "추천 중..." : "표지 제목 추천"}</button><button className="secondary" disabled={!result} onClick={applyCta}>CTA 적용</button><button className="secondary" disabled={!result} onClick={runQualityCheck}>출력 검사</button></div>
          {status && <div className="status">{status}</div>}{warning && <div className="status danger">{warning}</div>}
        </aside>

        <section className="workspace">
          {!result ? <div className="panel empty"><strong>주제를 입력하면 글·레이아웃·미니 그림을 자동으로 구성해.</strong><span>처음에는 전부 사용해보고, 실제 작업 흐름에 맞춰 기능을 하나씩 정리하면 돼.</span></div> : <>
            <div className="panel result-head"><div><div className="result-badge">{result.contentTypeLabel}</div><h2>{result.topic}</h2><p>{result.slides.length}장 · 1080×1350px · 자동 저장 중</p></div><div className="actions"><button className="secondary" onClick={() => navigator.clipboard.writeText(`${result.caption}\n\n${result.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}`)}>캡션 복사</button><button className="secondary save-button" onClick={exportAllPng}>전체 PNG 저장</button><button className="secondary" onClick={exportAll}>전체 패키지 ZIP</button><button className="secondary" onClick={saveProject}>프로젝트 저장</button></div></div>

            {!!result.titleCandidates?.length && <section className="panel assist-panel"><h3>표지 제목 후보</h3><div className="candidate-grid">{result.titleCandidates.map((title) => <button className="candidate-button" key={title} onClick={() => applyTitleCandidate(title)}>{title}</button>)}</div></section>}
            {!!qualityMessages.length && <section className="panel assist-panel"><h3>출력 검사 결과</h3><div className="quality-list">{qualityMessages.map((message, index) => <div key={`${message}-${index}`}>• {message}</div>)}</div></section>}
            {!!result.factWarnings?.length && <section className="panel assist-panel warning-panel"><h3>사실 확인 주의</h3>{result.factWarnings.map((message, index) => <div key={`${message}-${index}`}>• {message}</div>)}</section>}

            <div className="cards-grid">
              {result.slides.map((slide, index) => {
                const visualKind = detectCardVisual(slide, index);
                const noPhotoLayout = !slide.imageUrl && (slide.layout === "split" || slide.layout === "list" || slide.layout === "cover");
                const showFeatureVisual = (slide.layout === "clean" || (slide.layout === "split" && noPhotoLayout)) && compactLength(slide.body) <= 165 && slide.visualEnabled !== false;
                const quoteParts = slide.layout === "quote" ? getQuoteParts(slide.body, slide.highlight) : null;
                const displayTitle = formatCardTitle(slide.title, slide.layout);
                const displayBody = formatEditorialBody(slide.body, slide.layout);
                const zoom = Math.max(100, slide.imageZoom ?? 100);
                const photoStyle = { backgroundImage: slide.imageUrl ? `url(${slide.imageUrl})` : fallbackBackground(index), backgroundPosition: `${slide.imagePositionX ?? 50}% ${slide.imagePositionY ?? 50}%`, backgroundSize: zoom === 100 ? "cover" : `${zoom}%` };
                const locked = slide.isLocked === true;
                return <article className={`panel card-editor${locked ? " is-locked" : ""}`} key={slide.id} draggable={!locked} onDragStart={() => setDraggedIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedIndex !== null) moveSlide(draggedIndex, index); setDraggedIndex(null); }}>
                  <div className="card-stage"><div className={`instagram-card layout-${slide.layout} visual-${visualKind}${noPhotoLayout ? " no-photo-layout" : ""}${index === result.slides.length - 1 ? " is-final-card" : ""}${safeArea ? " show-safe-area" : ""}`} ref={(node) => { cardRefs.current[slide.id] = node; }}>
                    {(slide.layout === "cover" || slide.layout === "quote") && <div className="full-photo" style={photoStyle} />}
                    {(slide.layout === "split" || slide.layout === "list") && <div className="bottom-photo" style={photoStyle} />}
                    {(slide.layout === "cover" || slide.layout === "quote") && <div className="photo-overlay" />}
                    {slide.layout === "quote" && <><span className="quote-mark quote-mark-open" aria-hidden="true">“</span><span className="quote-mark quote-mark-close" aria-hidden="true">”</span></>}
                    {safeArea && <div className="safe-area-guide" aria-hidden="true" />}
                    <div className="editorial-signature">{brandName.toUpperCase()} · {normalizeHandle(accountHandle)}</div>
                    <div className="card-content"><div className="eyebrow">{slide.eyebrow}</div>{slide.title && <div className={`card-title ${titleSizeClass(displayTitle, slide.layout)}`}>{displayTitle}</div>}
                      {slide.layout === "list" && slide.items?.length ? <CardVisual kind={visualKind} compact /> : showFeatureVisual ? <CardVisual kind={visualKind} /> : null}
                      {slide.layout === "list" && slide.items?.length ? <ol className="card-list">{slide.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}><span className="list-index">{(slide.itemStart ?? 1) + itemIndex}</span><span className="list-text">{item}</span></li>)}</ol> : slide.layout === "quote" && quoteParts ? <>{quoteParts.lead && <div className={`card-body quote-lead ${bodySizeClass(quoteParts.lead, slide.layout)}`}>{formatEditorialBody(quoteParts.lead, "quote")}</div>}{quoteParts.emphasis && <div className={`quote-highlight ${compactLength(quoteParts.emphasis) > 15 ? "is-long" : ""}`}>{quoteParts.emphasis}</div>}</> : slide.body ? <div className={`card-body ${bodySizeClass(slide.body, slide.layout)}`}><HighlightedText text={displayBody} highlight={slide.highlight} /></div> : null}
                      {slide.layout === "list" && slide.body && <div className="list-note">{formatEditorialBody(slide.body, "list")}</div>}
                    </div><div className="attribution">{slide.attribution || "Original editorial design"}</div>
                  </div></div>

                  <div className="edit-box">
                    <div className="card-toolbar"><button className="secondary" onClick={() => patchSlide(index, { isLocked: !locked }, true)}>{locked ? "잠금 해제" : "카드 잠금"}</button><button className="secondary" disabled={locked || index === 0} onClick={() => moveSlide(index, index - 1)}>앞으로</button><button className="secondary" disabled={locked || index === result.slides.length - 1} onClick={() => moveSlide(index, index + 1)}>뒤로</button><button className="secondary" disabled={locked} onClick={() => duplicateSlide(index)}>복제</button><button className="secondary" disabled={locked} onClick={() => addSlide(index)}>뒤에 추가</button><button className="secondary" disabled={locked || result.slides.length <= 1} onClick={() => deleteSlide(index)}>삭제</button></div>
                    <div className="edit-row two"><select className="select" disabled={locked} value={slide.layout} onChange={(event) => patchSlide(index, { layout: event.target.value as CardLayout }, true)}>{layoutOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><input className="input" disabled={locked} value={slide.eyebrow} onFocus={snapshot} onChange={(event) => patchSlide(index, { eyebrow: event.target.value })} /></div>
                    <textarea className="textarea edit-title" disabled={locked} value={slide.title} onFocus={snapshot} onChange={(event) => patchSlide(index, { title: event.target.value })} />
                    <textarea className="textarea edit-body" disabled={locked} value={slide.body} onFocus={snapshot} onChange={(event) => patchSlide(index, { body: event.target.value })} />
                    {slide.layout === "list" && <><input className="input" disabled={locked} type="number" min={1} value={slide.itemStart ?? 1} onChange={(event) => patchSlide(index, { itemStart: Math.max(1, Number(event.target.value) || 1) }, true)} /><textarea className="textarea edit-items" disabled={locked} value={(slide.items ?? []).join("\n")} onFocus={snapshot} onChange={(event) => patchSlide(index, { items: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 6) })} /></>}
                    <div className="edit-row two"><select className="select" disabled={locked} value={slide.visualKind ?? "auto"} onChange={(event) => patchSlide(index, { visualKind: event.target.value as CardVisualKind, visualEnabled: event.target.value !== "none" }, true)}>{visualOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><input className="input" disabled={locked} value={slide.highlight ?? ""} onFocus={snapshot} onChange={(event) => patchSlide(index, { highlight: event.target.value })} placeholder="강조 문구" /></div>
                    {!!slide.imageUrl && <div className="image-position-controls"><label>사진 확대 {slide.imageZoom ?? 100}%<input type="range" min={100} max={180} value={slide.imageZoom ?? 100} disabled={locked} onChange={(event) => patchSlide(index, { imageZoom: Number(event.target.value) })} /></label><label>좌우 {slide.imagePositionX ?? 50}<input type="range" min={0} max={100} value={slide.imagePositionX ?? 50} disabled={locked} onChange={(event) => patchSlide(index, { imagePositionX: Number(event.target.value) })} /></label><label>상하 {slide.imagePositionY ?? 50}<input type="range" min={0} max={100} value={slide.imagePositionY ?? 50} disabled={locked} onChange={(event) => patchSlide(index, { imagePositionY: Number(event.target.value) })} /></label></div>}
                    <div className="quick-actions"><button className="secondary" disabled={locked} onClick={() => patchSlide(index, { title: shortenText(slide.title, 34) }, true)}>제목 짧게</button><button className="secondary" disabled={locked} onClick={() => patchSlide(index, { body: shortenText(slide.body, 100) }, true)}>본문 짧게</button><button className="secondary" disabled={locked || assistLoading === `slide-${index}`} onClick={() => refineSlide(index, "더 짧고 쉽게")}>AI 짧게</button><button className="secondary" disabled={locked || assistLoading === `slide-${index}`} onClick={() => refineSlide(index, "더 강한 후킹으로")}>AI 강하게</button><button className="secondary" disabled={locked || assistLoading === `slide-${index}`} onClick={() => refineSlide(index, "과장을 줄이고 정보 중심으로")}>AI 담백하게</button></div>
                    <div className="image-actions"><button className="secondary" disabled={locked} onClick={() => generateImage(index, result, "ai").catch((error) => setWarning(error.message))}>AI 이미지</button><button className="secondary" disabled={locked} onClick={() => generateImage(index, result, "pexels").catch((error) => setWarning(error.message))}>무료 사진</button><label className={`secondary upload-button${locked ? " disabled" : ""}`}>내 사진<input disabled={locked} type="file" accept="image/*" onChange={(event) => { uploadImage(index, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button className="secondary" disabled={locked} onClick={() => patchSlide(index, { imageUrl: "", attribution: "", sourceUrl: "" }, true)}>사진 제거</button><button className="secondary save-button" onClick={() => exportOne(index)}>PNG 저장</button></div>
                  </div>
                </article>;
              })}
            </div>

            <section className="panel caption-panel"><div className="caption-head"><h3>캡션</h3><button className="secondary" onClick={regenerateCaptions}>{assistLoading === "caption" ? "생성 중..." : "캡션 5종 다시 생성"}</button></div><div className="caption-tabs">{(["auto", "short", "info", "emotional", "threads"] as CaptionVariantKey[]).map((key) => result.captionVariants?.[key] ? <button className={`secondary${captionStyle === key ? " active" : ""}`} key={key} onClick={() => applyCaptionVariant(key)}>{key === "auto" ? "기본" : key === "short" ? "짧게" : key === "info" ? "정보형" : key === "emotional" ? "감성형" : "Threads"}</button> : null)}</div><textarea className="textarea caption-editor" value={result.caption} onFocus={snapshot} onChange={(event) => setResult({ ...result, caption: event.target.value })} /><div className="caption-copy hashtags">{result.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}</div>{!!result.references.length && <div className="references"><strong>정보 출처</strong>{result.references.map((reference) => <div key={reference.url}>{reference.title} — {reference.url}</div>)}</div>}</section>
          </>}
        </section>
      </div>
    </main>
  );
}
