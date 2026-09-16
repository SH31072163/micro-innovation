import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  try {
    const adminResult = await query('SELECT is_admin FROM users WHERE id = $1', [userInfo.id]);
    if (!adminResult.rows[0] || !adminResult.rows[0].is_admin) {
      return res.status(403).json({ error: '无管理员权限' });
    }

    if (req.method === 'GET') {
      const users = await query('SELECT id, username, real_name FROM users WHERE is_admin = FALSE ORDER BY id ASC');
      const menus = await query('SELECT id, title, level, parent_id, sort_order, is_system FROM menus ORDER BY level, sort_order ASC');
      const permissions = await query('SELECT user_id, menu_id FROM menu_permissions');
      res.status(200).json({ users: users.rows, menus: menus.rows, permissions: permissions.rows });

    } else if (req.method === 'POST') {
      const { userId, menuIds } = req.body;
      await query('DELETE FROM menu_permissions WHERE user_id = $1', [userId]);
      for (const mid of menuIds) {
        await query('INSERT INTO menu_permissions (user_id, menu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, mid]);
      }
      res.status(200).json({ message: '权限设置成功' });

    } else if (req.method === 'PUT') {
      const { menus } = req.body;
      for (const m of menus) {
        await query('UPDATE menus SET sort_order = $1 WHERE id = $2', [m.sort_order, m.id]);
      }
      res.status(200).json({ message: '排序已更新' });

    } else {
      res.status(405).json({ error: '方法不允许' });
    }
  } catch (err) {
    console.error('Menu manage error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
}
