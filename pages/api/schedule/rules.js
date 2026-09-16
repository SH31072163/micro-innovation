import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

/**
 * 排班表管理区 - 配置默认规则 API
 *
 * GET    /api/schedule/rules?year=2026&month=9
 *   获取指定年月所有员工的默认排班规则
 *
 * PUT    /api/schedule/rules
 *   批量更新默认规则
 *   { year, month, rules: [{ employee_id, default_on_machine_days, allowed_work_types, allowed_weekdays }] }
 *
 * 规则：
 * - 每月C列填>0的浮点数（1位小数）
 * - D列复选工种（至少1最多全选）
 * - 可上机工作日复选周一至周五（至少1最多全选）
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
      const { year: yearStr, month: monthStr } = req.query;
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);

      if (!year || !month) return res.status(400).json({ error: '缺少年份或月份' });

      const result = await query(
        `SELECT r.id, r.employee_id, e.name, r.default_on_machine_days, r.allowed_work_types, r.allowed_weekdays
         FROM schedule_default_rules r
         JOIN schedule_employees e ON e.employee_id = r.employee_id
         WHERE r.year = $1 AND r.month = $2
         ORDER BY e.employee_id ASC`,
        [year, month]
      );

      // 解析 JSONB 字段
      const rules = result.rows.map(r => ({
        ...r,
        allowed_work_types: typeof r.allowed_work_types === 'string' ? JSON.parse(r.allowed_work_types) : r.allowed_work_types,
        allowed_weekdays: typeof r.allowed_weekdays === 'string' ? JSON.parse(r.allowed_weekdays) : r.allowed_weekdays,
      }));

      return res.status(200).json({ year, month, rules });
    }

    // ── PUT: 批量更新 ──
    if (req.method === 'PUT') {
      const { year, month, rules } = req.body;
      if (!year || !month || !rules || !Array.isArray(rules)) {
        return res.status(400).json({ error: '缺少必要参数' });
      }

      for (const r of rules) {
        // 验证：默认上机天数 > 0，浮点1位小数
        const days = parseFloat(r.default_on_machine_days);
        if (isNaN(days) || days <= 0) {
          return res.status(400).json({ error: `上机天数必须大于0: ${r.employee_id}` });
        }
        const roundedDays = Math.round(days * 10) / 10;

        // 验证：工种至少1个
        let workTypes = r.allowed_work_types;
        if (typeof workTypes === 'string') workTypes = JSON.parse(workTypes);
        if (!Array.isArray(workTypes) || workTypes.length === 0) {
          return res.status(400).json({ error: `至少选择1个上机工种: ${r.employee_id}` });
        }

        // 验证：工作日至少1个
        let weekdays = r.allowed_weekdays;
        if (typeof weekdays === 'string') weekdays = JSON.parse(weekdays);
        if (!Array.isArray(weekdays) || weekdays.length === 0) {
          return res.status(400).json({ error: `至少选择1个可上机工作日: ${r.employee_id}` });
        }

        // UPSERT
        await query(
          `INSERT INTO schedule_default_rules (employee_id, year, month, default_on_machine_days, allowed_work_types, allowed_weekdays)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (employee_id, year, month)
           DO UPDATE SET default_on_machine_days = $4, allowed_work_types = $5, allowed_weekdays = $6`,
          [r.employee_id, year, month, roundedDays, JSON.stringify(workTypes), JSON.stringify(weekdays)]
        );
      }

      return res.status(200).json({ message: '保存成功' });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('Schedule rules error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}
