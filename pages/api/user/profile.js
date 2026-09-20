import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { validatePassword, validateEmail, validatePhone, validateRealName, validateDepartment, generateToken } from '../../../lib/validators';
import { sendMail } from '../../../lib/mailer';

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  if (req.method === 'GET') {
    try {
      const result = await query(
        'SELECT id, username, email, phone, real_name, department, labor_relation, email_verified, status, is_admin, register_date, user_id FROM users WHERE id = $1',
        [userInfo.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
      res.status(200).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: '服务器错误' });
    }
  } else if (req.method === 'PUT') {
    const { field, value, oldValue, confirmPassword } = req.body;
    try {
      const result = await query('SELECT * FROM users WHERE id = $1', [userInfo.id]);
      const user = result.rows[0];
      if (!user) return res.status(404).json({ error: '用户不存在' });

      if (field === 'password') {
        const err = validatePassword(value);
        if (err) return res.status(400).json({ error: err });
        if (!oldValue || !require('bcryptjs').compareSync(oldValue, user.password)) {
          return res.status(400).json({ error: '原密码不正确' });
        }
        if (value !== confirmPassword) return res.status(400).json({ error: '两次输入的新密码不一致' });
        const hashed = require('bcryptjs').hashSync(value, 10);
        await query('UPDATE users SET password = $1, force_change_password = FALSE WHERE id = $2', [hashed, user.id]);
        res.status(200).json({ message: '密码修改成功' });

      } else if (field === 'email') {
        const err = validateEmail(value);
        if (err) return res.status(400).json({ error: err });
        if (value !== confirmPassword) return res.status(400).json({ error: '两次输入的邮箱不一致' });

        await query('UPDATE users SET email = $1, email_verified = FALSE WHERE id = $2', [value, user.id]);
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await query('INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)', [user.id, token, 'email_change', expiresAt]);

        const verifyUrl = `${req.headers.origin || 'https://micro-innovation.pages.dev'}/api/auth/verify?token=${token}`;
        const mailHtml = `<h2>【微创新实验田】请验证新邮箱</h2><p>您正在修改关联邮箱，请在24小时内点击以下链接完成验证：</p><p><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">点击验证新邮箱</a></p><p>或复制以下链接到浏览器打开：</p><p>${verifyUrl}</p><p>验证通过后才能正常使用账号。</p>`;
        await sendMail(value, '【微创新实验田】请验证您的新邮箱', mailHtml);
        res.status(200).json({ message: '新邮箱验证邮件已发送，请查收并点击验证链接。验证通过前账号将暂时无法登录。' });

      } else if (field === 'phone') {
        const err = validatePhone(value);
        if (err) return res.status(400).json({ error: err });
        await query('UPDATE users SET phone = $1 WHERE id = $2', [value, user.id]);
        res.status(200).json({ message: '手机号修改成功' });

      } else if (field === 'real_name') {
        const err = validateRealName(value);
        if (err) return res.status(400).json({ error: err });
        await query('UPDATE users SET real_name = $1 WHERE id = $2', [value, user.id]);
        res.status(200).json({ message: '姓名修改成功' });

      } else if (field === 'department') {
        const err = validateDepartment(value);
        if (err) return res.status(400).json({ error: err });
        await query('UPDATE users SET department = $1 WHERE id = $2', [value, user.id]);
        res.status(200).json({ message: '部门修改成功' });

      } else if (field === 'labor_relation') {
        if (!['国脉员工', '非国脉员工'].includes(value)) return res.status(400).json({ error: '劳动关系选项不正确' });
        await query('UPDATE users SET labor_relation = $1 WHERE id = $2', [value, user.id]);
        res.status(200).json({ message: '劳动关系修改成功' });

      } else {
        res.status(400).json({ error: '不支持的字段' });
      }
    } catch (err) {
      console.error('Profile update error:', err);
      res.status(500).json({ error: '服务器错误' });
    }
  } else {
    res.status(405).json({ error: '方法不允许' });
  }
}
