import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type * as Tesseract from 'tesseract.js';

/**
 * Text recognition with Tesseract (tesseract.js: the Tesseract engine compiled
 * to WebAssembly). It runs in a worker thread inside the API process with the
 * English model shipped in node_modules, so resumes never leave the server and
 * nothing is downloaded at run time.
 *
 * One worker is shared and jobs run one at a time; it is started on first use
 * and stopped after a few idle minutes, since it holds the model in memory.
 */

export interface OcrWord {
  readonly text: string;
  /** 0–100. */
  readonly confidence: number;
  /** Box in picture pixels, y down. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** The line's baseline under this word (picture pixels). */
  readonly baseline: number;
  /** The type size of the word's line (about one em), in pixels. */
  readonly size: number;
  /** Words of one recognised line share this number. */
  readonly line: number;
}

export interface OcrResult {
  readonly words: readonly OcrWord[];
  /** Mean word confidence, 0–100, or null when no word was read. */
  readonly confidence: number | null;
}

export class OcrTimeoutError extends Error {
  constructor() {
    super('Text recognition took too long');
    this.name = 'OcrTimeoutError';
  }
}

const IDLE_MS = 3 * 60_000;
const PAGE_TIMEOUT_MS = 60_000;

type TesseractModule = typeof Tesseract;

let worker: Promise<Tesseract.Worker> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** The LSTM-only English model ("best", integer-quantised): accurate and 3 MB. */
function languageDirectory(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
}

async function startWorker(): Promise<Tesseract.Worker> {
  const loaded = (await import('tesseract.js')) as TesseractModule & { default?: TesseractModule };
  const tesseract = loaded.default ?? loaded;
  const created = await tesseract.createWorker('eng', tesseract.OEM.LSTM_ONLY, {
    langPath: languageDirectory(),
    gzip: true,
    // Read the model from node_modules each start; never write a copy to disk.
    cacheMethod: 'none',
    logger: () => undefined,
    errorHandler: () => undefined,
  });
  // Automatic page layout: finds the large name at the top that single-block mode drops.
  await created.setParameters({ tessedit_pageseg_mode: tesseract.PSM.AUTO, preserve_interword_spaces: '1' });
  return created;
}

async function stopWorker(): Promise<void> {
  const current = worker;
  worker = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (current) await current.then((instance) => instance.terminate()).catch(() => undefined);
}

function scheduleIdleStop(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { void stopWorker(); }, IDLE_MS);
  idleTimer.unref();
}

/** Runs jobs one at a time on the shared worker. */
function serialized<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OcrTimeoutError()), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function wordsOf(page: Tesseract.Page): OcrWord[] {
  const words: OcrWord[] = [];
  let lineNumber = 0;
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        lineNumber += 1;
        const { baseline, bbox } = line;
        const slope = baseline.x1 !== baseline.x0 ? (baseline.y1 - baseline.y0) / (baseline.x1 - baseline.x0) : 0;
        // Capitals stand about 0.72 em above the baseline; Tesseract's row height
        // (ascenders to descenders) is about 1.15 em. Lines with neither tall
        // letters nor capitals would understate the first, so take the larger.
        const capitals = (baseline.y0 - bbox.y0) / 0.72;
        const row = (line.rowAttributes?.rowHeight ?? 0) / 1.15;
        const size = Math.max(1, capitals, row);
        for (const word of line.words) {
          const text = word.text.trim();
          if (!text) continue;
          const middle = (word.bbox.x0 + word.bbox.x1) / 2;
          words.push({
            text,
            confidence: word.confidence,
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
            baseline: baseline.y0 + slope * (middle - baseline.x0),
            size,
            line: lineNumber,
          });
        }
      }
    }
  }
  return words;
}

/**
 * Reads one page picture (any format Tesseract opens; we send PGM). `dpi`
 * tells Tesseract the scale, which it would otherwise guess.
 */
export function recognizePicture(picture: Buffer, dpi: number): Promise<OcrResult> {
  return serialized(async () => {
    if (idleTimer) clearTimeout(idleTimer);
    try {
      worker ??= startWorker();
      const instance = await worker;
      await instance.setParameters({ user_defined_dpi: String(Math.round(dpi)) });
      const { data } = await withTimeout(instance.recognize(picture, {}, { blocks: true, text: false }), PAGE_TIMEOUT_MS);
      const words = wordsOf(data);
      const letters = words.reduce((sum, word) => sum + word.text.length, 0);
      const confidence = letters > 0
        ? words.reduce((sum, word) => sum + word.confidence * word.text.length, 0) / letters
        : null;
      return { words, confidence };
    } catch (error) {
      // A stuck or broken worker is replaced on the next job.
      await stopWorker();
      throw error;
    } finally {
      if (worker) scheduleIdleStop();
    }
  });
}

/** Stops the worker at once (server shutdown, tests); a job in progress fails. */
export function stopResumeOcr(): Promise<void> {
  return stopWorker();
}
