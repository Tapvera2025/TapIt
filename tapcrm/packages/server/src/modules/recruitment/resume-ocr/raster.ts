/**
 * Page pictures for text recognition.
 *
 * A scanned PDF page is one or more images placed on the page by a transform
 * (the transformation matrix maps an image's unit square onto the page). The
 * page is redrawn in grey at a resolution Tesseract reads well, so margins,
 * strips, rotated placement, /Rotate and very large scans all come out as one
 * upright picture of the page.
 */

/** [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export interface GrayImage {
  readonly width: number;
  readonly height: number;
  /** One byte per pixel: 0 black, 255 white; row 0 is the top. */
  readonly pixels: Uint8Array;
}

export interface PlacedImage extends GrayImage {
  /** Maps the image's unit square (y up) onto the page. */
  readonly transform: Matrix;
  /** A stencil mask: only its ink is painted; the rest is see-through. */
  readonly stencil?: boolean;
}

export interface PageBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface PageRaster extends GrayImage {
  /** Raster pixels per PDF point (dpi / 72). */
  readonly scale: number;
}

/**
 * Tesseract is tuned for 300 dpi: low-resolution scans are enlarged to it
 * (a 150 dpi scan of small type went from 56% to 90% word confidence), and
 * sharper ones gain nothing above it.
 */
const OCR_DPI = 300;
/** Bounds memory and time on huge pages. */
const MAX_RASTER_PIXELS = 12_000_000;

/** `m` applied first, then `outer` — the PDF/canvas `transform` operator. */
export function compose(outer: Matrix, m: Matrix): Matrix {
  return [
    outer[0] * m[0] + outer[2] * m[1],
    outer[1] * m[0] + outer[3] * m[1],
    outer[0] * m[2] + outer[2] * m[3],
    outer[1] * m[2] + outer[3] * m[3],
    outer[0] * m[4] + outer[2] * m[5] + outer[4],
    outer[1] * m[4] + outer[3] * m[5] + outer[5],
  ];
}

function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

/** Width and height of an image on the page, in points. */
function placedSize(image: PlacedImage): { readonly width: number; readonly height: number } {
  const [a, b, c, d] = image.transform;
  return { width: Math.hypot(a, b), height: Math.hypot(c, d) };
}

/** The part of the page an image covers, as a share of the page area. */
export function pageCoverage(image: PlacedImage, box: PageBox): number {
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u = 0, v = 0]) => [
    image.transform[0] * u + image.transform[2] * v + image.transform[4],
    image.transform[1] * u + image.transform[3] * v + image.transform[5],
  ] as const);
  const xs = corners.map(([x]) => Math.min(Math.max(x, box.x0), box.x1));
  const ys = corners.map(([, y]) => Math.min(Math.max(y, box.y0), box.y1));
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  const page = (box.x1 - box.x0) * (box.y1 - box.y0);
  return page > 0 ? area / page : 0;
}

/** Resolution for the page picture: 300 dpi, less for pages larger than A3. */
export function targetDpi(box: PageBox): number {
  const area = ((box.x1 - box.x0) / 72) * ((box.y1 - box.y0) / 72);
  return area > 0 && area * OCR_DPI * OCR_DPI > MAX_RASTER_PIXELS ? Math.sqrt(MAX_RASTER_PIXELS / area) : OCR_DPI;
}

/* ------------------------------------------------------------------ *
 * Drawing images onto the page picture
 * ------------------------------------------------------------------ */

/** Resampling weights along one axis of an image placed square to the page. */
interface Taps {
  /** Per output pixel: index of its first tap and how many taps it has. */
  readonly first: Int32Array;
  readonly count: Int32Array;
  /** Per output pixel: the share of it the image covers (edges are partial). */
  readonly coverage: Float32Array;
  readonly source: Int32Array;
  readonly weight: Float32Array;
}

/**
 * `edge(k)` is where the edge before output pixel k falls, in source pixels.
 * Shrinking averages every source pixel an output pixel covers (by overlap);
 * enlarging interpolates between the two nearest.
 */
