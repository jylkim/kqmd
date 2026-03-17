---
status: complete
priority: p3
issue_id: "053"
tags: [code-review, mcp, http, error-handling, quality]
dependencies: []
---

# Malformed MCP JSON still returns 500

`/query`와 `/mcp`는 malformed JSON을 아직 `400 Bad Request`가 아니라 generic `500`으로 처리합니다.

## Problem Statement

body size cap은 들어갔지만, `JSON.parse()` 예외는 바깥 generic catch로 흘러가 `500 Internal server error`가 됩니다. 이러면 실제 서버 버그와 클라이언트 입력 오류를 구분하기 어렵고, 로컬 비인가 클라이언트가 log noise를 쉽게 만들 수 있습니다.

## Findings

- [`src/mcp/server.ts:751`](../src/mcp/server.ts#L751) 와 [`src/mcp/server.ts:783`](../src/mcp/server.ts#L783) 는 `JSON.parse()`를 직접 호출합니다.
- malformed JSON은 outer catch로 가서 [`src/mcp/server.ts:854`](../src/mcp/server.ts#L854) 의 generic `500` envelope을 탑니다.

## Proposed Solutions

### Option 1: SyntaxError를 400으로 변환

**Approach:** `JSON.parse()` 주위에서 `SyntaxError`를 별도로 잡아 `400 Bad Request`로 반환합니다.

**Pros:**
- 입력 오류와 서버 오류가 분리됩니다
- 로그 품질이 좋아집니다

**Cons:**
- 큰 설계 변화는 아닙니다

**Effort:** Small

**Risk:** Low

## Recommended Action

HTTP body JSON parse를 별도 helper로 감싸서 malformed JSON을 명시적인 `400 Bad Request`로 변환한다.

## Technical Details

**Affected files:**
- `src/mcp/server.ts`
- `test/mcp-http.test.ts`

## Resources

- **Branch:** `feat/adaptive-korean-query-ranking`
- **Commit:** `99b4d2d`

## Acceptance Criteria

- [x] malformed JSON은 `400`으로 내려간다
- [x] generic `500` path는 실제 server-side failure에만 사용된다
- [x] HTTP tests가 parse error envelope를 고정한다

## Work Log

### 2026-03-17 - Initial Review Finding

**By:** Codex

**Actions:**
- `/query`와 `/mcp` JSON parse 경로를 검토
- malformed JSON handling을 P3 todo로 기록

**Learnings:**
- 로컬 도구 표면이라도 parse error를 500으로 뭉개면 운영/디버깅 경험이 나빠진다

### 2026-03-17 - Resolved On Branch

**By:** Codex

**Actions:**
- shared JSON parse helper와 `InvalidJsonBodyError`를 추가해 `/query`와 `/mcp` 모두 malformed body를 400으로 내리도록 변경했다
- parse error가 generic 500 handler로 흘러가지 않도록 catch 분기를 분리했다
- malformed `/query` 및 `/mcp` body 테스트를 추가했다

**Learnings:**
- JSON parse failure를 transport boundary에서 구분하면 실제 서버 결함과 client input fault가 로그/테스트에서 더 선명하게 분리된다
