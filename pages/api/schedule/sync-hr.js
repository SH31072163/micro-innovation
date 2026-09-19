import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { sendMail } from '../../../lib/mailer';

/**
 * 鍚屾浜哄姏閰嶇疆 API
 *
 * GET  /api/schedule/sync-hr          鑾峰彇閰嶇疆锛堥偖绠便€佸畾鏃躲€佺彮娆℃椂闂达級+ 鍚勯偖绠卞綋鏈堝彂閫佺姸鎬? * PUT  /api/schedule/sync-hr          淇濆瓨閰嶇疆 { type: 'emails'|'schedule'|'shifts', ... }
 * POST /api/schedule/sync-hr          鎵嬪姩鍙戦€侀偖浠?{ action: 'send', email_index: 0|1|2 }
 * POST /api/schedule/sync-hr          瀵煎嚭Excel鏁版嵁 { action: 'export', year, month }
 */

// 鈹€鈹€ 妯″潡绾у畾鏃舵鏌ワ紙姣忓皬鏃舵鏌ヤ竴娆★紝闃茬儹閲嶈浇閲嶅锛?鈹€鈹€
if (!global.syncHrCronStarted) {
  global.syncHrCronStarted = true;
  // 姣?0鍒嗛挓鎵ц涓€娆℃鏌?  setInterval(async () => {
    try {
      const now = new Date();
      const curDay = now.getDate();
      const curHour = now.getHours();
      console.log(`[鍚屾浜哄姏瀹氭椂妫€鏌 ${now.toISOString()} day=${curDay} hour=${curHour}`);

      // 鑾峰彇閰嶇疆
      const cfgResult = await query('SELECT emails, send_day, send_hour, shift_times FROM sync_hr_config WHERE id = 1');
      const cfg = cfgResult.rows[0];
      if (!cfg) return;

      const sendDay = cfg.send_day || 6;
      const sendHour = cfg.send_hour || 10;

      // 鎸夊ぉ妫€鏌?      if (curDay !== sendDay) return;
      // 鎸夊皬鏃舵鏌?      if (curHour !== sendHour) return;

      // 鍒拌揪閰嶇疆鐨勬棩鏈熷拰鏃堕棿锛屾墽琛屽彂閫?      console.log(`[鍚屾浜哄姏瀹氭椂妫€鏌 鍒拌揪鍙戦€佹椂闂?${sendDay}鏃?{sendHour}鏃讹紝寮€濮嬪彂閫?..`);

      // 璁＄畻涓婁釜鏈?      let targetYear = now.getFullYear();
      let targetMonth = now.getMonth();
      if (targetMonth === 0) { targetMonth = 12; targetYear--; }

      const emails = cfg.emails || ['', '', ''];
      const shiftTimes = cfg.shift_times || {
        '鏃╃彮': { start: '09:00', end: '18:00' },
        '鏃ョ彮': { start: '08:30', end: '17:30' },
        '鏅氱彮': { start: '12:00', end: '21:00' },
        '鍏ㄧ彮': { start: '09:00', end: '21:00' },
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
        console.log('[鍚屾浜哄姏瀹氭椂妫€鏌 鏃犳湁鏁堟帓鐝暟鎹紝璺宠繃');
        return;
      }

      const XLSX = require('xlsx-js-style');
      const wb = buildExportWorkbook(excelRows, targetYear, targetMonth);
      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
      const subject = `闄勪欢涓洪攢鍞湇鍔′腑蹇冨鏈嶆潯绾?{targetYear}骞?{targetMonth}鏈堟帓鐝〃锛岃鏌ユ敹`;
      const fileName = `閿€鍞湇鍔′腑蹇冨鏈嶆潯绾?{targetYear}骞?{targetMonth}鏈堟帓鐝〃.xlsx`;

      let sentCount = 0;
      for (let i = 0; i < emails.length; i++) {
        const email = (emails[i] || '').trim();
        if (!email) continue;

        // 闃查噸澶嶏細妫€鏌ユ槸鍚﹀凡鍙戦€?        const logCheck = await query(
          'SELECT id FROM sync_hr_send_log WHERE year = $1 AND month = $2 AND email = $3',
          [targetYear, targetMonth, email]
        );
        if (logCheck.rows.length > 0) {
          console.log(`[鍚屾浜哄姏瀹氭椂妫€鏌 ${email} 鏈湀宸插彂閫侊紝璺宠繃`);
          continue;
        }

        const sendResult = await sendMailWithAttachment(email, subject, subject, buffer, fileName);
        if (sendResult.success) {
          await query(
            'INSERT INTO sync_hr_send_log (year, month, email, sent_at) VALUES ($1, $2, $3, NOW())',
            [targetYear, targetMonth, email]
          );
          sentCount++;
          console.log(`[鍚屾浜哄姏瀹氭椂妫€鏌 宸插彂閫佽嚦 ${email}`);
        } else {
          console.error(`[鍚屾浜哄姏瀹氭椂妫€鏌 鍙戦€佽嚦 ${email} 澶辫触: ${sendResult.error}`);
        }
      }
      console.log(`[鍚屾浜哄姏瀹氭椂妫€鏌 瀹屾垚锛屽叡鍙戦€?${sentCount} 灏乣);
    } catch (err) {
      console.error('[鍚屾浜哄姏瀹氭椂妫€鏌 閿欒:', err.message);
    }
  }, 60 * 60 * 1000); // 姣忓皬鏃?  console.log('[鍚屾浜哄姏] 瀹氭椂妫€鏌ュ凡鍚姩锛堟瘡灏忔椂涓€娆★級');
}

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '鏈櫥褰? });

  const userRow = await query('SELECT is_schedule_admin, is_admin FROM users WHERE id = $1', [userInfo.id]);
  if (!userRow.rows[0] || (!userRow.rows[0].is_schedule_admin && !userRow.rows[0].is_admin)) {
    return res.status(403).json({ error: '鏃犳帓鐝鐞嗘潈闄? });
  }

  // 鑷姩寤鸿〃锛堜笌 manage.js ALTER TABLE 妯″紡涓€鑷达級
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS sync_hr_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        emails JSONB DEFAULT '["","",""]'::jsonb,
        send_day INTEGER DEFAULT 6,
        send_hour INTEGER DEFAULT 10,
        shift_times JSONB DEFAULT '{"鏃╃彮":{"start":"09:00","end":"18:00"},"鏃ョ彮":{"start":"08:30","end":"17:30"},"鏅氱彮":{"start":"12:00","end":"21:00"},"鍏ㄧ彮":{"start":"09:00","end":"21:00"}}'::jsonb,
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
    // 纭繚鏈夐粯璁よ
    await query('INSERT INTO sync_hr_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  } catch (e) {
    console.error('[鍚屾浜哄姏] 寤鸿〃澶辫触:', e.message);
  }

  try {
    // 鈹€鈹€ GET: 鑾峰彇閰嶇疆 + 鍙戦€佺姸鎬?鈹€鈹€
    if (req.method === 'GET') {
      const cfgResult = await query('SELECT emails, send_day, send_hour, shift_times FROM sync_hr_config WHERE id = 1');
      const cfg = cfgResult.rows[0] || { emails: ['', '', ''], send_day: 6, send_hour: 10, shift_times: null };

      const emails = cfg.emails || ['', '', ''];
      const shiftTimes = cfg.shift_times || {
        '鏃╃彮': { start: '09:00', end: '18:00' },
        '鏃ョ彮': { start: '08:30', end: '17:30' },
        '鏅氱彮': { start: '12:00', end: '21:00' },
        '鍏ㄧ彮': { start: '09:00', end: '21:00' },
      };

      // 鏌ュ綋鏈堝悇閭鍙戦€佺姸鎬?      const now = new Date();
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

      // 姣忎釜閭鐨勭姸鎬?      const emailStatus = emails.map((email) => {
        if (!email) return { email: '', sent: false, sentAt: '' };
        const sentAt = logMap[email];
        if (sentAt) {
          const d = new Date(sentAt);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const hh = String(d.getHours()).padStart(2, '0');
          const mi = String(d.getMinutes()).padStart(2, '0');
          return { email, sent: true, sentAt: `${mm}鏈?{dd}鏃?{hh}:${mi}` };
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

    // 鈹€鈹€ PUT: 淇濆瓨閰嶇疆 鈹€鈹€
    if (req.method === 'PUT') {
      const { type } = req.body;

      if (type === 'emails') {
        const { emails } = req.body;
        if (!Array.isArray(emails) || emails.length !== 3) {
          return res.status(400).json({ error: '閭鏍煎紡閿欒' });
        }
        // 鍩烘湰閭鏍煎紡鏍￠獙锛堢┖鍊煎厑璁革級
        const validEmails = emails.map(e => (e || '').trim());
        for (const e of validEmails) {
          if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
            return res.status(400).json({ error: `閭鏍煎紡鏃犳晥: ${e}` });
          }
        }
        await query('UPDATE sync_hr_config SET emails = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(validEmails)]);
        return res.status(200).json({ message: '閭淇濆瓨鎴愬姛' });
      }

      if (type === 'schedule') {
        const { sendDay, sendHour } = req.body;
        const day = parseInt(sendDay);
        const hour = parseInt(sendHour);
        if (isNaN(day) || day < 6 || day > 28) return res.status(400).json({ error: '鏃ユ湡鑼冨洿6-28鏃? });
        if (isNaN(hour) || hour < 9 || hour > 18) return res.status(400).json({ error: '鏃堕棿鑼冨洿9-18鏃? });
        await query('UPDATE sync_hr_config SET send_day = $1, send_hour = $2, updated_at = NOW() WHERE id = 1', [day, hour]);
        return res.status(200).json({ message: '瀹氭椂閰嶇疆淇濆瓨鎴愬姛' });
      }

      if (type === 'shifts') {
        const { shiftTimes } = req.body;
        if (!shiftTimes) return res.status(400).json({ error: '缂哄皯鐝鏃堕棿鏁版嵁' });
        // 鏍￠獙4涓彮娆?        const required = ['鏃╃彮', '鏃ョ彮', '鏅氱彮', '鍏ㄧ彮'];
        for (const key of required) {
          if (!shiftTimes[key] || !shiftTimes[key].start || !shiftTimes[key].end) {
            return res.status(400).json({ error: `缂哄皯鐝鏃堕棿: ${key}` });
          }
        }
        await query('UPDATE sync_hr_config SET shift_times = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(shiftTimes)]);
        return res.status(200).json({ message: '鐝鏃堕棿淇濆瓨鎴愬姛' });
      }

      return res.status(400).json({ error: '鏈煡鐨勯厤缃被鍨? });
    }

    // 鈹€鈹€ POST: 鎵嬪姩鍙戦€?/ 瀵煎嚭Excel鏁版嵁 鈹€鈹€
    if (req.method === 'POST') {
      const { action } = req.body;

      // 鈹€鈹€ 鎵嬪姩鍙戦€侀偖浠?鈹€鈹€
      if (action === 'send') {
        const { emailIndex } = req.body;
        const idx = parseInt(emailIndex);
        if (isNaN(idx) || idx < 0 || idx > 2) {
          return res.status(400).json({ error: '閭搴忓彿鏃犳晥' });
        }

        // 鑾峰彇閰嶇疆
        const cfgResult = await query('SELECT emails, shift_times FROM sync_hr_config WHERE id = 1');
        const cfg = cfgResult.rows[0];
        if (!cfg) return res.status(500).json({ error: '閰嶇疆涓嶅瓨鍦? });

        const emails = cfg.emails || ['', '', ''];
        const targetEmail = (emails[idx] || '').trim();
        if (!targetEmail) return res.status(400).json({ error: '璇ラ偖绠辨湭閰嶇疆' });

        // 璁＄畻涓婁釜鏈堢殑骞存湀
        const now = new Date();
        let targetYear = now.getFullYear();
        let targetMonth = now.getMonth(); // 0-based, 涓婁釜鏈?        if (targetMonth === 0) { targetMonth = 12; targetYear--; }

        // 鑾峰彇鍛樺伐鍒楄〃锛堟寜宸ュ彿鎺掑簭锛?        const empResult = await query(
          'SELECT name, employee_id FROM schedule_employees WHERE is_active = TRUE ORDER BY employee_id ASC'
        );
        if (empResult.rows.length === 0) return res.status(400).json({ error: '鏃犲憳宸ユ暟鎹? });

        // 鑾峰彇鎺掔彮璁板綍
        const recResult = await query(
          `SELECT employee_id, day, shift FROM schedule_records WHERE year = $1 AND month = $2 ORDER BY employee_id ASC, day ASC`,
          [targetYear, targetMonth]
        );
        const recordsMap = {};
        for (const r of recResult.rows) {
          if (!recordsMap[r.employee_id]) recordsMap[r.employee_id] = {};
          recordsMap[r.employee_id][r.day] = r.shift;
        }

        // 鐝鏃堕棿
        const shiftTimes = cfg.shift_times || {
          '鏃╃彮': { start: '09:00', end: '18:00' },
          '鏃ョ彮': { start: '08:30', end: '17:30' },
          '鏅氱彮': { start: '12:00', end: '21:00' },
          '鍏ㄧ彮': { start: '09:00', end: '21:00' },
        };

        // 鐢熸垚Excel鏁版嵁锛堣鏁扮粍锛?        const excelRows = buildExcelRows(empResult.rows, recordsMap, targetYear, targetMonth, shiftTimes);
        if (excelRows.length === 0) {
          return res.status(400).json({ error: '鏃犳湁鏁堟帓鐝暟鎹? });
        }

        // 鐢熸垚Excel鏂囦欢锛圔uffer锛?        const XLSX = require('xlsx-js-style');
        const wb = buildExportWorkbook(excelRows, targetYear, targetMonth);
        const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

        // 閭欢鏍囬鍜屾鏂?        const subject = `闄勪欢涓洪攢鍞湇鍔′腑蹇冨鏈嶆潯绾?{targetYear}骞?{targetMonth}鏈堟帓鐝〃锛岃鏌ユ敹`;
        const html = subject; // 鏍囬鍜屾鏂囦竴鑷?
        // 鍙戦€侀偖浠讹紙甯﹂檮浠?- 浣跨敤 sendMail 鐨勬墿灞曟帴鍙ｏ級
        const sendResult = await sendMailWithAttachment(targetEmail, subject, html, buffer, `閿€鍞湇鍔′腑蹇冨鏈嶆潯绾?{targetYear}骞?{targetMonth}鏈堟帓鐝〃.xlsx`);
        if (!sendResult.success) {
          return res.status(500).json({ error: '鍙戦€佸け璐? ' + sendResult.error });
        }

        // 璁板綍鍙戦€佹棩蹇楋紙UPSERT锛?        await query(
          `INSERT INTO sync_hr_send_log (year, month, email, sent_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT (year, month, email) DO UPDATE SET sent_at = NOW()`,
          [targetYear, targetMonth, targetEmail]
        );

        return res.status(200).json({ message: '鍙戦€佹垚鍔?, to: targetEmail });
      }

      // 鈹€鈹€ 鑾峰彇瀵煎嚭Excel鏁版嵁 鈹€鈹€
      if (action === 'export') {
        const { year: yearStr, month: monthStr } = req.body;
        const year = parseInt(yearStr);
        const month = parseInt(monthStr);
        if (!year || !month) return res.status(400).json({ error: '缂哄皯骞翠唤鎴栨湀浠? });

        // 鑾峰彇閰嶇疆涓殑鐝鏃堕棿
        const cfgResult = await query('SELECT shift_times FROM sync_hr_config WHERE id = 1');
        const shiftTimes = (cfgResult.rows[0] && cfgResult.rows[0].shift_times) || {
          '鏃╃彮': { start: '09:00', end: '18:00' },
          '鏃ョ彮': { start: '08:30', end: '17:30' },
          '鏅氱彮': { start: '12:00', end: '21:00' },
          '鍏ㄧ彮': { start: '09:00', end: '21:00' },
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
          return res.status(400).json({ error: '鏃犳湁鏁堟帓鐝暟鎹? });
        }

        return res.status(200).json({ rows: excelRows, year, month });
      }

      // 鈹€鈹€ 瀹氭椂妫€鏌ワ紙鍐呴儴璋冪敤锛?鈹€鈹€
      if (action === 'check-and-send') {
        return await handleCheckAndSend(req, res);
      }

      return res.status(400).json({ error: '鏈煡鐨勬搷浣? });
    }

    return res.status(405).json({ error: '鏂规硶涓嶅厑璁? });
  } catch (err) {
    console.error('[鍚屾浜哄姏] 鏈嶅姟鍣ㄩ敊璇?', err);
    res.status(500).json({ error: '鏈嶅姟鍣ㄩ敊璇? ' + err.message });
  }
}

// 鈹€鈹€ 鏋勫缓Excel鏁版嵁琛岋紙涓€浜轰竴澶╀竴琛岋紝鍙惈鏃ョ彮/鏃╃彮/鏅氱彮/鍏ㄧ彮锛?鈹€鈹€
function buildExcelRows(employees, recordsMap, year, month, shiftTimes) {
  const days = new Date(year, month, 0).getDate();
  const weekdayNames = ['鏄熸湡鏃?, '鏄熸湡涓€', '鏄熸湡浜?, '鏄熸湡涓?, '鏄熸湡鍥?, '鏄熸湡浜?, '鏄熸湡鍏?];
  const validShifts = ['鏃ョ彮', '鏃╃彮', '鏅氱彮', '鍏ㄧ彮'];

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

// 鈹€鈹€ 鏋勫缓瀵煎嚭宸ヤ綔绨匡紙鏃犳爣棰樿锛岀1琛岃〃澶达紝娣辫摑琛ㄥご+浜ゆ浛琛岃壊锛?鈹€鈹€
function buildExportWorkbook(rows, year, month) {
  const XLSX = require('xlsx-js-style');
  const header = ['搴忓彿', '宸ュ彿', '濮撳悕', '鏃ユ湡', '鏄熸湡', '鐝', '涓婄彮鏃堕棿', '涓嬬彮鏃堕棿'];
  const aoa = [header, ...rows.map(r => [r.seq, r.employeeId, r.name, r.date, r.weekday, r.shift, r.startTime, r.endTime])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }];

  const thinBorder = {
    top: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
    bottom: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
    left: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
    right: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
  };
  // 琛ㄥご鏍峰紡锛氭繁钃濆簳鐧藉瓧
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
  // 鏁版嵁琛岋細浜ゆ浛琛岃壊
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
  XLSX.utils.book_append_sheet(wb, ws, '鎺掔彮琛?);
  return wb;
}

// 鈹€鈹€ 鍙戦€佸甫闄勪欢鐨勯偖浠讹紙閫氳繃閭欢 Worker + SMTP锛?鈹€鈹€
// 褰撳墠 Worker 浠呮敮鎸佺函鏂囨湰/HTML閭欢锛岄檮浠跺姛鑳芥殏涓嶆敮鎸?// 甯﹂檮浠剁殑閭欢鍏堢敤姝ｆ枃鍙戦€佹帓鐝〃 HTML 琛ㄦ牸锛岄檮浠跺姛鑳藉悗缁墿灞?async function sendMailWithAttachment(to, subject, html, attachmentBuffer, attachmentName) {
  const MAIL_WORKER_URL = process.env.MAIL_WORKER_URL || 'https://mail-sender.sh31072163.workers.dev';
  const MAIL_API_KEY = process.env.MAIL_API_KEY || 'mail-sender-secret-key-2026';
  const MAIL_FROM = process.env.MAIL_FROM || 'SH31072163@126.com';

  if (!MAIL_WORKER_URL || !MAIL_API_KEY) {
    console.log('\n========== 鍚屾浜哄姏閭欢锛堝紑鍙戞ā寮?鈥?鏈厤缃?MAIL_WORKER_URL/MAIL_API_KEY锛?=========');
    console.log(`鏀朵欢浜? ${to}`);
    console.log(`涓婚: ${subject}`);
    console.log(`闄勪欢: ${attachmentName} (${attachmentBuffer.length} bytes)`);
    console.log('================================================\n');
    return { success: false, error: '鏈厤缃?MAIL_WORKER_URL 鎴?MAIL_API_KEY' };
  }

  try {
    const mailHtml = `<p>${html}</p><p>锛堟帓鐝〃 Excel 闄勪欢鏆備互閭欢姝ｆ枃褰㈠紡鍙戦€侊紝濡傞渶 Excel 鏂囦欢璇疯仈绯荤鐞嗗憳銆傦級</p>`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(MAIL_WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': MAIL_API_KEY,
      },
      body: JSON.stringify({
        to,
        subject,
        html: mailHtml,
        from: MAIL_FROM,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let errMsg = `Mail Worker 杩斿洖 HTTP ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error) errMsg += `: ${errJson.error}`;
      } catch {
        if (errText) errMsg += `: ${errText.substring(0, 300)}`;
      }
      throw new Error(errMsg);
    }

    console.log(`[鍚屾浜哄姏閭欢宸插彂閫?Worker)] To: ${to}, Subject: ${subject}`);
    return { success: true };
  } catch (err) {
    console.error('[鍚屾浜哄姏] 閭欢鍙戦€佸け璐?', err.message);
    return { success: false, error: err.message };
  }
}

