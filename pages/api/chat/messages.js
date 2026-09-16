import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  if (req.method !== 'GET') return res.status(405).json({ error: '方法不允许' });

  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: '缺少对话ID' });

  try {
    const session = await query('SELECT * FROM chat_sessions WHERE id = $1 AND user_id = $2', [sessionId, userInfo.id]);
    if (session.rows.length === 0) return res.status(404).json({ error: '对话不存在' });
    const messages = await query('SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY id ASC', [sessionId]);
    res.status(200).json(messages.rows);
  } catch (err) {
    console.error('Messages error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
}
