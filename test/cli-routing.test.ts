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
    expect(parseCliInvocation(['search', '--version']).route).toEqual({
      mode: 'passthrough',
      command: 'search',
    });
    expect(parseCliInvocation([]).route).toEqual({
      mode: 'passthrough',
      command: 'help',
    });
  });
});
