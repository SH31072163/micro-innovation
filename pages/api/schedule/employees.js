import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

/**
 * 排班表管理区 - 人员增删 API
 * GET    /api/schedule/employees     获取所有人员
 * POST   /api/schedule/employees     新增人员  { name, employee_id, email }
 * PUT    /api/schedule/employees     修改人员  { id, email }  (姓名和工号不可改)
 * DELETE /api/schedule/employees    删除人员  { id }
 *
 * 注意：增删效果在"配置排班"和"配置默认规则"中只能次月生效。
 *       修改信息（如邮箱）立即生效。
 */

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  const userRow = await query('SELECT is_schedule_admin, is_admin FROM users WHERE id = $1', [userInfo.id]);
  if (!userRow.rows[0] || (!userRow.rows[0].is_schedule_admin && !userRow.rows[0].is_admin)) {
    return res.status(403).json({ error: '无排班管理权限' });
  }

  try {
    // ── GET ──
    if (req.method === 'GET') {
      const result = await query(
        'SELECT id, name, employee_id, email, is_active, created_at FROM schedule_employees ORDER BY employee_id ASC'
      );
      return res.status(200).json(result.rows);
    }

    // ── POST: 新增 ──
    if (req.method === 'POST') {
      const { name, employee_id, email } = req.body;
      if (!name || !employee_id) return res.status(400).json({ error: '姓名和工号必填' });

      // 检查工号唯一
      const existing = await query('SELECT id FROM schedule_employees WHERE employee_id = $1', [employee_id]);
      if (existing.rows.length > 0) return res.status(409).json({ error: '工号已存在' });

      await query(
        'INSERT INTO schedule_employees (name, employee_id, email, is_active) VALUES ($1, $2, $3, TRUE)',
        [name, employee_id, (email || '').trim()]
      );
      return res.status(201).json({ message: '新增成功' });
    }

    // ── PUT: 修改（仅可改邮箱，姓名和工号不可改） ──
    if (req.method === 'PUT') {
      const { id, email } = req.body;
      if (!id) return res.status(400).json({ error: '缺少ID' });

      await query('UPDATE schedule_employees SET email = $1 WHERE id = $2', [(email || '').trim(), id]);
      return res.status(200).json({ message: '修改成功' });
    }

    // ── DELETE: 删除（标记为inactive，不影响历史记录） ──
    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: '缺少ID' });

      await query('UPDATE schedule_employees SET is_active = FALSE WHERE id = $1', [id]);
      return res.status(200).json({ message: '删除成功（次月生效）' });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('Schedule employees error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}
