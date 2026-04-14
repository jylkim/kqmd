import { describe, expect, test } from 'vitest';

import { parseCliInvocation } from '../src/cli.js';
import { OWNED_COMMANDS, PASSTHROUGH_COMMANDS } from '../src/commands/manifest.js';

describe('CLI routing', () => {
  test('routes owned commands through the manifest', () => {
    const invocation = parseCliInvocation(['search', 'hangul']);

    expect(invocation.route).toEqual({ mode: 'owned', command: 'search' });
    expect(OWNED_COMMANDS).toContain(invocation.command);
    expect(invocation.commandArgs).toEqual(['hangul']);
  });

  test('routes passthrough commands through the manifest', () => {
    const invocation = parseCliInvocation(['collection', 'list']);

    expect(invocation.route).toEqual({ mode: 'passthrough', command: 'collection' });
    expect(PASSTHROUGH_COMMANDS).toContain(invocation.command);
    expect(invocation.commandArgs).toEqual(['list']);
  });

  test('routes skill as passthrough', () => {
    const invocation = parseCliInvocation(['skill', 'show']);

    expect(invocation.route).toEqual({ mode: 'passthrough', command: 'skill' });
    expect(invocation.commandArgs).toEqual(['show']);
  });

  test('routes context as passthrough', () => {
    const invocation = parseCliInvocation(['context', 'add', 'qmd://notes', 'desc']);

    expect(invocation.route).toEqual({ mode: 'passthrough', command: 'context' });
    expect(invocation.commandArgs).toEqual(['add', 'qmd://notes', 'desc']);
  });

  test('routes vsearch as passthrough', () => {
    const invocation = parseCliInvocation(['vsearch', 'query text']);

    expect(invocation.route).toEqual({ mode: 'passthrough', command: 'vsearch' });
    expect(invocation.commandArgs).toEqual(['query text']);
  });

  test('routes pull as passthrough', () => {
    const invocation = parseCliInvocation(['pull']);

    expect(invocation.route).toEqual({ mode: 'passthrough', command: 'pull' });
    expect(invocation.commandArgs).toEqual([]);
  });

  test('routes cleanup as owned', () => {
    const invocation = parseCliInvocation(['cleanup']);

    expect(invocation.route).toEqual({ mode: 'owned', command: 'cleanup' });
    expect(OWNED_COMMANDS).toContain(invocation.command);
    expect(invocation.commandArgs).toEqual([]);
  });

  test('routes bench through the owned manifest', () => {
    const invocation = parseCliInvocation(['bench', 'fixture.json']);

    expect(invocation.route).toEqual({ mode: 'owned', command: 'bench' });
    expect(OWNED_COMMANDS).toContain(invocation.command);
    expect(invocation.commandArgs).toEqual(['fixture.json']);
  });

  test('routes mcp through the owned manifest', () => {
    const invocation = parseCliInvocation(['mcp']);

    expect(invocation.route).toEqual({ mode: 'owned', command: 'mcp' });
    expect(OWNED_COMMANDS).toContain(invocation.command);
    expect(invocation.commandArgs).toEqual([]);
  });

  test('keeps top-level option parsing minimal while preserving command position', () => {
    const invocation = parseCliInvocation(['--index', 'work', 'status']);

    expect(invocation.indexName).toBe('work');
    expect(invocation.command).toBe('status');
    expect(invocation.route).toEqual({ mode: 'owned', command: 'status' });
  });

  test('keeps top-level help passthrough while routing owned command help locally', () => {
    expect(parseCliInvocation(['--help']).route).toEqual({
      mode: 'passthrough',
      command: 'help',
    });
    expect(parseCliInvocation(['-h']).route).toEqual({
      mode: 'passthrough',
      command: 'help',
    });
    expect(parseCliInvocation(['help', 'search']).route).toEqual({
      mode: 'owned',
      command: 'search',
    });
    expect(parseCliInvocation(['help', 'search', '--help']).route).toEqual({
      mode: 'owned',
      command: 'search',
    });
    expect(parseCliInvocation(['help', 'search', '-h']).route).toEqual({
      mode: 'owned',
      command: 'search',
    });
    expect(parseCliInvocation(['help', 'collection']).route).toEqual({
      mode: 'passthrough',
      command: 'help',
    });
    expect(parseCliInvocation(['help', 'collection', '--help']).route).toEqual({
      mode: 'passthrough',
      command: 'help',
    });
    expect(parseCliInvocation(['help', 'nope']).route).toEqual({
      mode: 'passthrough',
      command: 'help',
    });
    expect(parseCliInvocation(['search', '--help']).route).toEqual({
      mode: 'owned',
      command: 'search',
    });
    expect(parseCliInvocation(['search', '-h']).route).toEqual({
      mode: 'owned',
      command: 'search',
    });
    expect(parseCliInvocation(['--help', 'query']).route).toEqual({
      mode: 'owned',
      command: 'query',
    });
    expect(parseCliInvocation(['-h', 'query']).route).toEqual({
      mode: 'owned',
      command: 'query',
    });
    // --version은 runCli에서 parseCliInvocation 전에 처리한다.
    // parseCliInvocation에 도달하면 일반 routing을 따른다.
    expect(parseCliInvocation(['search', '--version']).route).toEqual({
      mode: 'owned',
      command: 'search',
    });
    expect(parseCliInvocation([]).route).toEqual({
      mode: 'passthrough',
      command: 'help',
    });
  });
});
