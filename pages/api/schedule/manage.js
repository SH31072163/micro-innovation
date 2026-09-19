import { query, queryBatch } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { sendMail } from '../../../lib/mailer';
import { generateScheduleEmailHTML } from '../../../lib/scheduleEmailTemplate';

/**
 * 鎺掔彮琛ㄧ鐞嗗尯 - 閰嶇疆鎺掔彮 API
 *
 * GET    /api/schedule/manage?year=2026&month=9
 *   鑾峰彇鎸囧畾骞存湀鎺掔彮琛紙绠＄悊鍖虹紪杈戠敤锛屽惈姹囨€荤粺璁★級
 *
 * PUT    /api/schedule/manage
 *   淇濆瓨淇敼鍚庣殑鎺掔彮琛? *   { year, month, records: [{ employee_id, day, shift, meal_time, am_work_type, pm_work_type }] }
 *
 * POST   /api/schedule/manage   { action: 'reschedule', year, month }
 *   閲嶆柊鎺掔彮锛氭牴鎹粯璁よ鍒?13鏉℃帓鐝鍒欒嚜鍔ㄧ敓鎴愭帓鐝? *
 * 闄愬埗锛? * - 浠呬繚鐣欎笂鏈?鏈湀/娆℃湀涓変釜鏈堟暟鎹? * - 鏌愭湀鎺掔彮琛ㄥ湪娆℃湀20鏃ュ悗涓嶅厑璁镐慨鏀? * - 淇濆瓨鍚庡鏈変慨鏀癸紝鏍规嵁閭欢鎻愰啋瑙勫垯鍙戦偖浠? */

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '鏈櫥褰? });

  const userRow = await query('SELECT is_schedule_admin, is_admin FROM users WHERE id = $1', [userInfo.id]);
  if (!userRow.rows[0] || (!userRow.rows[0].is_schedule_admin && !userRow.rows[0].is_admin)) {
    return res.status(403).json({ error: '鏃犳帓鐝鐞嗘潈闄? });
  }

  try {
    // 纭繚 schedule_records 琛ㄥ瓨鍦?remark 瀛楁锛堣嚜鍔ㄨ縼绉伙紝鎵€鏈夎姹傚墠鎵ц锛?    try {
      await query('ALTER TABLE schedule_records ADD COLUMN IF NOT EXISTS remark VARCHAR(150) DEFAULT \'\'');
    } catch (e) {
      console.error('[鎺掔彮] 娣诲姞 remark 瀛楁澶辫触:', e.message);
    }

    // 鈹€鈹€ GET: 鑾峰彇鎺掔彮琛?鈹€鈹€
    if (req.method === 'GET') {
      const { year: yearStr, month: monthStr } = req.query;
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);

      if (!year || !month) return res.status(400).json({ error: '缂哄皯骞翠唤鎴栨湀浠? });

      // 闄愬埗锛氫粎涓婃湀/鏈湀/娆℃湀
      const { allowed, diff } = checkMonthAllowed(year, month);
      if (!allowed) return res.status(403).json({ error: '浠呭彲绠＄悊涓婃湀銆佹湰鏈堝拰娆℃湀鐨勬帓鐝〃' });

      const employees = await query(
        'SELECT name, employee_id, employee_type FROM schedule_employees WHERE is_active = TRUE ORDER BY employee_id ASC'
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

// 妫€鏌ユ槸鍚﹀凡杩囨埅姝㈡棩鏈燂紙娆℃湀5鏃ュ悗涓嶅彲淇敼锛?  const canEdit = checkCanEdit(year, month);

  // 鏄惁鍏佽閲嶆柊鎺掔彮锛堜粎娆℃湀鍏佽锛?  const canReschedule = isNextMonth(year, month);

      // 浜哄憳缁村害13椤规眹鎬荤粺璁★紙姣忎汉褰撴湀缁熻锛?      const personStats = {};
      for (const emp of employees.rows) {
        personStats[emp.employee_id] = computePersonalStatsForEmail(recordsMap[emp.employee_id] || {}, days);
      }

      // 澶╃淮搴?3椤规眹鎬荤粺璁★紙姣忓ぉ鍚勬寚鏍囧湪宀椾汉鏁帮級
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

    // 鈹€鈹€ PUT: 淇濆瓨鎺掔彮琛ㄤ慨鏀?鈹€鈹€
    if (req.method === 'PUT') {
      const { year, month, records } = req.body;
      if (!year || !month) return res.status(400).json({ error: '缂哄皯骞翠唤鎴栨湀浠? });

      // 纭繚 schedule_records 琛ㄥ瓨鍦?remark 瀛楁锛堣嚜鍔ㄨ縼绉伙級
      try {
        await query('ALTER TABLE schedule_records ADD COLUMN IF NOT EXISTS remark VARCHAR(150) DEFAULT \'\'');
      } catch (e) {
        console.error('[鎺掔彮] 娣诲姞 remark 瀛楁澶辫触:', e.message);
      }

      // 妫€鏌ユ槸鍚﹀彲缂栬緫
      const canEdit = checkCanEdit(year, month);
      if (!canEdit) return res.status(403).json({ error: '璇ユ湀鎺掔彮琛ㄥ凡杩囨埅姝㈡棩鏈燂紝涓嶅彲淇敼' });

      // 鑾峰彇鏃ц褰曠敤浜庢瘮瀵?      const oldRecords = await query(
        'SELECT employee_id, day, shift, meal_time, am_work_type, pm_work_type, remark FROM schedule_records WHERE year = $1 AND month = $2',
        [year, month]
      );
      const oldMap = {};
      for (const r of oldRecords.rows) {
        oldMap[`${r.employee_id}_${r.day}`] = r;
      }

      // UPSERT 鏂拌褰曪紙鍒嗘壒澶氳 VALUES锛岄伩鍏嶅瓙璇锋眰瓒呴檺锛?      // 璁板綍鏈夊彉鍖栫殑鍛樺伐
      const changedEmployees = new Set();

      // 鍏堣绠楀彉鍖?      for (const rec of records) {
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

      // 鍒嗘壒澶氳 VALUES UPSERT锛堥伩鍏嶅瓙璇锋眰瓒呴檺锛?      const BATCH_SIZE = 100;
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

      // 娓呯悊瓒呭嚭3涓湀鐨勫巻鍙叉暟鎹?      await cleanupOldRecords();

      // 鈹€鈹€ 濡傛湁淇敼锛屾牴鎹偖浠舵彁閱掕鍒欏彂閭欢 鈹€鈹€
      let emailSentCount = 0;
      if (changedEmployees.size > 0) {
        emailSentCount = await sendAdjustmentEmails(year, month, Array.from(changedEmployees));
      }

      return res.status(200).json({
        message: '淇濆瓨鎴愬姛',
        changedCount: changedEmployees.size,
        changedEmployees: Array.from(changedEmployees),
        emailSentCount,
      });
    }

    // 鈹€鈹€ POST: 閲嶆柊鎺掔彮 鈹€鈹€
    if (req.method === 'POST') {
      const { action, year, month } = req.body;
      if (action !== 'reschedule') return res.status(400).json({ error: '鏈煡鎿嶄綔' });
      if (!year || !month) return res.status(400).json({ error: '缂哄皯骞翠唤鎴栨湀浠? });

      // 纭繚 schedule_records 琛ㄥ瓨鍦?remark 瀛楁锛堣嚜鍔ㄨ縼绉伙級
      try {
        await query('ALTER TABLE schedule_records ADD COLUMN IF NOT EXISTS remark VARCHAR(150) DEFAULT \'\'');
      } catch (e) {
        console.error('[鎺掔彮] 娣诲姞 remark 瀛楁澶辫触:', e.message);
      }

      const canEdit = checkCanEdit(year, month);
      if (!canEdit) return res.status(403).json({ error: '璇ユ湀鎺掔彮琛ㄥ凡杩囨埅姝㈡棩鏈燂紝涓嶅彲閲嶆柊鎺掔彮' });

      // 閲嶆柊鎺掔彮浠呭厑璁搁拡瀵规鏈堬紙鏈湀/涓婃湀涓嶅厑璁搁噸鏂版帓鐝級
      if (!isNextMonth(year, month)) {
        return res.status(403).json({ error: '浠呮鏈堝厑璁搁噸鏂版帓鐝紝鏈湀/涓婃湀鎺掔彮琛ㄤ笉鍙噸鏂版帓鐝? });
      }

      // 鑾峰彇鍛樺伐鍒楄〃
      const employees = await query(
        'SELECT name, employee_id, employee_type FROM schedule_employees WHERE is_active = TRUE ORDER BY employee_id ASC'
      );

      // 鑾峰彇榛樿瑙勫垯
      let rulesResult = await query(
        `SELECT employee_id, default_on_machine_days, allowed_work_types, allowed_weekdays
         FROM schedule_default_rules WHERE year = $1 AND month = $2`,
        [year, month]
      );

      // 鑻ョ洰鏍囨湀鏃犻粯璁よ鍒欙紝鑷姩鍥為€€鍒颁笂鏈堣鍒欙紙淇濊瘉"閲嶆柊鎺掔彮"鍙敤锛?      if (rulesResult.rows.length === 0) {
        const prevKey = year * 12 + (month - 2);
        const prevYear = Math.floor(prevKey / 12);
        const prevMonth = (prevKey % 12) + 1;
        rulesResult = await query(
          `SELECT employee_id, default_on_machine_days, allowed_work_types, allowed_weekdays
           FROM schedule_default_rules WHERE year = $1 AND month = $2`,
          [prevYear, prevMonth]
        );
        if (rulesResult.rows.length > 0) {
          console.log(`[鎺掔彮] ${year}-${month} 鏃犻粯璁よ鍒欙紝宸插洖閫€浣跨敤 ${prevYear}-${prevMonth} 鐨勮鍒檂);
        }
      }

      // 鐩爣鏈堜笌涓婃湀閮芥棤瑙勫垯鏃讹紝鏄庣‘鎶ラ敊锛堥伩鍏嶉潤榛樼敓鎴愮┖鎺掔彮琛級
      if (rulesResult.rows.length === 0) {
        return res.status(400).json({
          error: '璇ユ湀鍙婁笂鏈堝潎鏈厤缃粯璁ゆ帓鐝鍒欙紝璇峰厛鍦?閰嶇疆榛樿瑙勫垯"涓繚瀛樿鍒欏悗鍐嶉噸鏂版帓鐝?,
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

      // 鑾峰彇鍥藉畾鍋囨棩 - 鍙彇鐩爣骞存湀鐨勮褰曪紙閬垮厤鍏朵粬鏈堜唤鍋囨棩姹℃煋鏈湀浼戞伅鏃ラ泦鍚堬級
      let holidaysResult = await query(
        `SELECT date, name, is_holiday FROM schedule_holidays
         WHERE EXTRACT(YEAR FROM date) = $1 AND EXTRACT(MONTH FROM date) = $2`,
        [year, month]
      );

      // 濡傛灉鐩爣鏈堟病鏈夊亣鏃ヨ褰曪紝浠嶢PI鎷夊彇鍏ㄥ勾鍋囨棩锛堣嚜鍔ㄥ叆搴擄級锛屽啀鎸夌洰鏍囨湀杩囨护
      if (holidaysResult.rows.length === 0) {
        try {
          const apiHolidays = await fetchHolidaysFromAPI(year);
          // 鎵归噺鎻掑叆锛堝崟娆TTP璇锋眰锛岄伩鍏嶅瓙璇锋眰瓒呴檺锛?          if (apiHolidays.length > 0) {
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
          // 閲嶆柊鎸夌洰鏍囨湀鏌ヨ
          holidaysResult = await query(
            `SELECT date, name, is_holiday FROM schedule_holidays
             WHERE EXTRACT(YEAR FROM date) = $1 AND EXTRACT(MONTH FROM date) = $2`,
            [year, month]
          );
        } catch (apiErr) {
          console.error('鑾峰彇鑺傚亣鏃ュ畨鎺掑け璐ワ紝灏嗕粎鎸夊懆鏈帓浼?', apiErr.message);
          // API澶辫触鏃朵笉闃绘柇鎺掔彮锛屼粎鎸夊懆鏈帓浼?        }
      }

      const holidaySet = new Set();      // 娉曞畾鍋囨棩锛坕s_holiday=true锛屽綋澶╂斁鍋囷級
      const workdaySet = new Set();      // 璋冧紤涓婄彮鏃ワ紙is_holiday=false锛屽懆鏈渶涓婄彮锛?      for (const h of holidaysResult.rows) {
        const dt = new Date(h.date);
        const d = dt.getDate();
        // 鍙娇鐢ㄧ洰鏍囧勾鏈堢殑鍋囨棩锛堥槻姝㈠叾浠栨湀浠藉亣鏃ョ殑"鍑犲彿"姹℃煋鏈湀浼戞伅鏃ワ級
        if (dt.getFullYear() === year && (dt.getMonth() + 1) === month) {
          if (h.is_holiday) holidaySet.add(d);
          else workdaySet.add(d);
        }
      }

      // 璇诲彇涓婃湀鎺掔彮璁板綍锛岀敤浜庝唬鍊肩彮璺ㄦ湀杩炵画杞祦
      const prevKey = year * 12 + (month - 2);
      const prevYear = Math.floor(prevKey / 12);
      const prevMonth = (prevKey % 12) + 1;
      let lastDutyEmployeeId = null;
      try {
        const prevRecords = await query(
          `SELECT employee_id, day, am_work_type, pm_work_type
           FROM schedule_records
           WHERE year = $1 AND month = $2
             AND (am_work_type LIKE '%浠ｅ€肩彮%' OR pm_work_type LIKE '%浠ｅ€肩彮%')
           ORDER BY day DESC LIMIT 1`,
          [prevYear, prevMonth]
        );
        if (prevRecords.rows.length > 0) {
          lastDutyEmployeeId = prevRecords.rows[0].employee_id;
          console.log(`[鎺掔彮] 涓婃湀鏈€鍚庝唬鐝汉: ${lastDutyEmployeeId}`);
        }
      } catch (e) {
        console.log(`[鎺掔彮] 璇诲彇涓婃湀浠ｇ彮璁板綍澶辫触锛屼粠宸ュ彿鏈€灏忓紑濮? ${e.message}`);
      }

      // 鎵ц鎺掔彮绠楁硶
      const schedule = runScheduleAlgorithm(year, month, employees.rows, rulesMap, holidaySet, workdaySet, lastDutyEmployeeId);

      // 鍒犻櫎鏃ц褰?      await query('DELETE FROM schedule_records WHERE year = $1 AND month = $2', [year, month]);

      // 鎵归噺鎻掑叆鏂拌褰曪紙鍒嗘壒澶氳 VALUES锛岄伩鍏嶅瓙璇锋眰瓒呴檺锛?      // 12浜好?1澶?= 372鏉★紝姣忔壒200鏉″琛孖NSERT锛屽叡2娆″瓙璇锋眰
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

      // 娓呯悊瓒呭嚭3涓湀鐨勫巻鍙叉暟鎹?      await cleanupOldRecords();

      return res.status(200).json({
        message: '閲嶆柊鎺掔彮鎴愬姛',
        totalRecords: schedule.length,
        days: getDaysInMonth(year, month),
      });
    }

    return res.status(405).json({ error: '鏂规硶涓嶅厑璁? });
  } catch (err) {
    console.error('Schedule manage error:', err);
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

/**
 * 璁＄畻鏌愭湀瀹為檯宸ヤ綔鏃ユ暟閲忥紙瑙勫垯11/12鐢級
 * 鏈堝疄闄呭伐浣滄棩 = 褰撴湀澶╂暟 - 娉曞畾浼?- 姝ｅ父鍙屼紤 + 璋冧紤琛ョ彮鏃? * 鍗筹細褰撳ぉ鏃㈤潪娉曞畾鍋囨棩銆佷篃闈烇紙鍛ㄦ湯涓旈潪璋冧紤涓婄彮鏃ワ級鍒欒涓哄伐浣滄棩
 */
function computeActualWorkDays(days, weekdays, holidaySet, workdaySet = new Set()) {
  let count = 0;
  for (let d = 1; d <= days; d++) {
    const wd = weekdays[d - 1];
    // 娉曞畾鍋囨棩锛氫紤鎭?    if (holidaySet.has(d)) continue;
    // 姝ｅ父鍙屼紤锛堝懆鏈笖闈炶皟浼戜笂鐝棩锛夛細浼戞伅
    if (wd > 5 && !workdaySet.has(d)) continue;
    count++;
  }
  return count;
}

/**
 * 瑙勫垯11锛氬吋鑱岀敤鎴锋帴寰呭矖鐨勫憳宸ヤ笂鏈哄ぉ鏁? * 涓婃満澶╂暟 = min(鍚戜笅鍙栨暣(鏈堝疄闄呭伐浣滄棩 / 2), 榛樿涓婃満澶╂暟)
 */
function computePartTimeTargetDays(actualWorkDays, defaultDays) {
  return Math.min(Math.floor(actualWorkDays / 2), defaultDays);
}

/**
 * 瑙勫垯12锛氬叏鑱岀敤鎴锋帴寰呭矖鐨勫憳宸ヤ笂鏈哄ぉ鏁? * 涓婃満澶╂暟 = min(鏈堝疄闄呭伐浣滄棩, 榛樿涓婃満澶╂暟) - 1
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
 * 鍒ゆ柇鏌愭湀鏄惁涓?娆℃湀"锛堢浉瀵瑰綋鍓嶆湀锛? */
function isNextMonth(year, month) {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const curKey = curY * 12 + (curM - 1);
  const reqKey = year * 12 + (month - 1);
  return reqKey === curKey + 1;
}

/**
 * 鏌愭湀鎺掔彮琛ㄥ湪娆℃湀5鏃ュ悗涓嶅厑璁镐慨鏀? */
function checkCanEdit(year, month) {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const curKey = curY * 12 + (curM - 1);
  const reqKey = year * 12 + (month - 1);

  // 濡傛灉鏄笂鏈堢殑鎺掔彮琛紝妫€鏌ユ槸鍚﹀湪娆℃湀5鏃ュ悗
  // 涓婃湀鎺掔彮琛細娆℃湀 = 鏈湀锛?鏃ュ悗涓嶅彲淇敼
  if (reqKey < curKey) {
    // 涓婃湀鎺掔彮锛氬綋鏈湀>5鏃ユ椂涓嶅彲淇敼
    if (now.getDate() > 5) return false;
  }

  return true;
}

/**
 * 娓呯悊瓒呭嚭3涓湀锛堜笂鏈?鏈湀/娆℃湀锛夌殑鍘嗗彶鏁版嵁
 */
async function cleanupOldRecords() {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  // 涓婁笂鏈?= curKey - 2锛屽垹闄?< 涓婁笂鏈堢殑璁板綍
  const cutoffKey = (curY * 12 + (curM - 1)) - 2;
  const cutoffYear = Math.floor(cutoffKey / 12);
  const cutoffMonth = (cutoffKey % 12) + 1;

  await query(
    `DELETE FROM schedule_records WHERE (year * 12 + month - 1) < $1`,
    [cutoffKey]
  );
}

/**
 * 鎺掔彮绠楁硶瀹炵幇锛?3鏉¤鍒欙級
 * holidaySet: 娉曞畾鍋囨棩鏃ユ湡闆嗗悎锛泈orkdaySet: 璋冧紤涓婄彮鏃ラ泦鍚堬紙鍛ㄦ湯浣嗛渶涓婄彮锛? */
function runScheduleAlgorithm(year, month, employees, rulesMap, holidaySet, workdaySet = new Set(), lastDutyEmployeeId = null) {
  const days = getDaysInMonth(year, month);
  const weekdays = getWeekdays(year, month, days);
  const schedule = [];

  // 璁＄畻鏈堝疄闄呭伐浣滄棩锛堣鍒?1/12鐢級
  const actualWorkDays = computeActualWorkDays(days, weekdays, holidaySet, workdaySet);

  // 姣忎釜鍛樺伐鐨勬帓鐝鍒?  const empSchedule = {}; // employee_id -> { day: { shift, meal_time, am, pm } }

  for (const emp of employees) {
    empSchedule[emp.employee_id] = {};
    const rule = rulesMap[emp.employee_id];
    if (!rule) continue;

    // 鈹€鈹€ 瑙勫垯5: 鍏堟妸鍥藉畾鍋囨棩鍜屽弻浼戞棩鏍囦负"浼?锛堣皟浼戜笂鐝棩闄ゅ锛?鈹€鈹€
    for (let d = 1; d <= days; d++) {
      const wd = weekdays[d - 1];
      // 鍛ㄥ叚鍛ㄦ棩涓轰紤锛屼絾濡傛灉璇ユ棩鏄皟浼戜笂鐝棩锛坵orkdaySet锛夊垯鐓у父涓婄彮
      if (holidaySet.has(d) || (wd > 5 && !workdaySet.has(d))) {
        empSchedule[emp.employee_id][d] = {
          shift: '浼?,
          meal_time: '浼?,
          am_work_type: 'AM浼?,
          pm_work_type: 'PM浼?,
        };
      }
    }

    // 鈹€鈹€ 鍒嗛厤涓婃満澶╂暟 鈹€鈹€
    // 瑙勫垯11锛氬吋鑱岀敤鎴锋帴寰呭矖 鈫?min(鍚戜笅鍙栨暣(鏈堝疄闄呭伐浣滄棩/2), 榛樿涓婃満澶╂暟)
    // 瑙勫垯12锛氬叏鑱岀敤鎴锋帴寰呭矖 鈫?min(鏈堝疄闄呭伐浣滄棩, 榛樿涓婃満澶╂暟) - 1
    let targetDays = rule.defaultDays;
    const empType = emp.employee_type || '';
    if (empType === '鍏艰亴鐢ㄦ埛鎺ュ緟宀?) {
      targetDays = computePartTimeTargetDays(actualWorkDays, rule.defaultDays);
    } else if (empType === '鍏ㄨ亴鐢ㄦ埛鎺ュ緟宀?) {
      targetDays = computeFullTimeTargetDays(actualWorkDays, rule.defaultDays);
    }
    // 闃叉鏋佺鎯呭喌鍑虹幇璐熸暟涓婃満澶╂暟
    targetDays = Math.max(0, targetDays);

    const workTypes = rule.workTypes || [];
    const allowedWeekdays = rule.weekdays || [1, 2, 3, 4, 5];

    // 鍙笂鏈虹殑鏃ユ湡锛堟帓闄ゅ凡鏍?浼?鐨勬棩鏈燂紱璋冧紤涓婄彮鏃ュ嵆浣胯惤鍦ㄥ懆鏈篃璁″叆锛?    const availableDays = [];
    for (let d = 1; d <= days; d++) {
      if (empSchedule[emp.employee_id][d]) continue;
      const wd = weekdays[d - 1];
      if (allowedWeekdays.includes(wd) || workdaySet.has(d)) {
        availableDays.push(d);
      }
    }

    // 鈹€鈹€ 瑙勫垯1: 灏介噺璁╀笂鏈哄ぉ鏁板钩鍧囧垎甯冨湪姣忎竴鍛?鈹€鈹€
    const weeks = getWeekRanges(days, weekdays);
    const daysPerWeek = distributeDaysAcrossWeeks(targetDays, weeks, availableDays);

    // 鈹€鈹€ 瑙勫垯2: 姣忎汉鍕鹃€夌殑涓婃満宸ョ鍦ㄦ€讳笂鏈哄ぉ鏁颁腑骞冲潎鍒嗗竷锛堟寜閰嶉鍧囪　卤1澶╋級 鈹€鈹€
    const workTypeAssignment = distributeWorkTypes(targetDays, workTypes);

    // 鈹€鈹€ 瑙勫垯10: 鍏ㄨ亴涓婃満鏃ョ彮娆¤鍒?鈹€鈹€
    // 鍏ㄨ亴鐢ㄦ埛鎺ュ緟宀楋細涓婃満鏃ヤ笉鎺掓棩鐝紝鏀规帓鏃╃彮锛堥粯璁わ級鎴栨櫄鐝紙2澶╋級
    // 鍏艰亴鐢ㄦ埛鎺ュ緟宀楋細涓婃満鏃ヤ繚鎸佹棩鐝?    const isFullTime = empType === '鍏ㄨ亴鐢ㄦ埛鎺ュ緟宀?;

    let typeIndex = 0;
    for (let w = 0; w < weeks.length; w++) {
      const daysInThisWeek = daysPerWeek[w] || 0;
      let assignedThisWeek = 0;
      for (let d = 1; d <= days; d++) {
        if (assignedThisWeek >= daysInThisWeek) break;
        if (empSchedule[emp.employee_id][d]) continue; // 宸叉爣浼?        if (!availableDays.includes(d)) continue;

        // 鍒嗛厤涓婃満
        const wt = workTypeAssignment[typeIndex % workTypeAssignment.length];
        typeIndex++;

        // 鍏ㄨ亴涓婃満鏃ワ細榛樿鏃╃彮锛堟櫄鐝湪绗簩闃舵缁熶竴鏀规淳锛屽彇2涓垎鏁ｆ棩鏈燂級
        const shift = isFullTime ? '鏃╃彮' : '鏃ョ彮';
        const mealTime = isFullTime ? '11:00椁? : '11:30椁?;

        // 鏄犲皠宸ョ
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

    // 鈹€鈹€ 瑙勫垯7: 姣忎綅鍛樺伐涓嶄笂鏈虹殑鏃ュ瓙鍏ㄩ儴瀹夋帓涓撻」宸ヤ綔 鈹€鈹€
    for (let d = 1; d <= days; d++) {
      if (!empSchedule[emp.employee_id][d]) {
        empSchedule[emp.employee_id][d] = {
          shift: '鏃ョ彮',
          meal_time: '11:30椁?,
          am_work_type: 'AM涓撻」宸ヤ綔',
          pm_work_type: 'PM涓撻」宸ヤ綔',
        };
      }
    }
  }

// 鈹€鈹€ 瑙勫垯4锛堢浜岄樁娈碉級: 涓?15澶╀笂鏈哄憳宸ュ悇鍒嗛厤2涓櫄鐝?鈹€鈹€
  // 鏅氱彮涓嶅崰鐢ㄤ笂鍕ゅぉ鏁帮紙鏅氱彮褰撳ぉ浠嶈涓婃満锛夛紝浠庡凡鍒嗛厤鐨勪笂鏈烘棩涓寫閫?  // 绾︽潫1锛氬悓涓€鍛樺伐2涓櫄鐝敖閲忛棿闅斺墺5澶?  // 绾︽潫2锛氬悓涓€澶╂櫄鐝汉鏁扳墹3锛堥伩鍏嶉泦涓級
  // 绾︽潫3锛氭櫄鐝彧瀹夋帓鍦?浼戞伅鏃ヤ箣鍓嶇殑宸ヤ綔鏃?锛堟鏃ュ繀涓轰紤鎭棩锛岄伩鍏嶆櫄鐝鏃ユ棭鐝?鏃ョ彮鍐茬獊锛?  // 瑙勫垯4鐨勪笂鏈哄ぉ鏁板垽瀹氫笌瑙勫垯11/12淇濇寔涓€鑷达紙鍩轰簬鍛樺伐鍏ㄨ亴/鍏艰亴韬唤璁＄畻鐨勭洰鏍囧ぉ鏁帮級
  const lateShiftEmployees = employees.filter(emp => {
    const rule = rulesMap[emp.employee_id];
    if (!rule) return false;
    let t = rule.defaultDays;
    const empType = emp.employee_type || '';
    if (empType === '鍏艰亴鐢ㄦ埛鎺ュ緟宀?) t = computePartTimeTargetDays(actualWorkDays, rule.defaultDays);
    else if (empType === '鍏ㄨ亴鐢ㄦ埛鎺ュ緟宀?) t = computeFullTimeTargetDays(actualWorkDays, rule.defaultDays);
    return Math.max(0, t) > 15;
  });

  // 浼戞伅鏃ュ垽瀹氾紙涓庤鍒?涓€鑷达級锛氭硶瀹氬亣鏃ワ紝鎴栭潪璋冧紤涓婄彮鏃ョ殑鍛ㄦ湯
  const isRestDayF = (d) => d >= 1 && d <= days && (holidaySet.has(d) || (weekdays[d - 1] > 5 && !workdaySet.has(d)));
  // 鍊欓€夋櫄鐝棩 = 褰撳ぉ鏄伐浣滄棩锛堥潪浼戞伅锛変笖娆℃棩鏄紤鎭棩锛堝鍛ㄤ簲鈫掑懆鍏€佽妭鍋囨棩鍓嶄竴澶╋級
  const lateCandidateDays = [];
  for (let d = 1; d <= days; d++) {
    if (isRestDayF(d)) continue; // 褰撳ぉ涓嶈兘鏄紤鎭棩
    if (d === days) continue; // 鏈堟湯鏈€鍚庝竴澶╋紝娆℃棩涓嶅湪鏈湀锛岃烦杩?    if (isRestDayF(d + 1)) lateCandidateDays.push(d);
  }

  if (lateShiftEmployees.length > 0) {
    // 棰勮绠楁瘡鏃ユ櫄鐝汉鏁帮紙鎸夊憳宸ラ『搴忕疮璁★紝淇濊瘉鍚屼竴澶┾墹3浜猴級
    const dailyLateCount = new Array(days + 1).fill(0);
    const lateEmpOrder = lateShiftEmployees.map(emp => emp.employee_id).sort();

    for (const empId of lateEmpOrder) {
      const empScheduleForEmp = empSchedule[empId];
      if (!empScheduleForEmp) continue;

      // 鍊欓€夋棩鏈燂細璇ュ憳宸ュ綋澶╂湁鐝紙闈炰紤闈炲亣锛夛紝涓旈潪鏅氱彮锛屼笖褰撳ぉ鏅氱彮浜烘暟<3锛屼笖鏄紤鎭棩鍓嶄竴澶?      const candidates = [];
      for (const d of lateCandidateDays) {
        const rec = empScheduleForEmp[d];
        if (!rec || rec.shift === '浼? || rec.shift === '鍋? || rec.shift === '鏅氱彮') continue;
        if (dailyLateCount[d] >= 3) continue;
        candidates.push(d);
      }

      // 浠庡€欓€夋睜涓€?涓敖閲忓垎鏁ｇ殑鏃ユ湡锛堣椽蹇冿細鍙栭棿闅旀渶澶х殑锛?      const chosen = [];
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
          rec.shift = '鏅氱彮';
          rec.meal_time = '17:30椁?;
          // 鏅氱彮褰撳ぉAM/PM宸ョ淇濈暀锛堟櫄鐝互鏅氱彮涓轰富锛屽伐绉嶄繚鐣欏師鍊硷級
          dailyLateCount[d]++;
        }
      }
    }
  }

  // 鈹€鈹€ 瑙勫垯6: 浠ｅ€肩彮鍙湪浼戞伅鏃ワ紝涓斿彧鍦ㄥ彲鎵挎帴"浠ｅ€肩彮"宸ョ鐨勫憳宸ヤ腑鎸夊伐鍙疯法鏈堣繛缁疆娴?鈹€鈹€
  // 浠ｅ€肩彮鍙細鍙戠敓鍦ㄥ浗瀹氬亣鏃ュ拰鍙屼紤鏃ワ紝褰撳ぉ鍙渶1浜鸿礋璐ｅ叏鐝紝鍏朵綑浜轰紤
  // 璺ㄦ湀杩炵画杞祦锛氫粠涓婃湀鏈€鍚庝唬鐝汉鐨勪笅涓€涓汉寮€濮嬶紱涓婃湀鏃犺褰曞垯浠庡伐鍙锋渶灏忓紑濮?  const dutyCandidates = employees.filter(e => {
    const rule = rulesMap[e.employee_id];
    return rule && rule.workTypes && rule.workTypes.includes('浠ｅ€肩彮');
  }).sort((a, b) => a.employee_id.localeCompare(b.employee_id));

  // 纭畾杞祦鐨勮捣濮嬬储寮?  let dutyStartIndex = 0;
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
      // 浼戞伅鏃ワ紝瀹夋帓浠ｅ€肩彮
      if (dutyCandidates.length > 0) {
        const emp = dutyCandidates[dutyIndex % dutyCandidates.length];
        dutyIndex++;
        if (emp && empSchedule[emp.employee_id][d] && empSchedule[emp.employee_id][d].shift === '浼?) {
          empSchedule[emp.employee_id][d] = {
            shift: '鍏ㄧ彮',
            meal_time: '11:30椁?,
            am_work_type: 'AM浠ｅ€肩彮',
            pm_work_type: 'PM浠ｅ€肩彮',
          };
        }
      }
    }
  }

  // 鈹€鈹€ 瑙勫垯9: 姣忓ぉ灏介噺瑕嗙洊鎵€鏈変笂鏈哄伐绉?鈹€鈹€
  // 鏀堕泦鎵€鏈夊憳宸ヤ娇鐢ㄧ殑涓婃満宸ョ绫诲瀷
  // 娉ㄦ剰锛氭帓闄?浠ｅ€肩彮"鈥斺€斾唬鍊肩彮鍙湪浼戞伅鏃ュ嚭鐜帮紙瑙勫垯6锛夛紝
  // 涓嶅睘浜庡伐浣滄棩闇€瑕佽鐩栫殑甯歌宸ョ锛涜嫢绾冲叆浼氬鑷磋鍒?鎶婂伐浣滄棩鍛樺伐
  // 鏀规垚浠ｅ€肩彮銆佸張琚鍒?鍏滃簳鏀瑰洖涓撻」锛屼粠鑰屾竻绌哄叾涓婃満澶╂暟銆?  const allWorkTypes = new Set();
  for (const emp of employees) {
    const rule = rulesMap[emp.employee_id];
    if (rule && rule.workTypes) {
      rule.workTypes.forEach(wt => {
        if (wt !== '浠ｅ€肩彮') allWorkTypes.add(wt);
      });
    }
  }
  const allWorkTypeList = Array.from(allWorkTypes);

  if (allWorkTypeList.length > 1) {
    // 瀵规瘡涓€澶╋紝缁熻褰撳ぉ鍚勫伐绉嶇殑瑕嗙洊鎯呭喌锛屽皾璇曞～琛ョ己澶卞伐绉?    for (let d = 1; d <= days; d++) {
      // 缁熻褰撳ぉ鍚勫伐绉嶇殑鍦ㄥ矖浜烘暟
      const dayCoverage = {}; // workType -> count
      allWorkTypeList.forEach(wt => { dayCoverage[wt] = 0; });

      const dayOnMachineEmps = []; // 褰撳ぉ涓婃満鐨勫憳宸?      for (const emp of employees) {
        const rec = empSchedule[emp.employee_id]?.[d];
        if (rec && rec.shift !== '浼? && rec.shift !== '鍋? &&
            rec.am_work_type && !rec.am_work_type.includes('涓撻」') && !rec.am_work_type.includes('浠ｅ€肩彮') && !rec.am_work_type.includes('浼?)) {
          const wt = rec.am_work_type.replace('AM', '');
          if (dayCoverage[wt] !== undefined) dayCoverage[wt]++;
          dayOnMachineEmps.push({ emp, rec, workType: wt });
        }
      }

      // 鎵惧嚭缂哄け鐨勫伐绉嶏紙褰撳ぉ鍦ㄥ矖浜烘暟涓?鐨勶級
      const missingTypes = allWorkTypeList.filter(wt => dayCoverage[wt] === 0);

      // 灏濊瘯涓烘瘡涓己澶卞伐绉嶆壘涓€涓綋澶╀笂鏈虹殑鍛樺伐鏉ユ壙鎷?      for (const missingWt of missingTypes) {
        if (dayOnMachineEmps.length === 0) break;

        // 浼樺厛鎵撅細璇ュ憳宸ョ殑瑙勫垯涓寘鍚己澶卞伐绉嶃€佷笖褰撳ぉ宸ョ鍦ㄥ綋澶╂湁澶氫綑浜烘墜鐨?        let bestCandidate = null;
        for (const entry of dayOnMachineEmps) {
          const empRule = rulesMap[entry.emp.employee_id];
          if (empRule && empRule.workTypes && empRule.workTypes.includes(missingWt)) {
            // 妫€鏌ヨ鍛樺伐褰撳ぉ宸ョ鍦ㄥ綋澶╂槸鍚︽湁澶氫汉锛?=2锛夛紝閬垮厤鎷嗚蛋鍞竴鐨勪汉鎵?            if (dayCoverage[entry.workType] >= 2) {
              bestCandidate = entry;
              break;
            }
            // 濡傛灉娌℃湁澶氫綑浜烘墜鐨勫€欓€夛紝涔熻褰曚笅鏉ヤ綔涓哄閫?            if (!bestCandidate) bestCandidate = entry;
          }
        }

        if (bestCandidate) {
          // 灏嗚鍛樺伐褰撳ぉ鐨勫伐绉嶆敼涓虹己澶卞伐绉?          const oldWt = bestCandidate.workType;
          dayCoverage[oldWt]--;
          dayCoverage[missingWt]++;
          bestCandidate.rec.am_work_type = `AM${missingWt}`;
          bestCandidate.rec.pm_work_type = `PM${missingWt}`;
          bestCandidate.workType = missingWt;
        }
      }
    }
  }

  // 鈹€鈹€ 瑙勫垯6锛堝己鍒跺厹搴曪級: 浠ｅ€肩彮鍙嚭鐜板湪鍥藉畾鍋囨棩鎴栧弻浼戞棩锛涘叾浣欏伐绉嶄笉鍑虹幇鍦ㄤ紤鎭棩 鈹€鈹€
  // 瑙勫垯6锛氫唬鍊肩彮鍙嚭鐜板湪鍥藉畾鍋囨棩鎴栧弻浼戞棩
  // 瑙勫垯6锛氶櫎浠ｅ€肩彮澶栵紝鍏朵綑宸ョ锛堣闊?宸ュ崟鐣欓偖/IM/璐ㄦ/澶栧懠/鎷ㄦ祴/涓撻」绛夛級涓嶅嚭鐜板湪鍥藉畾鍋囨棩鎴栧弻浼戞棩
  // 娉細璋冧紤涓婄彮鏃ワ紙workdaySet锛屽懆鏈絾闇€涓婄彮锛夎涓哄伐浣滄棩锛屼笉鍙楁湰瑙勫垯绾︽潫
  const isRestDayRule6 = (d) => d >= 1 && d <= days && (holidaySet.has(d) || (weekdays[d - 1] > 5 && !workdaySet.has(d)));
  const isDutyWork = (rec) => rec && ((rec.am_work_type || '').includes('浠ｅ€肩彮') || (rec.pm_work_type || '').includes('浠ｅ€肩彮'));

  for (const empId of Object.keys(empSchedule)) {
    const empData = empSchedule[empId];
    for (let d = 1; d <= days; d++) {
      const rec = empData[d];
      if (!rec) continue;

      if (isDutyWork(rec) && !isRestDayRule6(d)) {
        // 瑙勫垯6锛氫唬鍊肩彮鍑虹幇鍦ㄩ潪浼戞伅鏃?鈫?绾犳涓?鏃ョ彮+涓撻」宸ヤ綔"
        rec.shift = '鏃ョ彮';
        rec.meal_time = '11:30椁?;
        rec.am_work_type = 'AM涓撻」宸ヤ綔';
        rec.pm_work_type = 'PM涓撻」宸ヤ綔';
      }

      if (isRestDayRule6(d) && !isDutyWork(rec) && rec.shift !== '浼?) {
        // 瑙勫垯6锛氫紤鎭棩涓旈潪浠ｅ€肩彮 鈫?寮哄埗鏀逛负"浼?
        rec.shift = '浼?;
        rec.meal_time = '浼?;
        rec.am_work_type = 'AM浼?;
        rec.pm_work_type = 'PM浼?;
      }
    }
  }

  // 鈹€鈹€ 涓婃満澶╂暟鏍℃锛氱‘淇濇瘡浜哄疄闄呬笂鏈哄ぉ鏁扮簿纭瓑浜庣洰鏍囧ぉ鏁?鈹€鈹€
  // 鍦ㄦ墍鏈夎鍒欐墽琛屽畬姣曞悗锛岀粺璁℃瘡浜哄疄闄呬笂鏈哄ぉ鏁帮紝涓庣洰鏍囨瘮杈冨苟鏍℃
  const correctionOnMachineTypes = ['鎷ㄦ祴浣撻獙', '璇煶', '宸ュ崟鐣欓偖', '鏂囧瓧IM', 'IM鏂囧瓧', '澶栧懠璋冪爺', '璐ㄦ'];
  const isOnMachineRec = (rec) => {
    if (!rec) return false;
    const am = (rec.am_work_type || '').replace('AM', '').trim();
    const pm = (rec.pm_work_type || '').replace('PM', '').trim();
    return correctionOnMachineTypes.includes(am) || correctionOnMachineTypes.includes(pm);
  };

  for (const emp of employees) {
    const rule = rulesMap[emp.employee_id];
    if (!rule) continue;

    // 閲嶆柊璁＄畻鐩爣澶╂暟
    let targetDays = rule.defaultDays;
    const empType = emp.employee_type || '';
    if (empType === '鍏艰亴鐢ㄦ埛鎺ュ緟宀?) targetDays = computePartTimeTargetDays(actualWorkDays, rule.defaultDays);
    else if (empType === '鍏ㄨ亴鐢ㄦ埛鎺ュ緟宀?) targetDays = computeFullTimeTargetDays(actualWorkDays, rule.defaultDays);
    targetDays = Math.max(0, targetDays);

    const empData = empSchedule[emp.employee_id];

    // 缁熻瀹為檯涓婃満澶╂暟鍜屽彲琛ュ伩鐨勪笓椤瑰伐浣滄棩
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
      } else if (rec.shift === '鏃ョ彮' && (rec.am_work_type || '').includes('涓撻」')) {
        // 鎺掗櫎鏅氱彮娆℃棩锛堜笉搴旇ˉ鍋垮埌鏅氱彮娆℃棩锛?        const prev = d > 1 ? empData[d - 1] : null;
        const isAfterLate = prev && prev.shift === '鏅氱彮';
        if (!isAfterLate) specialWorkDaysForCompensation.push(d);
      }
    }

    // 鎯呭喌1锛氬疄闄?> 鐩爣 鈫?灏嗗浣欑殑涓婃満鏃ユ敼鍥炰笓椤瑰伐浣?    if (actualOnMachine > targetDays) {
      const excess = actualOnMachine - targetDays;
      let removed = 0;
      // 浼樺厛杩樺師琚鍒?鏀逛负宸ュ崟鐣欓偖鐨勫ぉ
      for (const d of onMachineDaysList) {
        if (removed >= excess) break;
        const rec = empData[d];
        if ((rec.am_work_type || '') === 'AM宸ュ崟鐣欓偖') {
          revertToSpecialWork(rec, empType);
          removed++;
        }
      }
      // 鑻ュ伐鍗曠暀閭笉澶熻繕鍘燂紝杩樺師鏈€鍚庡嚑澶╃殑涓婃満鏃?      if (removed < excess) {
        for (let i = onMachineDaysList.length - 1; i >= 0 && removed < excess; i--) {
          const d = onMachineDaysList[i];
          const rec = empData[d];
          if ((rec.am_work_type || '') === 'AM宸ュ崟鐣欓偖') continue;
          revertToSpecialWork(rec, empType);
          removed++;
        }
      }
    }

    // 鎯呭喌2锛氬疄闄?< 鐩爣 鈫?灏嗕笓椤瑰伐浣滄棩鏀逛负涓婃満
    // 涓ユ牸绾︽潫锛氬彧浣跨敤璇ュ憳宸ュ嬀閫夌殑涓婃満宸ョ锛堜笉鍚唬鍊肩彮锛夛紝鎸夐厤棰濆潎琛¤疆鎹?    if (actualOnMachine < targetDays) {
      const deficit = targetDays - actualOnMachine;
      const workTypes = rule.workTypes.filter(wt => wt !== '浠ｅ€肩彮');
      if (workTypes.length === 0) workTypes.push('璇煶');
      let added = 0;
      for (const d of specialWorkDaysForCompensation) {
        if (added >= deficit) break;
        const rec = empData[d];
        const wt = workTypes[added % workTypes.length];
        rec.am_work_type = `AM${wt}`;
        rec.pm_work_type = `PM${wt}`;
        // 鍏ㄨ亴锛氳ˉ涓婃満鏃ョ彮娆′负鏃╃彮锛涘吋鑱岋細鏃ョ彮
        if (empType === '鍏ㄨ亴鐢ㄦ埛鎺ュ緟宀?) {
          rec.shift = '鏃╃彮';
          rec.meal_time = '11:00椁?;
        } else {
          rec.shift = '鏃ョ彮';
          rec.meal_time = '11:30椁?;
        }
        added++;
      }
    }
  }

  // 鈹€鈹€ 瑙勫垯8锛堟渶缁堟墽琛岋級: 姣忔浼戞伅鏃ュ悗绗竴涓伐浣滄棩鑷冲皯瀹夋帓2浜烘壙鎷?宸ュ崟鐣欓偖" 鈹€鈹€
  // 鏀惧湪鎵€鏈夋牎姝?鍧囪　涔嬪悗鎵ц锛屼繚璇佷笉琚悗缁幆鑺傛敼鍔?  // 涓ユ牸绾︽潫锛氬彧浠庡嬀閫?宸ュ崟鐣欓偖"宸ョ鐨勫憳宸ヤ腑閫夋淳锛堢粷涓嶅垎閰嶆湭鍕鹃€夊伐绉嶏級
  // 浼樺厛閫夊綋澶╁凡涓婃満鐨勫憳宸ユ敼娲惧伐鍗曠暀閭紙涓嶅鍔犱笂鏈哄ぉ鏁帮級锛?  // 鑻ュ綋澶╁凡涓婃満鍛樺伐涓嶈冻2浜猴紝鎵嶄粠涓撻」宸ヤ綔鍛樺伐涓敼娲撅紝骞剁浉搴斿噺灏戝叾1涓笂鏈烘棩锛堜繚鎸佺洰鏍囧ぉ鏁颁笉鍙橈級
  const rule8OnMachineTypes = ['鎷ㄦ祴浣撻獙', '璇煶', '宸ュ崟鐣欓偖', '鏂囧瓧IM', 'IM鏂囧瓧', '澶栧懠璋冪爺', '璐ㄦ'];
  const isRestDay = (d) => d >= 1 && d <= days && (holidaySet.has(d) || (weekdays[d - 1] > 5 && !workdaySet.has(d)));
  // 棰勮绠楁瘡涓嬀閫?宸ュ崟鐣欓偖"鐨勫憳宸ラ泦鍚?  const ticketEligibleEmployees = employees.filter(emp => {
    const rule = rulesMap[emp.employee_id];
    return rule && rule.workTypes && rule.workTypes.includes('宸ュ崟鐣欓偖');
  });

  // 璁板綍鍝簺澶╄瑙勫垯8璁句负宸ュ崟鐣欓偖锛堢敤浜庡悗缁ˉ鍋跨粺璁★級
  const rule8TicketDays = {}; // employee_id -> Set(day)
  const rule8SpecialConverted = {}; // employee_id -> count锛堜粠涓撻」鏃ユ敼娲炬鏁帮紝闇€琛ュ伩鍑忓皯涓婃満锛?  const rule8TicketCount = {}; // employee_id -> 绱琚鍒?瀹夋帓鐨勫伐鍗曠暀閭鏁?  for (const emp of ticketEligibleEmployees) {
    rule8TicketDays[emp.employee_id] = new Set();
    rule8SpecialConverted[emp.employee_id] = 0;
    rule8TicketCount[emp.employee_id] = 0;
  }

  for (let d = 1; d <= days; d++) {
    // 妫€鏌ユ槸鍚︽槸浼戞伅鏃ュ悗鐨勭涓€涓伐浣滄棩锛堣皟浼戜笂鐝棩瑙嗕负宸ヤ綔鏃ワ級
    if (d > 1 && isRestDay(d - 1) && !isRestDay(d)) {
      let ticketCount = 0;
      // 绗竴杞細浼樺厛閫夊綋澶╁凡涓婃満鐨勫憳宸ワ紙涓斿繀椤诲嬀閫夊伐鍗曠暀閭級锛?      // 骞舵寜"绱宸ュ崟鏁版渶灏戜紭鍏?鎺掑簭锛屽疄鐜板伐鍗曠暀閭湪鍛樺伐闂村垎鏁?      const onMachineEligible = ticketEligibleEmployees
        .filter(emp => {
          const dayRecord = empSchedule[emp.employee_id]?.[d];
          if (!dayRecord || dayRecord.shift === '浼? || dayRecord.shift === '鍋?) return false;
          const amType = (dayRecord.am_work_type || '').replace('AM', '').trim();
          return rule8OnMachineTypes.includes(amType);
        })
        .sort((a, b) => rule8TicketCount[a.employee_id] - rule8TicketCount[b.employee_id]);
      for (const emp of onMachineEligible) {
        if (ticketCount >= 2) break;
        const dayRecord = empSchedule[emp.employee_id][d];
        dayRecord.am_work_type = 'AM宸ュ崟鐣欓偖';
        dayRecord.pm_work_type = 'PM宸ュ崟鐣欓偖';
        rule8TicketDays[emp.employee_id].add(d);
        rule8TicketCount[emp.employee_id]++;
        ticketCount++;
      }
      // 绗簩杞細褰撳ぉ涓婃満鍛樺伐涓嶈冻2浜烘椂锛屾墠閫変笓椤瑰伐浣滃憳宸ワ紙鍚屾牱蹇呴』鍕鹃€夊伐鍗曠暀閭紝鎸夌疮璁″伐鍗曟暟鎺掑簭锛?      const specialEligible = ticketEligibleEmployees
        .filter(emp => {
          const dayRecord = empSchedule[emp.employee_id]?.[d];
          if (!dayRecord || dayRecord.shift === '浼? || dayRecord.shift === '鍋?) return false;
          const amType = (dayRecord.am_work_type || '').replace('AM', '').trim();
          return !rule8OnMachineTypes.includes(amType) && amType !== '浼?;
        })
        .sort((a, b) => rule8TicketCount[a.employee_id] - rule8TicketCount[b.employee_id]);
      for (const emp of specialEligible) {
        if (ticketCount >= 2) break;
        const dayRecord = empSchedule[emp.employee_id][d];
        dayRecord.am_work_type = 'AM宸ュ崟鐣欓偖';
        dayRecord.pm_work_type = 'PM宸ュ崟鐣欓偖';
        rule8TicketDays[emp.employee_id].add(d);
        rule8SpecialConverted[emp.employee_id]++;
        rule8TicketCount[emp.employee_id]++;
        ticketCount++;
      }
    }
  }

  // 鈹€鈹€ 瑙勫垯8琛ュ伩锛氬"涓撻」鏀瑰伐鍗曠暀閭?鐨勫憳宸ワ紝浠庡叾浠栦笂鏈烘棩绉昏蛋鐩稿悓鏁伴噺鐨勪笂鏈猴紝淇濇寔鎬讳笂鏈哄ぉ鏁颁笉鍙?鈹€鈹€
  // 浠呭湪鍏ㄨ亴/鍏艰亴鐩爣澶╂暟宸茬簿纭殑鍓嶆彁涓嬶紝涓撻」鏃ヨ鏀逛负宸ュ崟鐣欓偖浼氫娇涓婃満+1锛?  // 鍥犳蹇呴』浠庤鍛樺伐鐨勫叾浠栦笂鏈烘棩涓敼鍥炵浉鍚屾暟閲忕殑涓撻」鏃ワ紝纭繚鎬讳笂鏈哄ぉ鏁颁笉鍙樸€?  for (const emp of ticketEligibleEmployees) {
    const rule = rulesMap[emp.employee_id];
    if (!rule) continue;
    const empType = emp.employee_type || '';
    const empData = empSchedule[emp.employee_id];
    const convertCount = rule8SpecialConverted[emp.employee_id];
    if (!empData || convertCount === 0) continue;

    // 鏀堕泦璇ュ憳宸ュ彲琛ュ伩鐨勪笂鏈烘棩锛堥潪瑙勫垯8鏃ャ€侀潪鏅氱彮銆侀潪鏅氱彮娆℃棩锛?    const removableDays = [];
    for (let d = 1; d <= days; d++) {
      if (rule8TicketDays[emp.employee_id].has(d)) continue;
      const rec = empData[d];
      if (!rec) continue;
      const isRest = holidaySet.has(d) || (weekdays[d - 1] > 5 && !workdaySet.has(d));
      if (isRest) continue;
      const am = (rec.am_work_type || '').replace('AM', '').trim();
      if (!rule8OnMachineTypes.includes(am)) continue; // 涓嶆槸涓婃満鏃?      if (rec.shift === '鏅氱彮') continue; // 涓嶇Щ鍔ㄦ櫄鐝棩
      const prev = d > 1 ? empData[d - 1] : null;
      if (prev && prev.shift === '鏅氱彮') continue; // 涓嶇Щ鍔ㄦ櫄鐝鏃?      removableDays.push(d);
    }

    // 浠庡悗寰€鍓嶇Щ璧颁笂鏈烘棩锛屾敼鍥炰笓椤癸紙涓嶆櫄鐝鎺ョ殑浼樺厛锛?    let removed = 0;
    for (let i = removableDays.length - 1; i >= 0 && removed < convertCount; i--) {
      const d = removableDays[i];
      const rec = empData[d];
      // 浼樺厛绉诲姩"鏃ョ彮"锛堥潪鏃?鏅氱彮锛夛紝閬垮厤褰卞搷鍏ㄨ亴鏃╃彮鑺傚锛涘叏鑱屼笓椤规棩涓烘棩鐝?      if (rec.shift === '鏅氱彮') continue;
      revertToSpecialWork(rec, empType);
      removed++;
    }
  }

  // 鈹€鈹€ 涓婃満宸ョ閰嶉鍧囪　鏍℃锛堣鍒?寮哄寲锛屽湪瑙勫垯8涔嬪悗鎵ц锛?鈹€鈹€
  // 瀵规瘡涓憳宸ョ粺璁″悇鍕鹃€夊伐绉嶇殑瀹為檯涓婃満澶╂暟锛屼笌鐞嗚閰嶉锛圱/N锛屽厑璁嘎?澶╋級姣旇緝锛?  // 鑻ュ亸宸秴闄愬垯閫氳繃浜ゆ崲瀹炵幇鍧囪　銆備弗鏍肩害鏉燂細
  //   1) 浜ゆ崲鍙湪璇ュ憳宸ュ嬀閫夊伐绉嶄箣闂磋繘琛岋紱
  //   2) 璺宠繃瑙勫垯8璁剧疆鐨?宸ュ崟鐣欓偖"鏃ワ紙淇濊瘉浼戞伅鏃ュ悗棣栨棩鈮?浜哄伐鍗曠暀閭笉琚牬鍧忥級锛?  //   3) 璺宠繃鏅氱彮鏃ヤ笌鏅氱彮娆℃棩锛堥伩鍏嶇牬鍧忔櫄鐝鎺ワ級銆?  for (const emp of employees) {
    const rule = rulesMap[emp.employee_id];
    if (!rule) continue;
    const empType = emp.employee_type || '';
    const workTypes = rule.workTypes.filter(wt => wt !== '浠ｅ€肩彮');
    if (workTypes.length <= 1) continue;

    const empData = empSchedule[emp.employee_id];

    // 缁熻鍚勫伐绉嶅ぉ鏁颁笌鎵€灞炴棩鏈?    const typeCount = {};
    const typeDays = {};
    for (const wt of workTypes) { typeCount[wt] = 0; typeDays[wt] = []; }
    let totalOnMachine = 0;
    for (let d = 1; d <= days; d++) {
      const rec = empData[d];
      if (!rec) continue;
      const isRest = holidaySet.has(d) || (weekdays[d - 1] > 5 && !workdaySet.has(d));
      if (isRest) continue;
      const am = (rec.am_work_type || '').replace('AM', '').trim();
      if (typeCount[am] !== undefined && am !== '涓撻」宸ヤ綔') {
        typeCount[am]++;
        typeDays[am].push(d);
        totalOnMachine++;
      }
    }

    // 鐞嗚閰嶉
    const base = Math.floor(totalOnMachine / workTypes.length);
    const rem = totalOnMachine % workTypes.length;
    const quota = {};
    workTypes.forEach((wt, i) => { quota[wt] = base + (i < rem ? 1 : 0); });

    // 鎵惧嚭瓒呭嚭閰嶉锛?鍩哄噯+1锛夌殑宸ョ锛堝彲璁╁嚭锛夊拰涓嶈冻閰嶉锛?鍩哄噯-1锛夌殑宸ョ锛堥渶瑕佽ˉ鍏咃級
    // 鍒ゅ畾閲囩敤"鍩哄噯卤1"锛歜ase = floor(T/N)锛屽厑璁稿悇宸ョ鍦?[base-1, base+1] 鍐呮诞鍔?    let overTypes = workTypes.filter(wt => typeCount[wt] > base + 1);
    let underTypes = workTypes.filter(wt => typeCount[wt] < base - 1);
    // 鍗曟棩浜ゆ崲杩唬鍧囪　锛堟渶澶?0杞紝閬垮厤姝诲惊鐜級
    // 浜ゆ崲鐩爣锛氫粠 overTypes 涓彇涓€涓紝鎶婂叾1澶╂敼涓?underTypes 鎴?灏氬湪鍩哄噯鍐呬絾浣庝簬鍩哄噯"鐨勫伐绉?    for (let round = 0; round < 30 && overTypes.length > 0; round++) {
      const fromWt = overTypes[0];
      // 鐩爣宸ョ锛氫紭鍏堜笉瓒筹紙<鍩哄噯-1锛夛紝鍏舵浣庝簬鍩哄噯锛?鍩哄噯锛?      let toWt = underTypes[0] || workTypes.find(wt => typeCount[wt] < base);
      if (!toWt) break;
      // 鎵句竴涓?fromWt 鐨勫ぉ锛氶潪瑙勫垯8宸ュ崟鏃ャ€侀潪鏅氱彮銆侀潪鏅氱彮娆℃棩
      let swapDay = null;
      for (const d of typeDays[fromWt]) {
        const rec = empData[d];
        if (rule8TicketDays[emp.employee_id] && rule8TicketDays[emp.employee_id].has(d)) continue; // 瑙勫垯8淇濇姢
        if (rec && rec.shift === '鏅氱彮') continue; // 淇濈暀鏅氱彮鏃ユ湡
        const prev = d > 1 ? empData[d - 1] : null;
        if (prev && prev.shift === '鏅氱彮') continue; // 涓嶇牬鍧忔櫄鐝鎺?        swapDay = d;
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
      // 閲嶆柊璁＄畻瓒?涓嶈冻
      overTypes = workTypes.filter(wt => typeCount[wt] > base + 1);
      underTypes = workTypes.filter(wt => typeCount[wt] < base - 1);
    }
  }

  // 杞崲涓鸿緭鍑烘牸寮?  for (const emp of employees) {
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
 * 鑾峰彇姣忓懆鐨勬棩鏈熻寖鍥? */
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
 * 灏嗕笂鏈烘棩鏀瑰洖涓撻」宸ヤ綔锛屽苟鎸夊憳宸ョ被鍨嬭缃彮娆? * 鍏ㄨ亴锛氫笓椤瑰伐浣滄棩涓?鏃ョ彮"锛涘吋鑱岋細鏃ョ彮
 */
function revertToSpecialWork(rec, empType) {
  rec.am_work_type = 'AM涓撻」宸ヤ綔';
  rec.pm_work_type = 'PM涓撻」宸ヤ綔';
  rec.shift = '鏃ョ彮';
  rec.meal_time = '11:30椁?;
}

/**
 * 灏嗕笂鏈哄ぉ鏁板钩鍧囧垎閰嶅埌姣忓懆
 */
function distributeDaysAcrossWeeks(totalDays, weeks, availableDays) {
  const numWeeks = weeks.length;
  const result = new Array(numWeeks).fill(0);
  const base = Math.floor(totalDays / numWeeks);
  const remainder = totalDays % numWeeks;

  for (let i = 0; i < numWeeks; i++) {
    result[i] = base + (i < remainder ? 1 : 0);
  }

  // 纭繚姣忓懆鍒嗛厤鐨勫ぉ鏁颁笉瓒呰繃璇ュ懆鍙敤澶╂暟
  for (let i = 0; i < numWeeks; i++) {
    const weekDays = weeks[i].filter(d => availableDays.includes(d));
    if (result[i] > weekDays.length) {
      let overflow = result[i] - weekDays.length;
      result[i] = weekDays.length;
      // 灏嗘孩鍑虹殑澶╂暟鍒嗛厤鍒板叾浠栧懆锛堥亶鍘嗘墍鏈夊懆锛岀洿鍒版孩鍑哄叏閮ㄥ惛鏀讹級
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
 * 灏嗗伐绉嶅钩鍧囧垎閰嶅埌涓婃満澶╂暟锛堣鍒?锛氳椽蹇?鍥炴函锛屽敖閲忛伩鍏嶅悓涓€宸ョ杩炵画3澶╋級
 * 绛栫暐锛氬厛鎸夋瘮渚嬬敓鎴愬悇宸ョ鐨勫熀纭€鏁伴噺锛岀劧鍚庨€愪綅璐績濉厖鈥斺€? *   姣忔鏀惧叆鍓嶆鏌ュ墠2澶╂槸鍚﹀凡鏄悓涓€宸ョ锛岃嫢鏄垯灏濊瘯鎹㈠叾浠栧伐绉嶏紱
 *   鑻ユ墍鏈夊伐绉嶉兘宸茬敤灏戒綑閲忔垨閮芥棤娉曟斁鍏ワ紝鍒欎繚鐣欏綋鍓嶉€夋嫨锛堟渶灏忓寲杩炵画澶╂暟锛夈€? *   鏈€鍚庨€氳繃鍥炴函妫€鏌ヤ慨姝ｄ粛瀛樺湪鐨勮繛缁?澶╋紙灏介噺灏嗙3澶╂崲涓哄叾浠栨湁浣欓噺鐨勫伐绉嶏級銆? */
function distributeWorkTypes(totalDays, workTypes) {
  if (!workTypes.length) return ['璇煶'];
  if (workTypes.length === 1) return new Array(totalDays).fill(workTypes[0]);

  // 璁＄畻姣忕宸ョ鐨勭洰鏍囨暟閲?  const base = Math.floor(totalDays / workTypes.length);
  const remainder = totalDays % workTypes.length;
  const quota = {};      // 宸ョ -> 鍓╀綑閰嶉
  const initialQuota = {};
  workTypes.forEach((wt, i) => {
    quota[wt] = base + (i < remainder ? 1 : 0);
    initialQuota[wt] = quota[wt];
  });

  const result = new Array(totalDays);

  // 绗竴杞細璐績濉厖
  for (let i = 0; i < totalDays; i++) {
    // 妫€鏌ュ墠2澶╂槸鍚﹀悓宸ョ
    const prev1 = i >= 1 ? result[i - 1] : null;
    const prev2 = i >= 2 ? result[i - 2] : null;
    const twoInRow = prev1 && prev2 && prev1 === prev2;

    // 鍊欓€夊伐绉嶏細浼樺厛鏈変綑閲忕殑锛屼笖锛堝鏋滃墠2澶╃浉鍚岋級鎺掗櫎璇ュ伐绉?    let candidates = workTypes.filter(wt => quota[wt] > 0);
    if (twoInRow) {
      const avoid = prev1;
      const preferred = candidates.filter(wt => wt !== avoid);
      if (preferred.length > 0) candidates = preferred;
    }

    // 鍦ㄥ€欓€変腑閫夊墿浣欓厤棰濇渶澶氱殑锛堝潎琛″垎甯冿級
    candidates.sort((a, b) => quota[b] - quota[a]);
    result[i] = candidates.length > 0 ? candidates[0] : prev1;
    if (candidates.length > 0) quota[candidates[0]]--;
  }

  // 绗簩杞細鍥炴函淇杩炵画3澶?  for (let i = 2; i < totalDays; i++) {
    if (result[i] === result[i - 1] && result[i] === result[i - 2]) {
      // 杩炵画3澶╁悓宸ョ锛屽皾璇曟妸绗?澶╂崲鎴愬叾浠栧伐绉?      const current = result[i];
      // 鎵句竴涓叾浠栧伐绉嶆潵鏇挎崲鈥斺€斾紭鍏堜粠鍚庣画浣嶇疆涓壘涓€涓笉鍚屽伐绉嶇殑鏉ヤ氦鎹?      let swapped = false;
      for (let j = i + 1; j < totalDays; j++) {
        if (result[j] !== current && result[j] !== result[i - 1]) {
          // 浜ゆ崲 i 鍜?j
          // 浣嗚纭繚浜ゆ崲鍚?j 浣嶇疆涓嶄細浜х敓鏂扮殑杩炵画3澶?          const jPrev1 = j >= 1 ? result[j - 1] : null;
          const jNext1 = j < totalDays - 1 ? result[j + 1] : null;
          if (jPrev1 !== result[i] && jNext1 !== result[i] &&
              result[i - 1] !== result[i] /* 宸茬‘璁や笉鍚?*/) {
            [result[i], result[j]] = [result[j], result[i]];
            swapped = true;
            break;
          }
        }
      }
      // 濡傛灉鏃犳硶浜ゆ崲锛屼繚鐣欙紙宸叉渶灏忓寲杩炵画锛?    }
  }

  return result;
}

/**
 * 浠庡叕鍏盇PI鑾峰彇褰撳勾鍥藉畾鍋囨棩
 * 浣跨敤 timor.tech API: https://timor.tech/api/holiday/year/{year}
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
      throw new Error('API杩斿洖鏁版嵁鏍煎紡寮傚父');
    }

    const holidays = [];
    for (const [dateStr, info] of Object.entries(data.holiday)) {
      const fullDate = `${year}-${dateStr}`;
      holidays.push({
        date: fullDate,
        name: info.name || '鍋囨棩',
        isHoliday: info.holiday === true,
      });
    }

    return holidays;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 鎺掔彮璋冩暣鍚庡彂閫侀偖浠剁粰鍙楀奖鍝嶅憳宸? * 鏍规嵁閭欢鎻愰啋瑙勫垯涓?rule_type='adjustment_email' 涓?is_enabled=TRUE 鐨勮鍒欏彂閫? * 姣忎綅鍙楀奖鍝嶅憳宸ユ敹鍒板寘鍚畬鏁存帓鐝〃+姹囨€荤粺璁?鏈堝害鐩爣鐨勯偖浠? */
async function sendAdjustmentEmails(year, month, changedEmployeeIds) {
  if (changedEmployeeIds.length === 0) return 0;

  // 妫€鏌ヨ皟鏁存帓鐝偖浠惰鍒欐槸鍚﹀惎鐢?  const emailRules = await query(
    `SELECT title_template FROM schedule_email_rules
     WHERE rule_type = 'adjustment_email' AND is_enabled = TRUE
     ORDER BY seq ASC LIMIT 1`
  );

  if (emailRules.rows.length === 0) {
    console.log('[鎺掔彮閭欢] 璋冩暣鎺掔彮閭欢瑙勫垯鏈惎鐢紝璺宠繃鍙戦€?);
    return 0;
  }

  const titleTemplate = emailRules.rows[0].title_template || '{year}骞磠month}鏈堟帓鐝皟鏁撮€氱煡';

  // 鑾峰彇鍙楀奖鍝嶅憳宸ヤ俊鎭?  const empResult = await query(
    `SELECT name, employee_id, email FROM schedule_employees
     WHERE employee_id = ANY($1) AND email IS NOT NULL AND email != ''`,
    [changedEmployeeIds]
  );

  // 涓€娆℃€ц幏鍙栨墍鏈夊彈褰卞搷鍛樺伐鐨勬帓鐝褰曪紙閬垮厤閫愬憳宸ユ煡璇㈠鑷村瓙璇锋眰瓒呴檺锛?  const allRecsResult = await query(
    `SELECT day, shift, meal_time, am_work_type, pm_work_type, employee_id
     FROM schedule_records
     WHERE year = $1 AND month = $2 AND employee_id = ANY($3)
     ORDER BY employee_id ASC, day ASC`,
    [year, month, changedEmployeeIds]
  );

  // 鎸?employee_id 鍒嗙粍
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

      const mailResult = await sendMail(emp.email, subject, html);
      if (mailResult === false) {
        throw new Error(sendMail.lastError || '鏈煡閿欒');
      }
      sentCount++;
    } catch (err) {
      console.error(`[鎺掔彮閭欢] 鍙戦€佺粰 ${emp.name}(${emp.employee_id}) 澶辫触:`, err.message);
    }
  }

  console.log(`[鎺掔彮閭欢] 璋冩暣鎺掔彮閭欢宸插彂閫?${sentCount}/${empResult.rows.length} 灏乣);
  return sentCount;
}

/**
 * 璁＄畻涓汉鎺掔彮姹囨€荤粺璁★紙鐢ㄤ簬閭欢鍙戦€侊級
 */
function computePersonalStatsForEmail(records, days) {
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

    const onMachineTypes = ['鎷ㄦ祴浣撻獙', '璇煶', '宸ュ崟鐣欓偖', '鏂囧瓧IM', 'IM鏂囧瓧', '澶栧懠璋冪爺', '璐ㄦ'];
    if (onMachineTypes.includes(amType) || onMachineTypes.includes(pmType)) onMachineDays++;
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
 * 澶╃淮搴?3椤规眹鎬荤粺璁★紙姣忓ぉ鍚勬寚鏍囧湪宀椾汉鏁帮級
 * 缁熻缁村害涓庝釜浜烘眹鎬讳繚鎸佷竴鑷达紝杩斿洖 day -> { onMachineDays, leaveDays, voiceDays, ..., dayShiftDays, earlyShiftDays, lateShiftDays }
 * 鍏朵腑 leaveDays 涓哄綋澶╄鍋囦汉鏁帮紝鍏朵綑涓哄綋澶╁悇鎸囨爣浜烘暟
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

      if (rec.shift === '鏃ョ彮') stat.dayShiftDays++;
      else if (rec.shift === '鏃╃彮') stat.earlyShiftDays++;
      else if (rec.shift === '鏅氱彮') stat.lateShiftDays++;

      const amType = (rec.am_work_type || '').replace('AM', '').trim();
      const pmType = (rec.pm_work_type || '').replace('PM', '').trim();

      const onMachineTypes = ['鎷ㄦ祴浣撻獙', '璇煶', '宸ュ崟鐣欓偖', '鏂囧瓧IM', 'IM鏂囧瓧', '澶栧懠璋冪爺', '璐ㄦ'];
      if (onMachineTypes.includes(amType) || onMachineTypes.includes(pmType)) stat.onMachineDays++;
      if (rec.shift === '鍋?) stat.leaveDays++;

      for (const t of [amType, pmType]) {
        if (t === '璇煶') stat.voiceDays += 0.5;
        if (t === '宸ュ崟鐣欓偖') stat.ticketDays += 0.5;
        if (t === '鏂囧瓧IM' || t === 'IM鏂囧瓧') stat.imDays += 0.5;
        if (t === '璐ㄦ') stat.qaDays += 0.5;
        if (t === '澶栧懠璋冪爺') stat.outboundDays += 0.5;
        if (t === '涓撻」宸ヤ綔') stat.specialTaskDays += 0.5;
        if (t === '鎷ㄦ祴浣撻獙') stat.testDays += 0.5;
        if (t === '浠ｅ€肩彮') stat.dutyDays += 0.5;
      }
    }
    dayStats[d] = stat;
  }
  return dayStats;
}

/**
 * 璁＄畻涓汉鏈堝害鐩爣锛堢敤浜庨偖浠跺彂閫侊級
 */
function computePersonalGoalsForEmail(stats) {
  const workload90 = (stats.voiceDays + stats.imDays + stats.ticketDays + stats.outboundDays + stats.qaDays) * 90;
  const workload72 = stats.testDays * 72;
  const workload = workload90 + workload72;

  return {
    workload: `${Math.round(workload)}浠禶,
    voiceMachineTime: `${stats.voiceDays * 7.5}灏忔椂`,
    imMachineTime: `${stats.imDays * 7.5}灏忔椂`,
  };
}
