import { ApplicationError } from '../../errors.js';

/**
 * Public applications parse the uploaded resume (PDF text, OCR) inside the
 * request. Unbounded, a burst of uploads, real or not, takes the API's CPU from
 * every other user. This lets a few parses run at once, queues a handful more,
 * and turns the rest away with a "try again shortly" answer.
 */
export class ParseGate {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly maxRunning: number,
    private readonly maxWaiting: number,
  ) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxRunning) {
      if (this.waiting.length >= this.maxWaiting) {
        throw new ApplicationError(
          'We are receiving many applications right now. Please try again in a few minutes.',
          503,
          'APPLICATIONS_BUSY',
        );
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // hand the slot straight to the next in line
      else this.running -= 1;
    }
  }
}

/** Shared by every public application in this process. */
export const publicResumeParseGate = new ParseGate(2, 20);
