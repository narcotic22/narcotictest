# InstaCard Private

개인 비밀번호로 접속하는 인스타그램 카드뉴스 생성기입니다.

## 구현된 기능

- 크롬에서 접속 가능한 개인용 웹앱
- 서버 환경변수에 저장한 비밀번호로 로그인
- 카드 수 3~6장
- 20대~50대 및 묶음 타깃 선택
- 최신 이슈 웹 검색을 활용한 AI 문구 생성
- AI 이미지, Pexels 무료 이미지, 혼합 모드
- Pexels 작가/플랫폼 출처를 카드 하단에 자동 표기
- 1080×1350px PNG 개별 다운로드
- 전체 카드와 캡션을 ZIP으로 다운로드
- 브라우저에 마지막 작업 자동 저장

## 1. 로컬 실행

Node.js 20 이상을 설치한 뒤 프로젝트 폴더에서:

```bash
npm install
cp .env.example .env.local
npm run dev
```

브라우저에서 `http://localhost:3000`으로 접속합니다.

## 2. 환경변수

`.env.local` 또는 Vercel 프로젝트의 Environment Variables에 입력합니다.

```env
APP_PASSWORD=본인만아는긴비밀번호
SESSION_SECRET=32자이상의무작위문자열
OPENAI_API_KEY=선택
OPENAI_TEXT_MODEL=gpt-5.6-luna
OPENAI_IMAGE_MODEL=gpt-image-2
PEXELS_API_KEY=선택
```

- OpenAI 키가 없으면 문구는 데모 데이터로 생성됩니다.
- Pexels 키가 없으면 무료 이미지 모드를 사용할 수 없습니다.
- 두 API 키 모두 서버에서만 사용되며 브라우저 코드에 노출되지 않습니다.

## 3. 어디서든 접속하도록 Vercel 배포

1. 이 폴더를 GitHub 저장소에 업로드합니다.
2. Vercel에서 `Add New Project`를 눌러 저장소를 연결합니다.
3. 위 환경변수를 Vercel에 등록합니다.
4. Deploy를 누릅니다.
5. 생성된 `https://프로젝트명.vercel.app` 주소를 크롬에서 사용합니다.

주소를 알아도 비밀번호가 없으면 제작 화면에 들어갈 수 없습니다. 비밀번호와 SESSION_SECRET은 서로 다른 긴 문자열로 설정하세요.

## 4. 이미지 출처 원칙

- AI 이미지는 `AI generated image`로 표시합니다.
- Pexels 이미지는 `Photo by 작가명 on Pexels`를 카드 하단에 표시합니다.
- 정보 출처는 캡션 패널과 다운로드되는 `caption.txt`에 포함합니다.
- 출처 표시는 사용 허가를 대신하지 않습니다. 인물, 상표, 브랜드, 민감한 사건을 다룰 때는 해당 사진이 오해를 만들지 않는지 직접 확인하세요.

## 다음 개선 후보

- Google 계정 1개만 허용하는 OAuth 로그인
- Supabase를 이용한 기기 간 프로젝트 동기화
- 템플릿 5종과 폰트/색상 변경
- 카드별 드래그 편집
- 인스타그램 게시 예약
