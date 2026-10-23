import { isWidgetSymbol } from './instrument-catalog.js';

// Official display-only embed. No quotes, cookies or chart internals are read.
export function mountTradingViewCard(card, symbol) {
  if (!isWidgetSymbol(symbol)) throw new Error('지원하지 않는 위젯 종목입니다.');
  const doc = card.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'external-chart';
  const status = doc.createElement('span');
  status.className = 'external-chart-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  const body = doc.createElement('div');
  body.className = 'tradingview-widget-container external-chart-body';
  const widget = doc.createElement('div');
  widget.className = 'tradingview-widget-container__widget';
  const footer = doc.createElement('div');
  footer.className = 'external-chart-footer';
  const link = doc.createElement('a');
  link.href = 'https://www.tradingview.com/chart/?symbol=WHSELFINVEST%3AUSTECH100CFD';
  link.target = '_blank'; link.rel = 'noopener nofollow';
  link.textContent = 'TradingView';
  link.title = 'US Tech 100 CFD (WH SelfInvest) · 시세 상태는 위젯 안에서 확인하세요.';
  const retry = doc.createElement('button');
  retry.type = 'button'; retry.textContent = '다시 연결';
  retry.title = 'TradingView 위젯 다시 불러오기';
  retry.hidden = true;
  footer.append(link, status, retry);
  body.append(widget);
  root.append(body, footer);
  card.classList.add('widget-card', 'loaded');
  card.setAttribute('aria-label', 'US Tech 100 CFD (USTECH100) TradingView 위젯');
  card.append(root);
  let disposed = false;
  function load() {
    if (disposed) return;
    body.replaceChildren(widget);
    widget.replaceChildren();
    status.hidden = true;
    retry.hidden = true;
    const script = doc.createElement('script');
    script.type = 'text/javascript'; script.async = true;
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.textContent = JSON.stringify({ autosize: true, symbol: 'WHSELFINVEST:USTECH100CFD', interval: '1',
      timezone: 'Asia/Seoul', theme: 'light', style: '1', locale: 'kr',
      allow_symbol_change: false, hide_side_toolbar: false, hide_top_toolbar: false,
      hide_legend: true, save_image: false, calendar: false, studies: [],
      overrides: { 'scalesProperties.showSymbolLabels': false } });
    script.onerror = () => {
      if (disposed || !script.isConnected) return;
      status.textContent = '위젯 연결 실패';
      status.hidden = false;
      retry.hidden = false;
    };
    body.append(script);
  }
  retry.addEventListener('click', load);
  load();
  return { destroy() {
    disposed = true;
    retry.removeEventListener('click', load);
    root.remove(); // Removing the iframe also stops its live connection.
  } };
}
