/**
 * 邮件发送模块（Cloudflare Pages/Workers 运行时兼容）
 *
 * Cloudflare 运行时无 Node.js net/tls 模块，采用纯 fetch 的 HTTP 邮件 API 方案：
 *  1. 若配置了 MAIL_API_URL + MAIL_API_KEY，则通过 HTTP API 发送
 *     （支持 Cloudflare Email Sending / Resend / Mailgun 等）
 *  2. 否则回退到控制台打印（开发模式），不抛错
 *
 * 保持 sendMail(to, subject, html) 接口不变，调用方无需修改。
 */

// 邮件 API 配置（HTTP 方式）
const MAIL_API_URL = process.env.MAIL_API_URL || '';
const MAIL_API_KEY = process.env.MAIL_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'SH31072163@126.com';

/**
 * 通过 HTTP API 发送邮件
 * POST {MAIL_API_URL}，Body: { from, to, subject, html }
 */
async function sendViaHttpApi(to, subject, html) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (MAIL_API_KEY) {
    headers['Authorization'] = `Bearer ${MAIL_API_KEY}`;
  }

  const body = JSON.stringify({
    from: MAIL_FROM,
    to,
    subject,
    html,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(MAIL_API_URL, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`邮件 API 返回 HTTP ${response.status}: ${errText.substring(0, 200)}`);
    }

    console.log(`[邮件已发送(HTTP API)] To: ${to}, Subject: ${subject}`);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 发送邮件
 * @param {string} to - 收件人
 * @param {string} subject - 主题
 * @param {string} html - HTML 内容
 * @returns {Promise<boolean>}
 */
async function sendMail(to, subject, html) {
  if (MAIL_API_URL) {
    try {
      return await sendViaHttpApi(to, subject, html);
    } catch (err) {
      console.error('[邮件] HTTP API 发送失败，回退到开发模式:', err.message);
    }
  }

  // 未配置邮件服务 - 打印到控制台
  console.log('\n========== 邮件（开发模式）==========');
  console.log(`收件人: ${to}`);
  console.log(`主题: ${subject}`);
  console.log(`内容:`);
  console.log(html);
  console.log('=====================================\n');
  return true;
}

module.exports = { sendMail };