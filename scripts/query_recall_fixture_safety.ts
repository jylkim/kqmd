type UnsafePattern = {
  readonly pattern: RegExp;
  readonly reason: string;
};

const UNSAFE_PATTERNS: readonly UnsafePattern[] = [
  { pattern: /\/Users\//, reason: 'absolute-path' },
  { pattern: /https?:\/\//i, reason: 'external-url' },
  { pattern: /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/, reason: 'email-address' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: 'aws-access-key' },
  { pattern: /\b(?:sk|pk|api|token|key)_[A-Za-z0-9_-]{12,}\b/i, reason: 'secret-token' },
  { pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9._-]{20,}\.[A-Za-z0-9._-]{20,}\b/, reason: 'jwt-like-token' },
  { pattern: /\b[0-9a-f]{32,}\b/i, reason: 'long-hex-secret' },
];

const SAFE_RELATIVE_PATH = /^(docs|notes)\/[A-Za-z0-9._/-]+$/;

export function assertSafeSyntheticText(text: string, label: string): void {
  for (const unsafePattern of UNSAFE_PATTERNS) {
    if (unsafePattern.pattern.test(text)) {
      throw new Error(
        `Unsafe synthetic fixture content detected for "${label}" (${unsafePattern.reason}).`,
      );
    }
  }
}

export function assertSafeSyntheticLabel(label: string): void {
  if (!/^[a-z0-9-]+$/.test(label)) {
    throw new Error(`Unsafe synthetic label detected: "${label}".`);
  }
}

export function assertSafeSyntheticPath(path: string): void {
  assertSafeSyntheticText(path, `path:${path}`);

  if (!SAFE_RELATIVE_PATH.test(path)) {
    throw new Error(`Unsafe synthetic path detected: "${path}".`);
  }
}

export function assertSafeSyntheticTexts(
  entries: readonly { readonly label: string; readonly text: string }[],
): void {
  for (const entry of entries) {
    assertSafeSyntheticText(entry.text, entry.label);
  }
}
