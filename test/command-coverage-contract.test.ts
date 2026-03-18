import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { OWNED_COMMANDS, PASSTHROUGH_COMMANDS } from '../src/commands/manifest.js';

/**
 * upstream @tobilu/qmd CLI 소스에서 top-level command를 직접 추출한다.
 *
 * qmd.js의 메인 switch는 `switch (cli.command) {` 이후,
 * 들여쓰기 8칸(spaces)에 있는 `case "xxx":` 들이 top-level command다.
 * nested switch(subcommand)의 case는 12칸 이상이므로 자동 제외된다.
 *
 * alias(vector-search, deep-search 등)는 같은 case branch를 공유하며,
 * 사용자에게 노출되는 canonical name만 manifest에 등록하면 된다.
 */
function extractUpstreamCommands(): string[] {
  const upstreamCliPath = resolve(
    import.meta.dirname,
    '../node_modules/@tobilu/qmd/dist/cli/qmd.js',
  );
  const source = readFileSync(upstreamCliPath, 'utf-8');

  // `switch (cli.command) {` 블록 위치를 찾는다
  const switchIndex = source.indexOf('switch (cli.command)');
  if (switchIndex === -1) {
    throw new Error('Could not find `switch (cli.command)` in upstream qmd.js');
  }

  const switchBlock = source.slice(switchIndex);

  // default: 이전까지의 top-level case만 추출 (8칸 들여쓰기)
  const casePattern = /^        case "([^"]+)":/gm;
  const commands: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = casePattern.exec(switchBlock)) !== null) {
    // default: 를 만나면 멈춘다
    const beforeMatch = switchBlock.slice(0, match.index);
    if (beforeMatch.includes('\n        default:')) {
      break;
    }

    commands.push(match[1]);
  }

  if (commands.length === 0) {
    throw new Error('Extracted zero commands from upstream qmd.js — parser is broken');
  }

  return [...new Set(commands)];
}

/** upstream이 undocumented alias로 취급하는 command들. canonical name이 이미 등록되어 있으므로 제외. */
const KNOWN_ALIASES = new Set(['vector-search', 'deep-search']);

describe('command coverage contract', () => {
  const upstreamCommands = extractUpstreamCommands();
  const canonicalUpstream = upstreamCommands.filter((cmd) => !KNOWN_ALIASES.has(cmd));
  const covered = new Set([...OWNED_COMMANDS, ...PASSTHROUGH_COMMANDS]);

  test('extracts a reasonable number of upstream commands', () => {
    // 삼중 안전장치: upstream이 너무 적게 추출되면 파서가 깨진 것
    expect(upstreamCommands.length).toBeGreaterThanOrEqual(10);
  });

  test('owned + passthrough commands cover all upstream commands', () => {
    const missing = canonicalUpstream.filter((command) => !covered.has(command));

    expect(missing).toEqual([]);
  });

  test('manifest does not contain commands absent from upstream surface', () => {
    const upstreamSet = new Set(canonicalUpstream);
    const allManifest = [...OWNED_COMMANDS, ...PASSTHROUGH_COMMANDS];
    const extra = allManifest.filter((command) => !upstreamSet.has(command));

    expect(extra).toEqual([]);
  });
});
