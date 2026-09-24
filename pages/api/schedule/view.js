import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { getGoalEndDayLabel } from '../../../lib/goalDate';

/**
 * 中心排班表查看 API
 *
 * GET /api/schedule/view?year=2026&month=9
 *   - 获取指定年月的中心排班表（行=员工按工号排序，列=日期，单元格=班次+工种）
 *   - 仅允许查看本月、上月、次月
 *   - 次月排班如未保存（未点"重新排班"），返回空排班
 *
 * GET /api/schedule/view?year=2026&month=9&employee_id=71007801
 *   - 获取某员工个人排班详情（日历格式）
 */

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  if (req.method !== 'GET') return res.status(405).json({ error: '方法不允许' });

  try {
    const { year: yearStr, month: monthStr, employee_id } = req.query;
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: '年份或月份参数无效' });
    }

    // ── 限制：仅允许查看上月、本月、次月 ──
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    const curMonthKey = curY * 12 + (curM - 1);
    const reqMonthKey = year * 12 + (month - 1);
    const diff = reqMonthKey - curMonthKey;

    if (diff < -1 || diff > 1) {
      return res.status(403).json({ error: '仅可查看上月、本月和次月的排班信息' });
    }

    // ── 次月检查：如未保存排班记录，返回空 ──
    if (diff === 1) {
      const count = await query(
        'SELECT COUNT(*) as count FROM schedule_records WHERE year = $1 AND month = $2',
        [year, month]
      );
      if (parseInt(count.rows[0].count) === 0) {
        return res.status(200).json({
          year, month, days: getDaysInMonth(year, month),
          employees: [], records: {},
          isEmpty: true,
          message: '次月排班尚未生成，请先在管理区点击"重新排班"',
        });
      }
    }

    // ── 获取员工列表（仅排班岗位：全职/兼职用户接待岗，按工号排序） ──
    const employees = await query(
      'SELECT name, employee_id, email FROM schedule_employees WHERE is_active = TRUE AND employee_type IN (\'全职用户接待岗\', \'兼职用户接待岗\') ORDER BY employee_id ASC'
    );

    // ── 获取排班记录 ──
    const records = await query(
      `SELECT employee_id, day, shift, meal_time, am_work_type, pm_work_type
       FROM schedule_records
       WHERE year = $1 AND month = $2
       ORDER BY employee_id ASC, day ASC`,
      [year, month]
    );

    // ── 组织成前端需要的结构 ──
    const days = getDaysInMonth(year, month);
    const weekdays = getWeekdays(year, month, days);

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

    // ── 如果指定了 employee_id，返回个人详情 ──
    if (employee_id) {
      const empData = employees.rows.find(e => e.employee_id === employee_id);
      if (!empData) return res.status(404).json({ error: '员工不存在' });

      const personalRecords = recordsMap[employee_id] || {};

      // 计算个人汇总统计
      const stats = computePersonalStats(personalRecords, days);

      // 计算个人月度目标
      const goals = computePersonalGoals(personalRecords, stats, year, month);

      // 获取数据字典（am/pm 工种、班次、餐时完整值列表）
      const dictResult = await query(
        'SELECT category, value, sort_order FROM schedule_dict ORDER BY category ASC, sort_order ASC'
      );
      const dictData = {};
      for (const row of dictResult.rows) {
        if (!dictData[row.category]) dictData[row.category] = [];
        dictData[row.category].push(row.value);
      }

      return res.status(200).json({
        year, month, days, weekdays,
        employee: empData,
        personalRecords,
        stats,
        goals,
        dictData,
      });
    }

    // ── 计算汇总统计（每人） ──
    const allStats = {};
    for (const emp of employees.rows) {
      const empRecords = recordsMap[emp.employee_id] || {};
      allStats[emp.employee_id] = computePersonalStats(empRecords, days);
    }

    return res.status(200).json({
      year, month, days, weekdays,
      employees: employees.rows,
      records: recordsMap,
      stats: allStats,
      isEmpty: records.rows.length === 0,
    });
  } catch (err) {
    console.error('Schedule view error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}

/**
 * 获取月份天数
 */
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * 获取每天星期几（1=周一 ... 7=周日）
 */
function getWeekdays(year, month, days) {
  const result = [];
  for (let d = 1; d <= days; d++) {
    const date = new Date(year, month - 1, d);
    let wd = date.getDay(); // 0=周日
    if (wd === 0) wd = 7; // 转为7=周日
    result.push(wd);
  }
  return result;
}

/**
 * 计算个人排班汇总统计（13项）
 * 1.实际上机天数 2.请假天数 3.语音天数 4.工单留邮天数 5.IM文字天数
 * 6.质检天数 7.外呼天数 8.专项任务天数 9.拨测体验天数 10.代值班天数
 * 11.日班天数 12.早班天数 13.晚班天数
 */
function computePersonalStats(records, days) {
  let onMachineDays = 0;
  let leaveDays = 0;
  let voiceDays = 0;
  let ticketDays = 0;
  let imDays = 0;
  let qaDays = 0;
  let outboundDays = 0;
  let specialTaskDays = 0;
  let testDays = 0;
  let dutyDays = 0;
  let dayShiftDays = 0;
  let earlyShiftDays = 0;
  let lateShiftDays = 0;

  for (let d = 1; d <= days; d++) {
    const rec = records[d];
    if (!rec) continue;

    // 班次统计
    if (rec.shift === '日班') dayShiftDays += 1;
    else if (rec.shift === '早班') earlyShiftDays += 1;
    else if (rec.shift === '晚班') lateShiftDays += 1;

    // 上机统计（按上机工种）
    const amType = (rec.am_work_type || '').replace('AM', '').trim();
    const pmType = (rec.pm_work_type || '').replace('PM', '').trim();

    // 实际上机天数 = 至少有半天上机的
    const isOnMachine = isOnMachineType(amType) || isOnMachineType(pmType);
    if (isOnMachine) onMachineDays += 1;

    // 请假天数
    if (rec.shift === '假') leaveDays += 1;

    // 各工种天数（半天=0.5天）
    const halfDayTypes = [amType, pmType];
    for (const t of halfDayTypes) {
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
    onMachineDays,
    leaveDays,
    voiceDays,
    ticketDays,
    imDays,
    qaDays,
    outboundDays,
    specialTaskDays,
    testDays,
    dutyDays,
    dayShiftDays,
    earlyShiftDays,
    lateShiftDays,
  };
}

function isOnMachineType(type) {
  const onMachine = ['拨测体验', '语音', '工单留邮', '文字IM', 'IM文字', '外呼调研', '质检'];
  return onMachine.includes(type);
}

/**
 * 计算个人月度目标
 *
 * 2026-09-21 新增：每工种目标（voiceTarget等）+ 完成值占位（completedVoice等）
 * 完成值当前为占位文本“XX件”/“XX小时”，今后接入外部平台API后在此处替换
 * （接API时仅需改后端，弹窗/邮件/Excel导出三处渲染自动同步）
 */
function computePersonalGoals(records, stats, year, month) {
  // 工作量 = (语音+IM+工单+外呼+质检)*90 + 拨测*72
  const workload90 = (stats.voiceDays + stats.imDays + stats.ticketDays + stats.outboundDays + stats.qaDays) * 90;
  const workload72 = stats.testDays * 72;
  const workload = workload90 + workload72;

  // 语音上机时间 = 语音天数 * 7.5
  const voiceMachineTime = stats.voiceDays * 7.5;
  // IM上机时间 = IM天数 * 7.5
  const imMachineTime = stats.imDays * 7.5;

  // ── 每工种目标（上半块：X月工作量目标与完成情况）──
  // 换算规则：语音/IM/工单留邮/外呼调研/质检 90件/天，拨测体验 72件/天
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
    // TODO: 今后接入外部平台API，替换为实际完成量（如“123件”）
    completed: 'XX件',
  }));

  // ── 完成值占位（下半块：X月需完成绩效考核目标）──
  // TODO: 今后接入外部平台API，替换为实际完成值
  const completed = {
    workload: 'XX件',
    voiceMachineTime: 'XX小时',
    imMachineTime: 'XX小时',
  };

  return {
    workload: `${Math.round(workload)}件`,
    voiceMachineTime: `${voiceMachineTime}小时`,
    imMachineTime: `${imMachineTime}小时`,
    // “1日-XX日完成值”列标题（XX=当天退1天，不跨月）
    endDayLabel: getGoalEndDayLabel(year, month),
    perType,
    completed,
  };
}
