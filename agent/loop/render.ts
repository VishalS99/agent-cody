import { logLedger, visualLines } from "../../config/logger.js";
import {
  ANSI_DIM_GREY,
  ANSI_RESET,
  DEFAULT_SCREEN_ROWS,
  HORIZONTAL_SEPARATOR,
  REPLY_PREFIX,
  TOOLS_CALLED_ANNOTATION,
} from "../constants.js";

export function renderTurnOutput(
  ledgerStart: number,
  streamed: string,
  segments: string[],
  boundaries: number[],
): void {
  if (process.stdout.isTTY && streamed.length > 0) {
    const blockLogs = logLedger.slice(ledgerStart);
    const blockLines = blockLogs.reduce((a, e) => a + e.lines, 0);
    const up = blockLines + visualLines(streamed) - (blockLogs.length + 1);
    const screenRows = process.stdout.rows ?? DEFAULT_SCREEN_ROWS;
    if (up >= 0 && up < screenRows) {
      process.stdout.write(`\x1b[${up}A\x1b[J`);
      process.stdout.write(REPLY_PREFIX);
      for (const entry of blockLogs) process.stdout.write(entry.text);
      let annotated = "";
      segments.forEach((seg, i) => {
        const rendered = Bun.markdown.ansi(seg);
        annotated += rendered;
        if (!rendered.endsWith("\n")) annotated += "\n";
        const hadTools = logLedger.slice(boundaries[i], boundaries[i + 1]).length > 0;
        if (hadTools) annotated += TOOLS_CALLED_ANNOTATION;
      });
      process.stdout.write(annotated);
      process.stdout.write(
        `${ANSI_DIM_GREY}${HORIZONTAL_SEPARATOR.repeat(process.stdout.columns ?? 80)}${ANSI_RESET}\n`,
      );
    } else {
      process.stdout.write("\n");
    }
  } else {
    process.stdout.write("\n");
    process.stdout.write(`${ANSI_DIM_GREY}${HORIZONTAL_SEPARATOR.repeat(process.stdout.columns ?? 80)}${ANSI_RESET}\n`);
  }
}
