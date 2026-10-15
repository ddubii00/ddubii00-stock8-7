import { timeAtLogical, logicalAtTime, distanceToTrendLine } from './trend-geometry.js';
import { makeId } from './shared-dashboard.js';
const SVG = 'http://www.w3.org/2000/svg';
export class TrendEditor {
  constructor(state, getLines, onChange) {
    this.state = state;
    this.getLines = getLines;
    this.onChange = onChange;
    this.stage = state.card.querySelector('.chart-stage');
    this.toolbar = state.card.querySelector('.trend-toolbar');
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.classList.add('trend-overlay');
    this.svg.setAttribute('aria-label', '추세선');
    state.card.append(this.svg);
    this.handlers = new AbortController();
    const listen = (target, event, handler, options = {}) => target.addEventListener(event, handler, {...options, signal: this.handlers.signal});
    this.toolbar.querySelector('.draw-line').addEventListener('click', () => {
      this.drawing = !this.drawing; this.selected = null; this.draft = null; this.repaint();
    });
    this.toolbar.querySelector('.delete-line').addEventListener('click', () => this.remove());
    this.toolbar.querySelector('.line-width').addEventListener('click', () => {
      const line = this.getLines().find(line => line.id === this.selected);
      if (line) this.onChange([{ type: 'upsertLine', symbol: state.item.symbol, line: {...line, width: line.width % 3 + 1} }]);
    });
    listen(state.card, 'pointerdown', event => this.down(event), {capture: true});
    listen(document, 'pointermove', event => {
      if (this.drag) {
        const anchor = this.anchorAt(event);
        if (anchor) this.draft = {...this.drag.line, [this.drag.endpoint || 'end']: anchor};
      }
      this.schedule();
    });
    listen(document, 'pointerup', event => this.finish(event));
    listen(document, 'pointercancel', () => this.cancel());
    listen(this.stage, 'dblclick', () => this.schedule());
    listen(state.card, 'keydown', event => {
      if (event.target.closest('input, textarea, select')) return;
      if (event.key === 'Escape') { this.cancel(); this.selected = null; this.repaint(); }
      if (['Delete', 'Backspace'].includes(event.key) && this.selected) { event.preventDefault(); this.remove(); }
    });
    this.schedule = this.schedule.bind(this);
    state.instance.chart.timeScale().subscribeVisibleLogicalRangeChange(this.schedule);
    this.observer = new ResizeObserver(this.schedule);
    this.observer.observe(this.stage);
    this.repaint();
  }
  schedule() { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.repaint()); }
  project(anchor) {
    const logical = logicalAtTime(this.state.rows, anchor.time);
    return { x: logical == null ? null : this.state.instance.chart.timeScale().logicalToCoordinate(logical), y: this.state.instance.candleSeries.priceToCoordinate(anchor.price) };
  }
  repaint() {
    if (this.state.disposed) return;
    const scale = this.state.instance.chart.timeScale();
    this.width = scale.width();
    this.height = this.stage.clientHeight - 28;
    this.svg.setAttribute('width', this.width);
    this.svg.setAttribute('height', this.height);
    const lines = this.getLines();
    this.points = (this.draft ? [...lines.filter(line => line.id !== this.draft.id), this.draft] : lines)
      .map(line => ({...line, a: this.project(line.start), b: this.project(line.end)}))
      .filter(line => [line.a.x, line.a.y, line.b.x, line.b.y].every(Number.isFinite));
    this.svg.replaceChildren();
    for (const line of this.points) {
      const segment = document.createElementNS(SVG, 'line');
      for (const [key, value] of Object.entries({x1:line.a.x, y1:line.a.y, x2:line.b.x, y2:line.b.y, stroke:'#111827', 'stroke-width':line.width})) segment.setAttribute(key, value);
      this.svg.append(segment);
      if (line.id === this.selected) for (const point of [line.a, line.b]) {
        const circle = document.createElementNS(SVG, 'circle');
        for (const [key,value] of Object.entries({cx:point.x,cy:point.y,r:5,fill:'#fff',stroke:'#111827','stroke-width':1.5})) circle.setAttribute(key,value);
        this.svg.append(circle);
      }
    }
    const button = this.toolbar.querySelector('.draw-line');
    button.classList.toggle('active', !!this.drawing);
    button.setAttribute('aria-pressed', String(!!this.drawing));
    this.stage.classList.toggle('drawing-line', !!this.drawing);
    this.stage.classList.toggle('editing-line', !!(this.drawing || this.selected));
    this.toolbar.querySelector('.delete-line').disabled = !lines.length;
    this.toolbar.querySelector('.line-width').disabled = !lines.some(line => line.id === this.selected);
    this.toolbar.querySelector('.line-width').textContent = `굵기${this.selected ? ' ' + (lines.find(line => line.id === this.selected)?.width || 1) : ''}`;
  }
  anchorAt(event) {
    const box = this.stage.getBoundingClientRect();
    const x = Math.max(0, Math.min(this.width, event.clientX - box.left));
    const y = Math.max(0, Math.min(this.height, event.clientY - box.top));
    const time = timeAtLogical(this.state.rows, this.state.instance.chart.timeScale().coordinateToLogical(x));
    const price = this.state.instance.candleSeries.coordinateToPrice(y);
    return time != null && Number.isFinite(price) ? {time,price} : null;
  }
  down(event) {
    if ((event.button !== 0 && event.pointerType !== 'touch') || !this.stage.contains(event.target)) return;
    const box = this.stage.getBoundingClientRect();
    const point = {x:event.clientX-box.left, y:event.clientY-box.top};
    if (point.x < 0 || point.x > this.width || point.y < 0 || point.y > this.height) return;
    let line, endpoint;
    if (this.drawing) {
      const anchor = this.anchorAt(event);
      if (!anchor) return;
      line = {id:makeId(),start:anchor,end:anchor,width:1};
    } else {
      const selected = this.points.find(line => line.id === this.selected);
      if (selected) for (const key of ['start','end']) {
        const p = key === 'start' ? selected.a : selected.b;
        if (Math.hypot(point.x-p.x,point.y-p.y) <= 9) { line=selected; endpoint=key; break; }
      }
      if (!line) {
        const hit = [...this.points].reverse().find(line => distanceToTrendLine(point,line) <= 7);
        this.selected = hit?.id || null;
        if (!hit) { this.repaint(); return; }
        event.preventDefault(); event.stopImmediatePropagation(); this.state.card.focus({preventScroll:true}); this.repaint(); return;
      }
    }
    event.preventDefault(); event.stopImmediatePropagation();
    this.selected = line.id;
    const clean = {id:line.id,start:line.start,end:line.end,width:line.width};
    this.drag = {line:clean,endpoint,x:event.clientX,y:event.clientY,symbol:this.state.item.symbol};
    this.draft = clean;
    this.state.card.focus({preventScroll:true});
    this.state.card.setPointerCapture(event.pointerId);
    this.state.instance.chart.applyOptions({handleScroll:{pressedMouseMove:false,horzTouchDrag:false,vertTouchDrag:false}});
    this.repaint();
  }
  finish(event) {
    if (!this.drag) return;
    const drag = this.drag;
    const anchor = this.anchorAt(event);
    if (anchor && (drag.endpoint || Math.hypot(event.clientX-drag.x,event.clientY-drag.y) >= 3) && drag.symbol === this.state.item.symbol) {
      this.onChange([{type:'upsertLine',symbol:drag.symbol,line:{...drag.line,[drag.endpoint||'end']:anchor}}]);
    }
    this.cancel();
  }
  cancel() {
    this.drag = null; this.draft = null; this.drawing = false;
    if (!this.state.disposed) this.state.instance.chart.applyOptions({handleScroll:{pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false}});
    this.repaint();
  }
  remove() {
    const lines = this.getLines();
    const targets = this.selected ? lines.filter(line => line.id === this.selected) : lines;
    if (targets.length) this.onChange(targets.map(line => ({type:'deleteLine',symbol:this.state.item.symbol,id:line.id})));
    this.selected = null; this.cancel();
  }
  reset() { this.selected = null; this.cancel(); }
  destroy() {
    this.handlers.abort(); this.observer.disconnect(); cancelAnimationFrame(this.frame);
    this.state.instance.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.schedule);
    this.svg.remove();
  }
}
