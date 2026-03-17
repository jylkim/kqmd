# Contributing to K-QMD

K-QMD에 기여해 주셔서 감사합니다.

## Before you start

- [README.md](README.md)를 읽고 프로젝트의 목적과 범위를 확인해 주세요.
- 개발 환경 세팅과 프로젝트 구조는 [docs/development.md](docs/development.md)를 참고하세요.
- 명령 경계에 관련된 변경이라면 [docs/architecture/kqmd-command-boundary.md](docs/architecture/kqmd-command-boundary.md)와 [docs/architecture/upstream-compatibility-policy.md](docs/architecture/upstream-compatibility-policy.md)를 같이 봐 주세요.

## Testing

변경 후에는 아래 명령으로 확인해 주세요.

```bash
bun run check
```

변경 범위에 따른 추가 검증은 [docs/development.md](docs/development.md)의 검증 방법 섹션을 참고하세요.

## Pull requests

- 무엇이 바뀌는지보다 먼저, 사용자에게 어떤 동작 변화가 생기는지 설명해 주세요.
- 명령 경계를 바꾸는 PR이라면 어떤 명령이 영향을 받는지 본문에 명시해 주세요.
- CLI help, README, 문서, 테스트 중 함께 갱신해야 할 것이 있다면 같이 맞춰 주세요.
- 새 동작을 주장한다면 그 주장을 뒷받침하는 테스트를 함께 넣어 주세요.

## Issues

버그 리포트를 올릴 때는 아래 정보를 함께 주시면 재현이 빨라집니다.

- 실행한 명령
- 기대한 결과와 실제 결과
- OS, Node.js 버전
- 가능하다면 최소 재현 단계

## Questions and proposals

작은 문서 수정부터 구조적인 제안까지 모두 환영합니다. 방향이 애매하면 이슈나 PR 설명에서 문제 정의와 선택지부터 먼저 열어 주셔도 좋습니다.

## AI coding agents

AI 코딩 에이전트를 활용한 기여도 환영합니다.
