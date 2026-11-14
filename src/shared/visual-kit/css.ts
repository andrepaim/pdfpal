// The figure stylesheet. Tokens live on the <svg class="vx-svg"> itself (and on any element with class "vx-tokens", for
// a stage that wants the same canvas colour), dark by default and tuned for the app's dark card; an ancestor or the
// svg with data-theme="paper" switches to the print/export palette. Text sizes and weights come from TEXT, which the
// layout also measures with. No rule dims an item: every visible item is drawn at full strength.
import { TEXT, type TextStyle } from './text.js'

export const VISUAL_FONT_FAMILY = 'Inter Variable'
const FONT = `"${VISUAL_FONT_FAMILY}",Inter,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif`
const font = (style: TextStyle) => `font-size:${style.size}px;font-weight:${style.weight}${style.spacing ? `;letter-spacing:${style.spacing}px` : ''}`
const S = '.vx-svg'

const DARK = `--vx-canvas:#10121c;--vx-hair:#272c3a;--vx-ink:#eceef4;--vx-muted:#9aa3b5;--vx-faint:#5d6679;--vx-grid:rgba(255,255,255,.055);
--vx-neutral:#a7b0c2;--vx-neutral-f:#1d212c;--vx-primary:#8fa2ff;--vx-primary-f:#1b2142;--vx-secondary:#45d0c1;--vx-secondary-f:#0e2b2c;
--vx-accent:#f6bd4f;--vx-accent-f:#302611;--vx-positive:#6fd694;--vx-positive-f:#12301f;--vx-negative:#ff8a8f;--vx-negative-f:#34161c;--vx-font:${FONT}`
const PAPER = `--vx-canvas:#f7f8fa;--vx-hair:#dfe3ea;--vx-ink:#1a1e2a;--vx-muted:#5b6475;--vx-faint:#a3aab8;--vx-grid:rgba(20,30,60,.07);
--vx-neutral:#5f6878;--vx-neutral-f:#eceef2;--vx-primary:#3f51d9;--vx-primary-f:#e6e9fe;--vx-secondary:#0b8a7f;--vx-secondary-f:#daf3f0;
--vx-accent:#ad6f0e;--vx-accent-f:#fbedcc;--vx-positive:#27874c;--vx-positive-f:#dcf2e4;--vx-negative:#cc3d4d;--vx-negative-f:#fbe2e5`

const weights = Array.from({ length: 11 }, (_, k) => `${S} .cell.w${k}{fill-opacity:${(0.08 + 0.08 * k).toFixed(2)}}`).join('')

