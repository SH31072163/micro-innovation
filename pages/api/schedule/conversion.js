import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

/**
 * 排班表管理区 - 配置换算规则 API
 * GET    /api/schedule/conversion   获取所有换算规则
 * PUT    /api/schedule/conversion   批量更新换算规则  { rules: [{ id, value }] }
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
        'SELECT id, category, work_type, value, unit, sort_order FROM schedule_conversion_rules ORDER BY category ASC, sort_order ASC'
      );

      const grouped = {};
      for (const row of result.rows) {
        if (!grouped[row.category]) grouped[row.category] = [];
        grouped[row.category].push(row);
      }

      return res.status(200).json(grouped);
    }

    // ── PUT: 批量更新（C列数字可改，限浮点型1位小数且>0） ──
    if (req.method === 'PUT') {
      const { rules } = req.body;
      if (!rules || !Array.isArray(rules)) return res.status(400).json({ error: '缺少规则数据' });

      // 先完成全部验证，再批量写入
      const validated = [];
      for (const r of rules) {
        // 验证：浮点型1位小数且>0
        const val = parseFloat(r.value);
        if (isNaN(val) || val <= 0) {
          return res.status(400).json({ error: `值必须大于0: ${r.value}` });
        }
        validated.push({ id: r.id, val: Math.round(val * 10) / 10 });
      }

      // 批量多行 VALUES 更新（单条SQL，避免子请求超限）
      if (validated.length > 0) {
        const values = [];
        const params = [];
        validated.forEach((v, i) => {
          const base = i * 2;
          values.push(`($${base + 1}, $${base + 2})`);
          params.push(v.val, v.id);
        });
        await query(
          `UPDATE schedule_conversion_rules AS c
           SET value = v.val
           FROM (VALUES ${values.join(', ')}) AS v(val, id)
           WHERE c.id = v.id`,
          params
        );
      }

      return res.status(200).json({ message: '保存成功' });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('Schedule conversion error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}
