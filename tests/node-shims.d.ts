// The few Node names the file-checking tests use. There is no @types/node in this
// project (and no reason to add a dependency for three functions).
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { size: number };
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare const __dirname: string;
