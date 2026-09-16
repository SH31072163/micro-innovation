import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { sendMail } from '../../../lib/mailer';
import { generateScheduleEmailHTML } from '../../../lib/scheduleEmailTemplate';

/**
 * 排班表邮件发送 API
 *
 * POST /api/schedule/send-email
 *   { year, month, employee_id, type }
 *   type: 'calendar' | 'stats' | 'goals' | 'all'
 *
 * 根据员工和月份获取排班数据，计算统计和目标，
 * 生成保留Excel格式的HTML表格，发送到员工邮箱。
 */

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  const userRow = await query('SELECT is_schedule_admin, is_admin FROM users WHERE id = $1', [userInfo.id]);
  if (!userRow.rows[0] || (!userRow.rows[0].is_schedule_admin && !userRow.rows[0].is_admin)) {
    return res.status(403).json({ error: '无排班管理权限' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: '方法不允许' });

  try {
    const { year: yearStr, month: monthStr, employee_id, type } = req.body;
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);

    if (!year || !month || !employee_id) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    const emailType = type || 'all';

    // ── 获取员工信息 ──
    const empResult = await query(
      'SELECT name, employee_id, email FROM schedule_employees WHERE employee_id = $1',
      [employee_id]
    );
    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: '员工不存在' });
    }
    const emp = empResult.rows[0];

    if (!emp.email) {
      return res.status(400).json({ error: `员工 ${emp.name} 未设置邮箱` });
    }

    // ── 获取排班记录 ──
    const recordsResult = await query(
      `SELECT day, shift, meal_time, am_work_type, pm_work_type
       FROM schedule_records
       WHERE year = $1 AND month = $2 AND employee_id = $3
       ORDER BY day ASC`,
      [year, month, employee_id]
    );

    const days = getDaysInMonth(year, month);
    const weekdays = getWeekdays(year, month, days);

    // 构建记录 map
    const recordsMap = {};
    for (const r of recordsResult.rows) {
      recordsMap[r.day] = {
        shift: r.shift,
        meal_time: r.meal_time,
        am_work_type: r.am_work_type,
        pm_work_type: r.pm_work_type,
      };
    }

    // ── 计算统计和目标 ──
    const stats = computePersonalStats(recordsMap, days);
    const goals = computePersonalGoals(stats);

    // ── 生成邮件 HTML ──
    const html = generateScheduleEmailHTML(
      emailType,
      emp.name,
      emp.employee_id,
      year, month, days, weekdays,
      recordsMap, stats, goals
    );

    // ── 生成邮件主题：从数据库 email_title 规则获取模板 ──
    // email_title 规则按 sort_order 排序：第1条=排班表、第2条=汇总统计、第3条=月度目标
    // 模板格式：[工号][姓名][年][月]排班表（更新至[年][月][日]）
    const titleRules = await query(
      `SELECT title_template, sort_order FROM schedule_email_rules
       WHERE rule_type = 'email_title' ORDER BY sort_order ASC`
    );

    // 占位符替换函数
    function applyTemplate(tpl) {
      if (!tpl) return '';
      const today = new Date();
      const updateDay = today.getDate();
      return tpl
        .replace(/\[工号\]/g, emp.employee_id)
        .replace(/\[姓名\]/g, emp.name)
        .replace(/\[年\]/g, year)
        .replace(/\[月\]/g, month)
        .replace(/\[日\]/g, updateDay);
    }

    let subject = '';
    if (titleRules.rows.length >= 3) {
      // 有模板，按类型选择对应模板
      const titleIdx = emailType === 'calendar' ? 0
                     : emailType === 'stats' ? 1
                     : emailType === 'goals' ? 2
                     : 0; // all 默认用排班表标题
      subject = applyTemplate(titleRules.rows[titleIdx].title_template);
    }

    // fallback：如果数据库没有模板，使用默认标题
    if (!subject) {
      if (emailType === 'calendar') {
        subject = `${year}年${month}月 ${emp.name} 个人月度排班表`;
      } else if (emailType === 'stats') {
        subject = `${year}年${month}月 ${emp.name} 个人排班汇总统计`;
      } else if (emailType === 'goals') {
        subject = `${year}年${month}月 ${emp.name} 个人月度目标`;
      } else {
        subject = `${year}年${month}月 ${emp.name} 排班信息`;
      }
    }

    // ── 发送邮件 ──
    await sendMail(emp.email, subject, html);

    return res.status(200).json({
      message: '邮件发送成功',
      to: emp.email,
      subject,
    });
  } catch (err) {
    console.error('Schedule send-email error:', err);
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

function isOnMachineType(type) {
  const onMachine = ['拨测体验', '语音', '工单留邮', '文字IM', 'IM文字', '外呼调研', '代值班', '质检'];
  return onMachine.includes(type);
}

/**
 * 计算个人排班汇总统计（13项）— 与 view.js 一致
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

    if (isOnMachineType(amType) || isOnMachineType(pmType)) onMachineDays++;
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
 * 计算个人月度目标 — 与 view.js 一致
 */
function computePersonalGoals(stats) {
  const workload90 = (stats.voiceDays + stats.imDays + stats.ticketDays + stats.outboundDays + stats.qaDays) * 90;
  const workload72 = stats.testDays * 72;
  const workload = workload90 + workload72;

  const voiceMachineTime = stats.voiceDays * 7.5;
  const imMachineTime = stats.imDays * 7.5;

  return {
    workload: `${Math.round(workload)}件`,
    voiceMachineTime: `${voiceMachineTime}小时`,
    imMachineTime: `${imMachineTime}小时`,
  };
}
