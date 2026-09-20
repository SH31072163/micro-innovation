import { query } from '../../../lib/db';

export default async function handler(req, res) {
  // GET: 检查 token 有效性，不执行验证
  if (req.method === 'GET') {
    const { token } = req.query;
    if (!token) return res.status(400).json({ valid: false, error: '缺少验证token' });

    try {
      const result = await query('SELECT * FROM email_tokens WHERE token = $1 AND used = FALSE', [token]);
      if (result.rows.length === 0) {
        return res.status(200).json({ valid: false, error: '验证链接无效或已使用' });
      }
      const tokenRow = result.rows[0];
      if (new Date(tokenRow.expires_at) < new Date()) {
        return res.status(200).json({ valid: false, error: '验证链接已过期，请重新注册或联系管理员' });
      }
      return res.status(200).json({ valid: true });
    } catch (err) {
      console.error('Verify GET error:', err);
      return res.status(500).json({ valid: false, error: '服务器错误' });
    }
  }

  // POST: 执行验证
  if (req.method === 'POST') {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: '缺少验证token' });

    try {
      const result = await query('SELECT * FROM email_tokens WHERE token = $1 AND used = FALSE', [token]);
      if (result.rows.length === 0) {
        return res.status(400).json({ error: '验证链接无效或已使用' });
      }

      const tokenRow = result.rows[0];
      if (new Date(tokenRow.expires_at) < new Date()) {
        return res.status(400).json({ error: '验证链接已过期，请重新注册或联系管理员' });
      }

      await query('UPDATE email_tokens SET used = TRUE WHERE id = $1', [tokenRow.id]);
      await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [tokenRow.user_id]);

      return res.status(200).json({ message: '您的邮箱已验证通过，现在可以登录使用了。' });
    } catch (err) {
      console.error('Verify POST error:', err);
      return res.status(500).json({ error: '服务器错误' });
    }
  }

  return res.status(405).json({ error: '方法不允许' });
}
