import { describe, expect, it } from 'vitest';
import {
  compose,
  encodePgm,
  imageToGray,
  maskToGray,
  pageCoverage,
  rasterizePage,
  targetDpi,
  type GrayImage,
  type Matrix,
  type PlacedImage,
} from './raster.js';

const A4 = { x0: 0, y0: 0, x1: 595, y1: 842 };

/** A picture with a black square in its top-left quarter. */
function marked(width: number, height: number): GrayImage {
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height / 2; y += 1) for (let x = 0; x < width / 2; x += 1) pixels[y * width + x] = 0;
  return { width, height, pixels };
}

function at(raster: GrayImage, x: number, y: number): number {
  return raster.pixels[Math.round(y) * raster.width + Math.round(x)]!;
}

describe('page pictures for text recognition', () => {
  it('draws an image where it sits on the page, at the chosen resolution', () => {
    // 400×200 points placed 100 pt from the left and 200 pt from the top.
    const image: PlacedImage = { ...marked(800, 400), transform: [400, 0, 0, 200, 100, 442] };
    const raster = rasterizePage([image], A4, 0, 144);
    expect(raster.scale).toBe(2);
    expect([raster.width, raster.height]).toEqual([1190, 1684]);
    expect(at(raster, 300, 450)).toBe(0); // inside the black quarter
    expect(at(raster, 800, 450)).toBe(255); // right half of the image
    expect(at(raster, 300, 700)).toBe(255); // bottom half of the image
    expect(at(raster, 100, 100)).toBe(255); // paper outside the image
  });

  it('averages a fine pattern when shrinking instead of picking pixels', () => {
    const width = 1000;
    const height = 1000;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) pixels[y * width + x] = (x + y) % 2 === 0 ? 0 : 255;
    const raster = rasterizePage([{ width, height, pixels, transform: [595, 0, 0, 842, 0, 0] }], A4, 0, 72);
    expect(at(raster, 300, 400)).toBeGreaterThan(110);
    expect(at(raster, 300, 400)).toBeLessThan(145);
  });

  it('turns images placed a quarter turn, and pages with /Rotate, upright', () => {
    const upright = marked(200, 100);
    // The same picture stored sideways (a quarter turn anticlockwise) and placed with a quarter-turn transform.
    const sideways = new Uint8Array(200 * 100);
    for (let y = 0; y < 200; y += 1) for (let x = 0; x < 100; x += 1) sideways[y * 100 + x] = upright.pixels[x * 200 + (199 - y)]!;
    const square = rasterizePage([{ ...upright, transform: [400, 0, 0, 200, 50, 500] }], A4, 0, 72);
    const turned = rasterizePage([{ width: 100, height: 200, pixels: sideways, transform: [0, -200, 400, 0, 50, 700] }], A4, 0, 72);
    const differences = square.pixels.filter((value, index) => Math.abs(value - turned.pixels[index]!) > 1).length;
    expect(differences).toBe(0);
    expect(at(turned, 150, 192)).toBe(0);

    const rotated = rasterizePage([{ ...upright, transform: [400, 0, 0, 200, 50, 500] }], A4, 90, 72);
    expect([rotated.width, rotated.height]).toEqual([square.height, square.width]);
    // The black corner (top-left of the image) is now at the top right of the picture.
    expect(at(rotated, rotated.width - 1 - 200, 100)).toBe(0);
  });

  it('inverts a page that came out mostly dark', () => {
    const dark: PlacedImage = { width: 10, height: 10, pixels: new Uint8Array(100).fill(10), transform: [595, 0, 0, 842, 0, 0] };
    expect(at(rasterizePage([dark], A4, 0, 72), 10, 10)).toBe(245);
  });

  it('draws pages at 300 dpi, less for very large pages', () => {
    expect(targetDpi(A4)).toBe(300);
    expect(targetDpi({ x0: 0, y0: 0, x1: 2000, y1: 3000 })).toBeLessThan(150);
  });

  it('measures how much of the page an image covers', () => {
    const logo: PlacedImage = { width: 10, height: 10, pixels: new Uint8Array(100), transform: [60, 0, 0, 60, 500, 760] };
    expect(pageCoverage(logo, A4)).toBeLessThan(0.01);
    expect(pageCoverage({ ...logo, transform: [595, 0, 0, 842, 0, 0] }, A4)).toBe(1);
  });

  it('composes transforms like the PDF cm operator', () => {
    const scale: Matrix = [2, 0, 0, 3, 0, 0];
    const move: Matrix = [1, 0, 0, 1, 10, 20];
    // Move inside a scaled space: the offset is scaled too.
    expect(compose(scale, move)).toEqual([2, 0, 0, 3, 20, 60]);
  });
});

describe('pdf.js image data to grey', () => {
  it('reads RGB, RGBA (on white paper) and one-bit images', () => {
    expect(imageToGray({ width: 2, height: 1, kind: 2, data: new Uint8Array([255, 255, 255, 0, 0, 0]) })?.pixels).toEqual(new Uint8Array([255, 0]));
    expect(imageToGray({ width: 1, height: 1, kind: 3, data: new Uint8Array([0, 0, 0, 0]) })?.pixels).toEqual(new Uint8Array([255]));
    // 1 bit per pixel, rows padded to whole bytes; a set bit is white.
    expect(imageToGray({ width: 3, height: 2, kind: 1, data: new Uint8Array([0b1010_0000, 0b0100_0000]) })?.pixels)
      .toEqual(new Uint8Array([255, 0, 255, 0, 255, 0]));
    expect(imageToGray({ width: 2, height: 2, kind: 2, data: new Uint8Array(3) })).toBeNull();
  });

  it('paints a stencil mask’s ink and fixes an inverted one', () => {
    expect(maskToGray({ width: 4, height: 1, data: new Uint8Array([0b1110_0000]) })?.pixels).toEqual(new Uint8Array([255, 255, 255, 0]));
    // Mostly "ink" means the sense was the other way round.
    expect(maskToGray({ width: 4, height: 1, data: new Uint8Array([0b0001_0000]) })?.pixels).toEqual(new Uint8Array([255, 255, 255, 0]));
  });

  it('writes binary PGM', () => {
    const pgm = encodePgm({ width: 2, height: 1, pixels: new Uint8Array([0, 255]) });
    expect(pgm.subarray(0, 11).toString('latin1')).toBe('P5\n2 1\n255\n');
    expect([...pgm.subarray(11)]).toEqual([0, 255]);
  });
});
