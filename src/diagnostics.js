// Never expose raw Playwright errors: they may contain URLs, page text or session data.
export function browserDiagnostic(error, phase) {
  const text = String(error?.message || '');
  const errno = error?.code;
  let code = 'BROWSER_START_FAILED';
  let message = 'راه‌اندازی مرورگر کامل نشد. مرحله و کد خطا را برای بررسی ارسال کنید.';
  if (errno === 'EACCES' || errno === 'EPERM' || /EACCES|permission denied|access denied/i.test(text)) {
    code = 'DATA_PERMISSION';
    message = 'دسترسی لازم به داده‌های مرورگر وجود ندارد. مالک و مجوز Volume را بررسی کنید؛ برای Volume با مالک root، مقدار RAILWAY_RUN_UID=0 را تنظیم و Deploy کنید.';
  } else if (errno === 'ENOSPC' || /no space left on device/i.test(text)) {
    code = 'DISK_FULL';
    message = 'فضای ذخیره‌سازی کافی نیست. ظرفیت Volume را بررسی کنید؛ پروفایل حساب را حذف نکنید.';
  } else if (errno === 'EROFS' || /read-only file system/i.test(text)) {
    code = 'DATA_READ_ONLY';
    message = 'مسیر داده فقط‌خواندنی است. DATA_DIR و اتصال Volume قابل‌نوشتن را بررسی کنید.';
  } else if (/ProcessSingleton|SingletonLock|profile.*in use|user data directory is already in use/i.test(text)) {
    code = 'PROFILE_IN_USE';
    message = 'پروفایل مرورگر قفل است یا توسط فرایند دیگری استفاده می‌شود. فقط یک replica نگه دارید و از توقف نمونه قبلی مطمئن شوید؛ پروفایل یا فایل‌های قفل را خودکار حذف نکنید.';
  } else if (/Executable doesn't exist|browser executable.*not found|playwright install/i.test(text)) {
    code = 'CHROMIUM_MISSING';
    message = 'فایل Chromium پیدا نشد. بیلد باید با Dockerfile همین مخزن انجام شود تا مرورگر نصب شود.';
  } else if (/error while loading shared libraries|Host system is missing dependencies/i.test(text)) {
    code = 'CHROMIUM_DEPENDENCIES';
    message = 'وابستگی‌های سیستمی Chromium کامل نیست. سرویس را با Dockerfile مخزن دوباره Build کنید.';
  } else if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 400 && error.httpStatus <= 599) {
    code = `GAME_HTTP_${error.httpStatus}`;
    message = `صفحه بازی پاسخ HTTP ${error.httpStatus} داد. وضعیت دسترسی یا سرویس بازی را بررسی کنید؛ محدودیت سایت دور زده نمی‌شود.`;
  } else if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(text)) {
    code = 'GAME_DNS';
    message = 'نام دامنه بازی resolve نشد. DNS و دسترسی شبکه خروجی سرویس را بررسی کنید.';
  } else if (/ERR_CERT_|certificate/i.test(text)) {
    code = 'GAME_TLS';
    message = 'اعتبارسنجی اتصال امن بازی شکست خورد. گواهی یا شبکه را بررسی کنید؛ بررسی TLS غیرفعال نشده است.';
  } else if (error?.name === 'TimeoutError' || /Timeout \d+ms exceeded|ETIMEDOUT|ERR_CONNECTION_TIMED_OUT/i.test(text)) {
    code = phase === 'navigation' ? 'GAME_TIMEOUT' : 'BROWSER_TIMEOUT';
    message = phase === 'navigation'
      ? 'بازشدن صفحه بازی در مهلت مقرر کامل نشد. دسترسی شبکه به بازی را بررسی کنید.'
      : 'راه‌اندازی مرورگر در مهلت مقرر کامل نشد. منابع و لاگ‌های سرویس را بررسی کنید.';
  } else if (/net::ERR_|ECONNREFUSED|ECONNRESET/i.test(text)) {
    code = 'GAME_NETWORK';
    message = 'اتصال شبکه به بازی شکست خورد. دسترسی خروجی سرویس و وضعیت سایت بازی را بررسی کنید.';
  } else if (/Target.*closed|browser.*closed|SIGKILL|SIGSEGV|Page crashed/i.test(text)) {
    code = 'CHROMIUM_EXITED';
    message = 'مرورگر یا صفحه بسته شده است. لاگ‌های crash و مصرف حافظه را بررسی کنید؛ کمبود RAM یکی از احتمال‌هاست، نه علت تأییدشده.';
  }
  const safePhase = ['storage', 'launch', 'setup', 'navigation', 'persist', 'running'].includes(phase) ? phase : 'unknown';
  return { code, phase: safePhase, message, at: new Date().toISOString() };
}
