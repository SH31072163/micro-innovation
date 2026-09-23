import Head from 'next/head';
import { useState, useEffect, useCallback } from 'react';

/**
 * 排班表大屏 — 独立全屏页面（免登录）
 * 访问地址：/screen
 * - 窗口内铺满（100vh 布局），自适应分辨率（vw 字号）
 * - 1区/4区底部与3区底部水平对齐（以3区底部为准）
 * - 保留「本月/上月」切换（仅限这两个月）
 *
 * 分区：
 * 1区: 员工集体照（全职+兼职卡片墙）
 * 2区: 员工月度排班表（周历式）
 * 3区: 排班数据汇总（12项天数）
 * 4区: 人员汇总信息
 */

// ── 配色（严格复刻v12班表大屏sheet）──
const C = {
  bg: '#0D2137',
  panel: '#13294B',
  panel2: '#10263F',
  cyan: '#00E5FF',
  gold: '#FFD730',
  pureYellow: '#FFFF00',
  white: '#FFFFFF',
  grayText: '#8FB8D8',
  lightText: '#D8E8F0',
  lightCyan: '#7FDBFF',
  fullCard: '#1E3A5F',
  partCard: '#14454A',
  hdrBg: '#0A1929',
  cellBg: '#10263F',
  cellRest: '#0C1F33',
  badgeBg: '#16283F',
  darkText: '#0A1929',
  green: '#00E676',
  red: '#FF5252',
};

const FONT = "'Microsoft YaHei', '微软雅黑', sans-serif";

