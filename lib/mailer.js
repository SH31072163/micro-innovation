/**
 * 閭欢鍙戦€佹ā鍧楋紙閫氳繃鐙珛 Worker + cloudflare:sockets SMTP 鍙戜俊锛? *
 * 鏋舵瀯锛? *   Pages (Next.js API) 鈫?fetch 鈫?mail-sender Worker 鈫?cloudflare:sockets 鈫?126 SMTP
 *
 * 鐙珛 Worker 缁曡繃浜?OpenNext esbuild 瀵?cloudflare:sockets 鐨勯檺鍒躲€? * Worker URL: https://mail-sender.sh31072163.workers.dev
 * Worker 鍦?Cloudflare 鍐呯綉锛孭ages 杩愯鏃跺彲姝ｅ父璁块棶锛堝嵆浣?workers.dev 鍦ㄥ浗鍐呬笉鍙揪锛夈€? *
 * 鐜鍙橀噺锛? *   MAIL_WORKER_URL  鈥?閭欢 Worker 鐨?URL锛堥粯璁?https://mail-sender.sh31072163.workers.dev锛? *   MAIL_API_KEY     鈥?璋冪敤 Worker 鐨?API Key
 *   MAIL_FROM        鈥?鍙戜欢浜哄湴鍧€锛堥粯璁?SH31072163@126.com锛? *
 * 鎺ュ彛涓嶅彉锛歴endMail(to, subject, html) 鈫?Promise<boolean>
 */

const MAIL_WORKER_URL = process.env.MAIL_WORKER_URL || 'https://mail-sender.sh31072163.workers.dev';
const MAIL_API_KEY = process.env.MAIL_API_KEY || 'mail-sender-secret-key-2026';
const MAIL_FROM = process.env.MAIL_FROM || 'SH31072163@126.com';

/**
 * 鍙戦€侀偖浠? */
async function sendMail(to, subject, html) {
  if (!MAIL_WORKER_URL || !MAIL_API_KEY) {
    console.log('\n========== 閭欢锛堝紑鍙戞ā寮?鈥?鏈厤缃?MAIL_WORKER_URL/MAIL_API_KEY锛?=========');
    console.log(`鍙戜欢浜? ${MAIL_FROM}`);
    console.log(`鏀朵欢浜? ${to}`);
    console.log(`涓婚: ${subject}`);
    console.log('================================================\n');
    sendMail.lastError = '鏈厤缃?MAIL_WORKER_URL 鎴?MAIL_API_KEY';
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(MAIL_WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': MAIL_API_KEY,
      },
      body: JSON.stringify({
        to,
        subject,
        html,
        from: MAIL_FROM,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let errMsg = `Mail Worker 杩斿洖 HTTP ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error) errMsg += `: ${errJson.error}`;
      } catch {
        if (errText) errMsg += `: ${errText.substring(0, 300)}`;
      }
      console.error('[閭欢] Worker 鍙戦€佸け璐?', errMsg);
      sendMail.lastError = errMsg;
      return false;
    }

    const result = await response.json().catch(() => ({}));
    console.log(`[閭欢宸插彂閫?Worker)] To: ${to}, Subject: ${subject}`);
    sendMail.lastError = null;
    return true;
  } catch (err) {
    clearTimeout(timer);
    const errMsg = err.name === 'AbortError' ? '璇锋眰瓒呮椂(15s)' : err.message;
    console.error('[閭欢] Worker 鍙戦€佸紓甯?', errMsg);
    sendMail.lastError = errMsg;
    return false;
  }
}

module.exports = { sendMail };
