// Runs a card layout's draw commands on a canvas. All decisions were made in layout.ts; this only paints.
import type { CardLayout, DrawCommand } from './layout'
import type { Fill } from './looks'

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function fill(ctx: Context, value: Fill, width: number, height: number) {
  if (typeof value === 'string') { ctx.fillStyle = value; ctx.fillRect(0, 0, width, height); return }
  // An elliptical radial gradient: a unit circle scaled to the ellipse's radii.
  ctx.save()
  ctx.translate(value.cx, value.cy)
  ctx.scale(value.rx, value.ry)
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  for (const [offset, color] of value.stops) gradient.addColorStop(offset, color)
  ctx.fillStyle = gradient
  ctx.fillRect(-value.cx / value.rx, -value.cy / value.ry, width / value.rx, height / value.ry)
  ctx.restore()
}

function command(ctx: Context, item: DrawCommand, layout: CardLayout, crop?: CanvasImageSource) {
  switch (item.kind) {
    case 'background': fill(ctx, item.fill, layout.width, layout.height); return
    case 'rect':
      ctx.globalAlpha = item.alpha
      ctx.fillStyle = item.color
      if (item.radius) { ctx.beginPath(); ctx.roundRect(item.x, item.y, item.width, item.height, item.radius); ctx.fill() }
      else ctx.fillRect(item.x, item.y, item.width, item.height)
      ctx.globalAlpha = 1
      return
    case 'text':
      ctx.font = item.font
      ctx.letterSpacing = `${item.letterSpacing}px`
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
      ctx.globalAlpha = item.alpha
      ctx.fillStyle = item.color
      ctx.fillText(item.text, item.x, item.y)
      ctx.globalAlpha = 1
      ctx.letterSpacing = '0px'
      return
    case 'image': {
      if (!crop) return
      const { x, y, width, height, radius } = item
      ctx.save()
      ctx.shadowBlur = item.shadow.blur
      ctx.shadowOffsetY = item.shadow.offsetY
      ctx.shadowColor = item.shadow.color
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill()
      ctx.restore()
      ctx.save()
      ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.clip()
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(crop, x, y, width, height)
      ctx.globalCompositeOperation = 'multiply'
      for (const mark of item.marks) {
        ctx.globalAlpha = mark.alpha
        ctx.fillStyle = mark.color
        for (const r of mark.rects) ctx.fillRect(x + r.x1 * width, y + r.y1 * height, (r.x2 - r.x1) * width, (r.y2 - r.y1) * height)
      }
      ctx.restore()
      return
    }
  }
}

/** Paints `layout` onto a context of exactly layout.width × layout.height; `crop` is the picture for its sheet. */
export function drawCard(ctx: Context, layout: CardLayout, crop?: CanvasImageSource) {
  for (const item of layout.commands) command(ctx, item, layout, crop)
}
