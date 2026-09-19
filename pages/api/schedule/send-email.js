import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { sendMail } from '../../../lib/mailer';
import { generateScheduleEmailHTML } from '../../../lib/scheduleEmailTemplate';

/**
 * 鎺掔彮琛ㄩ偖浠跺彂閫?API
 *
 * POST /api/schedule/send-email
 *   { year, month, employee_id, type }
 *   type: 'calendar' | 'stats' | 'goals' | 'all'
 *
 * 鏍规嵁鍛樺伐鍜屾湀浠借幏鍙栨帓鐝暟鎹紝璁＄畻缁熻鍜岀洰鏍囷紝
 * 鐢熸垚淇濈暀Excel鏍煎紡鐨凥TML琛ㄦ牸锛屽彂閫佸埌鍛樺伐閭銆? */

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '鏈櫥褰? });

  const userRow = await query('SELECT is_schedule_admin, is_admin FROM users WHERE id = $1', [userInfo.id]);
  if (!userRow.rows[0] || (!userRow.rows[0].is_schedule_admin && !userRow.rows[0].is_admin)) {
    return res.status(403).json({ error: '鏃犳帓鐝鐞嗘潈闄? });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: '鏂规硶涓嶅厑璁? });

  try {
    const { year: yearStr, month: monthStr, employee_id, type } = req.body;
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);

    if (!year || !month || !employee_id) {
      return res.status(400).json({ error: '缂哄皯蹇呰鍙傛暟' });
    }

    const emailType = type || 'all';

    // 鈹€鈹€ 鑾峰彇鍛樺伐淇℃伅 鈹€鈹€
    const empResult = await query(
      'SELECT name, employee_id, email FROM schedule_employees WHERE employee_id = $1',
      [employee_id]
    );
    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: '鍛樺伐涓嶅瓨鍦? });
    }
    const emp = empResult.rows[0];

    if (!emp.email) {
      return res.status(400).json({ error: `鍛樺伐 ${emp.name} 鏈缃偖绠盽 });
    }

    // 鈹€鈹€ 鑾峰彇鎺掔彮璁板綍 鈹€鈹€
    const recordsResult = await query(
      `SELECT day, shift, meal_time, am_work_type, pm_work_type
       FROM schedule_records
       WHERE year = $1 AND month = $2 AND employee_id = $3
       ORDER BY day ASC`,
      [year, month, employee_id]
    );

    const days = getDaysInMonth(year, month);
    const weekdays = getWeekdays(year, month, days);

    // 鏋勫缓璁板綍 map
    const recordsMap = {};
    for (const r of recordsResult.rows) {
      recordsMap[r.day] = {
        shift: r.shift,
        meal_time: r.meal_time,
        am_work_type: r.am_work_type,
        pm_work_type: r.pm_work_type,
      };
    }

    // 鈹€鈹€ 璁＄畻缁熻鍜岀洰鏍?鈹€鈹€
    const stats = computePersonalStats(recordsMap, days);
    const goals = computePersonalGoals(stats);

    // 鈹€鈹€ 鐢熸垚閭欢 HTML 鈹€鈹€
    const html = generateScheduleEmailHTML(
      emailType,
      emp.name,
      emp.employee_id,
      year, month, days, weekdays,
      recordsMap, stats, goals
    );

    // 鈹€鈹€ 鐢熸垚閭欢涓婚锛氫粠鏁版嵁搴?email_title 瑙勫垯鑾峰彇妯℃澘 鈹€鈹€
    // email_title 瑙勫垯鎸?sort_order 鎺掑簭锛氱1鏉?鎺掔彮琛ㄣ€佺2鏉?姹囨€荤粺璁°€佺3鏉?鏈堝害鐩爣
    // 妯℃澘鏍煎紡锛歔宸ュ彿][濮撳悕][骞碷[鏈圿鎺掔彮琛紙鏇存柊鑷砙骞碷[鏈圿[鏃锛?    const titleRules = await query(
      `SELECT title_template, sort_order FROM schedule_email_rules
       WHERE rule_type = 'email_title' ORDER BY sort_order ASC`
    );

    // 鍗犱綅绗︽浛鎹㈠嚱鏁?    function applyTemplate(tpl) {
      if (!tpl) return '';
      const today = new Date();
      const updateDay = today.getDate();
      return tpl
        .replace(/\[宸ュ彿\]/g, emp.employee_id)
        .replace(/\[濮撳悕\]/g, emp.name)
        .replace(/\[骞碶]/g, year)
        .replace(/\[鏈圽]/g, month)
        .replace(/\[鏃]/g, updateDay);
    }

    let subject = '';
    if (titleRules.rows.length >= 3) {
      // 鏈夋ā鏉匡紝鎸夌被鍨嬮€夋嫨瀵瑰簲妯℃澘
      const titleIdx = emailType === 'calendar' ? 0
                     : emailType === 'stats' ? 1
                     : emailType === 'goals' ? 2
                     : 0; // all 榛樿鐢ㄦ帓鐝〃鏍囬
      subject = applyTemplate(titleRules.rows[titleIdx].title_template);
    }

    // fallback锛氬鏋滄暟鎹簱娌℃湁妯℃澘锛屼娇鐢ㄩ粯璁ゆ爣棰?    if (!subject) {
      if (emailType === 'calendar') {
        subject = `${year}骞?{month}鏈?${emp.name} 涓汉鏈堝害鎺掔彮琛╜;
      } else if (emailType === 'stats') {
        subject = `${year}骞?{month}鏈?${emp.name} 涓汉鎺掔彮姹囨€荤粺璁;
      } else if (emailType === 'goals') {
        subject = `${year}骞?{month}鏈?${emp.name} 涓汉鏈堝害鐩爣`;
      } else {
        subject = `${year}骞?{month}鏈?${emp.name} 鎺掔彮淇℃伅`;
      }
    }

    // 鈹€鈹€ 鍙戦€侀偖浠?鈹€鈹€
    const mailResult = await sendMail(emp.email, subject, html);
    if (mailResult === false) {
      return res.status(500).json({ error: '閭欢鍙戦€佸け璐ワ細' + (sendMail.lastError || '鏈煡閿欒') });
    }

    return res.status(200).json({
      message: '閭欢鍙戦€佹垚鍔?,
      to: emp.email,
      subject,
    });
  } catch (err) {
    console.error('Schedule send-email error:', err);
    res.status(500).json({ error: '鏈嶅姟鍣ㄩ敊璇? ' + err.message });
  }
}

// 鈹€鈹€ 杈呭姪鍑芥暟 鈹€鈹€

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
  const onMachine = ['鎷ㄦ祴浣撻獙', '璇煶', '宸ュ崟鐣欓偖', '鏂囧瓧IM', 'IM鏂囧瓧', '澶栧懠璋冪爺', '璐ㄦ'];
  return onMachine.includes(type);
}

/**
 * 璁＄畻涓汉鎺掔彮姹囨€荤粺璁★紙13椤癸級鈥?涓?view.js 涓€鑷? */
function computePersonalStats(records, days) {
  let onMachineDays = 0, leaveDays = 0;
  let voiceDays = 0, ticketDays = 0, imDays = 0, qaDays = 0;
  let outboundDays = 0, specialTaskDays = 0, testDays = 0, dutyDays = 0;
  let dayShiftDays = 0, earlyShiftDays = 0, lateShiftDays = 0;

  for (let d = 1; d <= days; d++) {
    const rec = records[d];
    if (!rec) continue;

    if (rec.shift === '鏃ョ彮') dayShiftDays++;
    else if (rec.shift === '鏃╃彮') earlyShiftDays++;
    else if (rec.shift === '鏅氱彮') lateShiftDays++;

    const amType = (rec.am_work_type || '').replace('AM', '').trim();
    const pmType = (rec.pm_work_type || '').replace('PM', '').trim();

    if (isOnMachineType(amType) || isOnMachineType(pmType)) onMachineDays++;
    if (rec.shift === '鍋?) leaveDays++;

    for (const t of [amType, pmType]) {
      if (t === '璇煶') voiceDays += 0.5;
      if (t === '宸ュ崟鐣欓偖') ticketDays += 0.5;
      if (t === '鏂囧瓧IM' || t === 'IM鏂囧瓧') imDays += 0.5;
      if (t === '璐ㄦ') qaDays += 0.5;
      if (t === '澶栧懠璋冪爺') outboundDays += 0.5;
      if (t === '涓撻」宸ヤ綔') specialTaskDays += 0.5;
      if (t === '鎷ㄦ祴浣撻獙') testDays += 0.5;
      if (t === '浠ｅ€肩彮') dutyDays += 0.5;
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
 * 璁＄畻涓汉鏈堝害鐩爣 鈥?涓?view.js 涓€鑷? */
function computePersonalGoals(stats) {
  const workload90 = (stats.voiceDays + stats.imDays + stats.ticketDays + stats.outboundDays + stats.qaDays) * 90;
  const workload72 = stats.testDays * 72;
  const workload = workload90 + workload72;

  const voiceMachineTime = stats.voiceDays * 7.5;
  const imMachineTime = stats.imDays * 7.5;

  return {
    workload: `${Math.round(workload)}浠禶,
    voiceMachineTime: `${voiceMachineTime}灏忔椂`,
    imMachineTime: `${imMachineTime}灏忔椂`,
  };
}
