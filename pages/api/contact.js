import { query } from '../../lib/db';
import { getUserFromRequest } from '../../lib/auth';
import { sendMail } from '../../lib/mailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '鏂规硶涓嶅厑璁? });

  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '璇峰厛鐧诲綍' });

  const { subject, content } = req.body;
  if (!subject || !content) return res.status(400).json({ error: '璇峰～鍐欎富棰樺拰鍐呭' });

  try {
    const admin = await query('SELECT email FROM users WHERE is_admin = TRUE LIMIT 1');
    if (!admin.rows[0] || !admin.rows[0].email) {
      return res.status(400).json({ message: '绠＄悊鍛樺皻鏈缃偖绠憋紝鏃犳硶鍙戦€併€傝绋嶅悗鍐嶈瘯銆? });
    }

    const sender = await query('SELECT username, real_name, email FROM users WHERE id = $1', [userInfo.id]);
    const s = sender.rows[0];

    const mailHtml = `<h2>鐢ㄦ埛鍙嶉/鍜ㄨ</h2><p><strong>鍙戦€佽€咃細</strong>${s.real_name}锛?{s.username}锛?/p><p><strong>鍙戦€佽€呴偖绠憋細</strong>${s.email}</p><hr><p><strong>涓婚锛?/strong>${subject}</p><p><strong>鍐呭锛?/strong></p><p style="white-space:pre-wrap;">${content}</p>`;
    const mailResult = await sendMail(admin.rows[0].email, `銆愬井鍒涙柊瀹為獙鐢般€戠敤鎴峰挩璇細${subject}`, mailHtml);
    if (mailResult === false) {
      return res.status(500).json({ error: '閭欢鍙戦€佸け璐ワ細' + (sendMail.lastError || '鏈煡閿欒') });
    }
    res.status(200).json({ message: '閭欢宸插彂閫佺粰绠＄悊鍛? });
  } catch (err) {
    console.error('Contact error:', err);
    res.status(500).json({ error: '鏈嶅姟鍣ㄩ敊璇? });
  }
}
