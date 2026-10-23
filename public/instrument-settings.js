import { staticSearch } from './search-catalog.js';
import { PAGE_COUNT, SLOTS_PER_PAGE, validSymbol } from './dashboard-model.js';
import { normalizeSearchQuery, manualSearchItem, searchResultsWithFallback, prioritizeExactInstrument, parseKoreanCode } from './symbol-input.js';

export function instrumentChanges(items, slots) {
  if (items.length !== PAGE_COUNT * SLOTS_PER_PAGE || items.some(item => !validSymbol(item?.symbol) || !item.name?.trim())) {
    throw new Error('각 장의 종목 4개를 모두 지정해 주세요.');
  }
  return items.flatMap((item, index) => {
    if (slots[index].symbol === item.symbol && slots[index].name === item.name) return [];
    return [{ type: 'slot', index, patch: { symbol: item.symbol, name: item.name, decimals: /\.(KS|KQ)$/.test(item.symbol) ? 0 : 2 } }];
  });
}

export class InstrumentSettings {
  constructor(getState, save) {
    this.getState = getState;
    this.save = save;
    this.dialog = document.querySelector('#instrumentsDialog');
    this.pages = document.querySelector('#instrumentPages');
    this.error = document.querySelector('#instrumentsError');
    this.saveButtons = [...document.querySelectorAll('[data-save-instruments]')];
    document.querySelector('#instrumentsButton').addEventListener('click', () => this.open());
    for (const id of ['closeInstruments', 'cancelInstruments', 'cancelInstrumentsTop']) document.querySelector(`#${id}`).addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('close', () => this.dispose());
    document.querySelector('#instrumentsForm').addEventListener('submit', event => { event.preventDefault(); void this.submit(); });
  }
  dispose() {
    this.generation = (this.generation || 0) + 1;
    for (const row of this.rows || []) { clearTimeout(row.timer); row.abort?.abort(); }
  }
  open() {
    const state = this.getState();
    if (!state) return;
    this.dispose();
    this.rows = [];
    this.saveButtons.forEach(button => { button.disabled = false; });
    this.error.textContent = '';
    this.pages.replaceChildren();
    for (let page = 0; page < PAGE_COUNT; page++) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = `${page + 1}장`;
      fieldset.append(legend);
      for (let slot = 0; slot < SLOTS_PER_PAGE; slot++) {
        const index = page * SLOTS_PER_PAGE + slot;
        const root = document.createElement('div');
        root.className = 'instrument-setting';
        const label = document.createElement('label');
        label.htmlFor = `instrument-${index}`;
        label.textContent = `${slot + 1}번`;
        const input = document.createElement('input');
        input.id = label.htmlFor;
        input.type = 'search'; input.autocomplete = 'off'; input.spellcheck = false;
        input.value = state.slots[index].name;
        input.setAttribute('aria-label', `${page + 1}장 ${slot + 1}번 종목`);
        input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
        const code = document.createElement('small'); code.textContent = state.slots[index].symbol;
        const results = document.createElement('div');
        results.className = 'instrument-results'; results.id = `instrument-results-${index}`; results.setAttribute('role', 'listbox');
        input.setAttribute('aria-controls', results.id);
        const row = { root, input, code, results, item: { ...state.slots[index] }, query: input.value, matches: [], active: -1 };
        input.addEventListener('input', () => {
          row.item = null; row.code.textContent = '검색 중…'; row.active = -1;
          clearTimeout(row.timer); row.abort?.abort(); this.closeResults(row);
          this.renderResults(row, staticSearch(normalizeSearchQuery(input.value), this.getState().slots).slice(0, 12), true);
          row.timer = setTimeout(() => void this.search(row), 180);
        });
        input.addEventListener('keydown', event => {
          if (event.key === 'Escape' && row.matches.length) { event.preventDefault(); event.stopPropagation(); this.closeResults(row); }
          else if (['ArrowDown', 'ArrowUp'].includes(event.key) && row.matches.length) {
            event.preventDefault(); row.active = (row.active + (event.key === 'ArrowDown' ? 1 : -1) + row.matches.length) % row.matches.length;
            [...results.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === row.active)));
            input.setAttribute('aria-activedescendant', results.children[row.active].id);
            results.children[row.active].scrollIntoView({ block: 'nearest' });
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (row.matches.length) this.select(row, row.matches[Math.max(0, row.active)]);
            else void this.resolve(row).catch(error => { this.error.textContent = error.message; });
          }
        });
        input.addEventListener('focus', () => { for (const other of this.rows) if (other !== row) { clearTimeout(other.timer); other.abort?.abort(); this.closeResults(other); } });
        root.append(label, input, code, results); fieldset.append(root); this.rows.push(row);
      }
      this.pages.append(fieldset);
    }
    this.dialog.showModal();
  }
  closeResults(row) {
    row.results.replaceChildren(); delete row.results.dataset.signature; row.matches = []; row.active = -1;
    row.input.setAttribute('aria-expanded', 'false'); row.input.removeAttribute('aria-activedescendant');
  }
  select(row, item) {
    clearTimeout(row.timer); row.abort?.abort(); row.item = { symbol: item.symbol, name: item.name };
    row.input.value = item.name; row.code.textContent = item.symbol; row.input.removeAttribute('aria-invalid');
    this.closeResults(row);
  }
  async lookup(query, signal, onUpdate) {
    const local = staticSearch(query, this.getState().slots);
    const korean = parseKoreanCode(query);
    const merge = results => {
      const localItems = korean && results.some(item => item.symbol?.slice(0, 6) === korean.code)
        ? local.filter(item => item.symbol?.slice(0, 6) !== korean.code) : local;
      return prioritizeExactInstrument([...new Map([...localItems, ...results].map(item => [item.symbol, item])).values()], query)
        .filter(item => validSymbol(item.symbol)).slice(0, 12);
    };
    let matches = merge([]), pending = false;
    const deadline = Date.now() + 12000;
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(`/stock8-7/api/search?q=${encodeURIComponent(query)}`, { signal });
        if (!response.ok) throw new Error('Search unavailable');
        const payload = await response.json();
        pending = Boolean(payload.pending);
        matches = merge(pending ? payload.results || [] : searchResultsWithFallback(payload.results || [], query));
        onUpdate?.(matches, pending);
        const compact = value => String(value || '').normalize('NFKC').toUpperCase().replace(/\s+/g, '');
        if (!onUpdate && matches.some(item => (korean && item.symbol.slice(0, 6) === korean.code) || [item.symbol, item.name, ...(item.aliases || [])].some(value => compact(value) === compact(query)))) return matches;
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        matches = merge(searchResultsWithFallback(matches, query));
        onUpdate?.(matches, false);
        return matches;
      }
      if (!pending) return matches;
      if (Date.now() >= deadline) {
        if (!matches.length) throw new Error('검색이 지연되고 있습니다. 잠시 후 다시 검색해 주세요.');
        return matches;
      }
      await new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, Math.min(1000, 250 * (attempt + 1)));
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
  }
  renderResults(row, matches, pending) {
    const activeSymbol = row.matches[row.active]?.symbol;
    const signature = JSON.stringify(matches.map(item => [item.symbol, item.name]));
    if (row.results.dataset.signature !== signature) {
      this.closeResults(row); row.matches = matches;
      row.active = activeSymbol ? matches.findIndex(item => item.symbol === activeSymbol) : -1;
      for (const [i, item] of matches.entries()) {
        const option = document.createElement('button'); option.type = 'button'; option.id = `${row.results.id}-${i}`;
        option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(i === row.active));
        option.textContent = `${item.name} · ${item.symbol}`;
        option.addEventListener('click', () => this.select(row, item)); row.results.append(option);
      }
      row.results.dataset.signature = signature;
      row.input.setAttribute('aria-expanded', String(matches.length > 0));
      if (row.active >= 0) row.input.setAttribute('aria-activedescendant', row.results.children[row.active].id);
    }
    row.code.textContent = matches.length ? '검색 결과에서 선택하세요' : pending ? '검색 중…' : '검색 결과가 없습니다';
  }
  async search(row) {
    const query = normalizeSearchQuery(row.input.value), generation = this.generation;
    if (!query) { row.code.textContent = '종목을 입력하세요'; return; }
    const abort = row.abort = new AbortController();
    try {
      await this.lookup(query, abort.signal, (matches, pending) => {
        if (!abort.signal.aborted && generation === this.generation && query === normalizeSearchQuery(row.input.value)) this.renderResults(row, matches, pending);
      });
    } catch (error) { if (error.name !== 'AbortError') row.code.textContent = '검색을 다시 시도해 주세요'; }
  }

  async resolve(row) {
    if (row.item) return row.item;
    clearTimeout(row.timer); row.abort?.abort();
    const query = normalizeSearchQuery(row.input.value), generation = this.generation;
    const item = (await this.lookup(query))[0] || manualSearchItem(query);
    if (generation !== this.generation || query !== normalizeSearchQuery(row.input.value)) throw new Error('변경된 종목을 다시 확인해 주세요.');
    if (!item || !validSymbol(item.symbol)) {
      row.input.setAttribute('aria-invalid', 'true'); row.input.focus(); throw new Error('종목명 또는 코드를 확인해 주세요.');
    }
    this.select(row, item); return item;
  }
  async submit() {
    if (this.saveButtons.some(button => button.disabled)) return;
    const generation = this.generation;
    this.saveButtons.forEach(button => { button.disabled = true; });
    this.error.textContent = '';
    try {
      const items = await Promise.all(this.rows.map(row => this.resolve(row)));
      if (generation !== this.generation) return;
      const changes = instrumentChanges(items, this.getState().slots);
      if (changes.length) this.save(changes);
      this.dialog.close();
    } catch (error) { if (generation === this.generation) this.error.textContent = error.message; }
    finally { if (generation === this.generation) this.saveButtons.forEach(button => { button.disabled = false; }); }
  }
}
