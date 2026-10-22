import { isWidgetSymbol } from './instrument-catalog.js';

// Official display-only embed. No quotes, cookies or chart internals are read.
export function mountTradingViewCard(card, symbol) {
  if (!isWidgetSymbol(symbol)) throw new Error('지원하지 않는 위젯 종목입니다.');
  const doc = card.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'external-chart';
  const heading = doc.createElement('div');
  heading.className = 'external-chart-heading';
  const title = doc.createElement('strong');
  title.textContent = 'US Tech 100 CFD (USTECH100)';
  const status = doc.createElement('span');
  status.className = 'external-chart-status';
  status.textContent = 'TradingView · WH SelfInvest';
  status.title = '시세의 실시간·지연·시장 상태는 TradingView 차트 안에서 확인하세요. 기존 앱의 삼선·MACD 화살표·커서 동기화는 이 칸에 적용되지 않습니다.';
  heading.append(title, status);
  const body = doc.createElement('div');
  body.className = 'tradingview-widget-container external-chart-body';
  const widget = doc.createElement('div');
  widget.className = 'tradingview-widget-container__widget';
  const footer = doc.createElement('div');
  footer.className = 'tradingview-widget-copyright external-chart-footer';
  const link = doc.createElement('a');
  link.href = 'https://www.tradingview.com/chart/?symbol=WHSELFINVEST%3AUSTECH100CFD';
  link.target = '_blank'; link.rel = 'noopener nofollow';
  link.textContent = 'US Tech 100 CFD chart by TradingView';
  const retry = doc.createElement('button');
  retry.type = 'button'; retry.textContent = '다시 연결';
  retry.title = 'TradingView 위젯 다시 불러오기';
  footer.append(link, retry);
  body.append(widget);
  root.append(heading, body, footer);
  card.classList.add('widget-card', 'loaded');
  card.setAttribute('aria-label', 'US Tech 100 CFD (USTECH100) TradingView 위젯');
  card.append(root);
  let disposed = false;
  function load() {
    if (disposed) return;
    body.replaceChildren(widget);
    widget.replaceChildren();
    status.textContent = 'TradingView · WH SelfInvest';
    status.classList.remove('data-error');
    const script = doc.createElement('script');
    script.type = 'text/javascript'; script.async = true;
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.textContent = JSON.stringify({ autosize: true, symbol: 'WHSELFINVEST:USTECH100CFD', interval: '1',
      timezone: 'Asia/Seoul', theme: 'light', style: '1', locale: 'kr',
      allow_symbol_change: false, hide_side_toolbar: false, hide_top_toolbar: false,
      hide_legend: false, save_image: false, calendar: false, studies: [] });
    script.onerror = () => {
      if (disposed || !script.isConnected) return;
      status.textContent = '위젯 연결 실패';
      status.classList.add('data-error');
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
