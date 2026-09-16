import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

/**
 * 排班表管理区 - 配置数据字典 API
 * GET    /api/schedule/dict          获取所有字典数据
 * POST   /api/schedule/dict          新增字典项  { category, value, sort_order }
 * PUT    /api/schedule/dict          修改字典项  { id, category, value, sort_order }
 * DELETE /api/schedule/dict          删除字典项  { id }
 */

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  // ── 权限检查：需要排班管理员 ──
  const userRow = await query('SELECT is_schedule_admin, is_admin FROM users WHERE id = $1', [userInfo.id]);
  if (!userRow.rows[0] || (!userRow.rows[0].is_schedule_admin && !userRow.rows[0].is_admin)) {
    return res.status(403).json({ error: '无排班管理权限' });
  }

  try {
    // ── GET: 获取所有字典数据 ──
    if (req.method === 'GET') {
      const result = await query(
        'SELECT id, category, value, sort_order FROM schedule_dict ORDER BY category ASC, sort_order ASC'
      );

      // 按 category 分组返回
      const grouped = {};
      for (const row of result.rows) {
        if (!grouped[row.category]) grouped[row.category] = [];
        grouped[row.category].push(row);
      }

      return res.status(200).json(grouped);
    }

    // ── POST: 新增 ──
    if (req.method === 'POST') {
      const { category, value, sort_order } = req.body;
      if (!category || !value) return res.status(400).json({ error: '缺少必填字段' });

      const result = await query(
        'INSERT INTO schedule_dict (category, value, sort_order) VALUES ($1, $2, $3) RETURNING id',
        [category, value, sort_order || 0]
      );
      return res.status(201).json({ id: result.rows[0].id, message: '新增成功' });
    }

    // ── PUT: 修改 ──
    if (req.method === 'PUT') {
      const { id, category, value, sort_order } = req.body;
      if (!id) return res.status(400).json({ error: '缺少ID' });

      await query(
        'UPDATE schedule_dict SET category = $1, value = $2, sort_order = $3 WHERE id = $4',
        [category, value, sort_order || 0, id]
      );
      return res.status(200).json({ message: '修改成功' });
    }

    // ── DELETE: 删除 ──
    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: '缺少ID' });

      await query('DELETE FROM schedule_dict WHERE id = $1', [id]);
      return res.status(200).json({ message: '删除成功' });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('Schedule dict error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}
