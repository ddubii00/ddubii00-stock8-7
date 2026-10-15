import { applyChanges } from './dashboard-model.js';
export const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const PENDING_KEY = 'stock8.pendingChanges.v1';
export class SharedDashboard {
  constructor(onChange, onStatus) {
    this.onChange = onChange;
    this.onStatus = onStatus;
    this.pending = [];
    try { const saved = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); if (Array.isArray(saved)) this.pending = saved; } catch {}
  }
  async request(options) {
    const response = await fetch('/stock8-7/api/state', { cache: 'no-store', ...options });
    if (response.status === 401) { location.reload(); throw new Error('로그인이 필요합니다.'); }
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error || '서버 저장에 실패했습니다.'), { status: response.status });
    return value;
  }
  async start() {
    this.base = await this.request();
    const valid = [];
    let preview = this.base;
    for (const operation of this.pending) {
      try {
        if (!/^[\w-]{1,100}$/.test(operation?.id || '')) continue;
        preview = applyChanges(preview, operation.changes);
        valid.push(operation);
      } catch {}
    }
    this.pending = valid;
    this.publish();
    this.flush();
    this.timer = setInterval(() => this.poll(), 5000);
  }
  publish() {
    this.state = this.pending.reduce((state, operation) => applyChanges(state, operation.changes), this.base);
    localStorage.setItem(PENDING_KEY, JSON.stringify(this.pending));
    this.onChange(this.state);
  }
  change(changes) {
    const operation = { id: makeId(), changes };
    applyChanges(this.state, changes);
    this.pending.push(operation);
    this.rejected = null;
    this.onStatus('saving');
    this.publish();
    void this.flush();
  }
  accept(value) { if (!this.base || value.revision >= this.base.revision) this.base = value; }
  async flush() {
    if (this.saving || !this.base || !this.pending.length) return;
    this.saving = true;
    try {
      while (this.pending.length) {
        this.onStatus('saving');
        const operation = this.pending[0];
        const value = await this.request({ method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(operation) });
        this.accept(value);
        this.pending.shift();
        this.publish();
      }
      this.onStatus('saved');
    } catch (error) {
      // Invalid writes are rolled back; transient network/disk failures retry.
      if (error.status === 400) {
        this.pending.shift();
        this.publish();
        this.rejected = error.message;
      }
      this.onStatus('error', error.message);
      clearTimeout(this.retry);
      this.retry = setTimeout(() => this.flush(), 3000);
    } finally { this.saving = false; }
  }
  async poll() {
    if (this.polling || this.saving) return;
    this.polling = true;
    try {
      const value = await this.request();
      if (value.revision > this.base.revision) { this.accept(value); this.publish(); }
      if (this.pending.length) void this.flush();
      else if (this.rejected) this.onStatus('error', this.rejected);
      else this.onStatus('saved');
    } catch (error) { this.onStatus('error', error.message); }
    finally { this.polling = false; }
  }
}
