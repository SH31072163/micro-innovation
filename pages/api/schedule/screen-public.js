import { query } from '../../../lib/db';

/**
 * 排班表大屏 公开 API（免登录，供全屏大屏页面 /screen 调用）
 *
 * GET /api/schedule/screen-public?year=2026&month=9
 *   返回大屏所需全部数据（仅限本月/上月）：
 *   - employees: 全职/兼职分组（按工号排序，含累计处理服务量）
 *   - records: 所有员工排班记录
 *   - stats: 所有员工统计
 *   - goals: 所有员工月目标
 *   - screenData: 4区展示数据
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: '方法不允许' });

  try {
    const { year: yearStr, month: monthStr } = req.query;
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: '年份或月份参数无效' });
    }

    // 限制：仅允许查看上月、本月
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    const curMonthKey = curY * 12 + (curM - 1);
    const reqMonthKey = year * 12 + (month - 1);
    const diff = reqMonthKey - curMonthKey;

    if (diff < -1 || diff > 0) {
      return res.status(403).json({ error: '仅可查看上月和本月的排班信息' });
    }

    // ── 获取员工列表 ──
    // 逻辑：当月删除的员工当月仍显示，次月才生效
    // - is_active = TRUE：始终显示
    // - is_active = FALSE 且 deactivated_at IS NULL：历史数据未补记，保守处理不显示
    // - is_active = FALSE 且 deactivated_at 有值：若查询月 <= 停用月则仍显示，否则不显示
    //   例：9月删除(deactivated_at=2026-09)，查9月(<=9)显示，查10月(>9)不显示
    const employees = await query(
      `SELECT name, employee_id, employee_type, hire_date, is_active, deactivated_at
       FROM schedule_employees
       WHERE employee_type IN ('全职用户接待岗', '兼职用户接待岗')
          AND (is_active = TRUE
               OR (is_active = FALSE AND deactivated_at IS NOT NULL
                   AND (EXTRACT(YEAR FROM deactivated_at) > $1
                        OR (EXTRACT(YEAR FROM deactivated_at) = $1 AND EXTRACT(MONTH FROM deactivated_at) >= $2))))
       ORDER BY employee_id ASC`,
      [year, month]
    );

    // 分全职/兼职，按工号由小到大排序
    const fullTime = employees.rows.filter(e => (e.employee_type || '').includes('全职'));
    const partTime = employees.rows.filter(e => (e.employee_type || '').includes('兼职'));

    // ── 获取本月排班记录 ──
    const records = await query(
      `SELECT employee_id, day, shift, meal_time, am_work_type, pm_work_type
       FROM schedule_records
       WHERE year = $1 AND month = $2
       ORDER BY employee_id ASC, day ASC`,
      [year, month]
    );

    const days = getDaysInMonth(year, month);

    // records 按 employee_id 分组
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

    // ── 如果是当月或上月，可能需要跨月取上周排班（周TOP3跨月完整周） ──
    // 当前自然周的周一可能在上月，需要取上月排班
    const today = new Date();
    const todayDate = today.getDate();
    // 昨天
    const yesterday = new Date(today);
    yesterday.setDate(todayDate - 1);
    // 本周一
    const weekDay = today.getDay() || 7; // 0(周日)->7
    const monday = new Date(today);
    monday.setDate(todayDate - weekDay + 1);
    // 本周日
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    // 判断本周是否跨月
    let prevMonthRecords = {};
    if (monday.getMonth() + 1 !== month || monday.getFullYear() !== year) {
      // 周一在上月，需要取上月排班
      const prevDate = monday;
      const prevY = prevDate.getFullYear();
      const prevM = prevDate.getMonth() + 1;
      const prevRecs = await query(
        `SELECT employee_id, day, shift, meal_time, am_work_type, pm_work_type
         FROM schedule_records
         WHERE year = $1 AND month = $2
         ORDER BY employee_id ASC, day ASC`,
        [prevY, prevM]
      );
      for (const r of prevRecs.rows) {
        if (!prevMonthRecords[r.employee_id]) prevMonthRecords[r.employee_id] = {};
        prevMonthRecords[r.employee_id][r.day] = {
          shift: r.shift,
          meal_time: r.meal_time,
          am_work_type: r.am_work_type,
          pm_work_type: r.pm_work_type,
        };
      }
    }

    // ── 计算每人月度统计 ──
    const allStats = {};
    for (const emp of employees.rows) {
      const empRecords = recordsMap[emp.employee_id] || {};
      allStats[emp.employee_id] = computePersonalStats(empRecords, days);
    }

    // ── 计算每人月目标 ──
    const allGoals = {};
    for (const emp of employees.rows) {
      const st = allStats[emp.employee_id];
      allGoals[emp.employee_id] = computeGoals(st);
    }

    // ── 计算每人周统计和周目标 ──
    const weekStats = {};
    const weekGoals = {};
    for (const emp of employees.rows) {
      const ws = computeWeekStats(emp.employee_id, recordsMap, prevMonthRecords, monday, sunday, year, month);
      weekStats[emp.employee_id] = ws;
      weekGoals[emp.employee_id] = computeGoals(ws);
    }

    // ── 计算时序进度相关 ──
    // 已过去的实际上机天数（不含当天）：1日~昨天
    const todayDay = today.getDate();
    const isCurrentMonth = (curY === year && curM === month);
    const cutoffDay = isCurrentMonth ? todayDay - 1 : days; // 看上月则全部已过去

    // ── 计算每人累计处理服务量（2区标题）──
    for (const emp of employees.rows) {
      emp.cumulativeWorkload = computeCumulativeWorkload(emp, cutoffDay, days, year, month);
    }

    const screenData = computeScreenData(
      employees.rows, allStats, allGoals, weekStats, weekGoals,
      recordsMap, days, cutoffDay, isCurrentMonth
    );

    return res.status(200).json({
      year, month, days,
      employees: { fullTime, partTime },
      records: recordsMap,
      stats: allStats,
      goals: allGoals,
      weekStats,
      weekGoals,
      screenData,
      todayInfo: { todayDay, isCurrentMonth, cutoffDay },
    });
  } catch (err) {
    console.error('Screen API error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}

// ═══════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * 计算个人排班统计（与 view.js computePersonalStats 同口径）
 */
