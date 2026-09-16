import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

/**
 * 国定假日 API
 *
 * GET    /api/schedule/holidays?year=2026
 *   获取指定年份的国定假日
 *
 * POST   /api/schedule/holidays
 *   { action: 'fetch', year }  - 从API自动获取当年假日并存入数据库
 *   { action: 'add', date, name, is_holiday }  - 手动添加/修正
 *   { action: 'delete', id }  - 删除一条
 */

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  const userRow = await query('SELECT is_schedule_admin, is_admin FROM users WHERE id = $1', [userInfo.id]);
  if (!userRow.rows[0] || (!userRow.rows[0].is_schedule_admin && !userRow.rows[0].is_admin)) {
    return res.status(403).json({ error: '无排班管理权限' });
  }

  try {
    // ── GET: 获取假日 ──
    if (req.method === 'GET') {
      const { year: yearStr } = req.query;
      const year = parseInt(yearStr) || new Date().getFullYear();

      const result = await query(
        `SELECT id, date, name, is_holiday FROM schedule_holidays
         WHERE EXTRACT(YEAR FROM date) = $1
         ORDER BY date ASC`,
        [year]
      );

      return res.status(200).json(result.rows.map(r => ({
        id: r.id,
        date: r.date,
        name: r.name,
        is_holiday: r.is_holiday,
      })));
    }

    // ── POST ──
    if (req.method === 'POST') {
      const { action } = req.body;

      // ── 从API获取假日 ──
      if (action === 'fetch') {
        const { year } = req.body;
        const targetYear = year || new Date().getFullYear();

        try {
          const holidays = await fetchHolidaysFromAPI(targetYear);

          // 先清除该年旧数据
          await query(`DELETE FROM schedule_holidays WHERE EXTRACT(YEAR FROM date) = $1`, [targetYear]);

          // 批量插入
          let inserted = 0;
          for (const h of holidays) {
            await query(
              `INSERT INTO schedule_holidays (date, name, is_holiday) VALUES ($1, $2, $3)
               ON CONFLICT (date) DO UPDATE SET name = $2, is_holiday = $3`,
              [h.date, h.name, h.isHoliday]
            );
            inserted++;
          }

          return res.status(200).json({
            message: `成功获取 ${targetYear} 年假日数据，共 ${inserted} 条`,
            count: inserted,
          });
        } catch (err) {
          return res.status(500).json({ error: `获取假日API失败: ${err.message}` });
        }
      }

      // ── 手动添加/修正 ──
      if (action === 'add') {
        const { date, name, is_holiday } = req.body;
        if (!date || !name) return res.status(400).json({ error: '缺少日期或名称' });

        await query(
          `INSERT INTO schedule_holidays (date, name, is_holiday) VALUES ($1, $2, $3)
           ON CONFLICT (date) DO UPDATE SET name = $2, is_holiday = $3`,
          [date, name, is_holiday !== false]
        );
        return res.status(200).json({ message: '添加/修正成功' });
      }

      // ── 删除 ──
      if (action === 'delete') {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: '缺少ID' });

        await query('DELETE FROM schedule_holidays WHERE id = $1', [id]);
        return res.status(200).json({ message: '删除成功' });
      }

      return res.status(400).json({ error: '未知操作' });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('Schedule holidays error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}

/**
 * 从公共API获取当年国定假日
 * 使用 timor.tech API: https://timor.tech/api/holiday/year/{year}
 * 返回格式: { code: 0, holiday: { "01-01": { holiday: true, name: "元旦" }, ... } }
 */
async function fetchHolidaysFromAPI(year) {
  const apiUrl = `https://timor.tech/api/holiday/year/${year}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(apiUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data.code !== 0 || !data.holiday) {
      throw new Error('API返回数据格式异常');
    }

    const holidays = [];
    for (const [dateStr, info] of Object.entries(data.holiday)) {
      // dateStr 格式: "01-01" (MM-DD)
      const fullDate = `${year}-${dateStr}`;
      holidays.push({
        date: fullDate,
        name: info.name || '假日',
        isHoliday: info.holiday === true,
      });
    }

    return holidays;
  } finally {
    clearTimeout(timer);
  }
}
