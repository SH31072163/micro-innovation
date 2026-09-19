/**
 * 邮件发送模块（Cloudflare Pages/Workers 运行时兼容）
 *
 * 发送优先级：
 *  1. SMTP 直连（cloudflare:sockets TCP API）—— 线上 Workers 环境首选
 *  2. HTTP 邮件 API（MAIL_API_URL + MAIL_API_KEY）—— 可选外部邮件服务
 *  3. 开发模式（控制台打印）—— 本地开发无邮件配置时回退
 *
 * 保持 sendMail(to, subject, html) 接口不变，调用方无需修改。
 */

// SMTP 配置
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.126.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || 'SH31072163@126.com';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

// HTTP 邮件 API 配置（可选）
const MAIL_API_URL = process.env.MAIL_API_URL || '';
const MAIL_API_KEY = process.env.MAIL_API_KEY || '';

/**
 * 通过 SMTP 直连发送邮件（使用 cloudflare:sockets TCP API）
 * 仅在 Cloudflare Workers 运行时可用
 */
async function sendViaSmtp(to, subject, html) {
  // 动态导入 cloudflare:sockets（仅 Workers 环境有此模块）
  // 使用 eval 绕过 webpack 静态分析，避免构建报错
  let connect;
  try {
    const mod = await (new Function('return import("cloudflare:sockets")'))();
    connect = mod.connect;
  } catch (e) {
    throw new Error('cloudflare:sockets 不可用（非 Workers 环境）: ' + e.message);
  }

  if (!SMTP_PASS) {
    throw new Error('SMTP_PASS 未配置');
  }

  // 构建邮件内容（RFC 5322 格式）
  const boundary = '----=_Part_' + Math.random().toString(36).slice(2);
  const date = new Date().toUTCString();
  const messageId = '<' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@' + SMTP_HOST + '>';

  // HTML 转文本（简单版，用于 text/plain 部分）
  const textContent = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  const mailData = [
    `From: ${MAIL_FROM}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(textContent, 'utf-8').toString('base64'),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(html, 'utf-8').toString('base64'),
    ``,
    `--${boundary}--`,
    ``,
  ].join('\r\n');

  // 建立 TCP 连接（465 端口直接 TLS，587 端口 STARTTLS）
  const socket = connect({ hostname: SMTP_HOST, port: SMTP_PORT });

  // 使用 TransformStream 处理 socket 读写
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let responseBuffer = '';

  async function readResponse() {
    let lines = [];
    let line = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      responseBuffer += decoder.decode(value, { stream: true });
      // Process complete lines (ending with \r\n)
      while (true) {
        const idx = responseBuffer.indexOf('\r\n');
        if (idx === -1) break;
        line = responseBuffer.substring(0, idx);
        responseBuffer = responseBuffer.substring(idx + 2);
        lines.push(line);
        // SMTP multi-line: lines starting with "NNN-" are continuation; "NNN " is final
        if (/^\d{3} /.test(line)) {
          return lines.join('\r\n');
        }
      }
    }
    return lines.join('\r\n');
  }

  async function sendCommand(cmd) {
    await writer.write(encoder.encode(cmd + '\r\n'));
    return readResponse();
  }

  try {
    // 读取 SMTP 服务器欢迎消息
    let resp = await readResponse();
    if (!resp.startsWith('220')) throw new Error(`SMTP 连接失败: ${resp}`);

    // EHLO
    resp = await sendCommand('EHLO TeleAgent');
    if (!resp.startsWith('250')) throw new Error(`EHLO 失败: ${resp}`);

    // AUTH LOGIN
    resp = await sendCommand('AUTH LOGIN');
    if (!resp.startsWith('334')) throw new Error(`AUTH LOGIN 失败: ${resp}`);

    // 发送用户名（base64）
    resp = await sendCommand(Buffer.from(SMTP_USER, 'utf-8').toString('base64'));
    if (!resp.startsWith('334')) throw new Error(`用户名验证失败: ${resp}`);

    // 发送密码（base64）
    resp = await sendCommand(Buffer.from(SMTP_PASS, 'utf-8').toString('base64'));
    if (!resp.startsWith('235')) throw new Error(`密码验证失败: ${resp}`);

    // MAIL FROM
    resp = await sendCommand(`MAIL FROM:<${MAIL_FROM}>`);
    if (!resp.startsWith('250')) throw new Error(`MAIL FROM 失败: ${resp}`);

    // RCPT TO
    resp = await sendCommand(`RCPT TO:<${to}>`);
    if (!resp.startsWith('250')) throw new Error(`RCPT TO 失败: ${resp}`);

    // DATA
    resp = await sendCommand('DATA');
    if (!resp.startsWith('354')) throw new Error(`DATA 失败: ${resp}`);

    // 发送邮件内容
    await writer.write(encoder.encode(mailData + '\r\n.\r\n'));
    resp = await readResponse();
    if (!resp.startsWith('250')) throw new Error(`邮件发送失败: ${resp}`);

    // QUIT
    await sendCommand('QUIT');

    console.log(`[邮件已发送(SMTP)] To: ${to}, Subject: ${subject}`);
    return true;
  } finally {
    try { writer.close(); } catch (e) {}
    try { reader.releaseLock(); } catch (e) {}
    try { socket.close(); } catch (e) {}
  }
}

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
  const errors = [];

  // 优先尝试 SMTP 直连（需要 SMTP_PASS 配置且 Workers 环境）
  if (SMTP_PASS) {
    try {
      return await sendViaSmtp(to, subject, html);
    } catch (err) {
      errors.push(`SMTP: ${err.message}`);
      console.error('[邮件] SMTP 发送失败:', err.message);
    }
  }

  // 其次尝试 HTTP 邮件 API
  if (MAIL_API_URL) {
    try {
      return await sendViaHttpApi(to, subject, html);
    } catch (err) {
      errors.push(`HTTP API: ${err.message}`);
      console.error('[邮件] HTTP API 发送失败:', err.message);
    }
  }

  // 全部失败，打印到控制台
  console.log('\n========== 邮件（开发模式/回退）==========');
  console.log(`收件人: ${to}`);
  console.log(`主题: ${subject}`);
  console.log(`内容:`);
  console.log(html);
  if (errors.length > 0) {
    console.log('失败原因:', errors.join('; '));
  }
  console.log('=====================================\n');
  return true;
}

module.exports = { sendMail };
