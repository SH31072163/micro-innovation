import { query, queryBatch } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { sendMail } from '../../../lib/mailer';
import { generateScheduleEmailHTML } from '../../../lib/scheduleEmailTemplate';

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
 *   重新排班：根据默认规则+10条手写规则自动生成排班
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
    // ── GET: 获取排班表 ──
    if (req.method === 'GET') {
      const { year: yearStr, month: monthStr } = req.query;
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);

      if (!year || !month) return res.status(400).json({ error: '缺少年份或月份' });

      // 限制：仅上月/本月/次月
      const { allowed, diff } = checkMonthAllowed(year, month);
      if (!allowed) return res.status(403).json({ error: '仅可管理上月、本月和次月的排班表' });

      const employees = await query(
        'SELECT name, employee_id FROM schedule_employees WHERE is_active = TRUE ORDER BY employee_id ASC'
      );

      const records = await query(
        `SELECT employee_id, day, shift, meal_time, am_work_type, pm_work_type
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
        };
      }

      // 检查是否已过截止日期（次月20日后不可修改）
      const canEdit = checkCanEdit(year, month);

      return res.status(200).json({
        year, month, days, weekdays,
        employees: employees.rows,
        records: recordsMap,
        canEdit,
        isEmpty: records.rows.length === 0,
      });
    }

    // ── PUT: 保存排班表修改 ──
    if (req.method === 'PUT') {
      const { year, month, records } = req.body;
      if (!year || !month) return res.status(400).json({ error: '缺少年份或月份' });

      // 检查是否可编辑
      const canEdit = checkCanEdit(year, month);
      if (!canEdit) return res.status(403).json({ error: '该月排班表已过截止日期，不可修改' });

      // 获取旧记录用于比对
      const oldRecords = await query(
        'SELECT employee_id, day, shift, meal_time, am_work_type, pm_work_type FROM schedule_records WHERE year = $1 AND month = $2',
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
          old.pm_work_type !== rec.pm_work_type;
        if (hasChange) changedEmployees.add(rec.employee_id);
      }

      // 分批多行 VALUES UPSERT（避免子请求超限）
      const BATCH_SIZE = 100;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const values = [];
        const params = [];
        batch.forEach((rec, j) => {
          const base = j * 8;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, NOW())`);
          params.push(year, month, rec.employee_id, rec.day, rec.shift, rec.meal_time || '', rec.am_work_type || '', rec.pm_work_type || '');
        });
        await query(
          `INSERT INTO schedule_records (year, month, employee_id, day, shift, meal_time, am_work_type, pm_work_type, updated_at)
           VALUES ${values.join(', ')}
           ON CONFLICT (year, month, employee_id, day)
           DO UPDATE SET shift = EXCLUDED.shift, meal_time = EXCLUDED.meal_time,
                         am_work_type = EXCLUDED.am_work_type, pm_work_type = EXCLUDED.pm_work_type,
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

      const canEdit = checkCanEdit(year, month);
      if (!canEdit) return res.status(403).json({ error: '该月排班表已过截止日期，不可重新排班' });

      // 获取员工列表
      const employees = await query(
        'SELECT name, employee_id FROM schedule_employees WHERE is_active = TRUE ORDER BY employee_id ASC'
      );

      // 获取默认规则
      const rulesResult = await query(
        `SELECT employee_id, default_on_machine_days, allowed_work_types, allowed_weekdays
         FROM schedule_default_rules WHERE year = $1 AND month = $2`,
        [year, month]
      );

      const rulesMap = {};
      for (const r of rulesResult.rows) {
        rulesMap[r.employee_id] = {
          defaultDays: parseFloat(r.default_on_machine_days),
          workTypes: typeof r.allowed_work_types === 'string' ? JSON.parse(r.allowed_work_types) : r.allowed_work_types,
          weekdays: typeof r.allowed_weekdays === 'string' ? JSON.parse(r.allowed_weekdays) : r.allowed_weekdays,
        };
      }

      // 获取国定假日 - 先查数据库，如该年无数据则从API获取
      let holidaysResult = await query(
        `SELECT date, name, is_holiday FROM schedule_holidays
         WHERE EXTRACT(YEAR FROM date) = $1`,
        [year]
      );

      if (holidaysResult.rows.length === 0) {
        // 从API获取当年假日
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
          // 重新查询
          holidaysResult = await query(
            `SELECT date, name, is_holiday FROM schedule_holidays
             WHERE EXTRACT(YEAR FROM date) = $1`,
            [year]
          );
        } catch (apiErr) {
          console.error('获取假日API失败，将仅按周末排休:', apiErr.message);
          // API失败时不阻断排班，仅按周末排休
        }
      }

      const holidaySet = new Set();
      for (const h of holidaysResult.rows) {
        const d = new Date(h.date).getDate();
        if (h.is_holiday) holidaySet.add(d);
      }

      // 执行排班算法
      const schedule = runScheduleAlgorithm(year, month, employees.rows, rulesMap, holidaySet);

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
 * 某月排班表在次月20日后不允许修改
 */
function checkCanEdit(year, month) {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const curKey = curY * 12 + (curM - 1);
  const reqKey = year * 12 + (month - 1);

  // 如果是上月的排班表，检查是否在次月20日后
  // 上月排班表：次月 = 本月，20日后不可修改
  if (reqKey < curKey) {
    // 上月排班：当本月>20日时不可修改
    if (now.getDate() > 20) return false;
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
 * 排班算法实现（10条规则）
 */
function runScheduleAlgorithm(year, month, employees, rulesMap, holidaySet) {
  const days = getDaysInMonth(year, month);
  const weekdays = getWeekdays(year, month, days);
  const schedule = [];

  // 每个员工的排班计划
  const empSchedule = {}; // employee_id -> { day: { shift, meal_time, am, pm } }

  for (const emp of employees) {
    empSchedule[emp.employee_id] = {};
    const rule = rulesMap[emp.employee_id];
    if (!rule) continue;

    // ── 规则7: 先把国定假日和双休日标为"休" ──
    for (let d = 1; d <= days; d++) {
      const wd = weekdays[d - 1];
      if (holidaySet.has(d) || wd > 5) {
        empSchedule[emp.employee_id][d] = {
          shift: '休',
          meal_time: '休',
          am_work_type: 'AM休',
          pm_work_type: 'PM休',
        };
      }
    }

    // ── 分配上机天数 ──
    const targetDays = rule.defaultDays;
    const workTypes = rule.workTypes || [];
    const allowedWeekdays = rule.weekdays || [1, 2, 3, 4, 5];

    // 可上机的日期（排除已标"休"的日期）
    const availableDays = [];
    for (let d = 1; d <= days; d++) {
      if (!empSchedule[emp.employee_id][d] && allowedWeekdays.includes(weekdays[d - 1])) {
        availableDays.push(d);
      }
    }

    // ── 规则1: 尽量让上机天数平均分布在每一周 ──
    const weeks = getWeekRanges(days, weekdays);
    const daysPerWeek = distributeDaysAcrossWeeks(targetDays, weeks, availableDays);

    // ── 规则2: 每人勾选的上机工种在总上机天数中平均分布 ──
    const workTypeAssignment = distributeWorkTypes(targetDays, workTypes);

    // ── 规则4: 默认上机天数>15天者每月安排2天晚班 ──
    const needsLateShift = targetDays > 15;
    let lateShiftCount = 0;

    let dayIndex = 0;
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

        let shift = '日班';
        let mealTime = '11:30餐';

        // ── 规则4: 安排晚班 ──
        if (needsLateShift && lateShiftCount < 2) {
          shift = '晚班';
          mealTime = '17:30餐';
          lateShiftCount++;
        }

        // ── 规则3: 当天晚班→次日不排早班或日班 ──
        // (在分配时检查前一天是否为晚班)
        if (d > 1) {
          const prevDay = empSchedule[emp.employee_id][d - 1];
          if (prevDay && prevDay.shift === '晚班' && (shift === '早班' || shift === '日班')) {
          // 跳过这天，改为休息日
            continue;
          }
        }

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
        dayIndex++;
      }
    }

    // ── 规则10: 每位员工不上机的日子全部安排专项任务 ──
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

  // ── 规则6: 代值班只在休息日，且只在默认上机天数<11天的员工中按工号轮排 ──
  const dutyCandidates = employees.filter(e => {
    const rule = rulesMap[e.employee_id];
    return rule && rule.defaultDays < 11;
  });

  let dutyIndex = 0;
  for (let d = 1; d <= days; d++) {
    const wd = weekdays[d - 1];
    if (wd > 5 || holidaySet.has(d)) {
      // 休息日，安排代值班
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

  // ── 规则8: 每次休息日后第一天至少安排2人承担"工单留邮" ──
  for (let d = 1; d <= days; d++) {
    // 检查是否是休息日后的第一个工作日
    if (d > 1) {
      const prevWd = weekdays[d - 2];
      const curWd = weekdays[d - 1];
      if (prevWd > 5 && curWd <= 5) {
        // 找2个当天上机的员工，安排工单留邮
        let ticketCount = 0;
        for (const emp of employees) {
          if (ticketCount >= 2) break;
          const dayRecord = empSchedule[emp.employee_id]?.[d];
          if (dayRecord && dayRecord.shift !== '休' && dayRecord.shift !== '假') {
            dayRecord.am_work_type = 'AM工单留邮';
            dayRecord.pm_work_type = 'PM工单留邮';
            ticketCount++;
          }
        }
      }
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
      const overflow = result[i] - weekDays.length;
      result[i] = weekDays.length;
      // 将溢出的天数分配到其他周
      for (let j = 0; j < numWeeks; j++) {
        if (j !== i) {
          const jDays = weeks[j].filter(d => availableDays.includes(d));
          if (result[j] < jDays.length) {
            const space = jDays.length - result[j];
            const moved = Math.min(overflow, space);
            result[j] += moved;
            break;
          }
        }
      }
    }
  }

  return result;
}

/**
 * 将工种平均分配到上机天数
 */
function distributeWorkTypes(totalDays, workTypes) {
  if (!workTypes.length) return ['语音'];
  const result = [];
  const base = Math.floor(totalDays / workTypes.length);
  const remainder = totalDays % workTypes.length;

  for (let i = 0; i < workTypes.length; i++) {
    const count = base + (i < remainder ? 1 : 0);
    for (let j = 0; j < count; j++) {
      result.push(workTypes[i]);
    }
  }

  // 打乱顺序，避免同工种连续
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
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
      const goals = computePersonalGoalsForEmail(stats);

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

      await sendMail(emp.email, subject, html);
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

    const onMachineTypes = ['拨测体验', '语音', '工单留邮', '文字IM', 'IM文字', '外呼调研', '代值班', '质检'];
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
 * 计算个人月度目标（用于邮件发送）
 */
function computePersonalGoalsForEmail(stats) {
  const workload90 = (stats.voiceDays + stats.imDays + stats.ticketDays + stats.outboundDays + stats.qaDays) * 90;
  const workload72 = stats.testDays * 72;
  const workload = workload90 + workload72;

  return {
    workload: `${Math.round(workload)}件`,
    voiceMachineTime: `${stats.voiceDays * 7.5}小时`,
    imMachineTime: `${stats.imDays * 7.5}小时`,
  };
}
