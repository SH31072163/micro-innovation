import { query } from '../../../lib/db';
import { sendMail } from '../../../lib/mailer';
import {
  validateUsername, validatePassword, validateEmail, validatePhone,
  validateRealName, validateDepartment, validateLaborRelation, generateToken
} from '../../../lib/validators';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '鏂规硶涓嶅厑璁? });
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
    return res.status(400).json({ error: '涓ゆ杈撳叆鐨勫瘑鐮佷笉涓€鑷?, field: 'confirmPassword' });
  }

  try {
    // 鐢ㄦ埛鍚嶉噸澶嶆牎楠岋紙鍚湭楠岃瘉閭鐨勭敤鎴凤級
    const existingUsername = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUsername.rows.length > 0) {
      return res.status(400).json({ error: '鎮ㄦ墍濉啓鐢ㄦ埛鍚嶅凡缁忚浜轰娇鐢紝璇锋洿鎹€?, field: 'username' });
    }

    // 閭閲嶅鏍￠獙锛堝惈鏈獙璇侀偖绠辩殑鐢ㄦ埛锛?    const existingEmail = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail.rows.length > 0) {
      return res.status(400).json({ error: '鎮ㄦ墍濉啓閭宸茬粡琚汉浣跨敤锛岃鏇存崲銆?, field: 'email' });
    }

    // 鎵嬫満鍙烽噸澶嶆牎楠岋紙鍚湭楠岃瘉閭鐨勭敤鎴凤級
    const existingPhone = await query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existingPhone.rows.length > 0) {
      return res.status(400).json({ error: '鎮ㄦ墍濉啓鎵嬫満鍙风爜宸茬粡琚汉浣跨敤锛岃鏇存崲銆?, field: 'phone' });
    }

    const bcrypt = require('bcryptjs');
    const hashedPassword = bcrypt.hashSync(password, 10);
    const registerDate = new Date().toISOString().split('T')[0];

    const result = await query(`
      INSERT INTO users (username, password, email, phone, real_name, department, labor_relation, register_date, email_verified)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE) RETURNING id
    `, [username, hashedPassword, email, phone, real_name, department, labor_relation, registerDate]);

    const userId = result.rows[0].id;
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await query('INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)', [userId, token, 'register', expiresAt]);

    const verifyUrl = `${req.headers.origin || 'https://micro-innovation.pages.dev'}/api/auth/verify?token=${token}`;
    const mailHtml = `
      <h2>娆㈣繋娉ㄥ唽銆岄攢鍞湇鍔′腑蹇冨井鍒涙柊瀹為獙鐢般€?/h2>
      <p>璇峰湪24灏忔椂鍐呯偣鍑讳互涓嬮摼鎺ュ畬鎴愰偖绠遍獙璇侊細</p>
      <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">鐐瑰嚮楠岃瘉閭</a></p>
      <p>鎴栧鍒朵互涓嬮摼鎺ュ埌娴忚鍣ㄦ墦寮€锛?/p>
      <p>${verifyUrl}</p>
      <p>姝ら摼鎺?4灏忔椂鍚庡け鏁堛€?/p>
    `;

    const mailResult = await sendMail(email, '銆愬井鍒涙柊瀹為獙鐢般€戣楠岃瘉鎮ㄧ殑娉ㄥ唽閭', mailHtml);
    if (mailResult === false) {
      return res.status(500).json({ error: '娉ㄥ唽鎴愬姛锛屼絾楠岃瘉閭欢鍙戦€佸け璐ワ細' + (sendMail.lastError || '鏈煡閿欒') });
    }

    res.status(200).json({ message: '鎻愪氦娉ㄥ唽鐢宠鎴愬姛锛侀獙璇侀偖浠跺凡鍙戦€佸埌鎮ㄧ殑閭锛岃鍦?4灏忔椂鍐呯偣鍑婚偖浠朵腑鐨勯摼鎺ュ畬鎴愰獙璇併€? });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '鏈嶅姟鍣ㄩ敊璇? });
  }
}
