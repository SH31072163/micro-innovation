import { query, queryBatch } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { sendMail } from '../../../lib/mailer';
import { generateScheduleEmailHTML } from '../../../lib/scheduleEmailTemplate';
import { getGoalEndDayLabel } from '../../../lib/goalDate';

/**
 * 排班表管理区 - 配置排班 API
 *
 * GET    /api/schedule/manage?year=2026&month=9
 *   获取指定年月排班表（管理区编辑用，含汇总统计）
 *
 * PUT    /api/schedule/manage
 *   保存修改后的排班表
 *   { year, month, records: [{ employee_id, day, shift, meal_time, am_work_type, pm_work_type }] }
 *
 * POST   /api/schedule/manage   { action: 'reschedule', year, month }
 *   重新排班：根据默认规则+13条排班规则自动生成排班
 *
 * 限制：
 * - 仅保留上月/本月/次月三个月数据
 * - 某月排班表在次月20日后不允许修改
 * - 保存后如有修改，根据邮件提醒规则发邮件
 */

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  const userRow = await query('SELECT is_schedule_admin, is_admin FROM users WHERE id = $1', [userInfo.id]);
  if (!userRow.rows[0] || (!userRow.rows[0].is_schedule_admin && !userRow.rows[0].is_admin)) {
    return res.status(403).json({ error: '无排班管理权限' });
  }

  try {
    // 确保 schedule_records 表存在 remark 字段（自动迁移，所有请求前执行）
    try {
      await query('ALTER TABLE schedule_records ADD COLUMN IF NOT EXISTS remark VARCHAR(150) DEFAULT \'\'');
    } catch (e) {
      console.error('[排班] 添加 remark 字段失败:', e.message);
    }

    // ── GET: 获取排班表 ──
    if (req.method === 'GET') {
      const { year: yearStr, month: monthStr } = req.query;
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);

      if (!year || !month) return res.status(400).json({ error: '缺少年份或月份' });

      // 限制：仅上月/本月/次月
      const { allowed, diff } = checkMonthAllowed(year, month);
      if (!allowed) return res.status(403).json({ error: '仅可管理上月、本月和次月的排班表' });

      // 获取员工列表（仅排班岗位：全职/兼职用户接待岗）
      const employees = await query(
        'SELECT name, employee_id, employee_type FROM schedule_employees WHERE is_active = TRUE AND employee_type IN (\'全职用户接待岗\', \'兼职用户接待岗\') ORDER BY employee_id ASC'
      );

      const records = await query(
        `SELECT employee_id, day, shift, meal_time, am_work_type, pm_work_type, remark
         FROM schedule_records
         WHERE year = $1 AND month = $2
         ORDER BY employee_id ASC, day ASC`,
        [year, month]
      );

      const days = getDaysInMonth(year, month);
      const weekdays = getWeekdays(year, month, days);

      const recordsMap = {};
      for (const r of records.rows) {
        if (!recordsMap[r.employee_id]) recordsMap[r.employee_id] = {};
        recordsMap[r.employee_id][r.day] = {
          shift: r.shift,
          meal_time: r.meal_time,
          am_work_type: r.am_work_type,
          pm_work_type: r.pm_work_type,
          remark: r.remark || '',
        };
      }

// 检查是否已过截止日期（次月5日后不可修改）
  const canEdit = checkCanEdit(year, month);

  // 是否允许重新排班（仅次月允许）
  const canReschedule = isNextMonth(year, month);

      // 人员维度13项汇总统计（每人当月统计）
      const personStats = {};
      for (const emp of employees.rows) {
        personStats[emp.employee_id] = computePersonalStatsForEmail(recordsMap[emp.employee_id] || {}, days);
      }

      // 天维度13项汇总统计（每天各指标在岗人数）
      const dayStats = computeDayStats(recordsMap, employees.rows, days);

      return res.status(200).json({
        year, month, days, weekdays,
        employees: employees.rows,
        records: recordsMap,
        personStats,
        dayStats,
        canEdit,
        canReschedule,
        isEmpty: records.rows.length === 0,
      });
    }

    // ── PUT: 保存排班表修改 ──
    if (req.method === 'PUT') {
      const { year, month, records } = req.body;
      if (!year || !month) return res.status(400).json({ error: '缺少年份或月份' });

      // 确保 schedule_records 表存在 remark 字段（自动迁移）
      try {
        await query('ALTER TABLE schedule_records ADD COLUMN IF NOT EXISTS remark VARCHAR(150) DEFAULT \'\'');
      } catch (e) {
        console.error('[排班] 添加 remark 字段失败:', e.message);
      }

      // 检查是否可编辑
      const canEdit = checkCanEdit(year, month);
      if (!canEdit) return res.status(403).json({ error: '该月排班表已过截止日期，不可修改' });

      // 获取旧记录用于比对
      const oldRecords = await query(
        'SELECT employee_id, day, shift, meal_time, am_work_type, pm_work_type, remark FROM schedule_records WHERE year = $1 AND month = $2',
        [year, month]
      );
      const oldMap = {};
      for (const r of oldRecords.rows) {
        oldMap[`${r.employee_id}_${r.day}`] = r;
      }

      // UPSERT 新记录（分批多行 VALUES，避免子请求超限）
      // 记录有变化的员工
      const changedEmployees = new Set();

      // 先计算变化
      for (const rec of records) {
        const key = `${rec.employee_id}_${rec.day}`;
        const old = oldMap[key];
        const hasChange = !old ||
          old.shift !== rec.shift ||
          old.meal_time !== rec.meal_time ||
          old.am_work_type !== rec.am_work_type ||
          old.pm_work_type !== rec.pm_work_type ||
          (old.remark || '') !== (rec.remark || '');
        if (hasChange) changedEmployees.add(rec.employee_id);
      }

      // 分批多行 VALUES UPSERT（避免子请求超限）
      const BATCH_SIZE = 100;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const values = [];
        const params = [];
        batch.forEach((rec, j) => {
          const base = j * 9;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, NOW())`);
          params.push(year, month, rec.employee_id, rec.day, rec.shift, rec.meal_time || '', rec.am_work_type || '', rec.pm_work_type || '', rec.remark || '');
        });
        await query(
          `INSERT INTO schedule_records (year, month, employee_id, day, shift, meal_time, am_work_type, pm_work_type, remark, updated_at)
           VALUES ${values.join(', ')}
           ON CONFLICT (year, month, employee_id, day)
           DO UPDATE SET shift = EXCLUDED.shift, meal_time = EXCLUDED.meal_time,
                         am_work_type = EXCLUDED.am_work_type, pm_work_type = EXCLUDED.pm_work_type,
                         remark = EXCLUDED.remark,
                         updated_at = NOW()`,
          params
        );
      }

      // 清理超出3个月的历史数据
      await cleanupOldRecords();

      // ── 如有修改，根据邮件提醒规则发邮件 ──
      let emailSentCount = 0;
      if (changedEmployees.size > 0) {
        emailSentCount = await sendAdjustmentEmails(year, month, Array.from(changedEmployees));
      }

      return res.status(200).json({
        message: '保存成功',
        changedCount: changedEmployees.size,
        changedEmployees: Array.from(changedEmployees),
        emailSentCount,
      });
    }

    // ── POST: 重新排班 ──
    if (req.method === 'POST') {
      const { action, year, month } = req.body;
      if (action !== 'reschedule') return res.status(400).json({ error: '未知操作' });
      if (!year || !month) return res.status(400).json({ error: '缺少年份或月份' });

      // 确保 schedule_records 表存在 remark 字段（自动迁移）
      try {
        await query('ALTER TABLE schedule_records ADD COLUMN IF NOT EXISTS remark VARCHAR(150) DEFAULT \'\'');
      } catch (e) {
        console.error('[排班] 添加 remark 字段失败:', e.message);
      }

      const canEdit = checkCanEdit(year, month);
      if (!canEdit) return res.status(403).json({ error: '该月排班表已过截止日期，不可重新排班' });

      // 重新排班仅允许针对次月（本月/上月不允许重新排班）
      if (!isNextMonth(year, month)) {
        return res.status(403).json({ error: '仅次月允许重新排班，本月/上月排班表不可重新排班' });
      }

      // 获取员工列表（仅排班岗位：全职/兼职用户接待岗）
      const employees = await query(
        'SELECT name, employee_id, employee_type FROM schedule_employees WHERE is_active = TRUE AND employee_type IN (\'全职用户接待岗\', \'兼职用户接待岗\') ORDER BY employee_id ASC'
      );

      // 获取默认规则
      let rulesResult = await query(
        `SELECT employee_id, default_on_machine_days, allowed_work_types, allowed_weekdays
         FROM schedule_default_rules WHERE year = $1 AND month = $2`,
        [year, month]
      );

      // 若目标月无默认规则，自动回退到上月规则（保证"重新排班"可用）
      if (rulesResult.rows.length === 0) {
        const prevKey = year * 12 + (month - 2);
        const prevYear = Math.floor(prevKey / 12);
        const prevMonth = (prevKey % 12) + 1;
        rulesResult = await query(
          `SELECT employee_id, default_on_machine_days, allowed_work_types, allowed_weekdays
           FROM schedule_default_rules WHERE year = $1 AND month = $2`,
          [prevYear, prevMonth]
        );
        if (rulesResult.rows.length > 0) {
          console.log(`[排班] ${year}-${month} 无默认规则，已回退使用 ${prevYear}-${prevMonth} 的规则`);
        }
      }

      // 目标月与上月都无规则时，明确报错（避免静默生成空排班表）
      if (rulesResult.rows.length === 0) {
        return res.status(400).json({
          error: '该月及上月均未配置默认排班规则，请先在"配置默认规则"中保存规则后再重新排班',
        });
      }

      const rulesMap = {};
      for (const r of rulesResult.rows) {
        rulesMap[r.employee_id] = {
          defaultDays: parseFloat(r.default_on_machine_days),
          workTypes: typeof r.allowed_work_types === 'string' ? JSON.parse(r.allowed_work_types) : r.allowed_work_types,
          weekdays: typeof r.allowed_weekdays === 'string' ? JSON.parse(r.allowed_weekdays) : r.allowed_weekdays,
        };
      }

      // 获取国定假日 - 只取目标年月的记录（避免其他月份假日污染本月休息日集合）
      let holidaysResult = await query(
        `SELECT date, name, is_holiday FROM schedule_holidays
         WHERE EXTRACT(YEAR FROM date) = $1 AND EXTRACT(MONTH FROM date) = $2`,
        [year, month]
      );

      // 如果目标月没有假日记录，从API拉取全年假日（自动入库），再按目标月过滤
      if (holidaysResult.rows.length === 0) {
        try {
          const apiHolidays = await fetchHolidaysFromAPI(year);
          // 批量插入（单次HTTP请求，避免子请求超限）
          if (apiHolidays.length > 0) {
            const values = [];
            const params = [];
            apiHolidays.forEach((h, i) => {
              const base = i * 3;
              values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
              params.push(h.date, h.name, h.isHoliday);
            });
            await query(
              `INSERT INTO schedule_holidays (date, name, is_holiday) VALUES ${values.join(', ')}
               ON CONFLICT (date) DO NOTHING`,
              params
            );
          }
          // 重新按目标月查询
          holidaysResult = await query(
            `SELECT date, name, is_holiday FROM schedule_holidays
             WHERE EXTRACT(YEAR FROM date) = $1 AND EXTRACT(MONTH FROM date) = $2`,
            [year, month]
          );
        } catch (apiErr) {
          console.error('获取节假日安排失败，将仅按周末排休:', apiErr.message);
          // API失败时不阻断排班，仅按周末排休
        }
      }

      const holidaySet = new Set();      // 法定假日（is_holiday=true，当天放假）
      const workdaySet = new Set();      // 调休上班日（is_holiday=false，周末需上班）
      for (const h of holidaysResult.rows) {
        const dt = new Date(h.date);
        const d = dt.getDate();
        // 只使用目标年月的假日（防止其他月份假日的"几号"污染本月休息日）
        if (dt.getFullYear() === year && (dt.getMonth() + 1) === month) {
          if (h.is_holiday) holidaySet.add(d);
          else workdaySet.add(d);
        }
      }

      // 读取上月排班记录，用于代值班跨月连续轮流
      const prevKey = year * 12 + (month - 2);
      const prevYear = Math.floor(prevKey / 12);
      const prevMonth = (prevKey % 12) + 1;
      let lastDutyEmployeeId = null;
      try {
        const prevRecords = await query(
          `SELECT employee_id, day, am_work_type, pm_work_type
           FROM schedule_records
           WHERE year = $1 AND month = $2
             AND (am_work_type LIKE '%代值班%' OR pm_work_type LIKE '%代值班%')
           ORDER BY day DESC LIMIT 1`,
          [prevYear, prevMonth]
        );
        if (prevRecords.rows.length > 0) {
          lastDutyEmployeeId = prevRecords.rows[0].employee_id;
          console.log(`[排班] 上月最后代班人: ${lastDutyEmployeeId}`);
        }
      } catch (e) {
        console.log(`[排班] 读取上月代班记录失败，从工号最小开始: ${e.message}`);
      }

      // 执行排班算法
      const schedule = runScheduleAlgorithm(year, month, employees.rows, rulesMap, holidaySet, workdaySet, lastDutyEmployeeId);

      // 删除旧记录
      await query('DELETE FROM schedule_records WHERE year = $1 AND month = $2', [year, month]);

      // 批量插入新记录（分批多行 VALUES，避免子请求超限）
      // 12人×31天 = 372条，每批200条多行INSERT，共2次子请求
      const BATCH_SIZE = 200;
      for (let i = 0; i < schedule.length; i += BATCH_SIZE) {
        const batch = schedule.slice(i, i + BATCH_SIZE);
        const values = [];
        const params = [];
        batch.forEach((rec, j) => {
          const base = j * 8;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
          params.push(year, month, rec.employee_id, rec.day, rec.shift, rec.meal_time, rec.am_work_type, rec.pm_work_type);
        });
        await query(
          `INSERT INTO schedule_records (year, month, employee_id, day, shift, meal_time, am_work_type, pm_work_type)
           VALUES ${values.join(', ')}`,
          params
        );
      }

      // 清理超出3个月的历史数据
      await cleanupOldRecords();

      return res.status(200).json({
        message: '重新排班成功',
        totalRecords: schedule.length,
        days: getDaysInMonth(year, month),
      });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('Schedule manage error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}

// ── 辅助函数 ──

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function getWeekdays(year, month, days) {
  const result = [];
  for (let d = 1; d <= days; d++) {
    const date = new Date(year, month - 1, d);
    let wd = date.getDay();
    if (wd === 0) wd = 7;
    result.push(wd);
  }
  return result;
}

/**
 * 计算某月实际工作日数量（规则11/12用）
 * 月实际工作日 = 当月天数 - 法定休 - 正常双休 + 调休补班日
 * 即：当天既非法定假日、也非（周末且非调休上班日）则计为工作日
 */
function computeActualWorkDays(days, weekdays, holidaySet, workdaySet = new Set()) {
  let count = 0;
  for (let d = 1; d <= days; d++) {
    const wd = weekdays[d - 1];
    // 法定假日：休息
    if (holidaySet.has(d)) continue;
    // 正常双休（周末且非调休上班日）：休息
    if (wd > 5 && !workdaySet.has(d)) continue;
    count++;
  }
  return count;
}

/**
 * 规则11：兼职用户接待岗的员工上机天数
 * 上机天数 = min(向下取整(月实际工作日 / 2), 默认上机天数)
 */
function computePartTimeTargetDays(actualWorkDays, defaultDays) {
  return Math.min(Math.floor(actualWorkDays / 2), defaultDays);
}

/**
 * 规则12：全职用户接待岗的员工上机天数
 * 上机天数 = min(月实际工作日, 默认上机天数) - 1
 */
function computeFullTimeTargetDays(actualWorkDays, defaultDays) {
  return Math.min(actualWorkDays, defaultDays) - 1;
}

function checkMonthAllowed(year, month) {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const curKey = curY * 12 + (curM - 1);
  const reqKey = year * 12 + (month - 1);
  const diff = reqKey - curKey;
  return { allowed: diff >= -1 && diff <= 1, diff };
}

/**
 * 判断某月是否为"次月"（相对当前月）
 */
function isNextMonth(year, month) {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const curKey = curY * 12 + (curM - 1);
  const reqKey = year * 12 + (month - 1);
  return reqKey === curKey + 1;
}

/**
 * 某月排班表在次月5日后不允许修改
 */
function checkCanEdit(year, month) {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const curKey = curY * 12 + (curM - 1);
  const reqKey = year * 12 + (month - 1);

  // 如果是上月的排班表，检查是否在次月5日后
  // 上月排班表：次月 = 本月，5日后不可修改
  if (reqKey < curKey) {
    // 上月排班：当本月>5日时不可修改
    if (now.getDate() > 5) return false;
  }

  return true;
}

/**
 * 清理超出3个月（上月/本月/次月）的历史数据
 */
async function cleanupOldRecords() {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  // 上上月 = curKey - 2，删除 < 上上月的记录
  const cutoffKey = (curY * 12 + (curM - 1)) - 2;
  const cutoffYear = Math.floor(cutoffKey / 12);
  const cutoffMonth = (cutoffKey % 12) + 1;

  await query(
    `DELETE FROM schedule_records WHERE (year * 12 + month - 1) < $1`,
    [cutoffKey]
  );
}

/**
 * 排班算法实现（13条规则）
 * holidaySet: 法定假日日期集合；workdaySet: 调休上班日集合（周末但需上班）
 */
function runScheduleAlgorithm(year, month, employees, rulesMap, holidaySet, workdaySet = new Set(), lastDutyEmployeeId = null) {
  const days = getDaysInMonth(year, month);
  const weekdays = getWeekdays(year, month, days);
  const schedule = [];

  // 计算月实际工作日（规则11/12用）
  const actualWorkDays = computeActualWorkDays(days, weekdays, holidaySet, workdaySet);

  // 每个员工的排班计划
  const empSchedule = {}; // employee_id -> { day: { shift, meal_time, am, pm } }

  for (const emp of employees) {
    empSchedule[emp.employee_id] = {};
    const rule = rulesMap[emp.employee_id];
    if (!rule) continue;

    // ── 规则5: 先把国定假日和双休日标为"休"（调休上班日除外） ──
    for (let d = 1; d <= days; d++) {
      const wd = weekdays[d - 1];
      // 周六周日为休，但如果该日是调休上班日（workdaySet）则照常上班
      if (holidaySet.has(d) || (wd > 5 && !workdaySet.has(d))) {
        empSchedule[emp.employee_id][d] = {
          shift: '休',
          meal_time: '休',
          am_work_type: 'AM休',
          pm_work_type: 'PM休',
        };
      }
    }

    // ── 分配上机天数 ──
    // 规则11：兼职用户接待岗 → min(向下取整(月实际工作日/2), 默认上机天数)
    // 规则12：全职用户接待岗 → min(月实际工作日, 默认上机天数) - 1
    let targetDays = rule.defaultDays;
    const empType = emp.employee_type || '';
    if (empType === '兼职用户接待岗') {
      targetDays = computePartTimeTargetDays(actualWorkDays, rule.defaultDays);
    } else if (empType === '全职用户接待岗') {
      targetDays = computeFullTimeTargetDays(actualWorkDays, rule.defaultDays);
    }
    // 防止极端情况出现负数上机天数
    targetDays = Math.max(0, targetDays);

    const workTypes = rule.workTypes || [];
    const allowedWeekdays = rule.weekdays || [1, 2, 3, 4, 5];

    // 可上机的日期（排除已标"休"的日期；调休上班日即使落在周末也计入）
    const availableDays = [];
    for (let d = 1; d <= days; d++) {
      if (empSchedule[emp.employee_id][d]) continue;
      const wd = weekdays[d - 1];
      if (allowedWeekdays.includes(wd) || workdaySet.has(d)) {
        availableDays.push(d);
      }
    }

    // ── 规则1: 尽量让上机天数平均分布在每一周 ──
    const weeks = getWeekRanges(days, weekdays);
    const daysPerWeek = distributeDaysAcrossWeeks(targetDays, weeks, availableDays);

    // ── 规则2: 每人勾选的上机工种在总上机天数中平均分布（按配额均衡±1天） ──
    const workTypeAssignment = distributeWorkTypes(targetDays, workTypes);

    // ── 规则10: 全职上机日班次规则 ──
    // 全职用户接待岗：上机日不排日班，改排早班（默认）或晚班（2天）
    // 兼职用户接待岗：上机日保持日班
    const isFullTime = empType === '全职用户接待岗';

    let typeIndex = 0;
    for (let w = 0; w < weeks.length; w++) {
      const daysInThisWeek = daysPerWeek[w] || 0;
      let assignedThisWeek = 0;
      for (let d = 1; d <= days; d++) {
        if (assignedThisWeek >= daysInThisWeek) break;
        if (empSchedule[emp.employee_id][d]) continue; // 已标休
        if (!availableDays.includes(d)) continue;

        // 分配上机
        const wt = workTypeAssignment[typeIndex % workTypeAssignment.length];
        typeIndex++;

        // 全职上机日：默认早班（晚班在第二阶段统一改派，取2个分散日期）
        const shift = isFullTime ? '早班' : '日班';
        const mealTime = isFullTime ? '11:00餐' : '11:30餐';

        // 映射工种
        const amType = `AM${wt}`;
        const pmType = `PM${wt}`;

        empSchedule[emp.employee_id][d] = {
          shift,
          meal_time: mealTime,
          am_work_type: amType,
          pm_work_type: pmType,
        };
        assignedThisWeek++;
      }
    }

    // ── 规则7: 每位员工不上机的日子全部安排专项工作 ──
    for (let d = 1; d <= days; d++) {
      if (!empSchedule[emp.employee_id][d]) {
        empSchedule[emp.employee_id][d] = {
          shift: '日班',
          meal_time: '11:30餐',
          am_work_type: 'AM专项工作',
          pm_work_type: 'PM专项工作',
        };
      }
    }
  }

// ── 规则4（第二阶段）: 为>15天上机员工各分配2个晚班 ──
  // 晚班不占用上勤天数（晚班当天仍计上机），从已分配的上机日中挑选
  // 约束1：同一员工2个晚班尽量间隔≥5天
  // 约束2：同一天晚班人数≤3（避免集中）
  // 约束3：晚班只安排在"休息日之前的工作日"（次日必为休息日，避免晚班次日早班/日班冲突）
  // 规则4的上机天数判定与规则11/12保持一致（基于员工全职/兼职身份计算的目标天数）
  const lateShiftEmployees = employees.filter(emp => {
    const rule = rulesMap[emp.employee_id];
    if (!rule) return false;
    let t = rule.defaultDays;
    const empType = emp.employee_type || '';
    if (empType === '兼职用户接待岗') t = computePartTimeTargetDays(actualWorkDays, rule.defaultDays);
    else if (empType === '全职用户接待岗') t = computeFullTimeTargetDays(actualWorkDays, rule.defaultDays);
    return Math.max(0, t) > 15;
  });

  // 休息日判定（与规则5一致）：法定假日，或非调休上班日的周末
  const isRestDayF = (d) => d >= 1 && d <= days && (holidaySet.has(d) || (weekdays[d - 1] > 5 && !workdaySet.has(d)));
  // 候选晚班日 = 当天是工作日（非休息）且次日是休息日（如周五→周六、节假日前一天）
  const lateCandidateDays = [];
  for (let d = 1; d <= days; d++) {
    if (isRestDayF(d)) continue; // 当天不能是休息日
    if (d === days) continue; // 月末最后一天，次日不在本月，跳过
    if (isRestDayF(d + 1)) lateCandidateDays.push(d);
  }

  if (lateShiftEmployees.length > 0) {
    // 预计算每日晚班人数（按员工顺序累计，保证同一天≤3人）
    const dailyLateCount = new Array(days + 1).fill(0);
    const lateEmpOrder = lateShiftEmployees.map(emp => emp.employee_id).sort();

    for (const empId of lateEmpOrder) {
      const empScheduleForEmp = empSchedule[empId];
      if (!empScheduleForEmp) continue;

      // 候选日期：该员工当天有班（非休非假），且非晚班，且当天晚班人数<3，且是休息日前一天
      const candidates = [];
      for (const d of lateCandidateDays) {
        const rec = empScheduleForEmp[d];
        if (!rec || rec.shift === '休' || rec.shift === '假' || rec.shift === '晚班') continue;
        if (dailyLateCount[d] >= 3) continue;
        candidates.push(d);
      }

      // 从候选池中选2个尽量分散的日期（贪心：取间隔最大的）
      const chosen = [];
      if (candidates.length > 0) {
        chosen.push(candidates[0]);
        if (candidates.length >= 2) {
          let best = candidates[1];
          let bestGap = -1;
          for (const c of candidates) {
            if (c === chosen[0]) continue;
            const gap = Math.abs(c - chosen[0]);
            if (gap > bestGap) { bestGap = gap; best = c; }
          }
          chosen.push(best);
        }
      }

      for (const d of chosen) {
        const rec = empScheduleForEmp[d];
        if (rec) {
          rec.shift = '晚班';
          rec.meal_time = '17:30餐';
          // 晚班当天AM/PM工种保留（晚班以晚班为主，工种保留原值）
          dailyLateCount[d]++;
        }
      }
    }
  }

  // ── 规则6: 代值班只在休息日，且只在可承接"代值班"工种的员工中按工号跨月连续轮流 ──
  // 代值班只会发生在国定假日和双休日，当天只需1人负责全班，其余人休
  // 跨月连续轮流：从上月最后代班人的下一个人开始；上月无记录则从工号最小开始
  const dutyCandidates = employees.filter(e => {
    const rule = rulesMap[e.employee_id];
    return rule && rule.workTypes && rule.workTypes.includes('代值班');
  }).sort((a, b) => a.employee_id.localeCompare(b.employee_id));

  // 确定轮流的起始索引
  let dutyStartIndex = 0;
  if (lastDutyEmployeeId && dutyCandidates.length > 0) {
    const lastIdx = dutyCandidates.findIndex(e => e.employee_id === lastDutyEmployeeId);
    if (lastIdx >= 0) {
      dutyStartIndex = (lastIdx + 1) % dutyCandidates.length;
    }
  }

  let dutyIndex = dutyStartIndex;
  for (let d = 1; d <= days; d++) {
    const wd = weekdays[d - 1];
    if ((wd > 5 && !workdaySet.has(d)) || holidaySet.has(d)) {
      // 休息日，安排代值班
      if (dutyCandidates.length > 0) {
        const emp = dutyCandidates[dutyIndex % dutyCandidates.length];
        dutyIndex++;
        if (emp && empSchedule[emp.employee_id][d] && empSchedule[emp.employee_id][d].shift === '休') {
          empSchedule[emp.employee_id][d] = {
            shift: '全班',
            meal_time: '11:30餐',
            am_work_type: 'AM代值班',
            pm_work_type: 'PM代值班',
          };
        }
      }
    }
  }

  // ── 规则9: 每天尽量覆盖所有上机工种 ──
  // 收集所有员工使用的上机工种类型
  // 注意：排除"代值班"——代值班只在休息日出现（规则6），
  // 不属于工作日需要覆盖的常规工种；若纳入会导致规则9把工作日员工
  // 改成代值班、又被规则6兜底改回专项，从而清空其上机天数。
  const allWorkTypes = new Set();
  for (const emp of employees) {
    const rule = rulesMap[emp.employee_id];
    if (rule && rule.workTypes) {
      rule.workTypes.forEach(wt => {
        if (wt !== '代值班') allWorkTypes.add(wt);
      });
    }
  }
  const allWorkTypeList = Array.from(allWorkTypes);

  if (allWorkTypeList.length > 1) {
    // 对每一天，统计当天各工种的覆盖情况，尝试填补缺失工种
    for (let d = 1; d <= days; d++) {
      // 统计当天各工种的在岗人数
      const dayCoverage = {}; // workType -> count
      allWorkTypeList.forEach(wt => { dayCoverage[wt] = 0; });

      const dayOnMachineEmps = []; // 当天上机的员工
      for (const emp of employees) {
        const rec = empSchedule[emp.employee_id]?.[d];
        if (rec && rec.shift !== '休' && rec.shift !== '假' &&
            rec.am_work_type && !rec.am_work_type.includes('专项') && !rec.am_work_type.includes('代值班') && !rec.am_work_type.includes('休')) {
          const wt = rec.am_work_type.replace('AM', '');
          if (dayCoverage[wt] !== undefined) dayCoverage[wt]++;
          dayOnMachineEmps.push({ emp, rec, workType: wt });
        }
      }

      // 找出缺失的工种（当天在岗人数为0的）
      const missingTypes = allWorkTypeList.filter(wt => dayCoverage[wt] === 0);

      // 尝试为每个缺失工种找一个当天上机的员工来承担
      for (const missingWt of missingTypes) {
        if (dayOnMachineEmps.length === 0) break;

        // 优先找：该员工的规则中包含缺失工种、且当天工种在当天有多余人手的
        let bestCandidate = null;
        for (const entry of dayOnMachineEmps) {
          const empRule = rulesMap[entry.emp.employee_id];
          if (empRule && empRule.workTypes && empRule.workTypes.includes(missingWt)) {
            // 检查该员工当天工种在当天是否有多人（>=2），避免拆走唯一的人手
            if (dayCoverage[entry.workType] >= 2) {
              bestCandidate = entry;
              break;
            }
            // 如果没有多余人手的候选，也记录下来作为备选
            if (!bestCandidate) bestCandidate = entry;
          }
        }

        if (bestCandidate) {
          // 将该员工当天的工种改为缺失工种
          const oldWt = bestCandidate.workType;
          dayCoverage[oldWt]--;
          dayCoverage[missingWt]++;
          bestCandidate.rec.am_work_type = `AM${missingWt}`;
          bestCandidate.rec.pm_work_type = `PM${missingWt}`;
          bestCandidate.workType = missingWt;
        }
      }
    }
  }

  // ── 规则6（强制兜底）: 代值班只出现在国定假日或双休日；其余工种不出现在休息日 ──
  // 规则6：代值班只出现在国定假日或双休日
  // 规则6：除代值班外，其余工种（语音/工单留邮/IM/质检/外呼/拨测/专项等）不出现在国定假日或双休日
  // 注：调休上班日（workdaySet，周末但需上班）视为工作日，不受本规则约束
  const isRestDayRule6 = (d) => d >= 1 && d <= days && (holidaySet.has(d) || (weekdays[d - 1] > 5 && !workdaySet.has(d)));
  const isDutyWork = (rec) => rec && ((rec.am_work_type || '').includes('代值班') || (rec.pm_work_type || '').includes('代值班'));

  for (const empId of Object.keys(empSchedule)) {
    const empData = empSchedule[empId];
    for (let d = 1; d <= days; d++) {
      const rec = empData[d];
      if (!rec) continue;

      if (isDutyWork(rec) && !isRestDayRule6(d)) {
        // 规则6：代值班出现在非休息日 → 纠正为"日班+专项工作"
        rec.shift = '日班';
        rec.meal_time = '11:30餐';
        rec.am_work_type = 'AM专项工作';
        rec.pm_work_type = 'PM专项工作';
      }

      if (isRestDayRule6(d) && !isDutyWork(rec) && rec.shift !== '休') {
        // 规则6：休息日且非代值班 → 强制改为"休"
        rec.shift = '休';
        rec.meal_time = '休';
        rec.am_work_type = 'AM休';
        rec.pm_work_type = 'PM休';
      }
    }
  }

  // ── 上机天数校正：确保每人实际上机天数精确等于目标天数 ──
  // 在所有规则执行完毕后，统计每人实际上机天数，与目标比较并校正
  const correctionOnMachineTypes = ['拨测体验', '语音', '工单留邮', '文字IM', 'IM文字', '外呼调研', '质检'];
  const isOnMachineRec = (rec) => {
    if (!rec) return false;
    const am = (rec.am_work_type || '').replace('AM', '').trim();
    const pm = (rec.pm_work_type || '').replace('PM', '').trim();
    return correctionOnMachineTypes.includes(am) || correctionOnMachineTypes.includes(pm);
  };

  for (const emp of employees) {
    const rule = rulesMap[emp.employee_id];
    if (!rule) continue;

    // 重新计算目标天数
    let targetDays = rule.defaultDays;
    const empType = emp.employee_type || '';
    if (empType === '兼职用户接待岗') targetDays = computePartTimeTargetDays(actualWorkDays, rule.defaultDays);
    else if (empType === '全职用户接待岗') targetDays = computeFullTimeTargetDays(actualWorkDays, rule.defaultDays);
    targetDays = Math.max(0, targetDays);

    const empData = empSchedule[emp.employee_id];

    // 统计实际上机天数和可补偿的专项工作日
    let actualOnMachine = 0;
    const onMachineDaysList = [];
    const specialWorkDaysForCompensation = [];
    for (let d = 1; d <= days; d++) {
      const rec = empData[d];
      if (!rec) continue;
      const isRest = holidaySet.has(d) || (weekdays[d - 1] > 5 && !workdaySet.has(d));
      if (isRest) continue;
      if (isOnMachineRec(rec)) {
        actualOnMachine++;
        onMachineDaysList.push(d);
      } else if (rec.shift === '日班' && (rec.am_work_type || '').includes('专项')) {
        // 排除晚班次日（不应补偿到晚班次日）
        const prev = d > 1 ? empData[d - 1] : null;
        const isAfterLate = prev && prev.shift === '晚班';
        if (!isAfterLate) specialWorkDaysForCompensation.push(d);
      }
    }

    // 情况1：实际 > 目标 → 将多余的上机日改回专项工作
    if (actualOnMachine > targetDays) {
      const excess = actualOnMachine - targetDays;
      let removed = 0;
      // 优先还原被规则8改为工单留邮的天
      for (const d of onMachineDaysList) {
        if (removed >= excess) break;
        const rec = empData[d];
        if ((rec.am_work_type || '') === 'AM工单留邮') {
          revertToSpecialWork(rec, empType);
          removed++;
        }
      }
      // 若工单留邮不够还原，还原最后几天的上机日
      if (removed < excess) {
        for (let i = onMachineDaysList.length - 1; i >= 0 && removed < excess; i--) {
          const d = onMachineDaysList[i];
          const rec = empData[d];
          if ((rec.am_work_type || '') === 'AM工单留邮') continue;
          revertToSpecialWork(rec, empType);
          removed++;
        }
      }
    }

    // 情况2：实际 < 目标 → 将专项工作日改为上机
    // 严格约束：只使用该员工勾选的上机工种（不含代值班），按配额均衡轮换
    if (actualOnMachine < targetDays) {
      const deficit = targetDays - actualOnMachine;
      const workTypes = rule.workTypes.filter(wt => wt !== '代值班');
      if (workTypes.length === 0) workTypes.push('语音');
      let added = 0;
      for (const d of specialWorkDaysForCompensation) {
        if (added >= deficit) break;
        const rec = empData[d];
        const wt = workTypes[added % workTypes.length];
        rec.am_work_type = `AM${wt}`;
        rec.pm_work_type = `PM${wt}`;
        // 全职：补上机日班次为早班；兼职：日班
        if (empType === '全职用户接待岗') {
          rec.shift = '早班';
          rec.meal_time = '11:00餐';
        } else {
          rec.shift = '日班';
          rec.meal_time = '11:30餐';
        }
        added++;
      }
    }
  }

  // ── 规则8（最终执行）: 每次休息日后第一个工作日至少安排2人承担"工单留邮" ──
  // 放在所有校正/均衡之后执行，保证不被后续环节改动
  // 严格约束：只从勾选"工单留邮"工种的员工中选派（绝不分配未勾选工种）
  // 优先选当天已上机的员工改派工单留邮（不增加上机天数）；
  // 若当天已上机员工不足2人，才从专项工作员工中改派，并相应减少其1个上机日（保持目标天数不变）
  const rule8OnMachineTypes = ['拨测体验', '语音', '工单留邮', '文字IM', 'IM文字', '外呼调研', '质检'];
  const isRestDay = (d) => d >= 1 && d <= days && (holidaySet.has(d) || (weekdays[d - 1] > 5 && !workdaySet.has(d)));
  // 预计算每个勾选"工单留邮"的员工集合
  const ticketEligibleEmployees = employees.filter(emp => {
    const rule = rulesMap[emp.employee_id];
    return rule && rule.workTypes && rule.workTypes.includes('工单留邮');
  });

  // 记录哪些天被规则8设为工单留邮（用于后续补偿统计）
  const rule8TicketDays = {}; // employee_id -> Set(day)
  const rule8SpecialConverted = {}; // employee_id -> count（从专项日改派次数，需补偿减少上机）
  const rule8TicketCount = {}; // employee_id -> 累计被规则8安排的工单留邮次数
  for (const emp of ticketEligibleEmployees) {
    rule8TicketDays[emp.employee_id] = new Set();
    rule8SpecialConverted[emp.employee_id] = 0;
    rule8TicketCount[emp.employee_id] = 0;
  }

  for (let d = 1; d <= days; d++) {
    // 检查是否是休息日后的第一个工作日（调休上班日视为工作日）
    if (d > 1 && isRestDay(d - 1) && !isRestDay(d)) {
      let ticketCount = 0;
      // 第一轮：优先选当天已上机的员工（且必须勾选工单留邮），
      // 并按"累计工单数最少优先"排序，实现工单留邮在员工间分散
      const onMachineEligible = ticketEligibleEmployees
        .filter(emp => {
          const dayRecord = empSchedule[emp.employee_id]?.[d];
          if (!dayRecord || dayRecord.shift === '休' || dayRecord.shift === '假') return false;
          const amType = (dayRecord.am_work_type || '').replace('AM', '').trim();
          return rule8OnMachineTypes.includes(amType);
        })
        .sort((a, b) => rule8TicketCount[a.employee_id] - rule8TicketCount[b.employee_id]);
      for (const emp of onMachineEligible) {
        if (ticketCount >= 2) break;
        const dayRecord = empSchedule[emp.employee_id][d];
        dayRecord.am_work_type = 'AM工单留邮';
        dayRecord.pm_work_type = 'PM工单留邮';
        rule8TicketDays[emp.employee_id].add(d);
        rule8TicketCount[emp.employee_id]++;
        ticketCount++;
      }
      // 第二轮：当天上机员工不足2人时，才选专项工作员工（同样必须勾选工单留邮，按累计工单数排序）
      const specialEligible = ticketEligibleEmployees
        .filter(emp => {
          const dayRecord = empSchedule[emp.employee_id]?.[d];
          if (!dayRecord || dayRecord.shift === '休' || dayRecord.shift === '假') return false;
          const amType = (dayRecord.am_work_type || '').replace('AM', '').trim();
          return !rule8OnMachineTypes.includes(amType) && amType !== '休';
        })
        .sort((a, b) => rule8TicketCount[a.employee_id] - rule8TicketCount[b.employee_id]);
      for (const emp of specialEligible) {
        if (ticketCount >= 2) break;
        const dayRecord = empSchedule[emp.employee_id][d];
        dayRecord.am_work_type = 'AM工单留邮';
        dayRecord.pm_work_type = 'PM工单留邮';
        rule8TicketDays[emp.employee_id].add(d);
        rule8SpecialConverted[emp.employee_id]++;
        rule8TicketCount[emp.employee_id]++;
        ticketCount++;
      }
    }
  }

  // ── 规则8补偿：对"专项改工单留邮"的员工，从其他上机日移走相同数量的上机，保持总上机天数不变 ──
  // 仅在全职/兼职目标天数已精确的前提下，专项日被改为工单留邮会使上机+1，
  // 因此必须从该员工的其他上机日中改回相同数量的专项日，确保总上机天数不变。
  for (const emp of ticketEligibleEmployees) {
    const rule = rulesMap[emp.employee_id];
    if (!rule) continue;
    const empType = emp.employee_type || '';
    const empData = empSchedule[emp.employee_id];
    const convertCount = rule8SpecialConverted[emp.employee_id];
    if (!empData || convertCount === 0) continue;

    // 收集该员工可补偿的上机日（非规则8日、非晚班、非晚班次日）
    const removableDays = [];
    for (let d = 1; d <= days; d++) {
      if (rule8TicketDays[emp.employee_id].has(d)) continue;
      const rec = empData[d];
      if (!rec) continue;
      const isRest = holidaySet.has(d) || (weekdays[d - 1] > 5 && !workdaySet.has(d));
      if (isRest) continue;
      const am = (rec.am_work_type || '').replace('AM', '').trim();
      if (!rule8OnMachineTypes.includes(am)) continue; // 不是上机日
      if (rec.shift === '晚班') continue; // 不移动晚班日
      const prev = d > 1 ? empData[d - 1] : null;
      if (prev && prev.shift === '晚班') continue; // 不移动晚班次日
      removableDays.push(d);
    }

    // 从后往前移走上机日，改回专项（不晚班衔接的优先）
    let removed = 0;
    for (let i = removableDays.length - 1; i >= 0 && removed < convertCount; i--) {
      const d = removableDays[i];
      const rec = empData[d];
      // 优先移动"日班"（非早/晚班），避免影响全职早班节奏；全职专项日为日班
      if (rec.shift === '晚班') continue;
      revertToSpecialWork(rec, empType);
      removed++;
    }
  }

  // ── 上机工种配额均衡校正（规则2强化，在规则8之后执行） ──
  // 对每个员工统计各勾选工种的实际上机天数，与理论配额（T/N，允许±1天）比较，
  // 若偏差超限则通过交换实现均衡。严格约束：
  //   1) 交换只在该员工勾选工种之间进行；
  //   2) 跳过规则8设置的"工单留邮"日（保证休息日后首日≥2人工单留邮不被破坏）；
  //   3) 跳过晚班日与晚班次日（避免破坏晚班衔接）。
  for (const emp of employees) {
    const rule = rulesMap[emp.employee_id];
    if (!rule) continue;
    const empType = emp.employee_type || '';
    const workTypes = rule.workTypes.filter(wt => wt !== '代值班');
    if (workTypes.length <= 1) continue;

    const empData = empSchedule[emp.employee_id];

    // 统计各工种天数与所属日期
    const typeCount = {};
    const typeDays = {};
    for (const wt of workTypes) { typeCount[wt] = 0; typeDays[wt] = []; }
    let totalOnMachine = 0;
    for (let d = 1; d <= days; d++) {
      const rec = empData[d];
      if (!rec) continue;
      const isRest = holidaySet.has(d) || (weekdays[d - 1] > 5 && !workdaySet.has(d));
      if (isRest) continue;
      const am = (rec.am_work_type || '').replace('AM', '').trim();
      if (typeCount[am] !== undefined && am !== '专项工作') {
        typeCount[am]++;
        typeDays[am].push(d);
        totalOnMachine++;
      }
    }

    // 理论配额
    const base = Math.floor(totalOnMachine / workTypes.length);
    const rem = totalOnMachine % workTypes.length;
    const quota = {};
    workTypes.forEach((wt, i) => { quota[wt] = base + (i < rem ? 1 : 0); });

    // 找出超出配额（>基准+1）的工种（可让出）和不足配额（<基准-1）的工种（需要补充）
    // 判定采用"基准±1"：base = floor(T/N)，允许各工种在 [base-1, base+1] 内浮动
    let overTypes = workTypes.filter(wt => typeCount[wt] > base + 1);
    let underTypes = workTypes.filter(wt => typeCount[wt] < base - 1);
    // 单日交换迭代均衡（最多30轮，避免死循环）
    // 交换目标：从 overTypes 中取一个，把其1天改为 underTypes 或"尚在基准内但低于基准"的工种
    for (let round = 0; round < 30 && overTypes.length > 0; round++) {
      const fromWt = overTypes[0];
      // 目标工种：优先不足（<基准-1），其次低于基准（<基准）
      let toWt = underTypes[0] || workTypes.find(wt => typeCount[wt] < base);
      if (!toWt) break;
      // 找一个 fromWt 的天：非规则8工单日、非晚班、非晚班次日
      let swapDay = null;
      for (const d of typeDays[fromWt]) {
        const rec = empData[d];
        if (rule8TicketDays[emp.employee_id] && rule8TicketDays[emp.employee_id].has(d)) continue; // 规则8保护
        if (rec && rec.shift === '晚班') continue; // 保留晚班日期
        const prev = d > 1 ? empData[d - 1] : null;
        if (prev && prev.shift === '晚班') continue; // 不破坏晚班衔接
        swapDay = d;
        break;
      }
      if (swapDay === null) break;
      const rec = empData[swapDay];
      rec.am_work_type = `AM${toWt}`;
      rec.pm_work_type = `PM${toWt}`;
      typeCount[fromWt]--;
      typeCount[toWt]++;
      typeDays[fromWt] = typeDays[fromWt].filter(x => x !== swapDay);
      typeDays[toWt].push(swapDay);
      // 重新计算超/不足
      overTypes = workTypes.filter(wt => typeCount[wt] > base + 1);
      underTypes = workTypes.filter(wt => typeCount[wt] < base - 1);
    }
  }

  // 转换为输出格式
  for (const emp of employees) {
    const empData = empSchedule[emp.employee_id] || {};
    for (let d = 1; d <= days; d++) {
      const rec = empData[d];
      if (rec) {
        schedule.push({
          employee_id: emp.employee_id,
          day: d,
          shift: rec.shift,
          meal_time: rec.meal_time,
          am_work_type: rec.am_work_type,
          pm_work_type: rec.pm_work_type,
        });
      }
    }
  }

  return schedule;
}

/**
 * 获取每周的日期范围
 */
function getWeekRanges(days, weekdays) {
  const weeks = [];
  let currentWeek = [];
  for (let d = 1; d <= days; d++) {
    currentWeek.push(d);
    if (weekdays[d - 1] === 7 || d === days) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  return weeks;
}

/**
 * 将上机日改回专项工作，并按员工类型设置班次
 * 全职：专项工作日为"日班"；兼职：日班
 */
function revertToSpecialWork(rec, empType) {
  rec.am_work_type = 'AM专项工作';
  rec.pm_work_type = 'PM专项工作';
  rec.shift = '日班';
  rec.meal_time = '11:30餐';
}

/**
 * 将上机天数平均分配到每周
 */
function distributeDaysAcrossWeeks(totalDays, weeks, availableDays) {
  const numWeeks = weeks.length;
  const result = new Array(numWeeks).fill(0);
  const base = Math.floor(totalDays / numWeeks);
  const remainder = totalDays % numWeeks;

  for (let i = 0; i < numWeeks; i++) {
    result[i] = base + (i < remainder ? 1 : 0);
  }

  // 确保每周分配的天数不超过该周可用天数
  for (let i = 0; i < numWeeks; i++) {
    const weekDays = weeks[i].filter(d => availableDays.includes(d));
    if (result[i] > weekDays.length) {
      let overflow = result[i] - weekDays.length;
      result[i] = weekDays.length;
      // 将溢出的天数分配到其他周（遍历所有周，直到溢出全部吸收）
      for (let j = 0; j < numWeeks && overflow > 0; j++) {
        if (j !== i) {
          const jDays = weeks[j].filter(d => availableDays.includes(d));
          if (result[j] < jDays.length) {
            const space = jDays.length - result[j];
            const moved = Math.min(overflow, space);
            result[j] += moved;
            overflow -= moved;
          }
        }
      }
    }
  }

  return result;
}

/**
 * 将工种平均分配到上机天数（规则5：贪心+回溯，尽量避免同一工种连续3天）
 * 策略：先按比例生成各工种的基础数量，然后逐位贪心填充——
 *   每次放入前检查前2天是否已是同一工种，若是则尝试换其他工种；
 *   若所有工种都已用尽余量或都无法放入，则保留当前选择（最小化连续天数）。
 *   最后通过回溯检查修正仍存在的连续3天（尽量将第3天换为其他有余量的工种）。
 */
function distributeWorkTypes(totalDays, workTypes) {
  if (!workTypes.length) return ['语音'];
  if (workTypes.length === 1) return new Array(totalDays).fill(workTypes[0]);

  // 计算每种工种的目标数量
  const base = Math.floor(totalDays / workTypes.length);
  const remainder = totalDays % workTypes.length;
  const quota = {};      // 工种 -> 剩余配额
  const initialQuota = {};
  workTypes.forEach((wt, i) => {
    quota[wt] = base + (i < remainder ? 1 : 0);
    initialQuota[wt] = quota[wt];
  });

  const result = new Array(totalDays);

  // 第一轮：贪心填充
  for (let i = 0; i < totalDays; i++) {
    // 检查前2天是否同工种
    const prev1 = i >= 1 ? result[i - 1] : null;
    const prev2 = i >= 2 ? result[i - 2] : null;
    const twoInRow = prev1 && prev2 && prev1 === prev2;

    // 候选工种：优先有余量的，且（如果前2天相同）排除该工种
    let candidates = workTypes.filter(wt => quota[wt] > 0);
    if (twoInRow) {
      const avoid = prev1;
      const preferred = candidates.filter(wt => wt !== avoid);
      if (preferred.length > 0) candidates = preferred;
    }

    // 在候选中选剩余配额最多的（均衡分布）
    candidates.sort((a, b) => quota[b] - quota[a]);
    result[i] = candidates.length > 0 ? candidates[0] : prev1;
    if (candidates.length > 0) quota[candidates[0]]--;
  }

  // 第二轮：回溯修正连续3天
  for (let i = 2; i < totalDays; i++) {
    if (result[i] === result[i - 1] && result[i] === result[i - 2]) {
      // 连续3天同工种，尝试把第3天换成其他工种
      const current = result[i];
      // 找一个其他工种来替换——优先从后续位置中找一个不同工种的来交换
      let swapped = false;
      for (let j = i + 1; j < totalDays; j++) {
        if (result[j] !== current && result[j] !== result[i - 1]) {
          // 交换 i 和 j
          // 但要确保交换后 j 位置不会产生新的连续3天
          const jPrev1 = j >= 1 ? result[j - 1] : null;
          const jNext1 = j < totalDays - 1 ? result[j + 1] : null;
          if (jPrev1 !== result[i] && jNext1 !== result[i] &&
              result[i - 1] !== result[i] /* 已确认不同 */) {
            [result[i], result[j]] = [result[j], result[i]];
            swapped = true;
            break;
          }
        }
      }
      // 如果无法交换，保留（已最小化连续）
    }
  }

  return result;
}

/**
 * 从公共API获取当年国定假日
 * 使用 timor.tech API: https://timor.tech/api/holiday/year/{year}
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

/**
 * 排班调整后发送邮件给受影响员工
 * 根据邮件提醒规则中 rule_type='adjustment_email' 且 is_enabled=TRUE 的规则发送
 * 每位受影响员工收到包含完整排班表+汇总统计+月度目标的邮件
 */
async function sendAdjustmentEmails(year, month, changedEmployeeIds) {
  if (changedEmployeeIds.length === 0) return 0;

  // 检查调整排班邮件规则是否启用
  const emailRules = await query(
    `SELECT title_template FROM schedule_email_rules
     WHERE rule_type = 'adjustment_email' AND is_enabled = TRUE
     ORDER BY seq ASC LIMIT 1`
  );

  if (emailRules.rows.length === 0) {
    console.log('[排班邮件] 调整排班邮件规则未启用，跳过发送');
    return 0;
  }

  const titleTemplate = emailRules.rows[0].title_template || '{year}年{month}月排班调整通知';

  // 获取受影响员工信息
  const empResult = await query(
    `SELECT name, employee_id, email FROM schedule_employees
     WHERE employee_id = ANY($1) AND email IS NOT NULL AND email != ''`,
    [changedEmployeeIds]
  );

  // 一次性获取所有受影响员工的排班记录（避免逐员工查询导致子请求超限）
  const allRecsResult = await query(
    `SELECT day, shift, meal_time, am_work_type, pm_work_type, employee_id
     FROM schedule_records
     WHERE year = $1 AND month = $2 AND employee_id = ANY($3)
     ORDER BY employee_id ASC, day ASC`,
    [year, month, changedEmployeeIds]
  );

  // 按 employee_id 分组
  const recsByEmp = {};
  for (const r of allRecsResult.rows) {
    if (!recsByEmp[r.employee_id]) recsByEmp[r.employee_id] = {};
    recsByEmp[r.employee_id][r.day] = {
      shift: r.shift,
      meal_time: r.meal_time,
      am_work_type: r.am_work_type,
      pm_work_type: r.pm_work_type,
    };
  }

  let sentCount = 0;
  const days = getDaysInMonth(year, month);
  const weekdays = getWeekdays(year, month, days);

  for (const emp of empResult.rows) {
    try {
      const recordsMap = recsByEmp[emp.employee_id] || {};

      const stats = computePersonalStatsForEmail(recordsMap, days);
      const goals = computePersonalGoalsForEmail(stats, year, month);

      const html = generateScheduleEmailHTML(
        'all',
        emp.name, emp.employee_id,
        year, month, days, weekdays,
        recordsMap, stats, goals
      );

      const subject = titleTemplate
        .replace('{year}', year)
        .replace('{month}', month)
        .replace('{name}', emp.name);

      const mailResult = await sendMail(emp.email, subject, html);
      if (mailResult === false) {
        throw new Error(sendMail.lastError || '未知错误');
      }
      sentCount++;
    } catch (err) {
      console.error(`[排班邮件] 发送给 ${emp.name}(${emp.employee_id}) 失败:`, err.message);
    }
  }

  console.log(`[排班邮件] 调整排班邮件已发送 ${sentCount}/${empResult.rows.length} 封`);
  return sentCount;
}

/**
 * 计算个人排班汇总统计（用于邮件发送）
 */
function computePersonalStatsForEmail(records, days) {
  let onMachineDays = 0, leaveDays = 0;
  let voiceDays = 0, ticketDays = 0, imDays = 0, qaDays = 0;
  let outboundDays = 0, specialTaskDays = 0, testDays = 0, dutyDays = 0;
  let dayShiftDays = 0, earlyShiftDays = 0, lateShiftDays = 0;

  for (let d = 1; d <= days; d++) {
    const rec = records[d];
    if (!rec) continue;

    if (rec.shift === '日班') dayShiftDays++;
    else if (rec.shift === '早班') earlyShiftDays++;
    else if (rec.shift === '晚班') lateShiftDays++;

    const amType = (rec.am_work_type || '').replace('AM', '').trim();
    const pmType = (rec.pm_work_type || '').replace('PM', '').trim();

    const onMachineTypes = ['拨测体验', '语音', '工单留邮', '文字IM', 'IM文字', '外呼调研', '质检'];
    if (onMachineTypes.includes(amType) || onMachineTypes.includes(pmType)) onMachineDays++;
    if (rec.shift === '假') leaveDays++;

    for (const t of [amType, pmType]) {
      if (t === '语音') voiceDays += 0.5;
      if (t === '工单留邮') ticketDays += 0.5;
      if (t === '文字IM' || t === 'IM文字') imDays += 0.5;
      if (t === '质检') qaDays += 0.5;
      if (t === '外呼调研') outboundDays += 0.5;
      if (t === '专项工作') specialTaskDays += 0.5;
      if (t === '拨测体验') testDays += 0.5;
      if (t === '代值班') dutyDays += 0.5;
    }
  }

  return {
    onMachineDays, leaveDays,
    voiceDays, ticketDays, imDays, qaDays,
    outboundDays, specialTaskDays, testDays, dutyDays,
    dayShiftDays, earlyShiftDays, lateShiftDays,
  };
}

/**
 * 天维度13项汇总统计（每天各指标在岗人数）
 * 统计维度与个人汇总保持一致，返回 day -> { onMachineDays, leaveDays, voiceDays, ..., dayShiftDays, earlyShiftDays, lateShiftDays }
 * 其中 leaveDays 为当天请假人数，其余为当天各指标人数
 */
function computeDayStats(recordsMap, employees, days) {
  const dayStats = {};
  for (let d = 1; d <= days; d++) {
    const stat = {
      onMachineDays: 0, leaveDays: 0,
      voiceDays: 0, ticketDays: 0, imDays: 0, qaDays: 0,
      outboundDays: 0, specialTaskDays: 0, testDays: 0, dutyDays: 0,
      dayShiftDays: 0, earlyShiftDays: 0, lateShiftDays: 0,
    };
    for (const emp of employees) {
      const rec = recordsMap[emp.employee_id]?.[d];
      if (!rec) continue;

      if (rec.shift === '日班') stat.dayShiftDays++;
      else if (rec.shift === '早班') stat.earlyShiftDays++;
      else if (rec.shift === '晚班') stat.lateShiftDays++;

      const amType = (rec.am_work_type || '').replace('AM', '').trim();
      const pmType = (rec.pm_work_type || '').replace('PM', '').trim();

      const onMachineTypes = ['拨测体验', '语音', '工单留邮', '文字IM', 'IM文字', '外呼调研', '质检'];
      const amOnMachine = onMachineTypes.includes(amType);
      const pmOnMachine = onMachineTypes.includes(pmType);
      // 实际上机：上下午都为上机工种才算1人，只有一个算0.5人
      if (amOnMachine && pmOnMachine) stat.onMachineDays += 1;
      else if (amOnMachine || pmOnMachine) stat.onMachineDays += 0.5;
      // 请假：看AM/PM工种，AM假算0.5，PM假算0.5
      if (amType === '假') stat.leaveDays += 0.5;
      if (pmType === '假') stat.leaveDays += 0.5;

      for (const t of [amType, pmType]) {
        if (t === '语音') stat.voiceDays += 0.5;
        if (t === '工单留邮') stat.ticketDays += 0.5;
        if (t === '文字IM' || t === 'IM文字') stat.imDays += 0.5;
        if (t === '质检') stat.qaDays += 0.5;
        if (t === '外呼调研') stat.outboundDays += 0.5;
        if (t === '专项工作') stat.specialTaskDays += 0.5;
        if (t === '拨测体验') stat.testDays += 0.5;
        if (t === '代值班') stat.dutyDays += 0.5;
      }
    }
    dayStats[d] = stat;
  }
  return dayStats;
}

/**
 * 计算个人月度目标（用于邮件发送）
 */
function computePersonalGoalsForEmail(stats, year, month) {
  const workload90 = (stats.voiceDays + stats.imDays + stats.ticketDays + stats.outboundDays + stats.qaDays) * 90;
  const workload72 = stats.testDays * 72;
  const workload = workload90 + workload72;

  // 每工种目标（上半块：X月工作量目标与完成情况）
  const perTypeTargets = [
    ['voice', '语音', Math.round(stats.voiceDays * 90)],
    ['ticket', '工单留邮', Math.round(stats.ticketDays * 90)],
    ['im', 'IM文字', Math.round(stats.imDays * 90)],
    ['outbound', '外呼调研', Math.round(stats.outboundDays * 90)],
    ['test', '拨测体验', Math.round(stats.testDays * 72)],
    ['qa', '质检', Math.round(stats.qaDays * 90)],
  ];
  const perType = perTypeTargets.map(([key, label, target]) => ({
    key, label,
    target: `${target}件`,
    completed: 'XX件', // TODO: 今后接入外部平台API，替换为实际完成量
  }));

  const completed = { // TODO: 今后接入外部平台API，替换为实际完成值
    workload: 'XX件',
    voiceMachineTime: 'XX小时',
    imMachineTime: 'XX小时',
  };

  return {
    workload: `${Math.round(workload)}件`,
    voiceMachineTime: `${stats.voiceDays * 7.5}小时`,
    imMachineTime: `${stats.imDays * 7.5}小时`,
    endDayLabel: getGoalEndDayLabel(year, month),
    perType,
    completed,
  };
}
