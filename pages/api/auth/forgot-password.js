import { query } from '../../../lib/db';
import { sendMail } from '../../../lib/mailer';
import { maskEmail, generateRandomPassword } from '../../../lib/validators';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: '请输入用户名' });

    try {
      const result = await query('SELECT email FROM users WHERE username = $1', [username]);
      if (result.rows.length === 0) return res.status(404).json({ error: '该用户名不存在' });
      const user = result.rows[0];
      if (!user.email) return res.status(400).json({ error: '该账号未设置邮箱，请联系管理员重置密码' });
      res.status(200).json({ maskedEmail: maskEmail(user.email) });
    } catch (err) {
      res.status(500).json({ error: '服务器错误' });
    }
  } else if (req.method === 'POST') {
    const { username } = req.body;
    try {
      const result = await query('SELECT * FROM users WHERE username = $1', [username]);
      if (result.rows.length === 0) return res.status(404).json({ error: '该用户名不存在' });
      const user = result.rows[0];
      if (!user.email) return res.status(400).json({ error: '该账号未设置邮箱，请联系管理员重置密码' });

      const newPwd = generateRandomPassword();
      const bcrypt = require('bcryptjs');
      const hashedPwd = bcrypt.hashSync(newPwd, 10);

      await query('UPDATE users SET password = $1, force_change_password = TRUE, status = $2, login_fail_count = 0 WHERE id = $3', [hashedPwd, 'active', user.id]);

      const mailHtml = `
        <h2>【微创新实验田】密码重置通知</h2>
        <p>您的账号密码已重置，新密码如下：</p>
        <p style="font-size:20px;font-weight:bold;color:#2563eb;letter-spacing:2px;">${newPwd}</p>
        <p>请使用此密码登录，登录后系统将要求您修改密码。</p>
        <p>如非本人操作，请联系管理员。</p>
      `;
      await sendMail(user.email, '【微创新实验田】您的密码已重置', mailHtml);

      res.status(200).json({ message: '新密码已发送到您的邮箱，请查收' });
    } catch (err) {
      res.status(500).json({ error: '服务器错误' });
    }
  } else {
    res.status(405).json({ error: '方法不允许' });
  }
}
