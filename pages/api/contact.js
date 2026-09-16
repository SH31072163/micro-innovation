import { query } from '../../lib/db';
import { getUserFromRequest } from '../../lib/auth';
import { sendMail } from '../../lib/mailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '方法不允许' });

  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '请先登录' });

  const { subject, content } = req.body;
  if (!subject || !content) return res.status(400).json({ error: '请填写主题和内容' });

  try {
    const admin = await query('SELECT email FROM users WHERE is_admin = TRUE LIMIT 1');
    if (!admin.rows[0] || !admin.rows[0].email) {
      return res.status(400).json({ message: '管理员尚未设置邮箱，无法发送。请稍后再试。' });
    }

    const sender = await query('SELECT username, real_name, email FROM users WHERE id = $1', [userInfo.id]);
    const s = sender.rows[0];

    const mailHtml = `<h2>用户反馈/咨询</h2><p><strong>发送者：</strong>${s.real_name}（${s.username}）</p><p><strong>发送者邮箱：</strong>${s.email}</p><hr><p><strong>主题：</strong>${subject}</p><p><strong>内容：</strong></p><p style="white-space:pre-wrap;">${content}</p>`;
    await sendMail(admin.rows[0].email, `【微创新实验田】用户咨询：${subject}`, mailHtml);
    res.status(200).json({ message: '邮件已发送给管理员' });
  } catch (err) {
    console.error('Contact error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
}
