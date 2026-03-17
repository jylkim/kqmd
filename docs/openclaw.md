# OpenClaw에서 K-QMD 사용하기

[OpenClaw](https://docs.openclaw.ai)는 메모리 백엔드로 [QMD](https://github.com/tobi/qmd)를 지원합니다. K-QMD는 QMD의 drop-in replacement이므로, QMD 자리에 K-QMD를 설치하면 OpenClaw 설정을 변경하지 않고 한국어 검색 품질을 개선할 수 있습니다.

## 새로 설치

QMD를 사용한 적 없는 OpenClaw 환경에서 처음부터 K-QMD로 시작하는 경우입니다.

```bash
npm install -g kqmd
```

이후 `~/.openclaw/openclaw.json`에서 `memory.backend`를 `"qmd"`로 설정하면 됩니다. 나머지 설정은 [OpenClaw 공식 메모리 문서](https://docs.openclaw.ai/concepts/memory)를 참고하세요.

```json5
memory: {
  backend: "qmd"
}
```

## 기존 QMD에서 마이그레이션

이미 QMD를 메모리 백엔드로 사용 중인 경우입니다. 기존 인덱스 DB와 OpenClaw 설정은 그대로 유지됩니다.

### 1. QMD 제거 및 K-QMD 설치

```bash
# 기존 QMD 제거
npm uninstall -g @tobilu/qmd
# bun으로 설치했다면 bun remove -g qmd

# K-QMD 설치
npm install -g kqmd

# 바이너리 확인
qmd --version
```

### 2. 한국어 인덱스 빌드

```bash
qmd update
```

기존 인덱스 위에 한국어 shadow FTS 인덱스가 추가됩니다. 기존 데이터는 변경되지 않습니다.

### 3. 임베딩 재생성 (optional)

K-QMD는 임베딩 모델을 한국어 품질이 나은 Qwen3로 고정합니다. 기존 임베딩이 다른 모델로 생성된 경우 `qmd update` 실행 후 다음 안내가 표시됩니다:

```
Run 'qmd embed --force' to rebuild embeddings for the current model.
```

안내가 표시되면 Qwen3로 임베딩을 재생성하세요. 재생성하지 않아도 BM25 검색은 동작하지만, 벡터 검색 품질이 떨어질 수 있습니다.

## 롤백

```bash
npm uninstall -g kqmd
npm install -g @tobilu/qmd
```

## 문제 해결

### `qmd` 명령이 기존 QMD를 가리키는 경우

```bash
which qmd
```

기존 QMD가 다른 경로에 남아 있을 수 있습니다. 해당 바이너리를 제거하거나, `openclaw.json`에서 절대경로를 지정하세요:

```json5
memory: {
  qmd: {
    command: "/path/to/kqmd/bin/qmd.js"
  }
}
```

### QMD 실패로 SQLite fallback이 되는 경우

OpenClaw는 QMD 바이너리가 없거나 실패하면 내장 SQLite 매니저로 자동 전환합니다. `qmd --version`으로 바이너리가 정상 동작하는지 확인하세요.
