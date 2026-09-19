import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { sendMail } from '../../../lib/mailer';
import { validatePassword, validateEmail, generateToken } from '../../../lib/validators';

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '鏈櫥褰? });

  try {
    const adminResult = await query('SELECT is_admin FROM users WHERE id = $1', [userInfo.id]);
    if (!adminResult.rows[0] || !adminResult.rows[0].is_admin) {
      return res.status(403).json({ error: '鏃犵鐞嗗憳鏉冮檺' });
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
          u.status_text = '鍐荤粨';
        } else if (!u.email_verified) {
          u.status_text = '寰呴偖绠遍獙璇?;
        } else {
          u.status_text = '姝ｅ父';
        }
      });
      res.status(200).json(users.rows);

    } else if (req.method === 'POST') {
      const { action, userId } = req.body;
      if (action === 'freeze') {
        await query('UPDATE users SET status = $1 WHERE id = $2', ['frozen', userId]);
        res.status(200).json({ message: '宸插喕缁? });
      } else if (action === 'unfreeze') {
        await query('UPDATE users SET status = $1, login_fail_count = 0 WHERE id = $2', ['active', userId]);
        res.status(200).json({ message: '宸茶В鍐? });
      } else if (action === 'resend_verify') {
        // 閲嶅彂娉ㄥ唽楠岃瘉閭欢锛氫粎瀵圭姸鎬?"寰呴偖绠遍獙璇?锛坅ctive涓攅mail_verified=false锛夌殑鐢ㄦ埛鏈夋晥
        const targetResult = await query('SELECT id, email, status, email_verified FROM users WHERE id = $1', [userId]);
        if (targetResult.rows.length === 0) return res.status(404).json({ error: '鐢ㄦ埛涓嶅瓨鍦? });
        const targetUser = targetResult.rows[0];
        if (targetUser.status === 'frozen') return res.status(400).json({ error: '璇ヨ处鍙峰凡鍐荤粨锛岃鍏堣В鍐? });
        if (targetUser.email_verified) return res.status(400).json({ error: '璇ョ敤鎴烽偖绠卞凡楠岃瘉锛屾棤闇€閲嶅彂' });
        if (!targetUser.email) return res.status(400).json({ error: '璇ョ敤鎴锋棤鍏宠仈閭' });

        // 浣滃簾璇ョ敤鎴锋墍鏈夋湭浣跨敤鐨勬敞鍐岄獙璇侀摼鎺ワ紝閬垮厤澶氫釜鏈夋晥閾炬帴骞跺瓨
        await query("UPDATE email_tokens SET used = TRUE WHERE user_id = $1 AND type = 'register' AND used = FALSE", [userId]);

        // 鐢熸垚鏂?token锛?4灏忔椂鏈夋晥锛夛紝涓庢敞鍐屾椂閫昏緫涓€鑷?        const token = generateToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await query('INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)', [userId, token, 'register', expiresAt]);

        const verifyUrl = `${req.headers.origin || 'http://localhost:3000'}/api/auth/verify?token=${token}`;
        const mailHtml = `
          <h2>娆㈣繋娉ㄥ唽銆岄攢鍞湇鍔′腑蹇冨井鍒涙柊瀹為獙鐢般€?/h2>
          <p>璇峰湪24灏忔椂鍐呯偣鍑讳互涓嬮摼鎺ュ畬鎴愰偖绠遍獙璇侊細</p>
          <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">鐐瑰嚮楠岃瘉閭</a></p>
          <p>鎴栧鍒朵互涓嬮摼鎺ュ埌娴忚鍣ㄦ墦寮€锛?/p>
          <p>${verifyUrl}</p>
          <p>姝ら摼鎺?4灏忔椂鍚庡け鏁堛€?/p>
        `;
        const mailResult = await sendMail(targetUser.email, '銆愬井鍒涙柊瀹為獙鐢般€戣楠岃瘉鎮ㄧ殑娉ㄥ唽閭', mailHtml);
        if (mailResult === false) {
          return res.status(500).json({ error: '楠岃瘉閭欢鍙戦€佸け璐ワ細' + (sendMail.lastError || '鏈煡閿欒') });
        }
        res.status(200).json({ message: `楠岃瘉閭欢宸查噸鏂板彂閫佸埌 ${targetUser.email}锛岃鎻愰啋鐢ㄦ埛鍦?4灏忔椂鍐呯偣鍑婚偖浠朵腑鐨勯摼鎺ュ畬鎴愰獙璇併€俙 });
      } else {
        res.status(400).json({ error: '鏈煡鎿嶄綔' });
      }

    } else if (req.method === 'PUT') {
      const { userId, field, value, confirmPassword } = req.body;
      const targetResult = await query('SELECT * FROM users WHERE id = $1', [userId]);
      if (targetResult.rows.length === 0) return res.status(404).json({ error: '鐢ㄦ埛涓嶅瓨鍦? });
      const targetUser = targetResult.rows[0];

      if (field === 'password') {
        const err = validatePassword(value);
        if (err) return res.status(400).json({ error: err });
        if (value !== confirmPassword) return res.status(400).json({ error: '涓ゆ杈撳叆鐨勬柊瀵嗙爜涓嶄竴鑷? });
        const bcrypt = require('bcryptjs');
        const hashed = bcrypt.hashSync(value, 10);
        await query('UPDATE users SET password = $1 WHERE id = $2', [hashed, userId]);
        if (targetUser.email) {
          const mailHtml = `<h2>銆愬井鍒涙柊瀹為獙鐢般€戝瘑鐮佸凡琚鐞嗗憳淇敼</h2><p>鎮ㄧ殑璐﹀彿瀵嗙爜宸茶绠＄悊鍛樹慨鏀癸紝鏂板瘑鐮佷负锛?/p><p style="font-size:20px;font-weight:bold;color:#2563eb;">${value}</p><p>璇峰Ε鍠勪繚绠★紝寤鸿鐧诲綍鍚庤嚜琛屼慨鏀瑰瘑鐮併€?/p>`;
          const mailResult = await sendMail(targetUser.email, '銆愬井鍒涙柊瀹為獙鐢般€戞偍鐨勫瘑鐮佸凡琚慨鏀?, mailHtml);
          if (mailResult === false) {
            return res.status(500).json({ error: '瀵嗙爜宸蹭慨鏀癸紝浣嗛偖浠堕€氱煡鍙戦€佸け璐? });
          }
        }
        res.status(200).json({ message: '瀵嗙爜淇敼鎴愬姛锛屽凡鍙戦€侀偖浠堕€氱煡鐢ㄦ埛' });

      } else if (field === 'email') {
        const err = validateEmail(value);
        if (err) return res.status(400).json({ error: err });
        if (value !== confirmPassword) return res.status(400).json({ error: '涓ゆ杈撳叆鐨勯偖绠变笉涓€鑷? });
        await query('UPDATE users SET email = $1, email_verified = TRUE WHERE id = $2', [value, userId]);
        const mailHtml = `<h2>銆愬井鍒涙柊瀹為獙鐢般€戝叧鑱旈偖绠卞凡琚鐞嗗憳淇敼</h2><p>鎮ㄧ殑鍏宠仈閭宸茶绠＄悊鍛樹慨鏀逛负锛?strong>${value}</strong></p>`;
        const mailResult = await sendMail(value, '銆愬井鍒涙柊瀹為獙鐢般€戞偍鐨勫叧鑱旈偖绠卞凡淇敼', mailHtml);
        if (mailResult === false) {
          return res.status(500).json({ error: '閭淇敼鎴愬姛锛屼絾閭欢閫氱煡鍙戦€佸け璐? });
        }
        res.status(200).json({ message: '閭淇敼鎴愬姛锛屽凡鍙戦€侀偖浠堕€氱煡' });

      } else if (['real_name', 'department', 'labor_relation', 'phone'].includes(field)) {
        await query(`UPDATE users SET ${field} = $1 WHERE id = $2`, [value, userId]);
        res.status(200).json({ message: '淇敼鎴愬姛' });

      } else {
        res.status(400).json({ error: '涓嶆敮鎸佺殑瀛楁' });
      }

    } else if (req.method === 'DELETE') {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: '缂哄皯鐢ㄦ埛ID' });

      const targetResult = await query('SELECT username, is_admin FROM users WHERE id = $1', [userId]);
      if (targetResult.rows.length === 0) return res.status(404).json({ error: '鐢ㄦ埛涓嶅瓨鍦? });
      if (targetResult.rows[0].is_admin) return res.status(400).json({ error: '涓嶈兘鍒犻櫎绠＄悊鍛樿处鍙? });
      if (userId === userInfo.id) return res.status(400).json({ error: '涓嶈兘鍒犻櫎褰撳墠鐧诲綍璐﹀彿' });

      await query('DELETE FROM users WHERE id = $1', [userId]);
      res.status(200).json({ message: '璐﹀彿宸插垹闄? });

    } else {
      res.status(405).json({ error: '鏂规硶涓嶅厑璁? });
    }
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: '鏈嶅姟鍣ㄩ敊璇? });
  }
}
