import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { sendMail } from '../../../lib/mailer';

/**
 * 同步人力配置 API
 *
 * GET  /api/schedule/sync-hr          获取配置（邮箱、定时、班次时间）+ 各邮箱当月发送状态
 * PUT  /api/schedule/sync-hr          保存配置 { type: 'emails'|'schedule'|'shifts', ... }
 * POST /api/schedule/sync-hr          手动发送邮件 { action: 'send', email_index: 0|1|2 }
 * POST /api/schedule/sync-hr          导出Excel数据 { action: 'export', year, month }
 */

// ── 模块级定时检查（每小时检查一次，防热重载重复） ──
if (!global.syncHrCronStarted) {
  global.syncHrCronStarted = true;
  // 每60分钟执行一次检查
  setInterval(async () => {
    try {
      const now = new Date();
      const curDay = now.getDate();
      const curHour = now.getHours();
      console.log(`[同步人力定时检查] ${now.toISOString()} day=${curDay} hour=${curHour}`);

      // 获取配置
      const cfgResult = await query('SELECT emails, send_day, send_hour, shift_times FROM sync_hr_config WHERE id = 1');
      const cfg = cfgResult.rows[0];
      if (!cfg) return;

      const sendDay = cfg.send_day || 6;
      const sendHour = cfg.send_hour || 10;

      // 按天检查
      if (curDay !== sendDay) return;
      // 按小时检查
      if (curHour !== sendHour) return;

      // 到达配置的日期和时间，执行发送
      console.log(`[同步人力定时检查] 到达发送时间 ${sendDay}日${sendHour}时，开始发送...`);

      // 计算上个月
      let targetYear = now.getFullYear();
      let targetMonth = now.getMonth();
      if (targetMonth === 0) { targetMonth = 12; targetYear--; }

      const emails = cfg.emails || ['', '', ''];
      const shiftTimes = cfg.shift_times || {
        '早班': { start: '09:00', end: '18:00' },
        '日班': { start: '08:30', end: '17:30' },
        '晚班': { start: '12:00', end: '21:00' },
        '全班': { start: '09:00', end: '21:00' },
      };

      const empResult = await query(
        'SELECT name, employee_id FROM schedule_employees WHERE is_active = TRUE ORDER BY employee_id ASC'
      );
      const recResult = await query(
        `SELECT employee_id, day, shift FROM schedule_records WHERE year = $1 AND month = $2 ORDER BY employee_id ASC, day ASC`,
        [targetYear, targetMonth]
      );
      const recordsMap = {};
      for (const r of recResult.rows) {
        if (!recordsMap[r.employee_id]) recordsMap[r.employee_id] = {};
        recordsMap[r.employee_id][r.day] = r.shift;
      }

      const excelRows = buildExcelRows(empResult.rows, recordsMap, targetYear, targetMonth, shiftTimes);
      if (excelRows.length === 0) {
        console.log('[同步人力定时检查] 无有效排班数据，跳过');
        return;
      }

      const XLSX = require('xlsx-js-style');
      const wb = buildExportWorkbook(excelRows, targetYear, targetMonth);
      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
      const subject = `附件为销售服务中心客服条线${targetYear}年${targetMonth}月排班表，请查收`;
      const fileName = `销售服务中心客服条线${targetYear}年${targetMonth}月排班表.xlsx`;

      let sentCount = 0;
      for (let i = 0; i < emails.length; i++) {
        const email = (emails[i] || '').trim();
        if (!email) continue;

        // 防重复：检查是否已发送
        const logCheck = await query(
          'SELECT id FROM sync_hr_send_log WHERE year = $1 AND month = $2 AND email = $3',
          [targetYear, targetMonth, email]
        );
        if (logCheck.rows.length > 0) {
          console.log(`[同步人力定时检查] ${email} 本月已发送，跳过`);
          continue;
        }

        const sendResult = await sendMailWithAttachment(email, subject, subject, buffer, fileName);
        if (sendResult.success) {
          await query(
            'INSERT INTO sync_hr_send_log (year, month, email, sent_at) VALUES ($1, $2, $3, NOW())',
            [targetYear, targetMonth, email]
          );
          sentCount++;
          console.log(`[同步人力定时检查] 已发送至 ${email}`);
        } else {
          console.error(`[同步人力定时检查] 发送至 ${email} 失败: ${sendResult.error}`);
        }
      }
      console.log(`[同步人力定时检查] 完成，共发送 ${sentCount} 封`);
    } catch (err) {
      console.error('[同步人力定时检查] 错误:', err.message);
    }
  }, 60 * 60 * 1000); // 每小时
  console.log('[同步人力] 定时检查已启动（每小时一次）');
}

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  const userRow = await query('SELECT is_schedule_admin, is_admin FROM users WHERE id = $1', [userInfo.id]);
  if (!userRow.rows[0] || (!userRow.rows[0].is_schedule_admin && !userRow.rows[0].is_admin)) {
    return res.status(403).json({ error: '无排班管理权限' });
  }

  // 自动建表（与 manage.js ALTER TABLE 模式一致）
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS sync_hr_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        emails JSONB DEFAULT '["","",""]'::jsonb,
        send_day INTEGER DEFAULT 6,
        send_hour INTEGER DEFAULT 10,
        shift_times JSONB DEFAULT '{"早班":{"start":"09:00","end":"18:00"},"日班":{"start":"08:30","end":"17:30"},"晚班":{"start":"12:00","end":"21:00"},"全班":{"start":"09:00","end":"21:00"}}'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS sync_hr_send_log (
        id SERIAL PRIMARY KEY,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        email VARCHAR(200) NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(year, month, email)
      )
    `);
    // 确保有默认行
    await query('INSERT INTO sync_hr_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  } catch (e) {
    console.error('[同步人力] 建表失败:', e.message);
  }

  try {
    // ── GET: 获取配置 + 发送状态 ──
    if (req.method === 'GET') {
      const cfgResult = await query('SELECT emails, send_day, send_hour, shift_times FROM sync_hr_config WHERE id = 1');
      const cfg = cfgResult.rows[0] || { emails: ['', '', ''], send_day: 6, send_hour: 10, shift_times: null };

      const emails = cfg.emails || ['', '', ''];
      const shiftTimes = cfg.shift_times || {
        '早班': { start: '09:00', end: '18:00' },
        '日班': { start: '08:30', end: '17:30' },
        '晚班': { start: '12:00', end: '21:00' },
        '全班': { start: '09:00', end: '21:00' },
      };

      // 查当月各邮箱发送状态
      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = now.getMonth() + 1;
      const logResult = await query(
        'SELECT email, sent_at FROM sync_hr_send_log WHERE year = $1 AND month = $2',
        [curYear, curMonth]
      );
      const logMap = {};
      for (const row of logResult.rows) {
        logMap[row.email] = row.sent_at;
      }

      // 每个邮箱的状态
      const emailStatus = emails.map((email) => {
        if (!email) return { email: '', sent: false, sentAt: '' };
        const sentAt = logMap[email];
        if (sentAt) {
          const d = new Date(sentAt);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const hh = String(d.getHours()).padStart(2, '0');
          const mi = String(d.getMinutes()).padStart(2, '0');
          return { email, sent: true, sentAt: `${mm}月${dd}日${hh}:${mi}` };
        }
        return { email, sent: false, sentAt: '' };
      });

      return res.status(200).json({
        emails,
        sendDay: cfg.send_day || 6,
        sendHour: cfg.send_hour || 10,
        shiftTimes,
        emailStatus,
        currentYear: curYear,
        currentMonth: curMonth,
      });
    }

    // ── PUT: 保存配置 ──
    if (req.method === 'PUT') {
      const { type } = req.body;

      if (type === 'emails') {
        const { emails } = req.body;
        if (!Array.isArray(emails) || emails.length !== 3) {
          return res.status(400).json({ error: '邮箱格式错误' });
        }
        // 基本邮箱格式校验（空值允许）
        const validEmails = emails.map(e => (e || '').trim());
        for (const e of validEmails) {
          if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
            return res.status(400).json({ error: `邮箱格式无效: ${e}` });
          }
        }
        await query('UPDATE sync_hr_config SET emails = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(validEmails)]);
        return res.status(200).json({ message: '邮箱保存成功' });
      }

      if (type === 'schedule') {
        const { sendDay, sendHour } = req.body;
        const day = parseInt(sendDay);
        const hour = parseInt(sendHour);
        if (isNaN(day) || day < 6 || day > 28) return res.status(400).json({ error: '日期范围6-28日' });
        if (isNaN(hour) || hour < 9 || hour > 18) return res.status(400).json({ error: '时间范围9-18时' });
        await query('UPDATE sync_hr_config SET send_day = $1, send_hour = $2, updated_at = NOW() WHERE id = 1', [day, hour]);
        return res.status(200).json({ message: '定时配置保存成功' });
      }

      if (type === 'shifts') {
        const { shiftTimes } = req.body;
        if (!shiftTimes) return res.status(400).json({ error: '缺少班次时间数据' });
        // 校验4个班次
        const required = ['早班', '日班', '晚班', '全班'];
        for (const key of required) {
          if (!shiftTimes[key] || !shiftTimes[key].start || !shiftTimes[key].end) {
            return res.status(400).json({ error: `缺少班次时间: ${key}` });
          }
        }
        await query('UPDATE sync_hr_config SET shift_times = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(shiftTimes)]);
        return res.status(200).json({ message: '班次时间保存成功' });
      }

      return res.status(400).json({ error: '未知的配置类型' });
    }

    // ── POST: 手动发送 / 导出Excel数据 ──
    if (req.method === 'POST') {
      const { action } = req.body;

      // ── 手动发送邮件 ──
      if (action === 'send') {
        const { emailIndex } = req.body;
        const idx = parseInt(emailIndex);
        if (isNaN(idx) || idx < 0 || idx > 2) {
          return res.status(400).json({ error: '邮箱序号无效' });
        }

        // 获取配置
        const cfgResult = await query('SELECT emails, shift_times FROM sync_hr_config WHERE id = 1');
        const cfg = cfgResult.rows[0];
        if (!cfg) return res.status(500).json({ error: '配置不存在' });

        const emails = cfg.emails || ['', '', ''];
        const targetEmail = (emails[idx] || '').trim();
        if (!targetEmail) return res.status(400).json({ error: '该邮箱未配置' });

        // 计算上个月的年月
        const now = new Date();
        let targetYear = now.getFullYear();
        let targetMonth = now.getMonth(); // 0-based, 上个月
        if (targetMonth === 0) { targetMonth = 12; targetYear--; }

        // 获取员工列表（按工号排序）
        const empResult = await query(
          'SELECT name, employee_id FROM schedule_employees WHERE is_active = TRUE ORDER BY employee_id ASC'
        );
        if (empResult.rows.length === 0) return res.status(400).json({ error: '无员工数据' });

        // 获取排班记录
        const recResult = await query(
          `SELECT employee_id, day, shift FROM schedule_records WHERE year = $1 AND month = $2 ORDER BY employee_id ASC, day ASC`,
          [targetYear, targetMonth]
        );
        const recordsMap = {};
        for (const r of recResult.rows) {
          if (!recordsMap[r.employee_id]) recordsMap[r.employee_id] = {};
          recordsMap[r.employee_id][r.day] = r.shift;
        }

        // 班次时间
        const shiftTimes = cfg.shift_times || {
          '早班': { start: '09:00', end: '18:00' },
          '日班': { start: '08:30', end: '17:30' },
          '晚班': { start: '12:00', end: '21:00' },
          '全班': { start: '09:00', end: '21:00' },
        };

        // 生成Excel数据（行数组）
        const excelRows = buildExcelRows(empResult.rows, recordsMap, targetYear, targetMonth, shiftTimes);
        if (excelRows.length === 0) {
          return res.status(400).json({ error: '无有效排班数据' });
        }

        // 生成Excel文件（Buffer）
        const XLSX = require('xlsx-js-style');
        const wb = buildExportWorkbook(excelRows, targetYear, targetMonth);
        const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

        // 邮件标题和正文
        const subject = `附件为销售服务中心客服条线${targetYear}年${targetMonth}月排班表，请查收`;
        const html = subject; // 标题和正文一致

        // 发送邮件（带附件 - 使用 sendMail 的扩展接口）
        const sendResult = await sendMailWithAttachment(targetEmail, subject, html, buffer, `销售服务中心客服条线${targetYear}年${targetMonth}月排班表.xlsx`);
        if (!sendResult.success) {
          return res.status(500).json({ error: '发送失败: ' + sendResult.error });
        }

        // 记录发送日志（UPSERT）
        await query(
          `INSERT INTO sync_hr_send_log (year, month, email, sent_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT (year, month, email) DO UPDATE SET sent_at = NOW()`,
          [targetYear, targetMonth, targetEmail]
        );

        return res.status(200).json({ message: '发送成功', to: targetEmail });
      }

      // ── 获取导出Excel数据 ──
      if (action === 'export') {
        const { year: yearStr, month: monthStr } = req.body;
        const year = parseInt(yearStr);
        const month = parseInt(monthStr);
        if (!year || !month) return res.status(400).json({ error: '缺少年份或月份' });

        // 获取配置中的班次时间
        const cfgResult = await query('SELECT shift_times FROM sync_hr_config WHERE id = 1');
        const shiftTimes = (cfgResult.rows[0] && cfgResult.rows[0].shift_times) || {
          '早班': { start: '09:00', end: '18:00' },
          '日班': { start: '08:30', end: '17:30' },
          '晚班': { start: '12:00', end: '21:00' },
          '全班': { start: '09:00', end: '21:00' },
        };

        const empResult = await query(
          'SELECT name, employee_id FROM schedule_employees WHERE is_active = TRUE ORDER BY employee_id ASC'
        );
        const recResult = await query(
          `SELECT employee_id, day, shift FROM schedule_records WHERE year = $1 AND month = $2 ORDER BY employee_id ASC, day ASC`,
          [year, month]
        );
        const recordsMap = {};
        for (const r of recResult.rows) {
          if (!recordsMap[r.employee_id]) recordsMap[r.employee_id] = {};
          recordsMap[r.employee_id][r.day] = r.shift;
        }

        const excelRows = buildExcelRows(empResult.rows, recordsMap, year, month, shiftTimes);
        if (excelRows.length === 0) {
          return res.status(400).json({ error: '无有效排班数据' });
        }

        return res.status(200).json({ rows: excelRows, year, month });
      }

      // ── 定时检查（内部调用） ──
      if (action === 'check-and-send') {
        return await handleCheckAndSend(req, res);
      }

      return res.status(400).json({ error: '未知的操作' });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('[同步人力] 服务器错误:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}

// ── 构建Excel数据行（一人一天一行，只含日班/早班/晚班/全班） ──
function buildExcelRows(employees, recordsMap, year, month, shiftTimes) {
  const days = new Date(year, month, 0).getDate();
  const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const validShifts = ['日班', '早班', '晚班', '全班'];

  const rows = [];
  let seq = 1;
  for (const emp of employees) {
    const empRecords = recordsMap[emp.employee_id] || {};
    for (let d = 1; d <= days; d++) {
      const shift = empRecords[d];
      if (!shift || !validShifts.includes(shift)) continue;

      const date = new Date(year, month - 1, d);
      const weekday = weekdayNames[date.getDay()];
      const dateStr = `${year}${String(month).padStart(2, '0')}${String(d).padStart(2, '0')}`;
      const st = shiftTimes[shift] || { start: '', end: '' };

      rows.push({
        seq: seq++,
        employeeId: emp.employee_id,
        name: emp.name,
        date: dateStr,
        weekday,
        shift,
        startTime: st.start || '',
        endTime: st.end || '',
      });
    }
  }
  return rows;
}

// ── 构建导出工作簿（无标题行，第1行表头，深蓝表头+交替行色） ──
function buildExportWorkbook(rows, year, month) {
  const XLSX = require('xlsx-js-style');
  const header = ['序号', '工号', '姓名', '日期', '星期', '班次', '上班时间', '下班时间'];
  const aoa = [header, ...rows.map(r => [r.seq, r.employeeId, r.name, r.date, r.weekday, r.shift, r.startTime, r.endTime])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }];

  const thinBorder = {
    top: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
    bottom: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
    left: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
    right: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
  };
  // 表头样式：深蓝底白字
  for (let c = 0; c < header.length; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) {
      cell.s = {
        font: { bold: true, sz: 11, color: { rgb: 'FFFFFFFF' } },
        fill: { fgColor: { rgb: 'FF1E3A5F' }, bgColor: { rgb: 'FF1E3A5F' }, patternType: 'solid' },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: thinBorder,
      };
    }
  }
  // 数据行：交替行色
  const rowBg = (i) => (i % 2 === 1 ? 'FFF0F7FF' : 'FFFFFFFF');
  for (let r = 1; r < aoa.length; r++) {
    const bg = rowBg(r - 1);
    for (let c = 0; c < header.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        cell.s = {
          font: { sz: 10, color: { rgb: 'FF374151' } },
          fill: { fgColor: { rgb: bg }, patternType: 'solid' },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: thinBorder,
        };
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '排班表');
  return wb;
}

// ── 发送带附件的邮件 ──
async function sendMailWithAttachment(to, subject, html, attachmentBuffer, attachmentName) {
  const MAIL_API_URL = process.env.MAIL_API_URL || '';
  const MAIL_API_KEY = process.env.MAIL_API_KEY || '';
  const MAIL_FROM = process.env.MAIL_FROM || 'SH31072163@126.com';

  if (!MAIL_API_URL) {
    // 开发模式：打印日志
    console.log('\n========== 同步人力邮件（开发模式）==========');
    console.log(`收件人: ${to}`);
    console.log(`主题: ${subject}`);
    console.log(`附件: ${attachmentName} (${attachmentBuffer.length} bytes)`);
    console.log('=============================================\n');
    return { success: true };
  }

  try {
    // 使用 multipart/form-data 发送带附件的邮件
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const parts = [];

    // from
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="from"\r\n\r\n${MAIL_FROM}`);
    // to
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="to"\r\n\r\n${to}`);
    // subject
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="subject"\r\n\r\n${subject}`);
    // html
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="html"\r\n\r\n${html}`);
    // attachment
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="${attachmentName}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
    );

    const headerPart = parts.join('\r\n');
    const tail = `\r\n--${boundary}--\r\n`;

    // 合并 header(字符串) + 附件(二进制) + tail(字符串)
    const headerBuf = Buffer.from(headerPart, 'utf-8');
    const tailBuf = Buffer.from(tail, 'utf-8');
    const body = Buffer.concat([headerBuf, attachmentBuffer, tailBuf]);

    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    };
    if (MAIL_API_KEY) {
      headers['Authorization'] = `Bearer ${MAIL_API_KEY}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(MAIL_API_URL, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`邮件 API 返回 HTTP ${response.status}: ${errText.substring(0, 200)}`);
    }

    console.log(`[同步人力邮件已发送] To: ${to}, Subject: ${subject}`);
    return { success: true };
  } catch (err) {
    console.error('[同步人力] 邮件发送失败:', err.message);
    return { success: false, error: err.message };
  }
}

