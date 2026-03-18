# Changelog

[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 규약을 따릅니다.
버전 형식은 [릴리스 문서](docs/release.md#버전-정책)를 참고하세요.

## [Unreleased]

## [2.0.1-kqmd.2] - 2026-03-18

### Added

- upstream passthrough 명령 등록 누락분 보완 및 owned cleanup coverage contract 추가

### Fixed

- recall comparison 스크립트의 JSON 출력이 code fence로 감싸지지 않던 문제 수정
- package description이 README headline과 불일치하던 문제 수정

### Refactored

- 테스트 공통 헬퍼를 `test/helpers.ts`로 분리

## [2.0.1-kqmd.1] - 2026-03-09

upstream `@tobilu/qmd@2.0.1` 기반 K-QMD 최초 릴리스.

### Added

- CLI scaffold: upstream QMD를 감싸는 kqmd 배포 구조
- owned command store bootstrap (`update`, `status`, `search`, `cleanup`)
- owned command I/O parity contract 테스트
- qwen3 기본 embedding policy 채택
- Kiwi 기반 한국어 형태소 분석 shadow index (`search`)
- MCP server owned boundary (HTTP/stdio 지원)
- adaptive Korean query ranking (형태소 가중치 기반 재정렬)
- Korean recall comparison 벤치마크

### Fixed

- Kiwi 모델 bootstrap 다운로드 실패 문제 수정
- Kiwi shadow index 안정성 강화 (reliability harden)
- owned help contract 정합성 보완
- status/health 명령 리뷰 지적사항 반영
- 릴리스 준비 과정에서 발견된 gap 수정

### Refactored

- MCP `server.ts`를 types, query, http 모듈로 분리
- 상대 경로 import를 `#src/` path alias로 전환
- 중복 코드 통합 및 runtime path alias 수정
- 빌드/워크플로를 bun 기반으로 전환

[Unreleased]: https://github.com/jylkim/kqmd/compare/v2.0.1-kqmd.2...HEAD
[2.0.1-kqmd.2]: https://github.com/jylkim/kqmd/compare/v2.0.1-kqmd.1...v2.0.1-kqmd.2
[2.0.1-kqmd.1]: https://github.com/jylkim/kqmd/releases/tag/v2.0.1-kqmd.1
