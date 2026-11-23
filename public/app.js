const game = document.querySelector('#game');
const status = document.querySelector('#status');
const message = document.querySelector('#message');
let busy = false;
let screenshotUrl;
let usable = false;

async function request(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('ارتباط برقرار نشد؛ وضعیت نشست یا رمز پنل را بررسی کنید.');
  return response;
}
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const state = await (await request('/api/status')).json();
    usable = state.state === 'page-open';
    const names = { starting: 'در حال راه‌اندازی', retrying: 'در انتظار تلاش مجدد', disconnected: 'مرورگر قطع شده', stopped: 'متوقف', 'page-open': 'صفحه باز است؛ حساب و دعوت هنوز تأیید نشده' };
    status.textContent = names[state.state] || 'نامشخص';
    const diagnostic = document.querySelector('#diagnostic');
    diagnostic.hidden = !state.lastError;
    if (state.lastError) {
      document.querySelector('#error-code').textContent = state.lastError.code;
      document.querySelector('#error-detail').textContent = state.lastError.message;
      document.querySelector('#error-meta').textContent = `مرحله: ${state.lastError.phase} · خطاهای پیاپی: ${state.retries} · زمان: ${state.lastError.at}`;
    }
    game.classList.toggle('unavailable', !usable);
    if (!usable) return;
    const blob = await (await request('/api/screenshot')).blob();
    const next = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      game.onload = resolve;
      game.onerror = reject;
      game.src = next;
    }).catch(error => { URL.revokeObjectURL(next); throw error; });
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    screenshotUrl = next;
    message.textContent = '';
  } catch {
    usable = false;
    game.classList.add('unavailable');
    message.textContent = 'تصویر به‌روز نیست. پس از برقراری ارتباط، دوباره امتحان کنید.';
  } finally { busy = false; }
}
async function act(action) {
  if (busy || !usable) return;
  busy = true;
  try {
    await request('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'solhero-dashboard' }, body: JSON.stringify(action) });
    message.textContent = '';
  } catch {
    message.textContent = 'نتیجه اقدام مشخص نیست؛ قبل از تکرار، تصویر بازی را بررسی کنید.';
  } finally { busy = false; }
  await refresh();
}
game.addEventListener('click', event => {
  if (!game.naturalWidth) return;
  const rect = game.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * game.naturalWidth / rect.width);
  const y = Math.floor((event.clientY - rect.top) * game.naturalHeight / rect.height);
  void act({ type: 'click', x, y });
});
document.querySelector('#typing').addEventListener('submit', async event => {
  event.preventDefault();
  const field = document.querySelector('#text');
  if (field.value && !busy && usable) {
    const text = field.value;
    field.value = '';
    await act({ type: 'text', text });
  }
});
document.querySelector('#keys').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.key) void act({ type: 'key', key: button.dataset.key });
  else void act({ type: 'scroll', delta: Number(button.dataset.scroll) });
});
document.querySelector('#refresh').addEventListener('click', () => { void refresh(); });
setInterval(() => {
  if (document.querySelector('#auto').checked && !document.hidden) void refresh();
}, 3000);
void refresh();
