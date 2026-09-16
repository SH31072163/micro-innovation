/**
 * 排班表邮件 HTML 模板生成模块
 *
 * 根据 v10 Excel 模板中三个 sheet 的格式，生成保留字体/底色/边框/行高/列宽/对齐方式的 HTML 表格。
 *
 * 三个模板：
 * 1. 个人月度排班表（A1:G8）— 日历式 5行7列，每天显示班次+餐时+AM工种+PM工种
 * 2. 个人排班汇总统计（A1:D17）— 4列布局，13项统计
 * 3. 个人月度目标（A1:D15）— 4列布局，含排班记录+绩效目标+备注
 *
 * Excel 格式映射：
 * - 字体：微软雅黑（所有单元格统一）
 * - 标题：16号加粗居中（排班表）/ 12号加粗居中（汇总统计/月度目标）
 * - 信息栏标签：11号，浅黄底 #FFF8E1
 * - 姓名/工号值：14号加粗，浅蓝底 #E3F2FD
 * - 表头行：14号加粗，浅灰底 #F2F2F2（周末 #D9D9D9）
 * - 数据单元格：9-11号，白色底 #FFFFFF
 * - 边框：thin(1px) / medium(2px) 黑色
 * - 对齐：表头居中，数据单元格 left/top（排班表）或 center（统计/目标）
 */

// ── 格式常量 ──
const FONT_FAMILY = '微软雅黑, "Microsoft YaHei", sans-serif';

// ARGB → CSS hex 转换（openpyxl 格式 FFFFF8E1 → #FFF8E1）
function argbToHex(argb) {
  if (!argb || argb === '00000000') return '';
  return '#' + argb.substring(2);
}

// 边框样式映射
function borderStyle(cssSide, excelSide) {
  if (!excelSide || !excelSide.style) return '';
  const width = excelSide.style === 'medium' ? '2px' : '1px';
  return `border-${cssSide}: ${width} solid #000;`;
}

/**
 * 生成个人月度排班表 HTML（对应 Excel A1:G8）
 *
 * 布局：
 * Row1: 标题（合并 A1:G1）
 * Row2: 员工姓名(B2:C2合并) | 工号(E2:G2合并)
 * Row3: 周一~周日（表头，周末底色不同）
 * Row4-8: 日历数据（5行7列），每格显示：日期 / 班次 / 餐时 / AM工种 / PM工种
 */
function generateScheduleCalendarHTML(empName, empId, year, month, days, weekdays, records) {
  const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  // 构建日历布局：5行7列，第1行从1号对应的星期开始
  const calendar = [];
  let currentDay = 1;
  for (let week = 0; week < 6 && currentDay <= days; week++) {
    const row = [];
    for (let dow = 0; dow < 7; dow++) {
      if (currentDay > days) {
        row.push(null);
      } else {
        const wd = weekdays[currentDay - 1]; // 1=周一 ... 7=周日
        if (dow === wd - 1) {
          row.push(currentDay);
          currentDay++;
        } else {
          row.push(null);
        }
      }
    }
    calendar.push(row);
  }

  // 单元格内容构建
  function cellContent(day) {
    if (!day) return '';
    const rec = records[day];
    if (!rec) return `${day}日`;
    const am = (rec.am_work_type || '').replace('AM', '') || '';
    const pm = (rec.pm_work_type || '').replace('PM', '') || '';
    return `${day}日<br/>${rec.shift || ''}<br/>${rec.meal_time || ''}<br/>${am}<br/>${pm}`;
  }

  let html = `<table style="border-collapse:collapse;font-family:${FONT_FAMILY};width:100%;max-width:700px;">`;

  // Row1: 标题（合并7列）
  html += `<tr><td colspan="7" style="font-size:16px;font-weight:bold;text-align:center;vertical-align:center;height:35px;padding:4px;">销售服务中心${year}年${month}月员工${empName}排班表</td></tr>`;

  // Row2: 员工姓名 | 工号
  html += `<tr style="height:28px;">`;
  html += `<td style="font-size:11px;text-align:center;vertical-align:middle;background:#FFF8E1;border:1px solid #000;padding:2px;">员工姓名</td>`;
  html += `<td colspan="2" style="font-size:14px;font-weight:bold;text-align:center;vertical-align:middle;background:#E3F2FD;border:1px solid #000;padding:2px;">${empName}</td>`;
  html += `<td style="font-size:11px;text-align:center;vertical-align:middle;background:#FFF8E1;border:1px solid #000;padding:2px;">工号</td>`;
  html += `<td colspan="3" style="font-size:11px;text-align:center;vertical-align:middle;background:#E3F2FD;border:1px solid #000;padding:2px;">${empId}</td>`;
  html += `</tr>`;

  // Row3: 星期表头
  html += `<tr style="height:25px;">`;
  for (let i = 0; i < 7; i++) {
    const bg = i >= 5 ? '#D9D9D9' : '#F2F2F2';
    html += `<td style="font-size:14px;font-weight:bold;text-align:center;vertical-align:middle;background:${bg};border:2px solid #000;padding:2px;">${weekdayNames[i]}</td>`;
  }
  html += `</tr>`;

  // Row4-8: 日历数据行（height: 80px ≈ 60pt in Excel）
  for (const row of calendar) {
    html += `<tr style="height:80px;">`;
    for (let i = 0; i < 7; i++) {
      const day = row[i];
      const content = cellContent(day);
      html += `<td style="font-size:9px;text-align:left;vertical-align:top;background:#FFFFFF;border:1px solid #000;padding:2px;white-space:pre-line;">${content || '&nbsp;'}</td>`;
    }
    html += `</tr>`;
  }

  html += `</table>`;
  return html;
}