export default function ScreenPage() {
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

  // 本月/上月（供右上角标签）
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const prevYear = curMonth === 1 ? curYear - 1 : curYear;
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;

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
      const res = await fetch(`/api/schedule/screen-public?year=${y}&month=${m}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '加载失败');
      }
      const d = await res.json();
      setData(d);
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

  if (loading) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.cyan, fontSize: '3vh', fontFamily: FONT, background: C.bg }}>加载中...</div>;
  if (error) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.red, fontSize: '2.4vh', fontFamily: FONT, background: C.bg }}>{error}</div>;
  if (!data) return null;

  const { employees, records, stats, goals, screenData, days } = data;
  const allEmps = [...employees.fullTime, ...employees.partTime];
  const selEmployee = allEmps.find(e => e.employee_id === selEmp);
  const selRecords = (records[selEmp] || {});
  const selStats = stats[selEmp] || {};

  return (
    <div style={{ height: '100vh', width: '100vw', overflowX: 'auto', overflowY: 'hidden', background: C.bg, display: 'flex', flexDirection: 'column', padding: '1.2vh 1.2vw', fontFamily: FONT, color: C.white, boxSizing: 'border-box' }}>
      <Head>
        <title>排班表大屏</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* 顶部标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '1.2vh', flexShrink: 0, width: '100%', minWidth: 'fit-content', position: 'relative' }}>
        <h1 style={{ fontSize: '3vh', fontWeight: 'bold', color: C.cyan, margin: 0, textAlign: 'center' }}>
          销售服务中心{month}月排班表展示区
        </h1>
        <div style={{ position: 'absolute', right: '0', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '1vw' }}>
          <span
            onClick={() => switchTo(curYear, curMonth)}
            style={{
              fontSize: '1.9vh', fontWeight: 'bold', cursor: 'pointer',
              color: (year === curYear && month === curMonth) ? C.pureYellow : C.grayText,
              background: (year === curYear && month === curMonth) ? C.badgeBg : C.panel2,
              padding: '0.3vh 1vw', borderRadius: '4px',
            }}
          >{curMonth}月</span>
          <span
            onClick={() => switchTo(prevYear, prevMonth)}
            style={{
              fontSize: '1.9vh', fontWeight: 'bold', cursor: 'pointer',
              color: (year === prevYear && month === prevMonth) ? C.pureYellow : C.grayText,
              background: (year === prevYear && month === prevMonth) ? C.badgeBg : C.panel2,
              padding: '0.3vh 1vw', borderRadius: '4px',
            }}
          >{prevMonth}月</span>
        </div>
      </div>

      {/* 主体：1区 | 2+3区 | 4区，整体撑满剩余高度；宽度不足时整体横向滚动（内容最小宽度1100px） */}
      <div style={{ display: 'flex', gap: '1vw', flex: 1, minHeight: 0, width: '100%', minWidth: '1100px' }}>
        <Zone1
          employees={employees}
          selEmp={selEmp}
          onSelect={setSelEmp}
          stats={stats}
          goals={goals}
        />
        {/* 中列：2区+3区（决定整体高度基准） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2vh', flex: 1, minWidth: 0 }}>
          <Zone2 employee={selEmployee} records={selRecords} days={days} year={year} month={month} />
          <Zone3 employee={selEmployee} stats={selStats} month={month} />
        </div>
        <Zone4 screenData={screenData} month={month} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// 1区：员工集体照（卡片墙，撑满整列高度，卡片平分）
// ═══════════════════════════════════════════════════
function Zone1({ employees, selEmp, onSelect, stats, goals }) {
  const allCards = [
    ...employees.fullTime.map(e => ({ ...e, isFull: true })),
    ...employees.partTime.map(e => ({ ...e, isFull: false })),
  ];

  return (
    <div style={{ width: '16%', minWidth: '190px', flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ background: C.panel, borderRadius: '6px', padding: '0.8vh 0.6vw', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* 标题：青字 */}
        <div style={{ fontSize: '2.2vh', fontWeight: 'bold', color: C.cyan, marginBottom: '0.8vh', textAlign: 'center', flexShrink: 0 }}>
          员工集体照
        </div>
        {/* 卡片区：flex撑满剩余高度；12人一屏放下，放不下时滚动 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.6vh',
          scrollbarWidth: 'thin', scrollbarColor: C.cyan + '60 ' + C.panel }}>
          {allCards.map((emp) => {
            const isSel = emp.employee_id === selEmp;
            const g = goals[emp.employee_id];
            const target = g ? g.workload : 0;
            return (
              <div key={emp.employee_id}
                onClick={() => onSelect(emp.employee_id)}
                style={{
                  background: emp.isFull ? C.fullCard : C.partCard,
                  borderRadius: '4px',
                  padding: '0.6vh 0.8vw',
                  cursor: 'pointer',
                  flex: allCards.length <= 12 ? '1' : '0 0 auto',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  border: isSel ? `2px solid ${C.cyan}` : '2px solid transparent',
                  transition: 'border-color 0.2s',
                  minHeight: '5vh',
                }}>
                {/* 姓名：白字 */}
                <div style={{ fontSize: '1.9vh', fontWeight: 'bold', color: C.white, textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {emp.name}（{emp.isFull ? '全职' : '兼职'}）
                </div>
                {/* 已完成XX件/目标XX件：全职浅青、兼职金色 */}
                <div style={{ fontSize: '1.6vh', color: emp.isFull ? C.lightCyan : C.gold, textAlign: 'center', whiteSpace: 'nowrap', marginTop: '0.3vh' }}>
                  已完成XX件/目标{target}件
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

  const weeks = [];
  const firstDay = new Date(year, month - 1, 1);
  const firstWeekday = (firstDay.getDay() || 7) - 1;

  let currentDay = 1;
  let week = [];
  for (let i = 0; i < 7; i++) {
    if (i < firstWeekday) week.push(null);
    else week.push(currentDay++);
  }
  weeks.push(week);

  while (currentDay <= days) {
    week = [];
    for (let i = 0; i < 7; i++) {
      if (currentDay <= days) week.push(currentDay++);
      else week.push(null);
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
    <div style={{ background: C.panel, borderRadius: '6px', padding: '0.8vh 0.8vw', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 2区标题：青字 */}
      <div style={{ fontSize: '2.2vh', fontWeight: 'bold', color: C.cyan, marginBottom: '0.6vh', whiteSpace: 'nowrap', overflow: 'hidden', flexShrink: 0 }}>
        员工{month}月度排班表—{empLabel} {hireLabel} 加入销售服务中心 累计处理服务量{cumulative}件
      </div>
      {/* 表头：青底+深色字 */}
      <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
        {weekdays.map((wd, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', padding: '0.5vh 0',
            fontSize: '1.7vh', fontWeight: 'bold',
            color: C.darkText,
            background: C.cyan, borderRadius: '3px',
            border: `1px solid ${C.panel2}`,
            whiteSpace: 'nowrap',
          }}>{wd}</div>
        ))}
      </div>
      {/* 日历行 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', minHeight: 0, marginTop: '2px' }}>
      {weeks.map((wk, wi) => (
        <div key={wi} style={{ display: 'flex', gap: '2px', flex: 1, minHeight: 0 }}>
          {wk.map((day, di) => {
            if (day === null) {
              return <div key={di} style={{ flex: 1, background: 'transparent', borderRadius: '3px' }} />;
            }
            const rec = records[day];
            const isRest = rec && (rec.shift === '休' || rec.shift === '假');
            const amType = rec ? (rec.am_work_type || '').replace('AM', '').trim() : '';
            const pmType = rec ? (rec.pm_work_type || '').replace('PM', '').trim() : '';

            return (
              <div key={di} style={{
                flex: 1,
                background: isRest ? C.cellRest : C.cellBg,
                borderRadius: '3px',
                border: `1px solid ${C.panel2}`,
                padding: '0.3vh 0.4vw',
                fontSize: '1.7vh',
                color: C.lightText,
                lineHeight: '1.35',
                overflow: 'hidden',
              }}>
                {rec ? (
                  <>
                    <div style={{ fontWeight: 'bold', color: C.lightText }}>{day}日</div>
                    <div style={{ whiteSpace: 'nowrap' }}>{rec.shift || ''}</div>
                    <div style={{ whiteSpace: 'nowrap' }}>{rec.meal_time || ''}</div>
                    <div style={{ whiteSpace: 'nowrap' }}>AM{amType}</div>
                    <div style={{ whiteSpace: 'nowrap' }}>PM{pmType}</div>
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
    </div>
  );
}

// ═══════════════════════════════════════════════════
// 3区：排班数据汇总（12项，4列×3行，单行不换行）
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
    <div style={{ background: C.panel, borderRadius: '6px', padding: '0.8vh 0.8vw', flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
      {/* 3区标题：青字 */}
      <div style={{ fontSize: '2.2vh', fontWeight: 'bold', color: C.cyan, marginBottom: '0.6vh', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {month}月 {empLabel}排班数据汇总
      </div>
      {/* 4列×3行网格，每格单行：标签+数值并排、nowrap */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.8vh 0.6vw', flex: 1, alignContent: 'space-evenly' }}>
        {items.map(([label, val], i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4vw',
            whiteSpace: 'nowrap',
          }}>
            <div style={{ fontSize: '1.5vh', color: C.grayText, fontWeight: 'bold', background: C.panel, padding: '0.4vh 0.5vw', borderRadius: '3px', whiteSpace: 'nowrap' }}>{label}</div>
            <div style={{ fontSize: '1.7vh', fontWeight: 'bold', color: C.cyan, background: C.bg, padding: '0.4vh 0.7vw', borderRadius: '3px', whiteSpace: 'nowrap' }}>{val !== undefined ? `${val}天` : 'XX天'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// 4区：人员汇总信息（底部与3区对齐，行距/字号自适应补齐）
// ═══════════════════════════════════════════════════
function Zone4({ screenData, month }) {
  const sd = screenData || {};
  return (
    <div style={{ width: '22%', minWidth: '250px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.8vh', minHeight: 0 }}>
      {/* 标题行：黄字，4区宽度正中 */}
      <div style={{ width: '100%', background: C.panel, borderRadius: '4px', padding: '0.6vh 0', textAlign: 'center', fontSize: '2.2vh', fontWeight: 'bold', color: C.gold, flexShrink: 0 }}>
        人员汇总信息
      </div>

      {/* 两列：全职 | 兼职，撑满剩余高度 */}
      <div style={{ display: 'flex', gap: '0.6vw', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.8vh', minHeight: 0 }}>
          <InfoBlock label={`全职用户接待岗${sd.fullSummary?.count || 0}人`} bold />
          <InfoBlock label="全职每人每日处理" value={sd.fullSummary?.dailyAvg || '-'} renderModeEffect />
          <TOP3Block title="月度TOP3·全职" items={sd.monthTop3Full} color={C.fullCard} isMonth />
          <TOP3Block title="周TOP3·全职" items={sd.weekTop3Full} color={C.fullCard} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.8vh', minHeight: 0 }}>
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
      borderRadius: '4px', padding: '0.6vh 0.6vw',
      textAlign: 'center',
      flexShrink: 0,
    }}>
      {/* bold=XX岗XX人：黄字；普通行：浅色字 */}
      <div style={{ fontSize: bold ? '1.7vh' : '1.35vh', fontWeight: 'bold', color: bold ? C.gold : C.lightText, whiteSpace: 'nowrap' }}>
        {label}
      </div>
      {!bold && renderModeEffect && <div style={{ fontSize: '1.35vh', color: C.lightText, marginTop: '0.3vh', whiteSpace: 'nowrap' }}>人效 = {value || 'XX件'}/（人日）</div>}
      {!bold && !renderModeEffect && <div style={{ fontSize: '1.35vh', color: C.lightText, marginTop: '0.3vh', whiteSpace: 'nowrap' }}>{value}</div>}
    </div>
  );
}

function TOP3Block({ title, items, color, isMonth }) {
  return (
    <div style={{ background: C.panel, borderRadius: '4px', padding: '0.5vh 0.4vw', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, justifyContent: 'space-evenly', gap: '0.3vh' }}>
      {/* 标题：黄底+深色字 */}
      <div style={{ fontSize: '1.7vh', fontWeight: 'bold', color: C.darkText, background: C.gold, padding: '0.4vh 0.6vw', borderRadius: '3px', textAlign: 'center', flexShrink: 0, whiteSpace: 'nowrap' }}>
        {title}
      </div>
      {(items || []).map((item, i) => (
        <div key={i}>
          {isMonth ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{
                  flex: '1', padding: '0.35vh 0.5vw',
                  background: color, borderRadius: '3px',
                  fontSize: '1.6vh', fontWeight: 'bold', color: C.white, textAlign: 'center', whiteSpace: 'nowrap',
                }}>
                  {item.name}
                </div>
                <div style={{
                  flex: '0 0 auto', width: 'fit-content', minWidth: '0', padding: '0.35vh 0.5vw',
                  background: C.bg, borderRadius: '3px',
                  fontSize: '1.45vh', fontWeight: 'bold', color: C.gold, textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}>
                  {item.completed}/{item.target}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '0.3vh' }}>
                <div style={{
                  flex: '1', padding: '0.35vh 0.5vw',
                  background: C.bg, borderRadius: '3px',
                  fontSize: '1.45vh', fontWeight: 'bold', color: C.gold, textAlign: 'center', whiteSpace: 'nowrap',
                }}>
                  {item.progress}
                </div>
                <div style={{
                  flex: '0 0 auto', width: 'fit-content', minWidth: '0', padding: '0.35vh 0.5vw',
                  background: C.bg, borderRadius: '3px',
                  fontSize: '1.2vh', fontWeight: 'bold', textAlign: 'center',
                  color: C.gold, whiteSpace: 'nowrap',
                }}>
                  {item.status}
                </div>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{
                flex: '1', padding: '0.35vh 0.5vw',
                background: color, borderRadius: '3px',
                fontSize: '1.6vh', fontWeight: 'bold', color: C.white, textAlign: 'center', whiteSpace: 'nowrap',
              }}>
                {item.name}
              </div>
              <div style={{
                flex: '0 0 auto', width: 'fit-content', minWidth: '0', padding: '0.35vh 0.5vw',
                background: C.bg, borderRadius: '3px',
                fontSize: '1.45vh', fontWeight: 'bold', color: C.gold, textAlign: 'center',
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