function computePersonalStats(records, days) {
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
    if (onMachineTypes.includes(amType) || onMachineTypes.includes(pmType)) onMachineDays += 0.5;
    if (amType === '假' || pmType === '假') leaveDays += 0.5;
    // 实际上机：上下午都上机才算1天
    const amOn = onMachineTypes.includes(amType);
    const pmOn = onMachineTypes.includes(pmType);
    if (amOn && pmOn) onMachineDays = onMachineDays - 0.5 + 1; // 修正：0.5+0.5 -> 1

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
 * 计算目标（月/周通用）
 * 工作量 = (语音+IM+工单+外呼+质检)*90 + 拨测*72
 */
function computeGoals(stats) {
  const workload90 = (stats.voiceDays + stats.imDays + stats.ticketDays + stats.outboundDays + stats.qaDays) * 90;
  const workload72 = stats.testDays * 72;
  const workload = workload90 + workload72;
  return { workload: Math.round(workload) };
}

/**
 * 计算周统计（当前自然周，跨月取数）
 */
function computeWeekStats(employeeId, recordsMap, prevMonthRecords, monday, sunday, year, month) {
  let voiceDays = 0, ticketDays = 0, imDays = 0, qaDays = 0;
  let outboundDays = 0, specialTaskDays = 0, testDays = 0, dutyDays = 0;
  let onMachineDays = 0, leaveDays = 0;
  let dayShiftDays = 0, earlyShiftDays = 0, lateShiftDays = 0;

  const curDate = new Date(monday);
  while (curDate <= sunday) {
    const dY = curDate.getFullYear();
    const dM = curDate.getMonth() + 1;
    const dD = curDate.getDate();
    let rec = null;
    if (dY === year && dM === month) {
      rec = (recordsMap[employeeId] || {})[dD];
    } else {
      rec = (prevMonthRecords[employeeId] || {})[dD];
    }

    if (rec) {
      if (rec.shift === '日班') dayShiftDays++;
      else if (rec.shift === '早班') earlyShiftDays++;
      else if (rec.shift === '晚班') lateShiftDays++;

      const amType = (rec.am_work_type || '').replace('AM', '').trim();
      const pmType = (rec.pm_work_type || '').replace('PM', '').trim();
      const onMachineTypes = ['拨测体验', '语音', '工单留邮', '文字IM', 'IM文字', '外呼调研', '质检'];
      const amOn = onMachineTypes.includes(amType);
      const pmOn = onMachineTypes.includes(pmType);
      if (amOn && pmOn) onMachineDays += 1;
      else if (amOn || pmOn) onMachineDays += 0.5;
      if (amType === '假' || pmType === '假') leaveDays += 0.5;

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
    curDate.setDate(curDate.getDate() + 1);
  }

  return {
    onMachineDays, leaveDays,
    voiceDays, ticketDays, imDays, qaDays,
    outboundDays, specialTaskDays, testDays, dutyDays,
    dayShiftDays, earlyShiftDays, lateShiftDays,
  };
}

/**
 * 计算大屏4区/5区/6区展示数据
 */
function computeScreenData(employees, allStats, allGoals, weekStats, weekGoals, recordsMap, days, cutoffDay, isCurrentMonth) {
  const fullTime = employees.filter(e => (e.employee_type || '').includes('全职'));
  const partTime = employees.filter(e => (e.employee_type || '').includes('兼职'));

  const sortByEmpId = (a, b) => a.employee_id.localeCompare(b.employee_id);
  fullTime.sort(sortByEmpId);
  partTime.sort(sortByEmpId);

  // ── 4区：每人每日处理 & 月累计 ──
  function computeGroupSummary(group) {
    let validCount = 0;
    for (const emp of group) {
      const st = allStats[emp.employee_id];
      if (!st) continue;
      let pastOnMachine = 0;
      const recs = recordsMap[emp.employee_id] || {};
      for (let d = 1; d <= cutoffDay && d <= days; d++) {
        const rec = recs[d];
        if (!rec) continue;
        const amType = (rec.am_work_type || '').replace('AM', '').trim();
        const pmType = (rec.pm_work_type || '').replace('PM', '').trim();
        const onMachineTypes = ['拨测体验', '语音', '工单留邮', '文字IM', 'IM文字', '外呼调研', '质检'];
        const amOn = onMachineTypes.includes(amType);
        const pmOn = onMachineTypes.includes(pmType);
        if (amOn && pmOn) pastOnMachine += 1;
        else if (amOn || pmOn) pastOnMachine += 0.5;
      }
      if (pastOnMachine > 0) validCount++;
    }
    const canCalc = validCount > 0;
    return {
      count: group.length,
      dailyAvg: canCalc ? 'XX件' : '-',
      monthlyTotal: 'XX件',
    };
  }

  const fullSummary = computeGroupSummary(fullTime);
  const partSummary = computeGroupSummary(partTime);

  // ── 5区/6区 TOP3 ──
  function computeTOP3(group, goalsMap, isWeek = false) {
    const items = [];
    for (const emp of group) {
      const goals = goalsMap[emp.employee_id];
      if (!goals) continue;

      const target = goals.workload;
      if (!target || target === 0) {
        items.push({
          name: emp.name, employee_id: emp.employee_id,
          completed: 'XX件', target: '0件',
          progress: '-', status: '落后时序进度',
          excluded: true,
        });
        continue;
      }

      // 完成值=XX占位；完成进度=XX%; 状态默认"超过时序进度"（TODO:接API后用实际值计算）
      items.push({
        name: emp.name, employee_id: emp.employee_id,
        completed: 'XX件', target: `${target}件`,
        progress: 'XX%', status: '超过时序进度',
        excluded: false,
      });
    }

    // TODO: 接入API后按实际完成进度降序排序；当前按工号排序占位
    items.sort((a, b) => {
      if (a.excluded && !b.excluded) return 1;
      if (!a.excluded && b.excluded) return -1;
      return a.employee_id.localeCompare(b.employee_id);
    });

    return items.slice(0, 3);
  }

  const monthTop3Full = computeTOP3(fullTime, allGoals, false);
  const monthTop3Part = computeTOP3(partTime, allGoals, false);
  const weekTop3Full = computeTOP3(fullTime, weekGoals, true);
  const weekTop3Part = computeTOP3(partTime, weekGoals, true);

  return {
    fullSummary, partSummary,
    monthTop3Full, monthTop3Part,
    weekTop3Full, weekTop3Part,
  };
}

/**
 * 计算累计处理服务量（2区标题用）
 *
 * 规则（2026-09-23 用户定义）：
 *   累计处理服务量 = 月份数 × 每月目标工作量 × 系数 + 本月累计工作量
 *   1) 月份数：从入职年月到上月（查询月的前一月）之间的月份数（含两端）
 *   2) 每月目标工作量：全职用户接待岗 1800 件/月，兼职用户接待岗 900 件/月
 *   3) 系数 = round(99999999 / 工号, 5) + (工号 mod 10) / 10
 *   4) 本月累计工作量 = 本月已过天数（1日~昨日）/ 本月天数 × 每月目标工作量
 *      （查看上月时，本月累计 = 上月完整月目标）
 */
function computeCumulativeWorkload(emp, cutoffDay, days, year, month) {
  // 每月目标工作量：按岗位类型取固定值
  const isFullTime = (emp.employee_type || '').includes('全职');
  const monthlyTarget = isFullTime ? 1800 : 900;

  // 系数 = round(99999999 / 工号, 5) + (工号 mod 10) / 10
  const empNum = parseInt(String(emp.employee_id).replace(/\D/g, ''), 10);
  if (!empNum || empNum <= 0) return 0;
  const coefficient = Math.round((99999999 / empNum) * 100000) / 100000 + (empNum % 10) / 10;

  // 月份数：入职年月 → 上月（查询月的前一个月），含两端
  // 例：入职 202509，查看 202609 → 到 202608，共 12 个月
  let monthCount = 0;
  if (emp.hire_date && emp.hire_date.length === 6) {
    const hireY = parseInt(emp.hire_date.substring(0, 4), 10);
    const hireM = parseInt(emp.hire_date.substring(4, 6), 10);
    if (hireY > 0 && hireM >= 1 && hireM <= 12) {
      const hireKey = hireY * 12 + (hireM - 1);
      const lastMonthKey = year * 12 + (month - 1) - 1; // 上月
      monthCount = lastMonthKey - hireKey + 1;
      if (monthCount < 0) monthCount = 0; // 入职晚于上月则不计历史月份
    }
  }

  // 本月累计工作量
  // 查看本月：1日~昨日 / 本月天数 × 每月目标
  // 查看上月：整月已完成 → 本月(即被查看月)累计 = 该月目标
  const isFullMonth = cutoffDay >= days;
  let currentMonthWork;
  if (isFullMonth) {
    currentMonthWork = monthlyTarget;
  } else {
    currentMonthWork = (cutoffDay / days) * monthlyTarget;
  }

  // 累计 = 月份数 × 目标 × 系数 + 本月累计
  const total = monthCount * monthlyTarget * coefficient + currentMonthWork;
  return Math.round(total);
}