function axisTaps(outputs: number, sources: number, edge: (k: number) => number): Taps {
  const first = new Int32Array(outputs);
  const count = new Int32Array(outputs);
  const coverage = new Float32Array(outputs);
  const source: number[] = [];
  const weight: number[] = [];
  for (let k = 0; k < outputs; k += 1) {
    let s0 = edge(k);
    let s1 = edge(k + 1);
    if (s0 > s1) [s0, s1] = [s1, s0];
    first[k] = source.length;
    const lo = Math.max(0, s0);
    const hi = Math.min(sources, s1);
    if (!(hi > lo) || !(s1 > s0)) continue;
    coverage[k] = (hi - lo) / (s1 - s0);
    if (s1 - s0 >= 1) {
      for (let i = Math.floor(lo); i < Math.ceil(hi); i += 1) {
        const share = Math.min(hi, i + 1) - Math.max(lo, i);
        if (share > 0) {
          source.push(i);
          weight.push(share / (hi - lo));
        }
      }
    } else {
      const centre = (lo + hi) / 2 - 0.5;
      const below = Math.floor(centre);
      const t = centre - below;
      source.push(Math.min(sources - 1, Math.max(0, below)), Math.min(sources - 1, Math.max(0, below + 1)));
      weight.push(1 - t, t);
    }
    count[k] = source.length - first[k]!;
  }
  return { first, count, coverage, source: Int32Array.from(source), weight: Float32Array.from(weight) };
}

/** The common case — a scan placed square to the page — in two quick separable passes. */
function drawSquare(target: Uint8Array, width: number, height: number, scale: number, box: PageBox, image: PlacedImage): void {
  const [a, , , d, e, f] = image.transform;
  const columns = axisTaps(width, image.width, (k) => ((box.x0 + k / scale - e) / a) * image.width);
  const rows = axisTaps(height, image.height, (k) => (1 - (box.y1 - k / scale - f) / d) * image.height);

  let left = width;
  let right = 0;
  for (let k = 0; k < width; k += 1) {
    if (columns.count[k]! > 0) {
      left = Math.min(left, k);
      right = k + 1;
    }
  }
  let firstRow = image.height;
  let lastRow = -1;
  for (let k = 0; k < height; k += 1) {
    for (let t = rows.first[k]!; t < rows.first[k]! + rows.count[k]!; t += 1) {
      firstRow = Math.min(firstRow, rows.source[t]!);
      lastRow = Math.max(lastRow, rows.source[t]!);
    }
  }
  if (left >= right || lastRow < firstRow) return;

  // Pass 1: every source row the page needs, resampled to the page's columns.
  const span = right - left;
  const across = new Float32Array((lastRow - firstRow + 1) * span);
  for (let row = firstRow; row <= lastRow; row += 1) {
    const from = row * image.width;
    const to = (row - firstRow) * span - left;
    for (let k = left; k < right; k += 1) {
      let sum = 0;
      const end = columns.first[k]! + columns.count[k]!;
      for (let t = columns.first[k]!; t < end; t += 1) sum += image.pixels[from + columns.source[t]!]! * columns.weight[t]!;
      across[to + k] = sum;
    }
  }

  // Pass 2: down the columns, blending partly covered edge pixels with what is underneath.
  for (let k = 0; k < height; k += 1) {
    const end = rows.first[k]! + rows.count[k]!;
    if (rows.count[k] === 0) continue;
    for (let column = left; column < right; column += 1) {
      if (columns.count[column] === 0) continue;
      let sum = 0;
      for (let t = rows.first[k]!; t < end; t += 1) sum += across[(rows.source[t]! - firstRow) * span + column - left]! * rows.weight[t]!;
      const cover = rows.coverage[k]! * columns.coverage[column]!;
      const index = k * width + column;
      const below = target[index]!;
      const value = Math.round(sum * cover + below * (1 - cover));
      target[index] = image.stencil ? Math.min(below, value) : value;
    }
  }
}

