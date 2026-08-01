"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "로그인에 실패했습니다.");
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-wrap">
      <form className="panel login-card" onSubmit={submit}>
        <h1>InstaCard Editorial</h1>
        <p>감성 롱폼과 정보형 카드뉴스를 만드는 개인용 도구야. 설정한 비밀번호를 입력해야 접속할 수 있어.</p>
        <label className="label" htmlFor="password">개인 비밀번호</label>
        <input
          id="password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
        />
        <button className="primary" style={{ marginTop: 14 }} disabled={loading || !password}>
          {loading ? "확인 중..." : "접속하기"}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </main>
  );
}
