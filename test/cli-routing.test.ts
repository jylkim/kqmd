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

  test('keeps top-level option parsing minimal while preserving command position', () => {
    const invocation = parseCliInvocation(['--index', 'work', 'status']);

    expect(invocation.indexName).toBe('work');
    expect(invocation.command).toBe('status');
    expect(invocation.route).toEqual({ mode: 'owned', command: 'status' });
  });

  test('treats help-like entrypoints as passthrough', () => {
    expect(parseCliInvocation(['--help']).route).toEqual({
      mode: 'passthrough',
      command: 'help',
    });
    expect(parseCliInvocation(['search', '--help']).route).toEqual({
      mode: 'passthrough',
      command: 'search',
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
