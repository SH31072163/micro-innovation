import { useState, useEffect, useCallback } from 'react';

/**
 * 排班表大屏 — 深蓝科技风
 * 1区: 员工集体照（全职+兼职卡片墙，可滚动）
 * 2区: 员工月度排班表（周历式）
 * 3区: 排班数据汇总（12项天数，3×4格）
 * 4区: 人员汇总信息（全职/兼职人数+每日处理+月累计+月度TOP3+周TOP3）
 */

// ── 配色（严格复刻v12班表大屏sheet）──
const C = {
  bg: '#0D2137',           // 页面背景（A1标题底色）
  panel: '#13294B',        // 面板底色（各区块标题底）
  panel2: '#10263F',       // 次级面板（排班格/信息条底色）
  cyan: '#00E5FF',         // 青色高亮（标题/数值）
  gold: '#FFD730',         // 金色高亮（人员汇总/TOP3数值）
  pureYellow: '#FFFF00',   // 纯黄（月份徽章 M1）
  white: '#FFFFFF',
  grayText: '#8FB8D8',     // 浅蓝灰文字（A4表头/C26标签）
  lightText: '#D8E8F0',   // 浅色文字（排班格/D每日处理）
  lightCyan: '#7FDBFF',   // 浅青（全职卡完成量）
  fullCard: '#1E3A5F',     // 全职卡片底色
  partCard: '#14454A',     // 兼职卡片底色
  hdrBg: '#0A1929',        // 深底（TOP3空白格/页面暗底）
  cellBg: '#10263F',       // 日历格底色（同 panel2）
  cellRest: '#0C1F33',     // 休息日底色
  badgeBg: '#16283F',      // 月份徽章底色（M1）
  darkText: '#0A1929',     // 深色字（周表头青底上/TOP3标题黄底上）
  green: '#00E676',
  red: '#FF5252',
};

const FONT = "'Microsoft YaHei', '微软雅黑', sans-serif";

