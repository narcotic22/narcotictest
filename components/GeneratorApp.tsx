"use client";

import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import type {
  Audience,
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

function downloadFile(data: string | Blob, filename: string) {
  const href = typeof data === "string" ? data : URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (data instanceof Blob) URL.revokeObjectURL(href);
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

function splitBalancedWords(words: string[]) {
  if (words.length <= 2) return [words.join(" ")].filter(Boolean);
  const middle = Math.ceil(words.length / 2);
  return [words.slice(0, middle).join(" "), words.slice(middle).join(" ")].filter(Boolean);
}

function formatCoverTitle(title: string) {
  const original = title.trim();
  if (!original || original.includes("\n")) return original;

  let firstLine = "";
  let remainder = original;
  const commaIndex = original.indexOf(",");
  if (commaIndex > 0 && commaIndex <= 12) {
    firstLine = original.slice(0, commaIndex + 1).trim();
    remainder = original.slice(commaIndex + 1).trim();
  }

  const words = remainder.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  if (firstLine) lines.push(firstLine);

  if (words.length >= 4) {
    const tailTwo = words.slice(-2).join(" ");
    const tailThree = words.slice(-3).join(" ");
    const strongTailTwo = /^(딱|꼭|지금|바로|이것만|이거|절대|무조건)/.test(tailTwo) || compactLength(tailTwo) <= 8;
    const strongTailThree = /^(딱|꼭|지금|바로|이것만|이거|절대|무조건)/.test(tailThree) && compactLength(tailThree) <= 12;

    if (strongTailTwo) {
      const head = words.slice(0, -2);
      lines.push(...splitBalancedWords(head));
      lines.push(tailTwo);
      return lines.slice(0, 3).join("\n");
    }

    if (strongTailThree) {
      const head = words.slice(0, -3);
      if (head.length) lines.push(...splitBalancedWords(head));
      lines.push(tailThree);
      return lines.slice(0, 3).join("\n");
    }
  }

  lines.push(...splitBalancedWords(words));
  return lines.slice(0, 3).join("\n");
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

export default function GeneratorApp() {
  const [topic, setTopic] = useState("외로워서 시작한 연애가 나를 더 외롭게 만들 때");
  const [audience, setAudience] = useState<Audience>("20~50대 전체");
  const [mode, setMode] = useState<ContentMode>("auto");
  const [tone, setTone] = useState<ContentTone>("magazine");
  const [imageMode, setImageMode] = useState<ImageMode>("economy");
  const [accountHandle, setAccountHandle] = useState("@YOUR_ACCOUNT");
  const [result, setResult] = useState<CardNewsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [warning, setWarning] = useState("");
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const savedHandle = localStorage.getItem(HANDLE_KEY);
    if (savedHandle) setAccountHandle(savedHandle);
    if (!saved) return;
    try {
      setResult(JSON.parse(saved) as CardNewsResult);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!result) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    } catch {
      // Large uploaded images may exceed browser storage. The current session still keeps the result.
    }
  }, [result]);

  useEffect(() => {
    localStorage.setItem(HANDLE_KEY, accountHandle);
  }, [accountHandle]);

  function patchSlide(index: number, patch: Partial<CardNewsResult["slides"][number]>) {
    setResult((previous) => previous
      ? {
          ...previous,
          slides: previous.slides.map((slide, slideIndex) =>
            slideIndex === index ? { ...slide, ...patch } : slide,
          ),
        }
      : previous,
    );
  }

  async function generateImage(
    slideIndex: number,
    current: CardNewsResult,
    requestMode: ImageRequestMode,
  ) {
    const slide = current.slides[slideIndex];
    setStatus(`${slideIndex + 1}번 카드 이미지를 준비하는 중...`);

    const response = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: requestMode,
        layout: slide.layout,
        imagePrompt: slide.imagePrompt,
        searchQuery: slide.searchQuery,
      }),
    });

    const data = (await response.json()) as {
      imageUrl?: string;
      attribution?: string;
      sourceUrl?: string;
      error?: string;
    };

    if (!response.ok) throw new Error(data.error ?? "이미지 생성에 실패했습니다.");

    setResult((previous) => {
      const base = previous?.slides.some((item) => item.id === slide.id) ? previous : current;
      return {
        ...base,
        slides: base.slides.map((item, index) =>
          index === slideIndex ? { ...item, ...data } : item,
        ),
      };
    });
  }

  async function applyAutomaticImages(data: CardNewsResult) {
    if (imageMode === "none") return;

    if (imageMode === "economy") {
      await generateImage(0, data, "ai");
      return;
    }

    const requestMode: ImageRequestMode = imageMode === "ai" ? "ai" : "pexels";
    for (let index = 0; index < data.slides.length; index += 1) {
      try {
        await generateImage(index, data, requestMode);
      } catch (error) {
        setWarning((previous) =>
          `${previous ? `${previous}\n` : ""}${index + 1}번 이미지: ${error instanceof Error ? error.message : "실패"}`,
        );
      }
    }
  }

  async function generate() {
    setLoading(true);
    setWarning("");
    setStatus("주제에 맞는 유형과 카드 흐름을 설계하는 중...");

    try {
      const response = await fetch("/api/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, audience, mode, tone }),
      });

      const data = (await response.json()) as CardNewsResult & { error?: string; warning?: string };
      if (!response.ok) throw new Error(data.error ?? "카드뉴스 생성에 실패했습니다.");

      setResult(data);
      if (data.warning) setWarning(data.warning);
      await applyAutomaticImages(data);
      setStatus(`${data.contentTypeLabel}으로 ${data.slides.length}장을 구성했어. 문구·사진·레이아웃을 카드별로 바꿀 수 있어.`);
    } catch (error) {
      setStatus("");
      setWarning(error instanceof Error ? error.message : "생성에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function uploadImage(index: number, file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setWarning("이미지 파일만 업로드할 수 있어.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setWarning("이미지는 12MB 이하로 올려줘.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      patchSlide(index, {
        imageUrl: String(reader.result ?? ""),
        attribution: "User uploaded image",
        sourceUrl: "",
      });
      setStatus(`${index + 1}번 카드에 내 사진을 적용했어.`);
    };
    reader.onerror = () => setWarning("이미지를 읽지 못했어.");
    reader.readAsDataURL(file);
  }

  async function exportOne(index: number) {
    if (!result) return;
    const node = cardRefs.current[result.slides[index].id];
    if (!node) return;

    setStatus(`${index + 1}번 카드를 PNG로 만드는 중...`);
    const dataUrl = await toPng(node, {
      pixelRatio: 2.5,
      cacheBust: true,
      backgroundColor: "#ffffff",
    });
    downloadFile(dataUrl, `instacard-${String(index + 1).padStart(2, "0")}.png`);
    setStatus("PNG 다운로드 완료.");
  }

  async function exportAll() {
    if (!result) return;

    setStatus("전체 카드 PNG를 묶는 중...");
    const zip = new JSZip();
    for (let index = 0; index < result.slides.length; index += 1) {
      const node = cardRefs.current[result.slides[index].id];
      if (!node) continue;
      const dataUrl = await toPng(node, {
        pixelRatio: 2.5,
        cacheBust: true,
        backgroundColor: "#ffffff",
      });
      zip.file(`instacard-${String(index + 1).padStart(2, "0")}.png`, dataUrl.split(",")[1], { base64: true });
    }

    const imageCredits = result.slides
      .map((slide, index) => slide.attribution
        ? `${index + 1}번 이미지: ${slide.attribution}${slide.sourceUrl ? `\n${slide.sourceUrl}` : ""}`
        : "",
      )
      .filter(Boolean)
      .join("\n\n");

    const references = result.references
      .map((reference) => `${reference.title}\n${reference.url}`)
      .join("\n\n");

    zip.file(
      "caption.txt",
      `${result.caption}\n\n${result.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}\n\n[정보 출처]\n${references || "없음"}\n\n[이미지 출처]\n${imageCredits || "직접 제작 또는 출처 없음"}`,
    );

    const blob = await zip.generateAsync({ type: "blob" });
    downloadFile(blob, "instacard-editorial-package.zip");
    setStatus("전체 ZIP 다운로드 완료.");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>InstaCard Editorial</h1>
          <p>빠른 정보형부터 감성 롱폼까지 자동 구성하는 개인용 카드뉴스 스튜디오</p>
        </div>
        <button className="secondary" onClick={logout}>로그아웃</button>
      </header>

      <div className="grid">
        <aside className="panel form-panel">
          <div className="form-group">
            <label className="label">주제 또는 요청</label>
            <textarea
              className="textarea topic-input"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="예: 외로워서 시작한 연애가 나를 더 외롭게 만들 때"
            />
            <div className="hint">단어 하나보다 원하는 방향까지 적으면 문장 품질이 더 좋아져.</div>
          </div>

          <div className="form-group">
            <label className="label">콘텐츠 형식</label>
            <select className="select" value={mode} onChange={(event) => setMode(event.target.value as ContentMode)}>
              {modeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <div className="hint">{modeOptions.find((option) => option.value === mode)?.description}</div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="label">대상</label>
              <select className="select" value={audience} onChange={(event) => setAudience(event.target.value as Audience)}>
                {audiences.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">문체</label>
              <select className="select" value={tone} onChange={(event) => setTone(event.target.value as ContentTone)}>
                {toneOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="label">이미지 자동 적용</label>
            <select className="select" value={imageMode} onChange={(event) => setImageMode(event.target.value as ImageMode)}>
              <option value="economy">절약형 — 표지만 AI 생성</option>
              <option value="ai">모든 카드 AI 이미지</option>
              <option value="pexels">모든 카드 Pexels 사진</option>
              <option value="none">자동 이미지 없음</option>
            </select>
            <div className="hint">절약형은 표지 한 장만 유료 생성하고, 나머지는 직접 사진을 올리거나 카드별로 선택해.</div>
          </div>

          <div className="form-group">
            <label className="label">계정명</label>
            <input
              className="input"
              value={accountHandle}
              onChange={(event) => setAccountHandle(event.target.value)}
              placeholder="@your_account"
            />
          </div>

          <div className="auto-count-box">
            <strong>장수도 자동 결정</strong>
            <span>정보형 3~6장 · 에세이형 8~12장 · 리스트형 6~12장 안에서 흐름에 맞춰 구성해.</span>
          </div>

          <button className="primary" disabled={loading || !topic.trim()} onClick={generate}>
            {loading ? "제작 중..." : "카드뉴스 만들기"}
          </button>
          {status && <div className="status">{status}</div>}
          {warning && <div className="status danger">{warning}</div>}
        </aside>

        <section className="workspace">
          {!result ? (
            <div className="panel empty">
              <strong>주제만 입력하면 형식·장수·레이아웃을 자동으로 정해.</strong>
              <span>감성형은 풀사진 표지, 상단 글·하단 사진, 중앙 인용문을 섞어 긴 호흡으로 구성해.</span>
            </div>
          ) : (
            <>
              <div className="panel result-head">
                <div>
                  <div className="result-badge">{result.contentTypeLabel}</div>
                  <h2>{result.topic}</h2>
                  <p>{result.slides.length}장 · 다운로드 시 1080×1350px</p>
                </div>
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() => navigator.clipboard.writeText(
                      `${result.caption}\n\n${result.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}`,
                    )}
                  >
                    캡션 복사
                  </button>
                  <button className="secondary" onClick={exportAll}>전체 ZIP</button>
                </div>
              </div>

              <div className="cards-grid">
                {result.slides.map((slide, index) => {
                  const photoStyle = {
                    backgroundImage: slide.imageUrl ? `url(${slide.imageUrl})` : fallbackBackground(index),
                  };
                  const displayTitle = slide.layout === "cover" ? formatCoverTitle(slide.title) : slide.title;
                  const quoteParts = slide.layout === "quote" ? getQuoteParts(slide.body, slide.highlight) : null;

                  return (
                    <article className="panel card-editor" key={slide.id}>
                      <div className="card-stage">
                        <div
                          className={`instagram-card layout-${slide.layout}`}
                          ref={(node) => { cardRefs.current[slide.id] = node; }}
                        >
                          {(slide.layout === "cover" || slide.layout === "quote") && (
                            <div className="full-photo" style={photoStyle} />
                          )}
                          {(slide.layout === "split" || slide.layout === "list") && (
                            <div className="bottom-photo" style={photoStyle} />
                          )}
                          {(slide.layout === "cover" || slide.layout === "quote") && <div className="photo-overlay" />}

                          <div className="editorial-signature">EDITORIAL · {normalizeHandle(accountHandle)}</div>
                          <div className="card-number">{index + 1}/{result.slides.length}</div>

                          <div className="card-content">
                            <div className="eyebrow">{slide.eyebrow}</div>
                            {slide.title && (
                              <div className={`card-title ${titleSizeClass(displayTitle, slide.layout)}`}>
                                {displayTitle}
                              </div>
                            )}

                            {slide.layout === "list" && slide.items?.length ? (
                              <ol className="card-list" start={slide.itemStart ?? 1}>
                                {slide.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}
                              </ol>
                            ) : slide.layout === "quote" && quoteParts ? (
                              <>
                                {quoteParts.lead ? (
                                  <div className={`card-body quote-lead ${bodySizeClass(quoteParts.lead, slide.layout)}`}>
                                    {quoteParts.lead}
                                  </div>
                                ) : null}
                                {quoteParts.emphasis ? (
                                  <div className={`quote-highlight ${compactLength(quoteParts.emphasis) > 22 ? "is-long" : ""}`}>
                                    {quoteParts.emphasis}
                                  </div>
                                ) : null}
                              </>
                            ) : slide.body ? (
                              <div className={`card-body ${bodySizeClass(slide.body, slide.layout)}`}>
                                <HighlightedText text={slide.body} highlight={slide.highlight} />
                              </div>
                            ) : null}

                            {slide.layout === "list" && slide.body && (
                              <div className="list-note">{slide.body}</div>
                            )}
                          </div>

                          <div className="attribution">{slide.attribution || "Original editorial design"}</div>
                        </div>
                      </div>

                      <div className="edit-box">
                        <div className="edit-row two">
                          <select
                            className="select"
                            value={slide.layout}
                            onChange={(event) => patchSlide(index, { layout: event.target.value as CardLayout })}
                          >
                            {layoutOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                          <input
                            className="input"
                            value={slide.eyebrow}
                            onChange={(event) => patchSlide(index, { eyebrow: event.target.value })}
                            placeholder="작은 분류 문구"
                          />
                        </div>

                        <textarea
                          className="textarea edit-title"
                          value={slide.title}
                          onChange={(event) => patchSlide(index, { title: event.target.value })}
                          placeholder="제목"
                        />
                        <textarea
                          className="textarea edit-body"
                          value={slide.body}
                          onChange={(event) => patchSlide(index, { body: event.target.value })}
                          placeholder="본문 또는 인용문"
                        />

                        {slide.layout === "list" && (
                          <>
                            <input
                              className="input"
                              type="number"
                              min={1}
                              value={slide.itemStart ?? 1}
                              onChange={(event) => patchSlide(index, { itemStart: Math.max(1, Number(event.target.value) || 1) })}
                              placeholder="목록 시작 번호"
                            />
                          <textarea
                            className="textarea edit-items"
                            value={(slide.items ?? []).join("\n")}
                            onChange={(event) => patchSlide(index, {
                              items: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 5),
                            })}
                            placeholder="항목을 한 줄에 하나씩 입력"
                          />
                          </>
                        )}

                        {slide.layout === "quote" && (
                          <input
                            className="input"
                            value={slide.highlight ?? ""}
                            onChange={(event) => patchSlide(index, { highlight: event.target.value })}
                            placeholder="본문 안에서 색으로 강조할 정확한 구절"
                          />
                        )}

                        <div className="image-actions">
                          <button
                            className="secondary"
                            onClick={() => generateImage(index, result, "ai").catch((error) => setWarning(error.message))}
                          >
                            AI 이미지
                          </button>
                          <button
                            className="secondary"
                            onClick={() => generateImage(index, result, "pexels").catch((error) => setWarning(error.message))}
                          >
                            무료 사진
                          </button>
                          <label className="secondary upload-button">
                            내 사진
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(event) => {
                                uploadImage(index, event.target.files?.[0]);
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                          <button
                            className="secondary"
                            onClick={() => patchSlide(index, { imageUrl: "", attribution: "", sourceUrl: "" })}
                          >
                            사진 제거
                          </button>
                          <button className="secondary save-button" onClick={() => exportOne(index)}>PNG 저장</button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <section className="panel caption-panel">
                <h3>캡션</h3>
                <div className="caption-copy">{result.caption}</div>
                <div className="caption-copy hashtags">
                  {result.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}
                </div>
                {!!result.references.length && (
                  <div className="references">
                    <strong>정보 출처</strong>
                    {result.references.map((reference) => (
                      <div key={reference.url}>{reference.title} — {reference.url}</div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
