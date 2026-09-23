import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

/**
 * 排班表管理区 - 人员增删 API
 * GET    /api/schedule/employees     获取所有人员
 * POST   /api/schedule/employees     新增人员  { name, employee_id, email, employee_type }
 * PUT    /api/schedule/employees     修改人员  { id, email, employee_type }  (姓名和工号不可改)
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
        'SELECT id, name, employee_id, email, employee_type, hire_date, is_active, created_at FROM schedule_employees ORDER BY employee_id ASC'
      );
      return res.status(200).json(result.rows);
    }

    // ── POST: 新增 ──
    if (req.method === 'POST') {
      const { name, employee_id, email, employee_type, hire_date } = req.body;
      if (!name || !employee_id) return res.status(400).json({ error: '姓名和工号必填' });
      if (!hire_date || !/^\d{6}$/.test(hire_date)) return res.status(400).json({ error: '入职日期必填，格式YYYYMM' });

      // 兼职全职校验：只允许两个枚举值，缺省为全职
      const EMPLOYEE_TYPES = ['全职用户接待岗', '兼职用户接待岗'];
      const type = employee_type || '全职用户接待岗';
      if (!EMPLOYEE_TYPES.includes(type)) {
        return res.status(400).json({ error: '兼职全职取值无效' });
      }

      // 检查工号唯一
      const existing = await query('SELECT id FROM schedule_employees WHERE employee_id = $1', [employee_id]);
      if (existing.rows.length > 0) return res.status(409).json({ error: '工号已存在' });

      await query(
        'INSERT INTO schedule_employees (name, employee_id, email, employee_type, hire_date, is_active) VALUES ($1, $2, $3, $4, $5, TRUE)',
        [name, employee_id, (email || '').trim(), type, hire_date]
      );
      return res.status(201).json({ message: '新增成功' });
    }

    // ── PUT: 修改（可改邮箱、兼职全职类型，姓名和工号不可改） ──
    if (req.method === 'PUT') {
      const { id, email, employee_type, hire_date } = req.body;
      if (!id) return res.status(400).json({ error: '缺少ID' });

      // 兼职全职校验（若传了值才校验）
      const EMPLOYEE_TYPES = ['全职用户接待岗', '兼职用户接待岗'];
      if (employee_type !== undefined && employee_type !== null && !EMPLOYEE_TYPES.includes(employee_type)) {
        return res.status(400).json({ error: '兼职全职取值无效' });
      }

      // 入职日期校验（若传了值才校验）
      if (hire_date !== undefined && hire_date !== null && !/^\d{6}$/.test(hire_date)) {
        return res.status(400).json({ error: '入职日期格式无效，应为YYYYMM' });
      }

      // 仅更新传了的字段，避免覆盖
      const fields = [];
      const params = [];
      if (email !== undefined) { params.push((email || '').trim()); fields.push('email = $' + params.length); }
      if (employee_type !== undefined && employee_type !== null) { params.push(employee_type); fields.push('employee_type = $' + params.length); }
      if (hire_date !== undefined && hire_date !== null) { params.push(hire_date); fields.push('hire_date = $' + params.length); }
      if (fields.length === 0) return res.status(400).json({ error: '没有可更新的字段' });
      params.push(id);
      await query('UPDATE schedule_employees SET ' + fields.join(', ') + ' WHERE id = $' + params.length, params);
      return res.status(200).json({ message: '修改成功' });
    }

    // ── DELETE: 删除（标记为inactive，不影响历史记录） ──
    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: '缺少ID' });

      await query('UPDATE schedule_employees SET is_active = FALSE, deactivated_at = NOW() WHERE id = $1', [id]);
      return res.status(200).json({ message: '删除成功（次月生效）' });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('Schedule employees error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}
