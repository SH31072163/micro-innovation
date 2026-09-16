import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

/**
 * 排班表管理区 - 配置邮件提醒规则 API
 * GET    /api/schedule/email-rules   获取所有邮件提醒规则
 * PUT    /api/schedule/email-rules   批量更新邮件提醒规则
 *   { rules: [{ id, is_enabled, send_date, send_time, title_template }] }
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
        `SELECT id, rule_type, seq, description, is_enabled, send_date, send_time, title_template, sort_order
         FROM schedule_email_rules ORDER BY sort_order ASC`
      );

      const grouped = {};
      for (const row of result.rows) {
        if (!grouped[row.rule_type]) grouped[row.rule_type] = [];
        grouped[row.rule_type].push(row);
      }

      return res.status(200).json(grouped);
    }

    // ── PUT: 批量更新 ──
    if (req.method === 'PUT') {
      const { rules } = req.body;
      if (!rules || !Array.isArray(rules)) return res.status(400).json({ error: '缺少规则数据' });

      for (const r of rules) {
        await query(
          `UPDATE schedule_email_rules
           SET is_enabled = $1, send_date = $2, send_time = $3, title_template = $4
           WHERE id = $5`,
          [
            r.is_enabled !== undefined ? r.is_enabled : true,
            r.send_date || '',
            r.send_time || '',
            r.title_template || '',
            r.id
          ]
        );
      }

      return res.status(200).json({ message: '保存成功' });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('Schedule email rules error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}
