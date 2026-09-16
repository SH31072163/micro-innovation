import { query } from '../../../lib/db';
import { generateToken } from '../../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许' });
  }

  const { username, password, mathAnswer, mathExpected } = req.body;

  if (mathAnswer === undefined || mathExpected === undefined) {
    return res.status(400).json({ error: '请完成验证码' });
  }
  if (parseInt(mathAnswer) !== parseInt(mathExpected)) {
    return res.status(400).json({ error: '验证码错误' });
  }

  try {
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    if (user.status === 'frozen') {
      return res.status(403).json({ error: '账号已被冻结，请联系管理员或通过"忘记密码"重置密码' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ error: '邮箱未验证，请查收注册邮件并点击验证链接' });
    }

    const bcrypt = require('bcryptjs');
    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) {
      const failCount = user.login_fail_count + 1;
      if (failCount >= 5) {
        await query('UPDATE users SET status = $1, login_fail_count = $2 WHERE id = $3', ['frozen', failCount, user.id]);
        return res.status(403).json({ error: '连续5次登录错误，账号已被冻结' });
      }
      await query('UPDATE users SET login_fail_count = $1 WHERE id = $2', [failCount, user.id]);
      return res.status(401).json({ error: `用户名或密码错误，已失败${failCount}次，5次后将冻结账号` });
    }

    await query('UPDATE users SET login_fail_count = 0 WHERE id = $1', [user.id]);

    const token = generateToken({ id: user.id, username: user.username, is_admin: user.is_admin ? 1 : 0 });

    res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        real_name: user.real_name,
        is_admin: user.is_admin,
        force_change_password: user.force_change_password,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
}
