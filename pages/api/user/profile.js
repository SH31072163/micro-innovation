import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { validatePassword, validateEmail, validatePhone, validateRealName, validateDepartment, generateToken } from '../../../lib/validators';
import { sendMail } from '../../../lib/mailer';

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '鏈櫥褰? });

  if (req.method === 'GET') {
    try {
      const result = await query(
        'SELECT id, username, email, phone, real_name, department, labor_relation, email_verified, status, is_admin, register_date FROM users WHERE id = $1',
        [userInfo.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '鐢ㄦ埛涓嶅瓨鍦? });
      res.status(200).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: '鏈嶅姟鍣ㄩ敊璇? });
    }
  } else if (req.method === 'PUT') {
    const { field, value, oldValue, confirmPassword } = req.body;
    try {
      const result = await query('SELECT * FROM users WHERE id = $1', [userInfo.id]);
      const user = result.rows[0];
      if (!user) return res.status(404).json({ error: '鐢ㄦ埛涓嶅瓨鍦? });

      if (field === 'password') {
        const err = validatePassword(value);
        if (err) return res.status(400).json({ error: err });
        if (!oldValue || !require('bcryptjs').compareSync(oldValue, user.password)) {
          return res.status(400).json({ error: '鍘熷瘑鐮佷笉姝ｇ‘' });
        }
        if (value !== confirmPassword) return res.status(400).json({ error: '涓ゆ杈撳叆鐨勬柊瀵嗙爜涓嶄竴鑷? });
        const hashed = require('bcryptjs').hashSync(value, 10);
        await query('UPDATE users SET password = $1, force_change_password = FALSE WHERE id = $2', [hashed, user.id]);
        res.status(200).json({ message: '瀵嗙爜淇敼鎴愬姛' });

      } else if (field === 'email') {
        const err = validateEmail(value);
        if (err) return res.status(400).json({ error: err });
        if (value !== confirmPassword) return res.status(400).json({ error: '涓ゆ杈撳叆鐨勯偖绠变笉涓€鑷? });

        await query('UPDATE users SET email = $1, email_verified = FALSE WHERE id = $2', [value, user.id]);
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await query('INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)', [user.id, token, 'email_change', expiresAt]);

        const verifyUrl = `${req.headers.origin || 'https://micro-innovation.pages.dev'}/api/auth/verify?token=${token}`;
        const mailHtml = `<h2>銆愬井鍒涙柊瀹為獙鐢般€戣楠岃瘉鏂伴偖绠?/h2><p>鎮ㄦ鍦ㄤ慨鏀瑰叧鑱旈偖绠憋紝璇峰湪24灏忔椂鍐呯偣鍑讳互涓嬮摼鎺ュ畬鎴愰獙璇侊細</p><p><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">鐐瑰嚮楠岃瘉鏂伴偖绠?/a></p><p>鎴栧鍒朵互涓嬮摼鎺ュ埌娴忚鍣ㄦ墦寮€锛?/p><p>${verifyUrl}</p><p>楠岃瘉閫氳繃鍚庢墠鑳芥甯镐娇鐢ㄨ处鍙枫€?/p>`;
        await sendMail(value, '銆愬井鍒涙柊瀹為獙鐢般€戣楠岃瘉鎮ㄧ殑鏂伴偖绠?, mailHtml);
        res.status(200).json({ message: '鏂伴偖绠遍獙璇侀偖浠跺凡鍙戦€侊紝璇锋煡鏀跺苟鐐瑰嚮楠岃瘉閾炬帴銆傞獙璇侀€氳繃鍓嶈处鍙峰皢鏆傛椂鏃犳硶鐧诲綍銆? });

      } else if (field === 'phone') {
        const err = validatePhone(value);
        if (err) return res.status(400).json({ error: err });
        await query('UPDATE users SET phone = $1 WHERE id = $2', [value, user.id]);
        res.status(200).json({ message: '鎵嬫満鍙蜂慨鏀规垚鍔? });

      } else if (field === 'real_name') {
        const err = validateRealName(value);
        if (err) return res.status(400).json({ error: err });
        await query('UPDATE users SET real_name = $1 WHERE id = $2', [value, user.id]);
        res.status(200).json({ message: '濮撳悕淇敼鎴愬姛' });

      } else if (field === 'department') {
        const err = validateDepartment(value);
        if (err) return res.status(400).json({ error: err });
        await query('UPDATE users SET department = $1 WHERE id = $2', [value, user.id]);
        res.status(200).json({ message: '閮ㄩ棬淇敼鎴愬姛' });

      } else if (field === 'labor_relation') {
        if (!['鍥借剦鍛樺伐', '闈炲浗鑴夊憳宸?].includes(value)) return res.status(400).json({ error: '鍔冲姩鍏崇郴閫夐」涓嶆纭? });
        await query('UPDATE users SET labor_relation = $1 WHERE id = $2', [value, user.id]);
        res.status(200).json({ message: '鍔冲姩鍏崇郴淇敼鎴愬姛' });

      } else {
        res.status(400).json({ error: '涓嶆敮鎸佺殑瀛楁' });
      }
    } catch (err) {
      console.error('Profile update error:', err);
      res.status(500).json({ error: '鏈嶅姟鍣ㄩ敊璇? });
    }
  } else {
    res.status(405).json({ error: '鏂规硶涓嶅厑璁? });
  }
}