// 鈹€鈹€ 瀹氭椂妫€鏌ュ苟鍙戦€?鈹€鈹€
async function handleCheckAndSend(req, res) {
  const now = new Date();
  const curDay = now.getDate();
  const curHour = now.getHours();

  // 鑾峰彇閰嶇疆
  const cfgResult = await query('SELECT emails, send_day, send_hour, shift_times FROM sync_hr_config WHERE id = 1');
  const cfg = cfgResult.rows[0];
  if (!cfg) return res.status(200).json({ message: '鏃犻厤缃?, sent: false });

  const sendDay = cfg.send_day || 6;
  const sendHour = cfg.send_hour || 10;

  // 鎸夊ぉ妫€鏌?  if (curDay !== sendDay) {
    return res.status(200).json({ message: `浠婂ぉ${curDay}鏃ヤ笉绛変簬閰嶇疆鏃ユ湡${sendDay}鏃ワ紝璺宠繃`, sent: false });
  }
  // 鎸夊皬鏃舵鏌?  if (curHour !== sendHour) {
    return res.status(200).json({ message: `褰撳墠${curHour}鏃朵笉绛変簬閰嶇疆鏃堕棿${sendHour}鏃讹紝璺宠繃`, sent: false });
  }

  // 璁＄畻涓婁釜鏈?  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth(); // 0-based
  if (targetMonth === 0) { targetMonth = 12; targetYear--; }

  const emails = cfg.emails || ['', '', ''];
  const shiftTimes = cfg.shift_times || {
    '鏃╃彮': { start: '09:00', end: '18:00' },
    '鏃ョ彮': { start: '08:30', end: '17:30' },
    '鏅氱彮': { start: '12:00', end: '21:00' },
    '鍏ㄧ彮': { start: '09:00', end: '21:00' },
  };

  // 鑾峰彇鍛樺伐鍜屾帓鐝?  const empResult = await query(
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
    return res.status(200).json({ message: '鏃犳湁鏁堟帓鐝暟鎹?, sent: false });
  }

  const XLSX = require('xlsx-js-style');
  const wb = buildExportWorkbook(excelRows, targetYear, targetMonth);
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const subject = `闄勪欢涓洪攢鍞湇鍔′腑蹇冨鏈嶆潯绾?{targetYear}骞?{targetMonth}鏈堟帓鐝〃锛岃鏌ユ敹`;
  const fileName = `閿€鍞湇鍔′腑蹇冨鏈嶆潯绾?{targetYear}骞?{targetMonth}鏈堟帓鐝〃.xlsx`;

  let sentCount = 0;
  for (let i = 0; i < emails.length; i++) {
    const email = (emails[i] || '').trim();
    if (!email) continue;

    // 妫€鏌ユ槸鍚﹀凡鍙戦€?    const logCheck = await query(
      'SELECT id FROM sync_hr_send_log WHERE year = $1 AND month = $2 AND email = $3',
      [targetYear, targetMonth, email]
    );
    if (logCheck.rows.length > 0) {
      console.log(`[鍚屾浜哄姏] ${email} 鏈湀宸插彂閫侊紝璺宠繃`);
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

  return res.status(200).json({ message: `宸插彂閫?${sentCount} 灏侀偖浠禶, sent: true, sentCount });
}