// ── 定时检查并发送 ──
async function handleCheckAndSend(req, res) {
  const now = new Date();
  const curDay = now.getDate();
  const curHour = now.getHours();

  // 获取配置
  const cfgResult = await query('SELECT emails, send_day, send_hour, shift_times FROM sync_hr_config WHERE id = 1');
  const cfg = cfgResult.rows[0];
  if (!cfg) return res.status(200).json({ message: '无配置', sent: false });

  const sendDay = cfg.send_day || 6;
  const sendHour = cfg.send_hour || 10;

  // 按天检查
  if (curDay !== sendDay) {
    return res.status(200).json({ message: `今天${curDay}日不等于配置日期${sendDay}日，跳过`, sent: false });
  }
  // 按小时检查
  if (curHour !== sendHour) {
    return res.status(200).json({ message: `当前${curHour}时不等于配置时间${sendHour}时，跳过`, sent: false });
  }

  // 计算上个月
  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth(); // 0-based
  if (targetMonth === 0) { targetMonth = 12; targetYear--; }

  const emails = cfg.emails || ['', '', ''];
  const shiftTimes = cfg.shift_times || {
    '早班': { start: '09:00', end: '18:00' },
    '日班': { start: '08:30', end: '17:30' },
    '晚班': { start: '12:00', end: '21:00' },
    '全班': { start: '09:00', end: '21:00' },
  };

  // 获取员工和排班
  const empResult = await query(
    'SELECT name, employee_id FROM schedule_employees WHERE is_active = TRUE ORDER BY employee_id ASC'
  );
  const recResult = await query(
    `SELECT employee_id, day, shift FROM schedule_records WHERE year = $1 AND month = $2 ORDER BY employee_id ASC, day ASC`,
    [targetYear, targetMonth]
  );
  const recordsMap = {};
  for (const r of recResult.rows) {
    if (!recordsMap[r.employee_id]) recordsMap[r.employee_id] = {};
    recordsMap[r.employee_id][r.day] = r.shift;
  }

  const excelRows = buildExcelRows(empResult.rows, recordsMap, targetYear, targetMonth, shiftTimes);
  if (excelRows.length === 0) {
    return res.status(200).json({ message: '无有效排班数据', sent: false });
  }

  const XLSX = require('xlsx-js-style');
  const wb = buildExportWorkbook(excelRows, targetYear, targetMonth);
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const subject = `附件为销售服务中心客服条线${targetYear}年${targetMonth}月排班表，请查收`;
  const fileName = `销售服务中心客服条线${targetYear}年${targetMonth}月排班表.xlsx`;

  let sentCount = 0;
  for (let i = 0; i < emails.length; i++) {
    const email = (emails[i] || '').trim();
    if (!email) continue;

    // 检查是否已发送
    const logCheck = await query(
      'SELECT id FROM sync_hr_send_log WHERE year = $1 AND month = $2 AND email = $3',
      [targetYear, targetMonth, email]
    );
    if (logCheck.rows.length > 0) {
      console.log(`[同步人力] ${email} 本月已发送，跳过`);
      continue;
    }

    const sendResult = await sendMailWithAttachment(email, subject, subject, buffer, fileName);
    if (sendResult.success) {
      await query(
        'INSERT INTO sync_hr_send_log (year, month, email, sent_at) VALUES ($1, $2, $3, NOW())',
        [targetYear, targetMonth, email]
      );
      sentCount++;
    }
  }

  return res.status(200).json({ message: `已发送 ${sentCount} 封邮件`, sent: true, sentCount });
}
