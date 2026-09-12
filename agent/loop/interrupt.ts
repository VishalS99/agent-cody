import { stdin as input, stdout as output } from "node:process";
import type { Interface } from "node:readline/promises";
import { CLI_INPUT_PROMPT } from "../constants.js";

interface KeypressKey {
  name?: string;
  ctrl?: boolean;
}

type KeypressHandler = (chunk: unknown, key?: KeypressKey) => void;

function clearInput(): void {
  output.write("\u001b[2K\r");
}

const REPROMPT_AFTER_ABORT = CLI_INPUT_PROMPT.replace(/^\n/, "");

export interface QuestionTicket {
  query: string;
  signal: AbortSignal;
}

/**
 * Owns Ctrl+C handling for the input loop: first press aborts the pending
 * question and reprompts, two consecutive presses request exit.
 *
 * Deferral note: Bun (1.3.x) drops an abort issued synchronously inside
 * readline's own SIGINT dispatch, leaving question() pending forever, so the
 * abort runs on the next tick. Harmless on Node, where sync abort also works.
 */
export class InterruptController {
  private rl: Interface;
  private onExit: () => void;
  private interrupted = false;
  private exitRequested = false;
  private aborter: AbortController | null = null;
  private redrawSameRow = false;

  private onKeypress: KeypressHandler = (_chunk, key) => {
    if (key?.name !== "c" || !key.ctrl) {
      this.interrupted = false;
    }
  };

  private onSigint = (): void => {
    if (this.interrupted) {
      this.exitRequested = true;
    }
    this.interrupted = true;
    const current = this.aborter;
    if (current && !current.signal.aborted) {
      if (!this.exitRequested) clearInput();
      setImmediate(() => current.abort());
    } else if (this.exitRequested) {
      this.onExit();
    }
  };

  constructor(rl: Interface, onExit: () => void) {
    this.rl = rl;
    this.onExit = onExit;
  }

  attach(): void {
    input.on("keypress", this.onKeypress);
    this.rl.on("SIGINT", this.onSigint);
  }

  detach(): void {
    input.removeListener("keypress", this.onKeypress);
    this.rl.removeListener("SIGINT", this.onSigint);
  }

  beginQuestion(): QuestionTicket {
    this.aborter = new AbortController();
    const query = this.redrawSameRow ? REPROMPT_AFTER_ABORT : CLI_INPUT_PROMPT;
    this.redrawSameRow = false;
    return { query, signal: this.aborter.signal };
  }

  endQuestion(): void {
    this.aborter = null;
  }

  /** True when an aborted question should reprompt instead of exiting. */
  shouldReprompt(err: unknown): boolean {
    this.aborter = null;
    if (err instanceof Error && err.name === "AbortError" && !this.exitRequested) {
      this.redrawSameRow = true;
      return true;
    }
    return false;
  }
}