/** An image placed a quarter turn from square, turned so it is square again. */
function quarterTurned(image: PlacedImage): PlacedImage {
  const { width, height, pixels } = image;
  const turned = new Uint8Array(width * height);
  // Turned picture: `height` wide and `width` tall; (x, y) shows (width-1-y, height-1-x).
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < height; x += 1) turned[y * height + x] = pixels[(height - 1 - x) * width + (width - 1 - y)]!;
  }
  const [, b, c, , e, f] = image.transform;
  return { width: height, height: width, pixels: turned, transform: [c, 0, 0, b, e, f], ...(image.stencil ? { stencil: true } : {}) };
}

/** Any other angle: sample each page pixel through the inverse transform (slow, and rare). */
function drawSampled(target: Uint8Array, width: number, height: number, scale: number, box: PageBox, image: PlacedImage): void {
  const inverse = invert(image.transform);
  if (!inverse) return;
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u = 0, v = 0]) => [
    (image.transform[0] * u + image.transform[2] * v + image.transform[4] - box.x0) * scale,
    (box.y1 - (image.transform[1] * u + image.transform[3] * v + image.transform[5])) * scale,
  ] as const);
  const left = Math.max(0, Math.floor(Math.min(...corners.map(([x]) => x))));
  const right = Math.min(width, Math.ceil(Math.max(...corners.map(([x]) => x))));
  const top = Math.max(0, Math.floor(Math.min(...corners.map(([, y]) => y))));
  const bottom = Math.min(height, Math.ceil(Math.max(...corners.map(([, y]) => y))));
  const size = placedSize(image);
  const steps = Math.min(2, Math.max(1, Math.ceil(Math.max(image.width / (size.width * scale), image.height / (size.height * scale)))));
  for (let ry = top; ry < bottom; ry += 1) {
    for (let rx = left; rx < right; rx += 1) {
      let sum = 0;
      let count = 0;
      for (let sy = 0; sy < steps; sy += 1) {
        for (let sx = 0; sx < steps; sx += 1) {
          const px = box.x0 + (rx + (sx + 0.5) / steps) / scale;
          const py = box.y1 - (ry + (sy + 0.5) / steps) / scale;
          const u = inverse[0] * px + inverse[2] * py + inverse[4];
          const v = inverse[1] * px + inverse[3] * py + inverse[5];
          if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
          const x = Math.min(image.width - 1, Math.floor(u * image.width));
          const y = Math.min(image.height - 1, Math.floor((1 - v) * image.height));
          sum += image.pixels[y * image.width + x]!;
          count += 1;
        }
      }
      if (count === 0) continue;
      const index = ry * width + rx;
      const below = target[index]!;
      const value = Math.round((sum + below * (steps * steps - count)) / (steps * steps));
      target[index] = image.stencil ? Math.min(below, value) : value;
    }
  }
}

function drawImage(target: Uint8Array, width: number, height: number, scale: number, box: PageBox, image: PlacedImage): void {
  if (image.width === 0 || image.height === 0) return;
  const [a, b, c, d] = image.transform;
  const tiny = 1e-6 * Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (Math.abs(b) <= tiny && Math.abs(c) <= tiny && Math.abs(a) > tiny && Math.abs(d) > tiny) {
    drawSquare(target, width, height, scale, box, image);
  } else if (Math.abs(a) <= tiny && Math.abs(d) <= tiny && Math.abs(b) > tiny && Math.abs(c) > tiny) {
    drawSquare(target, width, height, scale, box, quarterTurned(image));
  } else {
    drawSampled(target, width, height, scale, box, image);
  }
}

