import { query } from '../../../lib/db';
import { sendMail } from '../../../lib/mailer';
import { maskEmail, generateRandomPassword } from '../../../lib/validators';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: '璇疯緭鍏ョ敤鎴峰悕' });

    try {
      const result = await query('SELECT email FROM users WHERE username = $1', [username]);
      if (result.rows.length === 0) return res.status(404).json({ error: '璇ョ敤鎴峰悕涓嶅瓨鍦? });
      const user = result.rows[0];
      if (!user.email) return res.status(400).json({ error: '璇ヨ处鍙锋湭璁剧疆閭锛岃鑱旂郴绠＄悊鍛橀噸缃瘑鐮? });
      res.status(200).json({ maskedEmail: maskEmail(user.email) });
    } catch (err) {
      res.status(500).json({ error: '鏈嶅姟鍣ㄩ敊璇? });
    }
  } else if (req.method === 'POST') {
    const { username } = req.body;
    try {
      const result = await query('SELECT * FROM users WHERE username = $1', [username]);
      if (result.rows.length === 0) return res.status(404).json({ error: '璇ョ敤鎴峰悕涓嶅瓨鍦? });
      const user = result.rows[0];
      if (!user.email) return res.status(400).json({ error: '璇ヨ处鍙锋湭璁剧疆閭锛岃鑱旂郴绠＄悊鍛橀噸缃瘑鐮? });

      const newPwd = generateRandomPassword();
      const bcrypt = require('bcryptjs');
      const hashedPwd = bcrypt.hashSync(newPwd, 10);

      await query('UPDATE users SET password = $1, force_change_password = TRUE, status = $2, login_fail_count = 0 WHERE id = $3', [hashedPwd, 'active', user.id]);

      const mailHtml = `
        <h2>銆愬井鍒涙柊瀹為獙鐢般€戝瘑鐮侀噸缃€氱煡</h2>
        <p>鎮ㄧ殑璐﹀彿瀵嗙爜宸查噸缃紝鏂板瘑鐮佸涓嬶細</p>
        <p style="font-size:20px;font-weight:bold;color:#2563eb;letter-spacing:2px;">${newPwd}</p>
        <p>璇蜂娇鐢ㄦ瀵嗙爜鐧诲綍锛岀櫥褰曞悗绯荤粺灏嗚姹傛偍淇敼瀵嗙爜銆?/p>
        <p>濡傞潪鏈汉鎿嶄綔锛岃鑱旂郴绠＄悊鍛樸€?/p>
      `;
      const mailResult = await sendMail(user.email, '銆愬井鍒涙柊瀹為獙鐢般€戞偍鐨勫瘑鐮佸凡閲嶇疆', mailHtml);
      if (mailResult === false) {
        return res.status(500).json({ error: '瀵嗙爜宸查噸缃紝浣嗛偖浠跺彂閫佸け璐ワ細' + (sendMail.lastError || '鏈煡閿欒') });
      }

      res.status(200).json({ message: '鏂板瘑鐮佸凡鍙戦€佸埌鎮ㄧ殑閭锛岃鏌ユ敹' });
    } catch (err) {
      res.status(500).json({ error: '鏈嶅姟鍣ㄩ敊璇? });
    }
  } else {
    res.status(405).json({ error: '鏂规硶涓嶅厑璁? });
  }
}
