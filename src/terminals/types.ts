/** Anything that behaves like a terminal: a Linux shell, a Cisco IOS console, a cloud CLI. */
export interface Console {
  readonly title: string;
  readonly prompt: string;
  run(line: string): { text: string; clear?: boolean };
  complete(line: string): string;
}