/** Turns the raster clockwise by the page's /Rotate, so the text is upright. */
function rotate(raster: PageRaster, degrees: number): PageRaster {
  const turns = (((Math.round(degrees / 90) % 4) + 4) % 4);
  if (turns === 0) return raster;
  const { width, height, pixels } = raster;
  const outWidth = turns % 2 === 0 ? width : height;
  const outHeight = turns % 2 === 0 ? height : width;
  const out = new Uint8Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const [sx, sy] = turns === 1 ? [y, height - 1 - x] : turns === 2 ? [width - 1 - x, height - 1 - y] : [width - 1 - y, x];
      out[y * outWidth + x] = pixels[sy * width + sx]!;
    }
  }
  return { width: outWidth, height: outHeight, pixels: out, scale: raster.scale };
}

/** One upright grey picture of the page with every image drawn where it sits. */
export function rasterizePage(images: readonly PlacedImage[], box: PageBox, rotation = 0, dpi = targetDpi(box)): PageRaster {
  const scale = dpi / 72;
  const width = Math.max(1, Math.ceil((box.x1 - box.x0) * scale));
  const height = Math.max(1, Math.ceil((box.y1 - box.y0) * scale));
  const pixels = new Uint8Array(width * height).fill(255);
  for (const image of images) drawImage(pixels, width, height, scale, box, image);

  // A page that came out mostly dark was decoded with its colours swapped.
  let total = 0;
  for (const value of pixels) total += value;
  if (total / pixels.length < 100) for (let index = 0; index < pixels.length; index += 1) pixels[index] = 255 - pixels[index]!;

  return rotate({ width, height, pixels, scale }, rotation);
}

/* ------------------------------------------------------------------ *
 * pdf.js image data → grey
 * ------------------------------------------------------------------ */

/** pdf.js ImageKind values. */
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

export interface PdfImageData {
  readonly width: number;
  readonly height: number;
  readonly kind?: number;
  readonly data?: Uint8Array | Uint8ClampedArray;
}

/** Grey pixels from a decoded pdf.js image, or null for a format we do not read. */
export function imageToGray(image: PdfImageData): GrayImage | null {
  const { width, height, kind, data } = image;
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const pixels = new Uint8Array(width * height);
  if (kind === GRAYSCALE_1BPP) {
    const rowBytes = (width + 7) >> 3;
    if (data.length < rowBytes * height) return null;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
        pixels[y * width + x] = bit ? 255 : 0;
      }
    }
    return { width, height, pixels };
  }
  if (kind === RGB_24BPP || kind === RGBA_32BPP) {
    const channels = kind === RGB_24BPP ? 3 : 4;
    if (data.length < width * height * channels) return null;
    for (let index = 0, offset = 0; index < pixels.length; index += 1, offset += channels) {
      const luminance = (data[offset]! * 299 + data[offset + 1]! * 587 + data[offset + 2]! * 114) / 1000;
      const alpha = channels === 4 ? data[offset + 3]! / 255 : 1;
      pixels[index] = Math.round(luminance * alpha + 255 * (1 - alpha));
    }
    return { width, height, pixels };
  }
  return null;
}

/**
 * A stencil mask (black-and-white scans are often drawn this way): a 0 bit is
 * ink. Ink covering most of the mask means its sense was inverted.
 */
export function maskToGray(mask: { readonly width: number; readonly height: number; readonly data?: Uint8Array | Uint8ClampedArray }): GrayImage | null {
  const { width, height, data } = mask;
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const rowBytes = (width + 7) >> 3;
  if (data.length < rowBytes * height) return null;
  const pixels = new Uint8Array(width * height);
  let ink = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bit = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
      pixels[y * width + x] = bit ? 255 : 0;
      if (!bit) ink += 1;
    }
  }
  if (ink > pixels.length / 2) for (let index = 0; index < pixels.length; index += 1) pixels[index] = 255 - pixels[index]!;
  return { width, height, pixels };
}

/** Binary PGM (P5): the simplest picture format Tesseract reads. */
export function encodePgm(image: GrayImage): Buffer {
  const header = Buffer.from(`P5\n${image.width} ${image.height}\n255\n`, 'latin1');
  return Buffer.concat([header, Buffer.from(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength)]);
}
