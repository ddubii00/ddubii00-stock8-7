export function lineBreakPriceState(rows) {
  const last = rows?.at(-1);
  if (!last) return null;
  const previous = rows.at(-2);
  const rising = last.close >= last.open;
  return {
    price: last.close,
    color: rising ? '#d92c2c' : '#1f5bd8',
    reversal: Boolean(previous && last.close !== last.open && previous.close !== previous.open
      && rising !== (previous.close > previous.open))
  };
}

// Keep only the line-break price badge larger; candle labels and axis fonts
// remain native. The primitive lifecycle schedules updates on scale changes.
export class LineBreakPriceBadge {
  constructor(state, enabled, formatPrice) {
    this.state = state;
    this.enabled = enabled;
    this.formatPrice = formatPrice;
    this.element = document.createElement('div');
    this.element.className = 'line-break-price-badge';
    this.element.hidden = true;
    this.reversal = document.createElement('span');
    this.reversal.className = 'price-reversal';
    this.reversal.textContent = '전환';
    this.reversal.hidden = true;
    this.value = document.createElement('strong');
    this.element.append(this.reversal, this.value);
    state.card.append(this.element);
    state.instance.candleSeries.attachPrimitive(this);
  }
  attached() { this.updateAllViews(); }
  detached() { cancelAnimationFrame(this.frame); this.frame = 0; }
  updateAllViews() {
    if (this.frame || this.state.disposed) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }
  render() {
    const state = this.state;
    const latest = lineBreakPriceState(state.rows);
    const y = latest ? state.instance.candleSeries.priceToCoordinate(latest.price) : null;
    const stage = state.card.querySelector('.chart-stage');
    const plotHeight = stage.clientHeight - state.instance.chart.timeScale().height();
    this.element.hidden = !this.enabled() || !state.visible.candle || !latest || !Number.isFinite(y) || y < 0 || y > plotHeight;
    if (this.element.hidden) return;
    this.value.textContent = this.formatPrice(latest.price);
    this.element.style.setProperty('--badge-color', latest.color);
    this.element.style.top = `${stage.offsetTop + y}px`;
    this.element.style.left = `${stage.offsetLeft + state.instance.chart.timeScale().width() + 2}px`;
    this.element.style.maxWidth = `${state.instance.chart.priceScale('right').width() - 4}px`;
    this.element.dataset.price = String(latest.price);
    this.reversal.hidden = !latest.reversal;
  }
  destroy() {
    this.state.instance.candleSeries.detachPrimitive(this);
    this.detached();
    this.element.remove();
  }
}
