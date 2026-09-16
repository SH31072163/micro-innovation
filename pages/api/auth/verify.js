import { query } from '../../../lib/db';

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).send('缺少验证token');

  try {
    const result = await query('SELECT * FROM email_tokens WHERE token = $1 AND used = FALSE', [token]);
    if (result.rows.length === 0) {
      return res.status(400).send(`<html><body style="font-family:sans-serif;text-align:center;padding:50px;"><h2 style="color:#dc2626;">验证链接无效或已使用</h2><p>该链接可能已过期或已被使用过。</p><a href="/" style="color:#2563eb;">返回首页</a></body></html>`);
    }

    const tokenRow = result.rows[0];
    if (new Date(tokenRow.expires_at) < new Date()) {
      return res.status(400).send(`<html><body style="font-family:sans-serif;text-align:center;padding:50px;"><h2 style="color:#dc2626;">验证链接已过期</h2><p>该链接已超过24小时有效期，请重新注册或联系管理员。</p><a href="/" style="color:#2563eb;">返回首页</a></body></html>`);
    }

    await query('UPDATE email_tokens SET used = TRUE WHERE id = $1', [tokenRow.id]);
    await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [tokenRow.user_id]);

    res.status(200).send(`<html><body style="font-family:sans-serif;text-align:center;padding:50px;"><h2 style="color:#16a34a;">邮箱验证成功！</h2><p>您的邮箱已验证通过，现在可以登录使用了。</p><a href="/" style="display:inline-block;margin-top:20px;padding:10px 30px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">前往登录</a></body></html>`);
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).send('服务器错误');
  }
}