/**
 * 生成个人排班汇总统计 HTML（对应 Excel A1:D17）
 *
 * 布局（4列，A:B合并为名称列，C:D合并为天数列）：
 * Row1: 标题（合并 A1:D1）
 * Row2: 员工姓名 | 工号
 * Row3: 空
 * Row4: 表头：统计项 | 天数
 * Row5-17: 13项统计数据
 */
function generateScheduleStatsHTML(empName, empId, year, month, stats) {
  const items = [
    ['实际上机天数', stats.onMachineDays],
    ['请假天数', stats.leaveDays],
    ['语音天数', stats.voiceDays],
    ['工单留邮天数', stats.ticketDays],
    ['IM文字天数', stats.imDays],
    ['质检天数', stats.qaDays],
    ['外呼天数', stats.outboundDays],
    ['专项任务天数', stats.specialTaskDays],
    ['拨测体验天数', stats.testDays],
    ['代值班天数', stats.dutyDays],
    ['日班天数', stats.dayShiftDays],
    ['早班天数', stats.earlyShiftDays],
    ['晚班天数', stats.lateShiftDays],
  ];

  let html = `<table style="border-collapse:collapse;font-family:${FONT_FAMILY};width:100%;max-width:500px;">`;

  // Row1: 标题（合并4列）
  html += `<tr><td colspan="4" style="font-size:12px;font-weight:bold;text-align:center;vertical-align:middle;height:35px;padding:4px;">销售服务中心${year}年${month}月员工${empName}排班汇总统计</td></tr>`;

  // Row2: 员工姓名 | 工号
  html += `<tr style="height:28px;">`;
  html += `<td style="font-size:11px;text-align:center;vertical-align:middle;background:#FFF8E1;border:1px solid #000;padding:2px;">员工姓名</td>`;
  html += `<td style="font-size:14px;font-weight:bold;text-align:center;vertical-align:middle;background:#E3F2FD;border:1px solid #000;padding:2px;">${empName}</td>`;
  html += `<td style="font-size:11px;text-align:center;vertical-align:middle;background:#FFF8E1;border:1px solid #000;padding:2px;">工号</td>`;
  html += `<td style="font-size:11px;text-align:center;vertical-align:middle;background:#E3F2FD;border:1px solid #000;padding:2px;">${empId}</td>`;
  html += `</tr>`;

  // Row3: 空行
  html += `<tr style="height:14px;"><td colspan="4"></td></tr>`;

  // Row4: 表头
  html += `<tr style="height:22px;">`;
  html += `<td colspan="2" style="font-size:14px;font-weight:bold;text-align:center;vertical-align:middle;background:#F2F2F2;border:2px solid #000;padding:2px;">统计项</td>`;
  html += `<td colspan="2" style="font-size:14px;font-weight:bold;text-align:center;vertical-align:middle;background:#F2F2F2;border:2px solid #000;padding:2px;">天数</td>`;
  html += `</tr>`;

  // Row5-17: 13项数据（A:B合并名称，C:D合并天数）
  for (const [label, val] of items) {
    html += `<tr style="height:16px;">`;
    html += `<td colspan="2" style="font-size:11px;text-align:center;vertical-align:middle;background:#F2F2F2;border:1px solid #000;padding:2px;">${label}</td>`;
    html += `<td colspan="2" style="font-size:11px;text-align:center;vertical-align:middle;border:1px solid #000;padding:2px;">${val}</td>`;
    html += `</tr>`;
  }

  html += `</table>`;
  return html;
}

/**
 * 生成个人月度目标 HTML（对应 Excel A1:D15）
 *
 * 布局（4列，A:B合并，C:D合并）：
 * Row1: 标题（合并 A1:D1）
 * Row2: 员工姓名 | 工号
 * Row3: 月份排班记录（合并 A3:D3）
 * Row4-9: 6项排班记录（语音/工单留邮/IM文字/外呼调研/拨测体验/质检天数）
 * Row10: 月份需完成绩效考核目标（合并 A10:D10）
 * Row11-13: 3项目标（工作量/语音上机时间/IM上机时间）
 * Row14-15: 备注（合并 A14:D15）
 */