export default function ScheduleScreen({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selEmp, setSelEmp] = useState(null);
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);

  // 默认当月
  useEffect(() => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  }, []);

  // 计算本月/上月（供右上角标签）
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  // 上月（跨年处理）
  const prevYear = curMonth === 1 ? curYear - 1 : curYear;
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;

  // 直接切换到指定年月
  const switchTo = (y, m) => {
    setYear(y);
    setMonth(m);
  };

  useEffect(() => {
    if (!year || !month) return;
    fetchData(year, month);
  }, [year, month]);

  const fetchData = async (y, m) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule/screen?year=${y}&month=${m}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '加载失败');
      }
      const d = await res.json();
      setData(d);
      // 默认选中第一个全职员工
      if (d.employees && d.employees.fullTime && d.employees.fullTime.length > 0) {
        setSelEmp(d.employees.fullTime[0].employee_id);
      } else if (d.employees && d.employees.partTime && d.employees.partTime.length > 0) {
        setSelEmp(d.employees.partTime[0].employee_id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: '60px', textAlign: 'center', color: C.cyan, fontSize: '20px', fontFamily: FONT }}>加载中...</div>;
  if (error) return <div style={{ padding: '60px', textAlign: 'center', color: C.red, fontSize: '16px', fontFamily: FONT }}>{error}</div>;
  if (!data) return null;

  const { employees, records, stats, goals, screenData, days } = data;
  const allEmps = [...employees.fullTime, ...employees.partTime];
  const selEmployee = allEmps.find(e => e.employee_id === selEmp);
  const selRecords = (records[selEmp] || {});
  const selStats = stats[selEmp] || {};

  const canPrevMonth = (() => {
    const curKey = curYear * 12 + (curMonth - 1);
    const reqKey = year * 12 + (month - 1);
    return reqKey > curKey - 1; // 只能看上月和本月
  })();
  const canNextMonth = (() => {
    const curKey = curYear * 12 + (curMonth - 1);
    const reqKey = year * 12 + (month - 1);
    return reqKey < curKey; // 不能看次月
  })();

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '16px', fontFamily: FONT, color: C.white, overflowX: 'auto' }}>
      {/* 顶部标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', minWidth: '1200px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: C.cyan, margin: 0 }}>
          销售服务中心{month}月排班表展示区
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* 月份标签：本月+上月，点击切换，选中的高亮（本月在前） */}
          <span
            onClick={() => switchTo(curYear, curMonth)}
            style={{
              fontSize: '16px', fontWeight: 'bold', cursor: 'pointer',
              color: (year === curYear && month === curMonth) ? C.pureYellow : C.grayText,
              background: (year === curYear && month === curMonth) ? C.badgeBg : C.panel2,
              padding: '2px 12px', borderRadius: '4px',
            }}
          >{curMonth}月</span>
          <span
            onClick={() => switchTo(prevYear, prevMonth)}
            style={{
              fontSize: '16px', fontWeight: 'bold', cursor: 'pointer',
              color: (year === prevYear && month === prevMonth) ? C.pureYellow : C.grayText,
              background: (year === prevYear && month === prevMonth) ? C.badgeBg : C.panel2,
              padding: '2px 12px', borderRadius: '4px',
            }}
          >{prevMonth}月</span>
        </div>
      </div>

      {/* 主体区域：左侧1区 + 中间2/3区 + 右侧4区 */}
      <div style={{ display: 'flex', gap: '10px', minWidth: '1200px' }}>
        {/* 1区：员工集体照 */}
        <Zone1
          employees={employees}
          selEmp={selEmp}
          onSelect={setSelEmp}
          stats={stats}
          goals={goals}
        />

        {/* 中间：2区+3区 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
          <Zone2 employee={selEmployee} records={selRecords} days={days} year={year} month={month} />
          <Zone3 employee={selEmployee} stats={selStats} month={month} />
        </div>

        {/* 4区：人员汇总信息 */}
        <Zone4 screenData={screenData} month={month} />
      </div>
    </div>
  );
}

