export type TerminalViewport = { width: number; height: number };

export function didTerminalViewportChange(
  previous: TerminalViewport | null,
  next: TerminalViewport,
) {
  return previous?.width !== next.width || previous.height !== next.height;
}
