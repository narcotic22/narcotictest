"use client";

import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import type { Audience, CardNewsResult, ContentStyle, ImageMode } from "@/lib/types";

const audiences: Audience[] = ["20대", "30대", "40대", "50대", "20~30대", "30~40대", "40~50대", "20~50대 전체"];
const styles: ContentStyle[] = ["뉴스형", "정보형", "트렌드형", "강한 후킹형"];

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
    "linear-gradient(145deg,#6946f3,#17142f 65%)",
    "linear-gradient(145deg,#006b74,#101b28 68%)",
    "linear-gradient(145deg,#aa4b6b,#151725 70%)",
    "linear-gradient(145deg,#d58032,#252031 70%)",
  ];
  return options[index % options.length];
}

function compactLength(value: string) {
  return value.replace(/\s+/g, "").length;
}

function titleSizeClass(title: string, isCover: boolean) {
  const length = compactLength(title);
  if (isCover) {
    if (length >= 42) return "cover title-xs";
    if (length >= 29) return "cover title-sm";
    return "cover";
  }
  if (length >= 50) return "title-xs";
  if (length >= 35) return "title-sm";
  return "";
}

function bodySizeClass(body: string) {
  const length = compactLength(body);
  if (length >= 145) return "body-xs";
  if (length >= 100) return "body-sm";
  return "";
}

