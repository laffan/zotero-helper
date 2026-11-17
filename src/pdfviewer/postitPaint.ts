// Post-its painted into a raster — the thumbnail grid, the folded view's
// strips and the notepad's clips, which draw a page's annotations into
// their canvases (paint.ts). On the pages themselves a post-it is a live
// overlay (postits.ts), so the pages' own rasters leave them out.
//
// Drawn as the overlay looks at rest: the paper in its colour, 70%
// opaque, pared down by its crop, the grip a shade darker across its
// top, the words wrapped inside its margins and the writing over them.
import type { Annotation } from "../lib/highlights";
import {
  POSTIT_FONT, POSTIT_GRIP, POSTIT_INK, POSTIT_LINE, POSTIT_PAD, POSTIT_PEN, postItsOf, wrapLines,
} from "../lib/postits";
import type { PageViewport } from "./types";

/** Paint the post-its on page `pageIndex` among `annotations`. */
export function drawPostIts(
  ctx: CanvasRenderingContext2D,
  viewport: PageViewport,
  annotations: Annotation[],
  pageIndex: number,
): void {
  const k = viewport.scale;
  for (const p of postItsOf(annotations)) {
    if (p.pageIndex !== pageIndex) continue;
    const [x1, y1, x2, y2] = p.rect;
    const [ax, ay] = viewport.convertToViewportPoint(x1, y2);
    const [bx, by] = viewport.convertToViewportPoint(x2, y1);
    const left = Math.min(ax, bx);
    const top = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    // What shows at rest: the paper pared down by its crop.
    const [cl, cr, cb] = p.crop.map((v) => v * k);
    const shown = { x: left + cl, y: top, w: Math.max(0, w - cl - cr), h: Math.max(0, Math.abs(by - ay) - cb) };
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = p.color;
    ctx.fillRect(shown.x, shown.y, shown.w, shown.h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgb(0 0 0 / 0.07)";
    ctx.fillRect(shown.x, shown.y, shown.w, POSTIT_GRIP * k);
    ctx.beginPath();
    ctx.rect(shown.x, shown.y, shown.w, shown.h);
    ctx.clip();
    if (p.text.trim()) {
      ctx.fillStyle = POSTIT_INK;
      ctx.font = `${POSTIT_FONT * k}px -apple-system, system-ui, sans-serif`;
      ctx.textBaseline = "top";
      const lines = wrapLines(p.text, w - 2 * POSTIT_PAD * k, (s) => ctx.measureText(s).width);
      const step = POSTIT_FONT * POSTIT_LINE * k;
      lines.forEach((line, i) => ctx.fillText(line, left + POSTIT_PAD * k, top + (POSTIT_GRIP + POSTIT_PAD / 2) * k + i * step));
    }
    ctx.strokeStyle = POSTIT_INK;
    ctx.lineWidth = Math.max(0.5, POSTIT_PEN * k);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of p.strokes) {
      ctx.beginPath();
      for (let i = 0; i + 1 < s.length; i += 2) {
        const [x, y] = viewport.convertToViewportPoint(x1 + s[i], y2 - s[i + 1]);
        if (i === 0) ctx.moveTo(x, y);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
