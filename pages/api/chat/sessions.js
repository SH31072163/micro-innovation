import { query } from '../../../lib/db';
import { initializeDb } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

export default async function handler(req, res) {
  try {
    await initializeDb();
  } catch (err) {
    console.error('DB init error:', err);
  }

  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  try {
    if (req.method === 'GET') {
      const sessions = await query(`
        SELECT s.*,
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as msg_count,
          (SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY id ASC LIMIT 1) as first_msg
        FROM chat_sessions s
        WHERE s.user_id = $1 AND s.created_at > NOW() - INTERVAL '7 days'
        ORDER BY s.updated_at DESC
      `, [userInfo.id]);

      sessions.rows.forEach(s => {
        if (s.first_msg) s.title = s.first_msg.substring(0, 30) + (s.first_msg.length > 30 ? '...' : '');
      });

      res.status(200).json(sessions.rows);

    } else if (req.method === 'POST') {
      const result = await query('INSERT INTO chat_sessions (user_id) VALUES ($1) RETURNING id', [userInfo.id]);
      res.status(200).json({ id: result.rows[0].id, title: '新对话' });

    } else if (req.method === 'DELETE') {
      const { sessionId } = req.query;
      const session = await query('SELECT * FROM chat_sessions WHERE id = $1 AND user_id = $2', [sessionId, userInfo.id]);
      if (session.rows.length === 0) return res.status(404).json({ error: '对话不存在' });
      await query('DELETE FROM chat_messages WHERE session_id = $1', [sessionId]);
      await query('DELETE FROM chat_sessions WHERE id = $1', [sessionId]);
      res.status(200).json({ message: '对话已删除' });

    } else {
      res.status(405).json({ error: '方法不允许' });
    }
  } catch (err) {
    console.error('Sessions error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
}
