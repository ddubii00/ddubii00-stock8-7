import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tradingViewFrameUrl } from '../public/tradingview-card.js';

test('hosted USTECH frame disables saved settings that revive symbol-name labels, preserving price values and embed configuration', () => {
  const config = { symbol: 'WHSELFINVEST:USTECH100CFD', interval: '1', hide_legend: true, locale: 'kr', studies: [] };
  const src = 'https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=kr#' + encodeURIComponent(JSON.stringify(config));
  const result = new URL(tradingViewFrameUrl(src));
  assert.deepEqual(JSON.parse(result.searchParams.get('overrides')), { 'scalesProperties.showSymbolLabels': false });
  assert.deepEqual(JSON.parse(result.searchParams.get('disabled_features')), ['use_localstorage_for_settings']);
  assert.deepEqual(JSON.parse(decodeURIComponent(result.hash.slice(1))), config);
  assert.equal(result.searchParams.get('locale'), 'kr');
  assert.equal(tradingViewFrameUrl(result.href), result.href);
});

test('widget display settings never rewrite other providers or other TradingView embeds', () => {
  for (const src of [
    'https://example.com/embed-widget/advanced-chart/',
    'https://www.tradingview-widget.com.evil.example/embed-widget/advanced-chart/',
    'http://www.tradingview-widget.com/embed-widget/advanced-chart/',
    'https://www.tradingview-widget.com/embed-widget/ticker-tape/'
  ]) assert.equal(tradingViewFrameUrl(src), src);
});
