---
status: complete
priority: p2
issue_id: "002"
tags: [code-review, documentation, quality]
dependencies: []
---

# 저장소 문서의 절대 경로 링크 제거

README와 개발 문서가 `/Users/jylkim/kqmd/...` 형태의 절대 경로 링크를 사용하고 있다. 이 링크는 작성자 로컬 환경에서만 동작하고, 다른 개발자/CI/GitHub/npm tarball 환경에서는 깨진다.

## Problem Statement

문서 링크가 저장소 외부의 로컬 파일 시스템 경로에 묶여 있으면, 문서를 읽는 대부분의 환경에서 링크가 무의미해진다. 특히 README는 사용자/기여자가 가장 먼저 보는 문서이므로, 링크가 깨지면 프로젝트 신뢰도와 탐색성이 바로 떨어진다.

## Findings

- `README.md:55-58`에 개발 문서와 계획 문서를 `/Users/jylkim/kqmd/...` 절대 경로로 링크하고 있다.
- `docs/development.md:4`, `docs/development.md:35-45`, `docs/development.md:78-80`에도 같은 패턴이 반복된다.
- `docs/architecture/kqmd-command-boundary.md:9-13` 역시 절대 경로 링크를 사용한다.
- 이 링크 패턴은 GitHub 렌더링, 다른 개발자 로컬 clone, npm pack 산출물 README 어디에서도 이식 가능하지 않다.

## Proposed Solutions

### Option 1: 상대 경로 링크로 전환

**Approach:** 문서 내 링크를 모두 저장소 기준 상대 경로로 바꾼다.

**Pros:**
- GitHub, 로컬 clone, 에디터 미리보기에서 모두 동작한다
- 가장 단순하고 유지보수 비용이 낮다

**Cons:**
- 문서 간 상대 경로를 맞춰야 한다

**Effort:** Small

**Risk:** Low

---

### Option 2: 링크를 텍스트 경로로만 남기기

**Approach:** 클릭 가능한 링크 대신 plain path를 적는다.

**Pros:**
- 절대 경로 문제는 사라진다

**Cons:**
- 탐색성이 떨어진다
- README 사용성이 나빠진다

**Effort:** Small

**Risk:** Low

## Recommended Action

문서 링크를 모두 저장소 상대 경로로 전환한다. README는 `docs/...`, `docs/` 아래 문서는 해당 디렉터리 기준 상대 경로를 사용한다.

## Technical Details

**Affected files:**
- `README.md`
- `docs/development.md`
- `docs/architecture/kqmd-command-boundary.md`
- `docs/architecture/upstream-compatibility-policy.md` (향후 동일 패턴 여부 확인)

**Related components:**
- 저장소 문서 렌더링
- GitHub README 표시
- 개발자 온보딩 문서

## Resources

- Review branch: `feat/kqmd-replacement-distribution-scaffold`
- Review target commit: `4151362`

## Acceptance Criteria

- [x] 저장소 문서에서 `/Users/...` 절대 경로 링크가 제거된다
- [x] README와 내부 문서 링크가 상대 경로 또는 저장소 친화적 링크로 바뀐다
- [x] GitHub 렌더링 기준으로 링크가 자연스럽게 동작한다

## Work Log

### 2026-03-11 - Code Review Finding

**By:** Codex

**Actions:**
- Reviewed current branch docs after README 역할 분리 작업
- Found repeated absolute-path link pattern across README/development/architecture docs
- Categorized as P2 because it breaks documentation for every environment except the author's machine

**Learnings:**
- 문서 리뷰에서는 내용뿐 아니라 링크 이식성도 같이 봐야 한다
- 앱 응답용 절대 경로 포맷을 저장소 문서에 그대로 넣으면 쉽게 이런 문제가 생긴다

### 2026-03-11 - Todo Resolved

**By:** Codex

**Actions:**
- `README.md`, `docs/development.md`, `docs/architecture/kqmd-command-boundary.md`의 절대 경로 링크를 모두 상대 경로 링크로 변경
- 문서 예시 실행 경로도 저장소 기준으로 다시 정리
- `/Users/...` 패턴이 남아 있는지 grep으로 재검증

**Learnings:**
- 앱 응답용 파일 링크 규칙과 저장소 문서 링크 규칙은 분리해서 관리해야 한다
- README에서부터 상대 경로 원칙을 지키지 않으면 문서 전체가 쉽게 비이식적으로 변한다
