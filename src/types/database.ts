export interface MinimalStatement {
  get: (...params: (string | number)[]) => unknown;
  all: (...params: (string | number)[]) => unknown[];
  run: (...params: (string | number)[]) => unknown;
}

export interface MinimalDatabase {
  exec(sql: string): void;
  prepare(sql: string): MinimalStatement;
}
