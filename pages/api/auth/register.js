import { query } from '../../../lib/db';
import { sendMail } from '../../../lib/mailer';
import {
  validateUsername, validatePassword, validateEmail, validatePhone,
  validateRealName, validateDepartment, validateLaborRelation, generateToken
} from '../../../lib/validators';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许' });
  }

  const { username, password, confirmPassword, email, phone, real_name, department, labor_relation } = req.body;

  const checks = [
    { fn: () => validateUsername(username), field: 'username' },
    { fn: () => validatePassword(password), field: 'password' },
    { fn: () => validateEmail(email), field: 'email' },
    { fn: () => validatePhone(phone), field: 'phone' },
    { fn: () => validateRealName(real_name), field: 'real_name' },
    { fn: () => validateDepartment(department), field: 'department' },
    { fn: () => validateLaborRelation(labor_relation), field: 'labor_relation' },
  ];

  for (const check of checks) {
    const err = check.fn();
    if (err) return res.status(400).json({ error: err, field: check.field });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: '两次输入的密码不一致', field: 'confirmPassword' });
  }

  try {
    // 用户名重复校验（含未验证邮箱的用户）
    const existingUsername = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUsername.rows.length > 0) {
      return res.status(400).json({ error: '您所填写用户名已经被人使用，请更换。', field: 'username' });
    }

    // 邮箱重复校验（含未验证邮箱的用户）
    const existingEmail = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail.rows.length > 0) {
      return res.status(400).json({ error: '您所填写邮箱已经被人使用，请更换。', field: 'email' });
    }

    // 手机号重复校验（含未验证邮箱的用户）
    const existingPhone = await query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existingPhone.rows.length > 0) {
      return res.status(400).json({ error: '您所填写手机号码已经被人使用，请更换。', field: 'phone' });
    }

    const bcrypt = require('bcryptjs');
    const hashedPassword = bcrypt.hashSync(password, 10);
    const registerDate = new Date().toISOString().split('T')[0];

    // 生成用户编号 UserID：Uxj+YYYYMMDD+XX（当天序号自动递增，不回收）
    const dateStr = registerDate.replace(/-/g, ''); // 20260920
    const prefix = `Uxj${dateStr}`; // Uxj20260920
    const countResult = await query(
      "SELECT COUNT(*) as count FROM users WHERE user_id LIKE $1",
      [`${prefix}%`]
    );
    const seqNum = parseInt(countResult.rows[0].count) + 1;
    const userIdCode = `${prefix}${String(seqNum).padStart(2, '0')}`; // Uxj2026092001

    const result = await query(`
      INSERT INTO users (username, password, email, phone, real_name, department, labor_relation, register_date, email_verified, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9) RETURNING id
    `, [username, hashedPassword, email, phone, real_name, department, labor_relation, registerDate, userIdCode]);

    const userId = result.rows[0].id;
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await query('INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)', [userId, token, 'register', expiresAt]);

    const verifyUrl = `${req.headers.origin || 'https://micro-innovation.pages.dev'}/api/auth/verify?token=${token}`;
    const mailHtml = `
      <h2>欢迎注册「销售服务中心微创新实验田」</h2>
      <p>请在24小时内点击以下链接完成邮箱验证：</p>
      <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">点击验证邮箱</a></p>
      <p>或复制以下链接到浏览器打开：</p>
      <p>${verifyUrl}</p>
      <p>此链接24小时后失效。</p>
    `;

    const mailResult = await sendMail(email, '【微创新实验田】请验证您的注册邮箱', mailHtml);
    if (mailResult === false) {
      return res.status(500).json({ error: '注册成功，但验证邮件发送失败：' + (sendMail.lastError || '未知错误') });
    }

    res.status(200).json({ message: `提交注册申请成功！您的用户编号为 ${userIdCode}。验证邮件已发送到您的邮箱，请在24小时内点击邮件中的链接完成验证。` });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
}