function btnStyle(enabled) {
  return {
    padding: '4px 12px',
    fontSize: '13px',
    fontWeight: 'bold',
    color: enabled ? C.cyan : '#555',
    background: enabled ? C.panel : '#1a1a1a',
    border: `1px solid ${enabled ? C.cyan : '#333'}`,
    borderRadius: '4px',
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}

// ═══════════════════════════════════════════════════
// 1区：员工集体照（卡片墙）
// ═══════════════════════════════════════════════════
function Zone1({ employees, selEmp, onSelect, stats, goals }) {
  const allCards = [
    ...employees.fullTime.map(e => ({ ...e, isFull: true })),
    ...employees.partTime.map(e => ({ ...e, isFull: false })),
  ];

  return (
    <div style={{ width: '260px', flexShrink: 0 }}>
      <div style={{ background: C.panel, borderRadius: '6px', padding: '8px' }}>
        {/* 标题：15号青字 */}
        <div style={{ fontSize: '15px', fontWeight: 'bold', color: C.cyan, marginBottom: '8px', textAlign: 'center' }}>
          员工集体照
        </div>
        {/* 表头：10号浅蓝灰字，底#16283F */}
        <div style={{ fontSize: '10px', color: C.grayText, textAlign: 'center', marginBottom: '8px', background: C.badgeBg, padding: '3px 0', borderRadius: '3px' }}>
          姓名（已完成/目标）
        </div>
        <div style={{ maxHeight: '520px', overflowY: 'auto', paddingRight: '4px',
          scrollbarWidth: 'thin', scrollbarColor: C.cyan + '60 ' + C.panel }}>
          {allCards.map((emp) => {
            const isSel = emp.employee_id === selEmp;
            const g = goals[emp.employee_id];
            const target = g ? `${g.workload}件` : '0件';
            return (
              <div key={emp.employee_id}
                onClick={() => onSelect(emp.employee_id)}
                style={{
                  background: emp.isFull ? C.fullCard : C.partCard,
                  borderRadius: '4px',
                  padding: '6px 8px',
                  marginBottom: '4px',
                  cursor: 'pointer',
                  border: isSel ? `2px solid ${C.cyan}` : '2px solid transparent',
                  transition: 'border-color 0.2s',
                }}>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: C.white }}>
                  {emp.name}（{emp.isFull ? '全职' : '兼职'}）
                </div>
                {/* 全职卡11号浅青字，兼职卡11号金字 */}
                <div style={{ fontSize: '11px', color: emp.isFull ? C.lightCyan : C.gold }}>
                  XX/{target}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// 2区：员工月度排班表（周历式）
// ═══════════════════════════════════════════════════
function Zone2({ employee, records, days, year, month }) {
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  // 计算周历行
  const weeks = [];
  const firstDay = new Date(year, month - 1, 1);
  const firstWeekday = (firstDay.getDay() || 7) - 1; // 0=周一

  let currentDay = 1;
  // 第1周：补空+实际日期
  let week = [];
  for (let i = 0; i < 7; i++) {
    if (i < firstWeekday) {
      week.push(null);
    } else {
      week.push(currentDay++);
    }
  }
  weeks.push(week);

  // 后续周
  while (currentDay <= days) {
    week = [];
    for (let i = 0; i < 7; i++) {
      if (currentDay <= days) {
        week.push(currentDay++);
      } else {
        week.push(null);
      }
    }
    weeks.push(week);
  }

  const empLabel = employee ? `${employee.name}（${(employee.employee_type || '').includes('全职') ? '全职' : '兼职'}）` : '';
  const hireLabel = (() => {
    const hd = employee && employee.hire_date ? employee.hire_date : '';
    if (!hd || hd.length !== 6) return '';
    return `${hd.substring(0, 4)}年${parseInt(hd.substring(4, 6))}月`;
  })();
  const cumulative = employee && employee.cumulativeWorkload !== undefined && employee.cumulativeWorkload !== null ? employee.cumulativeWorkload : 0;

  return (
    <div style={{ background: C.panel, borderRadius: '6px', padding: '8px' }}>
      {/* 2区标题：15号青字 */}
      <div style={{ fontSize: '15px', fontWeight: 'bold', color: C.cyan, marginBottom: '6px' }}>
        员工{month}月度排班表—{empLabel} {hireLabel} 加入销售服务中心 累计处理服务量{cumulative}件
      </div>
      {/* 表头：13号 青底#00E5FF + 深色字#0A1929 */}
      <div style={{ display: 'flex', gap: '2px' }}>
        {weekdays.map((wd, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', padding: '6px 0',
            fontSize: '13px', fontWeight: 'bold',
            color: C.darkText,
            background: C.cyan, borderRadius: '3px',
            border: `1px solid ${C.panel2}`,
          }}>{wd}</div>
        ))}
      </div>
      {/* 日历行：10号浅色字#D8E8F0，日班格底#10263F，休息格底#0C1F33 */}
      {weeks.map((wk, wi) => (
        <div key={wi} style={{ display: 'flex', gap: '2px', marginTop: '2px' }}>
          {wk.map((day, di) => {
            if (day === null) {
              return <div key={di} style={{ flex: 1, minHeight: '60px', background: 'transparent', borderRadius: '3px' }} />;
            }
            const rec = records[day];
            const isRest = rec && (rec.shift === '休' || rec.shift === '假');
            const amType = rec ? (rec.am_work_type || '').replace('AM', '').trim() : '';
            const pmType = rec ? (rec.pm_work_type || '').replace('PM', '').trim() : '';

            return (
              <div key={di} style={{
                flex: 1, minHeight: '60px',
                background: isRest ? C.cellRest : C.cellBg,
                borderRadius: '3px',
                border: `1px solid ${C.panel2}`,
                padding: '3px 4px',
                fontSize: '10px',
                color: C.lightText,
                lineHeight: '1.4',
              }}>
                {rec ? (
                  <>
                    <div style={{ fontWeight: 'bold', color: C.lightText }}>{day}日</div>
                    <div>{rec.shift || ''}</div>
                    <div>{rec.meal_time || ''}</div>
                    <div>AM{amType}</div>
                    <div>PM{pmType}</div>
                  </>
                ) : (
                  <div style={{ fontWeight: 'bold', color: '#555' }}>{day}日</div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// 3区：排班数据汇总（12项天数，3×4格）
// ═══════════════════════════════════════════════════
function Zone3({ employee, stats, month }) {
  const items = [
    ['实际上机天数', stats.onMachineDays],
    ['请假天数', stats.leaveDays],
    ['代值班天数', stats.dutyDays],
    ['语音天数', stats.voiceDays],
    ['文字IM天数', stats.imDays],
    ['外呼天数', stats.outboundDays],
    ['拨测体验天数', stats.testDays],
    ['专项工作天数', stats.specialTaskDays],
    ['工单留邮天数', stats.ticketDays],
    ['早班天数', stats.earlyShiftDays],
    ['晚班天数', stats.lateShiftDays],
    ['日班天数', stats.dayShiftDays],
  ];

  const empLabel = employee ? `${employee.name}（${(employee.employee_type || '').includes('全职') ? '全职' : '兼职'} 用户接待岗）` : '';

  return (
    <div style={{ background: C.panel, borderRadius: '6px', padding: '8px' }}>
      {/* 3区标题：15号青字 */}
      <div style={{ fontSize: '15px', fontWeight: 'bold', color: C.cyan, marginBottom: '6px' }}>
        {month}月 {empLabel}排班数据汇总
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}>
        {items.map(([label, val], i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            padding: '6px 4px',
          }}>
            {/* 标签：12号浅蓝灰字，底#13294B */}
            <div style={{ fontSize: '12px', color: C.grayText, fontWeight: 'bold', background: C.panel, padding: '3px 4px', borderRadius: '3px', textAlign: 'center' }}>{label}</div>
            {/* 数值：14号青字，底#0D2137 */}
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: C.cyan, background: C.bg, padding: '3px 6px', borderRadius: '3px' }}>{val !== undefined ? `${val}天` : 'XX天'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// 4区：人员汇总信息（全职/兼职两列）
// ═══════════════════════════════════════════════════
function Zone4({ screenData, month }) {
  const sd = screenData || {};
  return (
    <div style={{ width: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* 标题行：15号 黄字#FFD730，底#13294B，4区宽度正中 */}
      <div style={{ width: '100%', background: C.panel, borderRadius: '4px', padding: '5px 0', textAlign: 'center', fontSize: '15px', fontWeight: 'bold', color: C.gold }}>
        人员汇总信息
      </div>

      {/* 两列：全职 | 兼职 */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {/* 全职列 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <InfoBlock label={`全职用户接待岗${sd.fullSummary?.count || 0}人`} bold />
          <InfoBlock label="全职每人每日处理" value={sd.fullSummary?.dailyAvg || '-'} renderModeEffect />
          <TOP3Block title={`月度TOP3·全职`} items={sd.monthTop3Full} color={C.fullCard} isMonth />
          <TOP3Block title={`周TOP3·全职`} items={sd.weekTop3Full} color={C.fullCard} />
        </div>
        {/* 兼职列 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <InfoBlock label={`兼职用户接待岗${sd.partSummary?.count || 0}人`} bold />
          <InfoBlock label="兼职每人每日处理" value={sd.partSummary?.dailyAvg || '-'} renderModeEffect />
          <TOP3Block title="月度TOP3·兼职" items={sd.monthTop3Part} color={C.partCard} isMonth />
          <TOP3Block title="周TOP3·兼职" items={sd.weekTop3Part} color={C.partCard} />
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ label, value, bold, renderModeEffect }) {
  return (
    <div style={{
      background: bold ? C.panel : C.panel2,
      borderRadius: '4px', padding: '5px 8px',
      textAlign: 'center',
    }}>
      {/* bold=XX岗XX人行：14号黄字；普通行：11号浅色字#D8E8F0 */}
      <div style={{ fontSize: bold ? '14px' : '11px', fontWeight: 'bold', color: bold ? C.gold : C.lightText }}>
        {label}
      </div>
      {!bold && renderModeEffect && <div style={{ fontSize: '11px', color: C.lightText, marginTop: '2px' }}>人效 = {value || 'XX件'}/（人日）</div>}
      {!bold && !renderModeEffect && <div style={{ fontSize: '11px', color: C.lightText, marginTop: '2px' }}>{value}</div>}
    </div>
  );
}

function TOP3Block({ title, items, color, isMonth }) {
  return (
    <div style={{ background: C.panel, borderRadius: '4px', padding: '4px' }}>
      {/* 标题：11号 黄底#FFD730 + 深色字#0A1929 */}
      <div style={{ fontSize: '11px', fontWeight: 'bold', color: C.darkText, marginBottom: '4px', background: C.gold, padding: '3px 6px', borderRadius: '3px', textAlign: 'center' }}>
        {title}
      </div>
      {(items || []).map((item, i) => (
        <div key={i} style={{ marginBottom: '3px' }}>
          {/* 月度TOP3：两行结构 —— 第1行：姓名+XX/XX件；第2行：XX%+超过/落后时序进度 */}
          {isMonth ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {/* 姓名：14号白字，底随全职/兼职 */}
                <div style={{
                  flex: '1', padding: '3px 6px',
                  background: color, borderRadius: '3px',
                  fontSize: '14px', fontWeight: 'bold', color: C.white, textAlign: 'center',
                }}>
                  {item.name}
                </div>
                {/* XX/XX件：12号黄字深底，不换行 */}
                <div style={{
                  flex: '0 0 auto', minWidth: '88px', padding: '3px 6px',
                  background: C.bg, borderRadius: '3px',
                  fontSize: '12px', fontWeight: 'bold', color: C.gold, textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}>
                  {item.completed}/{item.target}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}>
                {/* XX%：12号黄字深底（左侧与姓名对齐） */}
                <div style={{
                  flex: '1', padding: '3px 6px',
                  background: C.bg, borderRadius: '3px',
                  fontSize: '12px', fontWeight: 'bold', color: C.gold, textAlign: 'center',
                }}>
                  {item.progress}
                </div>
                {/* 超过/落后时序进度：10号黄字深底（右侧与数值对齐） */}
                <div style={{
                  flex: '0 0 80px', padding: '3px 4px',
                  background: C.bg, borderRadius: '3px',
                  fontSize: '10px', fontWeight: 'bold', textAlign: 'center',
                  color: C.gold,
                }}>
                  {item.status}
                </div>
              </div>
            </>
          ) : (
            /* 周TOP3：单行结构 —— 姓名 + XX/XX件，无进度无状态 */
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {/* 姓名：14号白字，底随全职/兼职 */}
              <div style={{
                flex: '1', padding: '3px 6px',
                background: color, borderRadius: '3px',
                fontSize: '14px', fontWeight: 'bold', color: C.white, textAlign: 'center',
              }}>
                {item.name}
              </div>
                {/* XX/XX件：12号黄字深底，不换行 */}
                <div style={{
                  flex: '0 0 auto', minWidth: '88px', padding: '3px 6px',
                  background: C.bg, borderRadius: '3px',
                  fontSize: '12px', fontWeight: 'bold', color: C.gold, textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}>
                  {item.completed}/{item.target}
                </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