/** The stylesheet for figures: tokens (dark default, [data-theme=paper]), SVG classes, @font-face is NOT included. */
export const VISUAL_KIT_CSS = `
:where(${S},.vx-tokens){${DARK}}
:where([data-theme=paper]) :where(${S},.vx-tokens),:where(${S},.vx-tokens)[data-theme=paper]{${PAPER}}
${S}{display:block;max-width:100%;height:auto;margin:0 auto;background:var(--vx-canvas);font-family:var(--vx-font);color:var(--vx-ink);-webkit-tap-highlight-color:transparent}
${S} text{font-family:var(--vx-font);font-kerning:normal;font-variant-ligatures:common-ligatures}
${S} .t-neutral{--c:var(--vx-neutral);--f:var(--vx-neutral-f)}${S} .t-primary{--c:var(--vx-primary);--f:var(--vx-primary-f)}
${S} .t-secondary{--c:var(--vx-secondary);--f:var(--vx-secondary-f)}${S} .t-accent{--c:var(--vx-accent);--f:var(--vx-accent-f)}
${S} .t-positive{--c:var(--vx-positive);--f:var(--vx-positive-f)}${S} .t-negative{--c:var(--vx-negative);--f:var(--vx-negative-f)}
${S} .el{transition:opacity .3s ease,transform .3s ease}
${S} .el.is-hidden{opacity:0;transform:translateY(4px);pointer-events:none}
${S} .shape{fill:var(--f);stroke:var(--c);stroke-width:1.25}
${S} .label{fill:var(--vx-ink);${font(TEXT.label)}}
${S} .sub{fill:var(--vx-muted);${font(TEXT.sub)}}
${S} .tag{fill:var(--vx-muted);${font(TEXT.tag)}}
${S} .tinted{fill:var(--c)}
${S} .halo{paint-order:stroke;stroke:var(--vx-canvas);stroke-width:6px;stroke-linejoin:round}
${S} .edge{fill:none;stroke:var(--c);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
${S} .edge.dashed{stroke-dasharray:5 5}
${S} .edge.bracket{stroke-width:1.25}
${S} .t-neutral .edge{stroke:var(--vx-faint)}
${S} .head{fill:var(--c);stroke:none}
${S} .t-neutral .head{fill:var(--vx-faint)}
${S} .chip{fill:var(--vx-canvas)}
${S} .chiptext{fill:var(--c);${font(TEXT.chip)}}
${S} .t-neutral .chiptext{fill:var(--vx-muted)}
${S} .group{fill:none;stroke:var(--vx-faint);stroke-width:1;stroke-dasharray:3 4}
${S} .axis{stroke:var(--vx-faint);stroke-width:1.25;fill:none;stroke-linecap:round}
${S} .gridline{stroke:var(--vx-grid);stroke-width:1}
${S} .tick{fill:var(--vx-muted);${font(TEXT.tick)}}
${S} .curve{fill:none;stroke:var(--c);stroke-width:2.25;stroke-linecap:round;stroke-linejoin:round}
${S} .curve.w-line{stroke-width:1.75}${S} .curve.w-vector{stroke-width:2}${S} .curve.w-ring{stroke-width:1.5}
${S} .curve.dashed{stroke-dasharray:6 6}${S} .curve.w-line.dashed{stroke-dasharray:5 5}${S} .curve.w-ring.dashed{stroke-dasharray:4 5}
${S} .leader{fill:none;stroke:var(--c);stroke-width:1;stroke-opacity:.7;stroke-linecap:round}
${S} .area{fill:var(--c);fill-opacity:.14;stroke:none}
${S} .area.outlined{fill-opacity:.16;stroke:var(--c);stroke-width:1.5}
${S} .dot{fill:var(--c);stroke:var(--vx-canvas);stroke-width:2}
${S} .direct{fill:var(--c);${font(TEXT.direct)};paint-order:stroke;stroke:var(--vx-canvas);stroke-width:4px;stroke-linejoin:round}
${S} .direct.note{fill:var(--vx-muted);font-weight:${TEXT.note.weight}}
${S} .track{fill:var(--vx-hair)}
${S} .bar{fill:var(--c)}
${S} .value{fill:var(--vx-ink);${font(TEXT.value)}}
${S} .cell{fill:var(--f);stroke:var(--c);stroke-width:1}
${S} .cell.weighted{fill:var(--c)}${weights}
${S} .celltext{fill:var(--vx-ink);${font(TEXT.cell)}}
${S} .celltext.on-fill{fill:var(--vx-canvas)}
${S} .rule{stroke:var(--vx-hair);stroke-width:1}
${S} .body{fill:var(--vx-ink);${font(TEXT.body)}}
${S} .hint{fill:var(--c);stroke:var(--vx-canvas);stroke-width:1.5}
${S} .hot{cursor:pointer;outline:none}
${S} .hot .shape{transition:stroke-width .15s ease}
${S} .hot:hover .shape{stroke-width:2}
${S} .hot:focus-visible .shape{stroke:var(--vx-ink);stroke-width:2.25}
${S} .hot.is-selected .shape{stroke-width:2.5}
${S} .hot.is-selected .hint{fill:var(--vx-ink)}
${S} .fallback{fill:var(--vx-muted);font-size:13px}
@media (prefers-reduced-motion:reduce){${S} .el,${S} .hot .shape{transition:none}${S} .el.is-hidden{transform:none}}
`.trim()