export default function GeneratorApp() {
  const [topic, setTopic] = useState("요즘 20~50대에게 핫한 주제");
  const [audience, setAudience] = useState<Audience>("20~50대 전체");
  const [style, setStyle] = useState<ContentStyle>("트렌드형");
  const [imageMode, setImageMode] = useState<ImageMode>("mixed");
  const [result, setResult] = useState<CardNewsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [warning, setWarning] = useState("");
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const saved = localStorage.getItem("instacard-last-result");
    if (saved) {
      try {
        setResult(JSON.parse(saved) as CardNewsResult);
      } catch {
        // Ignore broken local data.
      }
    }
  }, []);

  useEffect(() => {
    if (result) localStorage.setItem("instacard-last-result", JSON.stringify(result));
  }, [result]);

  async function generateImage(slideIndex: number, current: CardNewsResult, modeOverride?: "ai" | "pexels" | "none") {
    const slide = current.slides[slideIndex];
    const resolvedMode = modeOverride ?? (imageMode === "mixed" ? (slideIndex === 0 ? "ai" : "pexels") : imageMode);
    if (resolvedMode === "none") return;

    setStatus(`${slideIndex + 1}번 카드 이미지를 준비하는 중...`);
    const response = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: resolvedMode,
        imagePrompt: slide.imagePrompt,
        searchQuery: slide.searchQuery,
      }),
    });
    const data = (await response.json()) as { imageUrl?: string; attribution?: string; sourceUrl?: string; error?: string };
    if (!response.ok) throw new Error(data.error ?? "이미지 생성에 실패했습니다.");

    setResult((previous) => {
      const base = previous ?? current;
      return {
        ...base,
        slides: base.slides.map((item, index) => index === slideIndex ? { ...item, ...data } : item),
      };
    });
  }

  async function generate() {
    setLoading(true);
    setWarning("");
    setStatus("주제와 최신 자료를 조사한 뒤 적절한 카드 수를 정하는 중...");

    try {
      const response = await fetch("/api/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, audience, style }),
      });
      const data = (await response.json()) as CardNewsResult & { error?: string; warning?: string };
      if (!response.ok) throw new Error(data.error ?? "카드뉴스 생성에 실패했습니다.");

      setResult(data);
      if (data.warning) setWarning(data.warning);

      if (imageMode !== "none") {
        for (let i = 0; i < data.slides.length; i += 1) {
          try {
            await generateImage(i, data);
          } catch (error) {
            setWarning((previous) => `${previous ? `${previous} ` : ""}${i + 1}번 이미지: ${error instanceof Error ? error.message : "실패"}`);
          }
        }
      }

      setStatus(`내용에 맞춰 ${data.slides.length}장으로 자동 구성했어. 문구를 수정하거나 PNG로 내려받을 수 있어.`);
    } catch (error) {
      setStatus("");
      setWarning(error instanceof Error ? error.message : "생성에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function patchSlide(index: number, patch: Partial<CardNewsResult["slides"][number]>) {
    setResult((previous) => previous ? {
      ...previous,
      slides: previous.slides.map((slide, i) => i === index ? { ...slide, ...patch } : slide),
    } : previous);
  }

  async function exportOne(index: number) {
    if (!result) return;
    const node = cardRefs.current[result.slides[index].id];
    if (!node) return;

    setStatus(`${index + 1}번 카드를 PNG로 만드는 중...`);
    const dataUrl = await toPng(node, { pixelRatio: 2.5, cacheBust: true, backgroundColor: "#10131a" });
    downloadFile(dataUrl, `instacard-${String(index + 1).padStart(2, "0")}.png`);
    setStatus("PNG 다운로드 완료.");
  }

  async function exportAll() {
    if (!result) return;

    setStatus("전체 카드 PNG를 묶는 중...");
    const zip = new JSZip();
    for (let i = 0; i < result.slides.length; i += 1) {
      const node = cardRefs.current[result.slides[i].id];
      if (!node) continue;
      const dataUrl = await toPng(node, { pixelRatio: 2.5, cacheBust: true, backgroundColor: "#10131a" });
      zip.file(`instacard-${String(i + 1).padStart(2, "0")}.png`, dataUrl.split(",")[1], { base64: true });
    }

    const imageCredits = result.slides
      .filter((slide) => slide.attribution)
      .map((slide, index) => `${index + 1}번 이미지: ${slide.attribution}${slide.sourceUrl ? `\n${slide.sourceUrl}` : ""}`)
      .join("\n\n");

    zip.file("caption.txt", `${result.caption}\n\n${result.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}\n\n[정보 출처]\n${result.references.map((ref) => `${ref.title}\n${ref.url}`).join("\n\n")}\n\n[이미지 출처]\n${imageCredits}`);
    const blob = await zip.generateAsync({ type: "blob" });
    downloadFile(blob, "instacard-package.zip");
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
          <h1>InstaCard Private</h1>
          <p>한 줄 입력으로 만드는 개인용 인스타 카드뉴스</p>
        </div>
        <button className="secondary" onClick={logout}>로그아웃</button>
      </header>

      <div className="grid">
        <aside className="panel form-panel">
          <div className="form-group">
            <label className="label">주제 또는 요청</label>
            <textarea className="textarea" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예: 요즘 40대에게 핫한 건강관리 주제" />
            <div className="hint">단어 하나도 되고, “요즘 20~50대에게 핫한 주제”처럼 요청해도 돼.</div>
          </div>

          <div className="auto-count-box">
            <strong>카드 수 자동 결정</strong>
            <span>정보량을 분석해 3~6장 안에서 가장 자연스럽게 구성해.</span>
          </div>

          <div className="form-group">
            <label className="label">대상</label>
            <select className="select" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
              {audiences.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="label">콘텐츠 스타일</label>
            <select className="select" value={style} onChange={(e) => setStyle(e.target.value as ContentStyle)}>
              {styles.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="label">이미지 방식</label>
            <select className="select" value={imageMode} onChange={(e) => setImageMode(e.target.value as ImageMode)}>
              <option value="mixed">AI + 무료 사진 혼합</option>
              <option value="ai">AI 이미지만</option>
              <option value="pexels">Pexels 무료 사진만</option>
              <option value="none">이미지 없이 디자인</option>
            </select>
            <div className="hint">혼합 모드는 표지는 AI, 나머지는 출처가 기록되는 Pexels 사진을 우선 사용해.</div>
          </div>

          <button className="primary" disabled={loading || !topic.trim()} onClick={generate}>{loading ? "제작 중..." : "카드뉴스 만들기"}</button>
          {status && <div className="status">{status}</div>}
          {warning && <div className="status danger">{warning}</div>}
        </aside>

        <section className="workspace">
          {!result ? (
            <div className="panel empty">왼쪽에 주제만 입력하면 내용에 맞춰 3~6장으로 자동 구성해.</div>
          ) : (
            <>
              <div className="panel result-head">
                <div>
                  <h2>{result.topic}</h2>
                  <p>내용에 맞춰 {result.slides.length}장으로 자동 구성했어. 다운로드 파일은 1080×1350px로 저장돼.</p>
                </div>
                <div className="actions">
                  <button className="secondary" onClick={() => navigator.clipboard.writeText(`${result.caption}\n\n${result.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}`)}>캡션 복사</button>
                  <button className="secondary" onClick={exportAll}>전체 ZIP</button>
                </div>
              </div>

              <div className="cards-grid">
                {result.slides.map((slide, index) => {
                  const isCover = index === 0;
                  return (
                    <article className="panel card-editor" key={slide.id}>
                      <div className="card-stage">
                        <div className="instagram-card" ref={(node) => { cardRefs.current[slide.id] = node; }}>
                          <div className="card-bg" style={{ backgroundImage: slide.imageUrl ? `url(${slide.imageUrl})` : fallbackBackground(index) }} />
                          <div className="card-overlay" />
                          <div className="card-number">{String(index + 1).padStart(2, "0")} / {String(result.slides.length).padStart(2, "0")}</div>
                          <div className={`safe-area ${isCover ? "cover-layout" : "content-layout"}`}>
                            <div className="eyebrow">{slide.eyebrow}</div>
                            <div className={`card-title ${titleSizeClass(slide.title, isCover)}`}>{slide.title}</div>
                            <div className={`card-body ${bodySizeClass(slide.body)}`}>{slide.body}</div>
                          </div>
                          <div className="card-brand">@YOUR_ACCOUNT</div>
                          <div className="attribution">{slide.attribution || "Original design / InstaCard Private"}</div>
                        </div>
                      </div>

                      <div className="edit-box">
                        <input className="input" value={slide.eyebrow} onChange={(e) => patchSlide(index, { eyebrow: e.target.value })} />
                        <textarea className="textarea" value={slide.title} onChange={(e) => patchSlide(index, { title: e.target.value })} />
                        <textarea className="textarea" value={slide.body} onChange={(e) => patchSlide(index, { body: e.target.value })} />
                        <div className="edit-row">
                          <button className="secondary" onClick={() => generateImage(index, result, index === 0 ? "ai" : "pexels").catch((error) => setWarning(error.message))}>이미지 다시 생성</button>
                          <button className="secondary" onClick={() => exportOne(index)}>PNG 저장</button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <section className="panel caption-panel">
                <h3>캡션</h3>
                <div className="caption-copy">{result.caption}</div>
                <div className="caption-copy" style={{ marginTop: 12 }}>{result.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}</div>
                {!!result.references.length && (
                  <div className="references">
                    <strong>정보 출처</strong><br />
                    {result.references.map((ref) => <div key={ref.url}>{ref.title} — {ref.url}</div>)}
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
