# Query Cold Start Metrics

Date: 2026-03-25
Command: `bun run measure:query-cold-start`

이 문서는 synthetic fixture와 temp HOME/XDG/INDEX_PATH sandbox를 사용해 first-query cold-start wall-clock을 측정한다.
모델 다운로드나 실제 사용자 cache/config/index 재사용 없이 fast-default 계약만 검증한다.

## Method

- fresh child process per case
- synthetic fixture only
- `--json --explain` output에서 retrieval summary를 검증
- stderr, raw query text, absolute path, temp directory path는 artifact에 남기지 않음

## Results

| Fixture | Surface | Retrieval | Heavy path | Fallback | Wall-clock (ms) | Peak RSS |
|---|---|---|---|---|---:|---:|
| english-obsidian-cli | cli-query | fast-default | no | non-hangul | 221.39 | 144.9 MB |
| mixed-obsidian-korean | cli-query | fast-default | no | dirty-health | 254.13 | 130.4 MB |

## Aggregate

- wall-clock p50: 254.13 ms
- wall-clock p95: 254.13 ms
- max wall-clock: 254.13 ms
- max RSS: 144.9 MB

## Schema

```json
{
  "version": "ColdStartQueryBenchmarkV1",
  "generatedAt": "2026-03-25T04:06:52.038Z",
  "rows": [
    {
      "fixtureId": "english-obsidian-cli",
      "surface": "cli-query",
      "retrievalKind": "fast-default",
      "heavyPathUsed": false,
      "fallbackReason": "non-hangul",
      "elapsedMs": 221.39,
      "peakRssBytes": 151896064
    },
    {
      "fixtureId": "mixed-obsidian-korean",
      "surface": "cli-query",
      "retrievalKind": "fast-default",
      "heavyPathUsed": false,
      "fallbackReason": "dirty-health",
      "elapsedMs": 254.13,
      "peakRssBytes": 136740864
    }
  ]
}
```