function generateScheduleGoalsHTML(empName, empId, year, month, stats, goals) {
  const records = [
    ['语音天数', stats.voiceDays],
    ['工单留邮天数', stats.ticketDays],
    ['IM文字天数', stats.imDays],
    ['外呼调研天数', stats.outboundDays],
    ['拨测体验天数', stats.testDays],
    ['质检天数', stats.qaDays],
  ];

  const targets = [
    ['工作量', goals.workload],
    ['语音上机时间', goals.voiceMachineTime],
    ['IM上机时间', goals.imMachineTime],
  ];

  let html = `<table style="border-collapse:collapse;font-family:${FONT_FAMILY};width:100%;max-width:500px;">`;

  // Row1: 标题（合并4列）
  html += `<tr><td colspan="4" style="font-size:12px;font-weight:bold;text-align:center;vertical-align:middle;height:35px;padding:4px;">销售服务中心${year}年${month}月员工${empName}绩效考核目标</td></tr>`;

  // Row2: 员工姓名 | 工号
  html += `<tr style="height:28px;">`;
  html += `<td style="font-size:10px;text-align:center;vertical-align:middle;background:#FFF8E1;border:1px solid #000;padding:2px;">员工姓名</td>`;
  html += `<td style="font-size:10px;font-weight:bold;text-align:center;vertical-align:middle;background:#E3F2FD;border:1px solid #000;padding:2px;">${empName}</td>`;
  html += `<td style="font-size:10px;text-align:center;vertical-align:middle;background:#FFF8E1;border:1px solid #000;padding:2px;">工号</td>`;
  html += `<td style="font-size:10px;text-align:center;vertical-align:middle;background:#E3F2FD;border:1px solid #000;padding:2px;">${empId}</td>`;
  html += `</tr>`;

  // Row3: 月份排班记录标题（合并4列）
  html += `<tr style="height:25px;"><td colspan="4" style="font-size:14px;font-weight:bold;text-align:center;vertical-align:middle;background:#F2F2F2;border:1px solid #000;padding:2px;"> ${month}月排班记录</td></tr>`;

  // Row4-9: 6项排班记录（A:B合并名称，C:D合并天数）
  for (const [label, val] of records) {
    html += `<tr style="height:16px;">`;
    html += `<td colspan="2" style="font-size:11px;text-align:center;vertical-align:middle;background:#F2F2F2;border:1px solid #000;padding:2px;">${label}</td>`;
    html += `<td colspan="2" style="font-size:11px;text-align:center;vertical-align:middle;border:1px solid #000;padding:2px;">${val}</td>`;
    html += `</tr>`;
  }

  // Row10: 月份需完成绩效考核目标标题（合并4列）
  html += `<tr style="height:25px;"><td colspan="4" style="font-size:14px;font-weight:bold;text-align:center;vertical-align:middle;background:#F2F2F2;border:1px solid #000;padding:2px;"> ${month}月需完成绩效考核目标</td></tr>`;

  // Row11-13: 3项目标
  for (const [label, val] of targets) {
    html += `<tr style="height:16px;">`;
    html += `<td colspan="2" style="font-size:11px;text-align:center;vertical-align:middle;background:#F2F2F2;border:1px solid #000;padding:2px;">${label}</td>`;
    html += `<td colspan="2" style="font-size:11px;text-align:center;vertical-align:middle;border:1px solid #000;padding:2px;">${val}</td>`;
    html += `</tr>`;
  }

  // Row14-15: 备注（合并4列，跨2行）
  html += `<tr><td colspan="4" rowspan="2" style="font-size:10px;text-align:left;vertical-align:top;border:1px solid #000;padding:4px;">备注：语音/IM文字/外呼调研/工单留邮/质检 目标90件/天，拨测体验目标72件/天；语音/IM文字 目标7.5小时/天</td></tr>`;
  html += `<tr></tr>`;

  html += `</table>`;
  return html;
}

/**
 * 生成完整邮件 HTML（包含3个表格）
 * type: 'calendar' | 'stats' | 'goals' | 'all'
 */
function generateScheduleEmailHTML(type, empName, empId, year, month, days, weekdays, records, stats, goals) {
  let body = '';

  if (type === 'calendar' || type === 'all') {
    body += generateScheduleCalendarHTML(empName, empId, year, month, days, weekdays, records);
  }
  if (type === 'stats' || type === 'all') {
    if (type === 'all') body += '<br/>';
    body += generateScheduleStatsHTML(empName, empId, year, month, stats);
  }
  if (type === 'goals' || type === 'all') {
    if (type === 'all' || type === 'stats') body += '<br/>';
    body += generateScheduleGoalsHTML(empName, empId, year, month, stats, goals);
  }

  return `<html><body style="font-family:${FONT_FAMILY};margin:0;padding:20px;background:#f5f5f5;">
<div style="max-width:700px;margin:0 auto;background:#fff;padding:24px;border-radius:8px;">
${body}
</div>
</body></html>`;
}

module.exports = {
  generateScheduleCalendarHTML,
  generateScheduleStatsHTML,
  generateScheduleGoalsHTML,
  generateScheduleEmailHTML,
};
