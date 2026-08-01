# InstaCard Private — 자동 구성 업데이트

개인 비밀번호로 접속하는 인스타그램 카드뉴스 생성기입니다.

## 이번 업데이트

- 카드 수 선택 버튼 제거
- 주제와 정보량에 따라 3~6장 자동 구성
- 같은 내용을 반복해 장수를 늘리지 않도록 프롬프트 개선
- 표지와 본문 텍스트를 카드 중앙 중심으로 재배치
- 제목·본문 길이에 따라 글자 크기 자동 조절
- AI 호출 실패 시 데모 문구로 속이지 않고 오류를 표시
- 기본 모델값을 `gpt-5`, `gpt-image-1`로 정리

## 환경변수

Vercel 프로젝트의 Environment Variables에 아래 값을 등록합니다.

```env
APP_PASSWORD=본인만아는긴비밀번호
SESSION_SECRET=32자이상의무작위문자열
OPENAI_API_KEY=발급받은키
OPENAI_TEXT_MODEL=gpt-5
OPENAI_IMAGE_MODEL=gpt-image-1
PEXELS_API_KEY=선택
```

이미 Vercel에 등록한 환경변수는 GitHub 파일을 교체해도 유지됩니다.

## GitHub 업데이트

1. 이 ZIP의 압축을 풉니다.
2. 압축을 풀었을 때 보이는 `app`, `components`, `lib`, `package.json` 등의 파일과 폴더를 GitHub 저장소 최상단에 업로드합니다.
3. 기존 파일 교체를 승인하고 Commit changes를 누릅니다.
4. Vercel이 자동으로 새 버전을 배포합니다.
