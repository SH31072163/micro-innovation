import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { sendMail } from '../../../lib/mailer';
import { validatePassword, validateEmail, generateToken } from '../../../lib/validators';

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  try {
    const adminResult = await query('SELECT is_admin FROM users WHERE id = $1', [userInfo.id]);
    if (!adminResult.rows[0] || !adminResult.rows[0].is_admin) {
      return res.status(403).json({ error: '无管理员权限' });
    }

    if (req.method === 'GET') {
      const { keyword } = req.query;
      let users;
      if (keyword) {
        const kw = `%${keyword}%`;
        users = await query(`
          SELECT id, username, real_name, email, phone, department, labor_relation, status, email_verified, register_date
          FROM users WHERE username ILIKE $1 OR email ILIKE $2 OR department ILIKE $3 OR real_name ILIKE $4 OR labor_relation ILIKE $5
          ORDER BY id ASC
        `, [kw, kw, kw, kw, kw]);
      } else {
        users = await query(`SELECT id, username, real_name, email, phone, department, labor_relation, status, email_verified, register_date FROM users ORDER BY id ASC`);
      }
      users.rows.forEach((u, i) => {
        u.index = i + 1;
        if (u.status === 'frozen') {
          u.status_text = '冻结';
        } else if (!u.email_verified) {
          u.status_text = '待邮箱验证';
        } else {
          u.status_text = '正常';
        }
      });
      res.status(200).json(users.rows);

    } else if (req.method === 'POST') {
      const { action, userId } = req.body;
      if (action === 'freeze') {
        await query('UPDATE users SET status = $1 WHERE id = $2', ['frozen', userId]);
        res.status(200).json({ message: '已冻结' });
      } else if (action === 'unfreeze') {
        await query('UPDATE users SET status = $1, login_fail_count = 0 WHERE id = $2', ['active', userId]);
        res.status(200).json({ message: '已解冻' });
      } else if (action === 'resend_verify') {
        // 重发注册验证邮件：仅对状态="待邮箱验证"（active且email_verified=false）的用户有效
        const targetResult = await query('SELECT id, email, status, email_verified FROM users WHERE id = $1', [userId]);
        if (targetResult.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
        const targetUser = targetResult.rows[0];
        if (targetUser.status === 'frozen') return res.status(400).json({ error: '该账号已冻结，请先解冻' });
        if (targetUser.email_verified) return res.status(400).json({ error: '该用户邮箱已验证，无需重发' });
        if (!targetUser.email) return res.status(400).json({ error: '该用户无关联邮箱' });

        // 作废该用户所有未使用的注册验证链接，避免多个有效链接并存
        await query("UPDATE email_tokens SET used = TRUE WHERE user_id = $1 AND type = 'register' AND used = FALSE", [userId]);

        // 生成新 token（24小时有效），与注册时逻辑一致
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await query('INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)', [userId, token, 'register', expiresAt]);

        const verifyUrl = `${req.headers.origin || 'http://localhost:3000'}/api/auth/verify?token=${token}`;
        const mailHtml = `
          <h2>欢迎注册「销售服务中心微创新实验田」</h2>
          <p>请在24小时内点击以下链接完成邮箱验证：</p>
          <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">点击验证邮箱</a></p>
          <p>或复制以下链接到浏览器打开：</p>
          <p>${verifyUrl}</p>
          <p>此链接24小时后失效。</p>
        `;
        await sendMail(targetUser.email, '【微创新实验田】请验证您的注册邮箱', mailHtml);
        res.status(200).json({ message: `验证邮件已重新发送到 ${targetUser.email}，请提醒用户在24小时内点击邮件中的链接完成验证。` });
      } else {
        res.status(400).json({ error: '未知操作' });
      }

    } else if (req.method === 'PUT') {
      const { userId, field, value, confirmPassword } = req.body;
      const targetResult = await query('SELECT * FROM users WHERE id = $1', [userId]);
      if (targetResult.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
      const targetUser = targetResult.rows[0];

      if (field === 'password') {
        const err = validatePassword(value);
        if (err) return res.status(400).json({ error: err });
        if (value !== confirmPassword) return res.status(400).json({ error: '两次输入的新密码不一致' });
        const bcrypt = require('bcryptjs');
        const hashed = bcrypt.hashSync(value, 10);
        await query('UPDATE users SET password = $1 WHERE id = $2', [hashed, userId]);
        if (targetUser.email) {
          const mailHtml = `<h2>【微创新实验田】密码已被管理员修改</h2><p>您的账号密码已被管理员修改，新密码为：</p><p style="font-size:20px;font-weight:bold;color:#2563eb;">${value}</p><p>请妥善保管，建议登录后自行修改密码。</p>`;
          await sendMail(targetUser.email, '【微创新实验田】您的密码已被修改', mailHtml);
        }
        res.status(200).json({ message: '密码修改成功，已发送邮件通知用户' });

      } else if (field === 'email') {
        const err = validateEmail(value);
        if (err) return res.status(400).json({ error: err });
        if (value !== confirmPassword) return res.status(400).json({ error: '两次输入的邮箱不一致' });
        await query('UPDATE users SET email = $1, email_verified = TRUE WHERE id = $2', [value, userId]);
        const mailHtml = `<h2>【微创新实验田】关联邮箱已被管理员修改</h2><p>您的关联邮箱已被管理员修改为：<strong>${value}</strong></p>`;
        await sendMail(value, '【微创新实验田】您的关联邮箱已修改', mailHtml);
        res.status(200).json({ message: '邮箱修改成功，已发送邮件通知' });

      } else if (['real_name', 'department', 'labor_relation', 'phone'].includes(field)) {
        await query(`UPDATE users SET ${field} = $1 WHERE id = $2`, [value, userId]);
        res.status(200).json({ message: '修改成功' });

      } else {
        res.status(400).json({ error: '不支持的字段' });
      }

    } else if (req.method === 'DELETE') {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: '缺少用户ID' });

      const targetResult = await query('SELECT username, is_admin FROM users WHERE id = $1', [userId]);
      if (targetResult.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
      if (targetResult.rows[0].is_admin) return res.status(400).json({ error: '不能删除管理员账号' });
      if (userId === userInfo.id) return res.status(400).json({ error: '不能删除当前登录账号' });

      await query('DELETE FROM users WHERE id = $1', [userId]);
      res.status(200).json({ message: '账号已删除' });

    } else {
      res.status(405).json({ error: '方法不允许' });
    }
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
}
