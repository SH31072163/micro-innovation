import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx-js-style';

/**
 * 配置排班 - 管理区第1个页面
 * - 参照中心排班表排班区域+汇总统计区
 * - 动态天数列
 * - 含"自动排班"按钮（仅次月允许自动排班）
 * - 修改后保存生效
 * - 某月排班记录在次月5日后不可修改
 */
export default function ConfigSchedule({ token }) {
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);
  const [data, setData] = useState(null);
  const [dictData, setDictData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState({}); // employee_id -> day -> { shift, meal_time, am, pm }
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState(''); // 'success' | 'error'
  const [modalEmployee, setModalEmployee] = useState(null); // 弹窗编辑（点击姓名打开）

  const availableMonths = [];
  useEffect(() => {
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    setYear(curY);
    setMonth(curM);
    fetchDict();
  }, []);

  const fetchDict = async () => {
    try {
      const res = await fetch('/api/schedule/dict', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setDictData(await res.json());
    } catch (err) { console.error('获取字典失败:', err); }
  };

  const fetchData = useCallback(async () => {
    if (!year || !month) return;
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch(`/api/schedule/manage?year=${year}&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        // API 返回 days 为数字，转为数组供 .map() 使用
        if (typeof d.days === 'number') {
          d.days = Array.from({ length: d.days }, (_, i) => i + 1);
        }
        setData(d);
        setEditing({});
      }
    } catch (err) {
      console.error('获取排班表失败:', err);
    } finally {
      setLoading(false);
    }
  }, [year, month, token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleReschedule = async () => {
    if (!confirm(`确认对${year}年${month}月进行自动排班？这将覆盖当前排班数据。`)) return;
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/schedule/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'reschedule', year, month }),
      });
      const result = await res.json();
      if (res.ok) {
        const tip = `自动排班成功，共生成 ${result.totalRecords} 条记录`;
        setMsg(tip);
        setMsgType('success');
        alert(tip);
        fetchData();
      } else {
        const tip = result.error || '自动排班失败';
        setMsg(tip);
        setMsgType('error');
        alert(tip);
      }
    } catch (err) {
      setMsg('网络错误');
      setMsgType('error');
      alert('自动排班失败：网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    // 收集所有编辑过的记录（含备注字段）
    const records = [];
    for (const [empId, days] of Object.entries(editing)) {
      for (const [day, val] of Object.entries(days)) {
        records.push({
          employee_id: empId,
          day: parseInt(day),
          shift: val.shift,
          meal_time: val.meal_time,
          am_work_type: val.am_work_type,
          pm_work_type: val.pm_work_type,
          remark: val.remark || '',
        });
      }
    }

    if (records.length === 0) {
      setMsg('没有修改需要保存');
      setMsgType('error');
      alert('没有修改需要保存');
      return;
    }

    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/schedule/manage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ year, month, records }),
      });
      const result = await res.json();
      if (res.ok) {
        const tip = `保存成功${result.changedCount > 0 ? `，${result.changedCount}人排班有变动` : ''}`;
        setMsg(tip);
        setMsgType('success');
        alert(tip);
        setEditing({});
        fetchData();
      } else {
        const tip = result.error || '保存失败';
        setMsg(tip);
        setMsgType('error');
        alert(tip);
      }
    } catch (err) {
      setMsg('网络错误');
      setMsgType('error');
      alert('保存失败：网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setEditing({});
    setMsg('');
  };

  // ── 导出Excel：第1个Sheet完整排班表 + 每员工3个Sheet（排班表/汇总统计/月度目标） ──
  // 为确保导出数据与数据库当前保存的数据一致：存在未保存修改时提示先保存
  const handleExport = () => {
    const hasUnsaved = Object.keys(editing).some((empId) => Object.keys(editing[empId]).length > 0);
    if (hasUnsaved) {
      alert('您有未保存的修改，请先点击"保存"后再导出，以确保导出数据与数据库当前保存的数据一致。');
      return;
    }
    if (!data || data.isEmpty) return;
    const wb = buildWorkbook(data, year, month);
    if (!wb) return;
    XLSX.writeFile(wb, `配置排班表_${year}年${month}月.xlsx`);
  };

  // 获取餐时下拉选项：完整字典
  // 联动规则仅提供默认值（如晚班→17:30餐、休→休），所有格子均支持手工修改
  const getMealTimeOptions = () => (dictData?.['meal_time'] || []);

  // AM→PM工种映射（规则4：选AM语音→PM默认PM语音，但可改）
  const mapAmToPm = (amVal) => {
    if (!amVal) return '';
    return amVal.replace('AM', 'PM');
  };

  // 更新单元格（含联动规则：仅自动填充默认值，不锁定，均支持手工修改）
  // 规则1：班次→餐时联动（晚班→17:30餐、全班→11:30餐、日班/早班→11:30餐默认）
  // 规则2/3：班次假/休→餐时、AM、PM自动填对应值
  // 规则4：AM→PM默认联动（PM被人手改过则不覆盖）
  const updateCell = (empId, day, field, value) => {
    if (!editing[empId]) editing[empId] = {};
    if (!editing[empId][day]) {
      const orig = data.records[empId]?.[day] || {};
      editing[empId][day] = { shift: orig.shift || '', meal_time: orig.meal_time || '', am_work_type: orig.am_work_type || '', pm_work_type: orig.pm_work_type || '', remark: orig.remark || '' };
    }
    const cell = editing[empId][day];
    cell[field] = value;

    // ── 联动规则 ──
    if (field === 'shift') {
      // 规则1：班次→餐时联动
      if (value === '晚班') {
        cell.meal_time = '17:30餐';
      } else if (value === '全班') {
        cell.meal_time = '11:30餐';
      } else if (value === '日班' || value === '早班') {
        // 仅限11:00餐/11:30餐/12:00餐，若当前值不在范围内则默认11:30餐
        if (!['11:00餐', '11:30餐', '12:00餐'].includes(cell.meal_time)) {
          cell.meal_time = '11:30餐';
        }
      }
      // 规则2：班次"假"→其余3格全"假"
      if (value === '假') {
        cell.meal_time = '假';
        cell.am_work_type = 'AM假';
        cell.pm_work_type = 'PM假';
      }
      // 规则3：班次"休"→其余3格全"休"
      if (value === '休') {
        cell.meal_time = '休';
        cell.am_work_type = 'AM休';
        cell.pm_work_type = 'PM休';
      }
    }

    // 规则4：AM工种→PM工种默认联动（仅当PM工种为空或与旧AM匹配时自动填充）
    if (field === 'am_work_type') {
      const currentPm = cell.pm_work_type || '';
      const expectedPm = mapAmToPm(value);
      // 如果PM为空，或PM工种还是之前AM工种对应的PM值（即没被人手改过），则自动联动
      const prevAm = editing[empId][day]._prevAm || '';
      if (!currentPm || currentPm === mapAmToPm(prevAm)) {
        cell.pm_work_type = expectedPm;
      }
      cell._prevAm = value; // 记录当前AM，用于下次判断是否被手动改过
    }

    setEditing({ ...editing });
  };

  // 获取当前显示值（编辑值优先）
  const getCell = (empId, day, field) => {
    if (editing[empId]?.[day]) return editing[empId][day][field] || '';
    return data?.records?.[empId]?.[day]?.[field] || '';
  };

  const weekdayNames = ['', '一', '二', '三', '四', '五', '六', '日'];

  // ── 汇总统计字段定义（与个人弹窗13项一致，短标签用于表头/列） ──
  const SUM_ITEMS = [
    { key: 'onMachineDays', label: '实际上机', labelFull: '实际上机人数' },
    { key: 'leaveDays', label: '请假', labelFull: '请假人数' },
    { key: 'voiceDays', label: '语音', labelFull: '语音人数' },
    { key: 'ticketDays', label: '工单留邮', labelFull: '工单留邮人数' },
    { key: 'imDays', label: 'IM文字', labelFull: 'IM文字人数' },
    { key: 'qaDays', label: '质检', labelFull: '质检人数' },
    { key: 'outboundDays', label: '外呼', labelFull: '外呼人数' },
    { key: 'specialTaskDays', label: '专项', labelFull: '专项人数' },
    { key: 'testDays', label: '拨测', labelFull: '拨测人数' },
    { key: 'dutyDays', label: '代班', labelFull: '代班人数' },
    { key: 'dayShiftDays', label: '日班', labelFull: '日班人数' },
    { key: 'earlyShiftDays', label: '早班', labelFull: '早班人数' },
    { key: 'lateShiftDays', label: '晚班', labelFull: '晚班人数' },
  ];

  // 格式化统计值（去掉多余的 .0，保留 .5）
  const fmtSum = (v) => {
    if (v === null || v === undefined) return '';
    const n = Math.round(v * 10) / 10;
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  };

  // 可选月份
  const getMonths = () => {
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    const months = [];
    for (let i = -1; i <= 1; i++) {
      const key = curY * 12 + (curM - 1) + i;
      months.push({ year: Math.floor(key / 12), month: (key % 12) + 1 });
    }
    return months;
  };

  const months = getMonths();
  const monthLabels = ['上月', '本月', '次月'];

  if (loading && !data) return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;

  return (
    <div>
      {/* 工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {months.map((m, i) => {
            const isActive = year === m.year && month === m.month;
            return (
              <button
                key={i}
                className={isActive ? 'btn-primary' : 'btn-secondary'}
                style={{ padding: '6px 14px', fontSize: '13px' }}
                onClick={() => { setYear(m.year); setMonth(m.month); }}
              >
                {monthLabels[i]} ({m.year}年{m.month}月)
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {data?.canReschedule && (
            <button className="btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }}
              onClick={handleReschedule} disabled={loading}>
              自动排班
            </button>
          )}
          <button className="btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }}
            onClick={handleSave} disabled={loading || !data?.canEdit}>
            保存
          </button>
          <button className="btn-secondary" style={{ padding: '6px 16px', fontSize: '13px' }}
            onClick={handleCancel} disabled={loading}>
            取消
          </button>
          <button className="btn-secondary" style={{ padding: '6px 16px', fontSize: '13px' }}
            onClick={handleExport} disabled={loading || !data || data.isEmpty}>
            导出Excel
          </button>
        </div>
      </div>

      {msg && (
        <div style={{
          padding: '8px 12px', borderRadius: '4px', marginBottom: '16px', fontSize: '13px',
          background: msgType === 'success' ? '#dcfce7' : '#fee2e2',
          color: msgType === 'success' ? '#16a34a' : '#dc2626',
        }}>{msg}</div>
      )}

      {!data?.canEdit && data && (
        <div style={{ padding: '8px 12px', background: '#fffbeb', borderRadius: '4px', marginBottom: '16px', color: '#d97706', fontSize: '13px' }}>
          该月排班表已过截止日期（次月5日后），不可修改
        </div>
      )}

      {data?.isEmpty && (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', background: '#fff', borderRadius: '8px' }}>
          暂无排班数据，请点击"自动排班"生成
        </div>
      )}

      {/* 排班表编辑表格（冻结姓名/工号列 + 日期表头行） */}
      {data && !data.isEmpty && data.employees && data.employees.length > 0 && (
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 280px)', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: '11px', minWidth: 60 + 70 + data.days.length * 65 + 13 * 52 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, boxSizing: 'border-box', position: 'sticky', top: 0, left: 0, zIndex: 30, width: '60px', minWidth: '60px', maxWidth: '60px', height: '52px', padding: '0 8px', background: '#f9fafb' }} rowSpan={2}>姓名</th>
                <th style={{ ...thStyle, boxSizing: 'border-box', position: 'sticky', top: 0, left: '60px', zIndex: 30, width: '70px', minWidth: '70px', maxWidth: '70px', height: '52px', padding: '0 8px', background: '#f9fafb' }} rowSpan={2}>工号</th>
                {data.days.map((_, i) => (
                  <th key={i} style={{ ...thStyle, position: 'sticky', top: 0, zIndex: 20, textAlign: 'center', height: '32px', padding: '0 1px', minWidth: '55px', background: '#f9fafb' }}>
                    {i + 1}日
                  </th>
                ))}
                {/* 人员维度汇总列（最后一天右侧，13列） */}
                {SUM_ITEMS.map((item, i) => (
                  <th key={'sum' + i} style={{ ...thStyle, position: 'sticky', top: 0, zIndex: 20, textAlign: 'center', height: '32px', padding: '0 2px', minWidth: '52px', background: '#eef2ff', color: '#3730a3' }}>{item.label}</th>
                ))}
              </tr>
              <tr>
                {data.weekdays.map((wd, i) => (
                  <th key={i} style={{ ...thStyle, position: 'sticky', top: '32px', zIndex: 20, textAlign: 'center', height: '20px', padding: '0', color: wd > 5 ? '#dc2626' : '#6b7280', fontSize: '9px', background: '#f9fafb' }}>
                    {weekdayNames[wd]}
                  </th>
                ))}
                {/* 汇总区星期占位 */}
                {SUM_ITEMS.map((_, i) => (
                  <th key={'sumwd' + i} style={{ ...thStyle, position: 'sticky', top: '32px', zIndex: 20, textAlign: 'center', height: '20px', padding: '0', fontSize: '9px', background: '#eef2ff', color: '#6366f1' }}>天</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp, empIdx) => {
                // 相邻行浅蓝/白交替底色
                const rowBg = empIdx % 2 === 1 ? '#f0f7ff' : '#ffffff';
                return (
                <tr key={emp.employee_id}>
                  <td style={{ ...tdStyle, boxSizing: 'border-box', position: 'sticky', left: 0, zIndex: 10, width: '60px', minWidth: '60px', maxWidth: '60px', background: rowBg, cursor: 'pointer', color: '#2563eb', textDecoration: 'underline' }}
                    onClick={() => setModalEmployee(emp)}>{emp.name}</td>
                  <td style={{ ...tdStyle, boxSizing: 'border-box', position: 'sticky', left: '60px', zIndex: 10, width: '70px', minWidth: '70px', maxWidth: '70px', background: rowBg, cursor: 'pointer', color: '#2563eb' }}
                    onClick={() => setModalEmployee(emp)}>{emp.employee_id}</td>
                  {data.days.map((_, dayIdx) => {
                    const day = dayIdx + 1;
                    const shiftVal = getCell(emp.employee_id, day, 'shift');
                    const mealVal = getCell(emp.employee_id, day, 'meal_time');
                    const amVal = getCell(emp.employee_id, day, 'am_work_type');
                    const pmVal = getCell(emp.employee_id, day, 'pm_work_type');
                    const isEditing = editing[emp.employee_id]?.[day];
                    // 联动规则仅提供默认值，所有格子均可手工修改（与Excel关联条件一致）
                    const mealOptions = getMealTimeOptions();
                    const amOptions = dictData?.['am_work_type'] || [];
                    const pmOptions = dictData?.['pm_work_type'] || [];
                    return (
                      <td key={dayIdx} style={{ ...tdStyle, padding: '1px', textAlign: 'center', minWidth: '65px', background: isEditing ? '#fffde7' : rowBg }}>
                        {/* 第1个格子：班次 */}
                        <select value={shiftVal}
                          onChange={e => updateCell(emp.employee_id, day, 'shift', e.target.value)}
                          style={{ width: '55px', fontSize: '10px', border: '1px solid #ddd', borderRadius: '2px', padding: '1px 2px', textAlign: 'center' }}>
                          <option value=""></option>
                          {(dictData?.['shift'] || []).map(d => <option key={d.id} value={d.value}>{d.value}</option>)}
                        </select>
                        {/* 第2个格子：餐时（默认联动班次，可手工改） */}
                        <select value={mealVal}
                          onChange={e => updateCell(emp.employee_id, day, 'meal_time', e.target.value)}
                          style={{ width: '55px', fontSize: '9px', border: '1px solid #ddd', borderRadius: '2px', padding: '1px 2px', display: 'block', margin: '1px auto', textAlign: 'center' }}>
                          {mealOptions.map((o, i) => <option key={i} value={o.value}>{o.value}</option>)}
                        </select>
                        {/* 第3个格子：AM工种（班次选假/休时默认联动，可手工改） */}
                        <select value={amVal}
                          onChange={e => updateCell(emp.employee_id, day, 'am_work_type', e.target.value)}
                          style={{ width: '60px', fontSize: '9px', border: '1px solid #ddd', borderRadius: '2px', padding: '1px 2px', display: 'block', margin: '1px auto' }}>
                          <option value=""></option>
                          {amOptions.map(d => <option key={d.id || d.value} value={d.value}>{d.value}</option>)}
                        </select>
                        {/* 第4个格子：PM工种（默认联动AM，可手改） */}
                        <select value={pmVal}
                          onChange={e => updateCell(emp.employee_id, day, 'pm_work_type', e.target.value)}
                          style={{ width: '60px', fontSize: '9px', border: '1px solid #ddd', borderRadius: '2px', padding: '1px 2px', display: 'block', margin: '1px auto' }}>
                          <option value=""></option>
                          {pmOptions.map(d => <option key={d.id || d.value} value={d.value}>{d.value}</option>)}
                        </select>
                      </td>
                    );
                  })}
                  {/* 人员维度13项汇总列 */}
                  {SUM_ITEMS.map((item, i) => {
                    const pstats = data.personStats?.[emp.employee_id] || {};
                    return (
                      <td key={'psum' + i} style={{ ...tdStyle, padding: '1px', textAlign: 'center', minWidth: '52px', background: '#f5f3ff', fontWeight: '600', color: '#3730a3' }}>
                        {fmtSum(pstats[item.key])}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
              {/* 天维度13项汇总行（最后一个员工下方） */}
              {data.dayStats && (
                <>
                <tr style={{ background: '#eef2ff' }}>
                  <td style={{ ...tdStyle, boxSizing: 'border-box', position: 'sticky', left: 0, zIndex: 10, width: '60px', minWidth: '60px', maxWidth: '60px', background: '#eef2ff', fontWeight: '600', color: '#3730a3' }}>合计</td>
                  <td style={{ ...tdStyle, boxSizing: 'border-box', position: 'sticky', left: '60px', zIndex: 10, width: '70px', minWidth: '70px', maxWidth: '70px', background: '#eef2ff', fontWeight: '600', color: '#3730a3' }}></td>
                  {data.days.map((_, dayIdx) => (
                    <td key={`dsum${dayIdx}`} style={{ ...tdStyle, padding: '1px', textAlign: 'center', minWidth: '65px', background: '#eef2ff' }}>
                    </td>
                  ))}
                  {/* 天维度13项汇总值（合计列对应SUM_ITEMS） */}
                  {SUM_ITEMS.map((item, i) => {
                    let total = 0;
                    for (let d = 1; d <= data.days.length; d++) {
                      total += (data.dayStats?.[d]?.[item.key] || 0);
                    }
                    return (
                      <td key={`tsum${i}`} style={{ ...tdStyle, padding: '1px', textAlign: 'center', minWidth: '52px', background: '#e0e7ff', fontWeight: '700', color: '#3730a3' }}>
                        {fmtSum(total)}
                      </td>
                    );
                  })}
                </tr>
                {/* 合计行下方新增13行：每行一个统计指标，每天显示当天人数 */}
                {SUM_ITEMS.map((item, rowIdx) => (
                  <tr key={`statRow${rowIdx}`} style={{ background: rowIdx % 2 === 0 ? '#f5f3ff' : '#ede9fe' }}>
                    <td colSpan={2} style={{ ...tdStyle, boxSizing: 'border-box', position: 'sticky', left: 0, zIndex: 10, width: '130px', minWidth: '130px', background: rowIdx % 2 === 0 ? '#f5f3ff' : '#ede9fe', fontWeight: '600', color: '#3730a3', paddingLeft: '8px' }}>
                      {item.labelFull || item.label}
                    </td>
                    {data.days.map((_, dayIdx) => {
                      const day = dayIdx + 1;
                      const ds = data.dayStats?.[day] || {};
                      return (
                        <td key={`s${rowIdx}d${dayIdx}`} style={{ ...tdStyle, padding: '1px', textAlign: 'center', minWidth: '65px', fontWeight: '500', color: '#4338ca' }}>
                          {fmtSum(ds[item.key])}
                        </td>
                      );
                    })}
                    {/* 右侧月度合计（该项指标的月度合计，占第1列；其余12列留空） */}
                    {(() => {
                      let total = 0;
                      for (let d = 1; d <= data.days.length; d++) {
                        total += (data.dayStats?.[d]?.[item.key] || 0);
                      }
                      return (
                        <>
                          <td key={`s${rowIdx}total`} style={{ ...tdStyle, padding: '1px', textAlign: 'center', minWidth: '52px', background: '#e0e7ff', fontWeight: '700', color: '#3730a3' }}>
                            {fmtSum(total)}
                          </td>
                          {SUM_ITEMS.slice(1).map((_, j) => (
                            <td key={`s${rowIdx}pad${j}`} style={{ ...tdStyle, minWidth: '52px', background: rowIdx % 2 === 0 ? '#f5f3ff' : '#ede9fe' }}></td>
                          ))}
                        </>
                      );
                    })()}
                  </tr>
                ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 弹窗编辑：点击姓名打开，支持每日4项下拉框修改，回传编辑态统一保存 */}
      {modalEmployee && (
        <EditModal
          employee={modalEmployee}
          year={year}
          month={month}
          data={data}
          dictData={dictData}
          editing={editing}
          setEditing={setEditing}
          onClose={() => setModalEmployee(null)}
        />
      )}
    </div>
  );
}

// ── 弹窗编辑组件：每日4项（班次/餐时/AM工种/PM工种）下拉框修改，回传编辑态 ──
function EditModal({ employee, year, month, data, dictData, editing, setEditing, onClose }) {
  // 弹窗直接展示个人月度排班表（已删除原"个人排班汇总统计"、"个人月度目标"标签页）
  const days = Array.isArray(data?.days) ? data.days : Array.from({ length: data?.days || 0 }, (_, i) => i + 1);

  // 当前单元格值（编辑态优先，其次原始数据）
  const getVal = (d, field) => {
    const orig = data?.records?.[employee.employee_id]?.[d] || {};
    return editing[employee.employee_id]?.[d]?.[field] ?? orig[field] ?? '';
  };

  const mealOptions = dictData?.['meal_time'] || [];
  const shiftOptions = dictData?.['shift'] || [];
  const amOptions = dictData?.['am_work_type'] || [];
  const pmOptions = dictData?.['pm_work_type'] || [];

  const mapAmToPm = (amVal) => {
    if (!amVal) return '';
    return amVal.replace('AM', 'PM');
  };

  // 修改单格（含联动：班次→餐时、AM→PM 默认）
  const updateVal = (d, field, value) => {
    const empId = employee.employee_id;
    const next = { ...editing };
    if (!next[empId]) next[empId] = {};
    if (!next[empId][d]) {
      const orig = data.records[empId]?.[d] || {};
      next[empId][d] = {
        shift: orig.shift || '', meal_time: orig.meal_time || '',
        am_work_type: orig.am_work_type || '', pm_work_type: orig.pm_work_type || '',
        remark: orig.remark || '',
      };
    }
    const cell = next[empId][d];
    cell[field] = value;

    if (field === 'shift') {
      if (value === '晚班') cell.meal_time = '17:30餐';
      else if (value === '全班') cell.meal_time = '11:30餐';
      else if (value === '日班' || value === '早班') {
        if (!['11:00餐', '11:30餐', '12:00餐'].includes(cell.meal_time)) cell.meal_time = '11:30餐';
      }
      if (value === '假') { cell.meal_time = '假'; cell.am_work_type = 'AM假'; cell.pm_work_type = 'PM假'; }
      if (value === '休') { cell.meal_time = '休'; cell.am_work_type = 'AM休'; cell.pm_work_type = 'PM休'; }
    }
    if (field === 'am_work_type') {
      const currentPm = cell.pm_work_type || '';
      const expectedPm = mapAmToPm(value);
      const prevAm = cell._prevAm || '';
      if (!currentPm || currentPm === mapAmToPm(prevAm)) {
        cell.pm_work_type = expectedPm;
      }
      cell._prevAm = value;
    }

    setEditing(next);
  };

  const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const shiftColors = {
    '日班': '#e3f2fd', '早班': '#fff8e1', '晚班': '#f3e5f5',
    '全班': '#e8f5e9', '休': '#f5f5f5', '假': '#ffebee',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: '860px', maxWidth: '92vw' }} onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '16px', color: '#1e3a5f' }}>
            销售服务中心 {employee.name} （工号{employee.employee_id}） {year}年{month}月 排班表
          </h2>
          <button onClick={onClose} style={{ fontSize: '20px', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>x</button>
        </div>

        <div>
          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ ...mTh, width: '40px' }}>日</th>
                  <th style={{ ...mTh, width: '46px' }}>星期</th>
                  <th style={{ ...mTh, width: '60px' }}>班次</th>
                  <th style={{ ...mTh, width: '70px' }}>餐时</th>
                  <th style={{ ...mTh, width: '90px' }}>AM工种</th>
                  <th style={{ ...mTh, width: '90px' }}>PM工种</th>
                  <th style={{ ...mTh, width: '150px' }}>备注</th>
                  <th style={{ ...mTh, width: '60px' }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const wd = weekdayNames[(data.weekdays[d - 1] || 1) - 1];
                  const shiftVal = getVal(d, 'shift');
                  const mealVal = getVal(d, 'meal_time');
                  const amVal = getVal(d, 'am_work_type');
                  const pmVal = getVal(d, 'pm_work_type');
                  const remarkVal = getVal(d, 'remark');
                  const isRest = data.weekdays[d - 1] > 5;
                  const isModified = !!editing[employee.employee_id]?.[d];
                  return (
                    <tr key={d} style={{ borderBottom: '1px solid #f3f4f6', background: isModified ? '#fffde7' : '#fff' }}>
                      <td style={{ ...mTd, textAlign: 'center', fontWeight: '600' }}>{d}日</td>
                      <td style={{ ...mTd, textAlign: 'center', color: isRest ? '#dc2626' : '#6b7280' }}>{wd}</td>
                      <td style={{ ...mTd, textAlign: 'center' }}>
                        <select value={shiftVal} onChange={e => updateVal(d, 'shift', e.target.value)} style={selStyle}>
                          <option value=""></option>
                          {shiftOptions.map(o => <option key={o.id || o.value} value={o.value}>{o.value}</option>)}
                        </select>
                      </td>
                      <td style={{ ...mTd, textAlign: 'center' }}>
                        <select value={mealVal} onChange={e => updateVal(d, 'meal_time', e.target.value)} style={selStyle}>
                          {mealOptions.map(o => <option key={o.id || o.value} value={o.value}>{o.value}</option>)}
                        </select>
                      </td>
                      <td style={{ ...mTd, textAlign: 'center' }}>
                        <select value={amVal} onChange={e => updateVal(d, 'am_work_type', e.target.value)} style={selStyle}>
                          <option value=""></option>
                          {amOptions.map(o => <option key={o.id || o.value} value={o.value}>{o.value}</option>)}
                        </select>
                      </td>
                      <td style={{ ...mTd, textAlign: 'center' }}>
                        <select value={pmVal} onChange={e => updateVal(d, 'pm_work_type', e.target.value)} style={selStyle}>
                          <option value=""></option>
                          {pmOptions.map(o => <option key={o.id || o.value} value={o.value}>{o.value}</option>)}
                        </select>
                      </td>
                      <td style={{ ...mTd, padding: '2px 4px' }}>
                        <input
                          type="text"
                          value={remarkVal}
                          maxLength={50}
                          placeholder="最多50字"
                          onChange={e => updateVal(d, 'remark', e.target.value)}
                          style={{ width: '100%', fontSize: '11px', border: '1px solid #ddd', borderRadius: '3px', padding: '2px 4px' }}
                        />
                      </td>
                      <td style={{ ...mTd, fontSize: '10px', color: isModified ? '#d97706' : '#9ca3af', textAlign: 'center', fontWeight: isModified ? '600' : 'normal' }}>
                        {isModified ? '已修改' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const mTh = {
  padding: '6px 8px', textAlign: 'left', color: '#6b7280',
  fontWeight: '600', fontSize: '12px', background: '#f9fafb',
};
const mTd = { padding: '4px 6px', fontSize: '12px', color: '#374151' };
const selStyle = {
  width: '100%', fontSize: '11px', border: '1px solid #ddd',
  borderRadius: '3px', padding: '2px 4px', textAlign: 'center',
};

const thStyle = {
  padding: '6px 8px', textAlign: 'left', color: '#6b7280',
  fontWeight: '600', fontSize: '12px', background: '#f9fafb',
};
const tdStyle = {
  padding: '4px 6px', fontSize: '12px', color: '#374151', whiteSpace: 'nowrap',
  borderBottom: '1px solid #f3f4f6',
};

// ── 导出Excel工作簿构建（与中心排班表导出格式一致；xlsx-js-style 要求 8位ARGB，不带 #） ──
function buildWorkbook(data, year, month) {
  if (!data || !data.employees || data.employees.length === 0) return null;
  const days = Array.isArray(data.days) ? data.days.length : data.days;
  const weekdays = data.weekdays || [];
  const wdNames = ['', '一', '二', '三', '四', '五', '六', '日'];

  const rowBg = (i) => (i % 2 === 1 ? 'FFF0F7FF' : 'FFFFFFFF');
  const headerBg = 'FFF9FAFB';
  const shiftColors = {
    '日班': 'FFE3F2FD', '早班': 'FFFFF8E1', '晚班': 'FFF3E5F5',
    '全班': 'FFE8F5E9', '休': 'FFF5F5F5', '假': 'FFFFEBEE',
  };
  const thinBorder = {
    top: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
    bottom: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
    left: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
    right: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
  };
  const titleStyle = {
    font: { bold: true, sz: 14, color: { rgb: 'FFFFFFFF' } },
    fill: { fgColor: { rgb: 'FF1E3A5F' }, bgColor: { rgb: 'FF1E3A5F' }, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
  const headerCellStyle = {
    font: { bold: true, sz: 10, color: { rgb: 'FF374151' } },
    fill: { fgColor: { rgb: headerBg }, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder,
  };

  // Sheet名清理（≤31字符、去Excel非法字符、保证唯一）
  const usedNames = new Set();
  const safeSheetName = (base) => {
    let name = String(base).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Sheet';
    let n = name, i = 2;
    while (usedNames.has(n)) {
      const suffix = `(${i})`;
      n = name.slice(0, 31 - suffix.length) + suffix;
      i++;
    }
    usedNames.add(n);
    return n;
  };

  const wb = XLSX.utils.book_new();

  // ══════ Sheet 1：完整排班表（格式与中心排班表导出一致） ══════
  const wsData = [];
  wsData.push([`${year}年${month}月 配置排班表`]);
  wsData.push([]);
  const dateRow = ['姓名', '工号'];
  for (let d = 1; d <= days; d++) dateRow.push(`${d}日`);
  wsData.push(dateRow);
  const weekRow = ['', ''];
  for (let i = 0; i < days; i++) weekRow.push(`周${wdNames[weekdays[i]]}`);
  wsData.push(weekRow);
  data.employees.forEach((emp) => {
    const empRecords = data.records[emp.employee_id] || {};
    const row = [emp.name, emp.employee_id];
    for (let d = 1; d <= days; d++) {
      const rec = empRecords[d];
      if (!rec) {
        row.push('');
      } else {
        const am = (rec.am_work_type || '').replace('AM', '') || '';
        const pm = (rec.pm_work_type || '').replace('PM', '') || '';
        row.push(`${rec.shift || ''}\n${rec.meal_time || ''}\n${am}\n${pm}`);
      }
    }
    wsData.push(row);
  });
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: days + 1 } },
    { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
    { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } },
  ];
  ws['!cols'] = [{ wch: 10 }, { wch: 12 }, ...Array(days).fill({ wch: 14 })];
  ws['A1'].s = titleStyle;
  for (let c = 0; c <= days + 1; c++) {
    for (let r = 2; r <= 3; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.s = headerCellStyle;
    }
  }
  for (let r = 2; r < wsData.length; r++) {
    const empIdx = r - 2;
    for (let c = 0; c <= 1; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        cell.s = {
          font: { bold: true, sz: 10, color: { rgb: 'FF2563EB' } },
          fill: { fgColor: { rgb: rowBg(empIdx) }, patternType: 'solid' },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: thinBorder,
        };
      }
    }
  }
  for (let r = 2; r < wsData.length; r++) {
    const empIdx = r - 2;
    for (let c = 2; c <= days + 1; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      const text = String(cell.v || '');
      const shiftName = text.split('\n')[0] || '';
      const bg = shiftColors[shiftName] || rowBg(empIdx);
      cell.s = {
        font: { sz: 9, color: { rgb: 'FF374151' } },
        fill: { fgColor: { rgb: bg }, patternType: 'solid' },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: thinBorder,
      };
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName('配置排班表'));

  // ══════ 每员工3个Sheet ══════
  for (const emp of data.employees) {
    const empRecords = data.records[emp.employee_id] || {};
    const stats = (data.personStats && data.personStats[emp.employee_id]) || {};
    const empTitle = `销售服务中心 ${emp.name}（工号${emp.employee_id}） ${year}年${month}月`;

    // ── Sheet A：个人月度排班表（日历式，周一~周日） ──
    const cal = [];
    let cur = 1;
    for (let week = 0; week < 6 && cur <= days; week++) {
      const rowDays = [];
      for (let dow = 0; dow < 7; dow++) {
        if (cur > days) {
          rowDays.push(null);
        } else {
          const wd = weekdays[cur - 1];
          if (dow === wd - 1) {
            rowDays.push(cur);
            cur++;
          } else {
            rowDays.push(null);
          }
        }
      }
      cal.push(rowDays);
    }
    const calAoa = [[`${empTitle} 个人月度排班表`]];
    calAoa.push(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
    for (const rowDays of cal) {
      calAoa.push(rowDays.map((day) => {
        if (!day) return '';
        const rec = empRecords[day];
        if (!rec) return `${day}日`;
        return `${day}日\n${rec.shift || ''}\n${rec.meal_time || ''}\n${rec.am_work_type || ''}\n${rec.pm_work_type || ''}`;
      }));
    }
    const wsCal = XLSX.utils.aoa_to_sheet(calAoa);
    wsCal['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
    wsCal['!cols'] = Array(7).fill({ wch: 13 });
    wsCal['!rows'] = [{ hpt: 30 }, { hpt: 20 }, ...cal.map(() => ({ hpt: 66 }))];
    wsCal['A1'].s = titleStyle;
    for (let c = 0; c < 7; c++) {
      const cell = wsCal[XLSX.utils.encode_cell({ r: 1, c })];
      if (cell) cell.s = headerCellStyle;
    }
    for (let r = 2; r < calAoa.length; r++) {
      for (let c = 0; c < 7; c++) {
        const cell = wsCal[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        const day = cal[r - 2][c];
        const rec = day ? empRecords[day] : null;
        const bg = rec ? (shiftColors[rec.shift] || 'FFFFFFFF') : (day ? 'FFFFFFFF' : 'FFFAFAFA');
        cell.s = {
          font: { sz: 9, color: { rgb: 'FF374151' } },
          fill: { fgColor: { rgb: bg }, patternType: 'solid' },
          alignment: { horizontal: 'center', vertical: 'top', wrapText: true },
          border: thinBorder,
        };
      }
    }
    XLSX.utils.book_append_sheet(wb, wsCal, safeSheetName(`${emp.name || emp.employee_id}-排班表`));

    // ── Sheet B：个人排班汇总统计（13项） ──
    const statItems = [
      ['实际上机天数', stats.onMachineDays], ['请假天数', stats.leaveDays],
      ['语音天数', stats.voiceDays], ['工单留邮天数', stats.ticketDays],
      ['IM文字天数', stats.imDays], ['质检天数', stats.qaDays],
      ['外呼天数', stats.outboundDays], ['专项任务天数', stats.specialTaskDays],
      ['拨测体验天数', stats.testDays], ['代值班天数', stats.dutyDays],
      ['日班天数', stats.dayShiftDays], ['早班天数', stats.earlyShiftDays],
      ['晚班天数', stats.lateShiftDays],
    ];
    const statsAoa = [
      [`${empTitle} 个人排班汇总统计`],
      ['统计项', '天数'],
      ...statItems.map(([l, v]) => [l, (v === undefined || v === null) ? '' : v]),
    ];
    const wsStats = XLSX.utils.aoa_to_sheet(statsAoa);
    wsStats['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    wsStats['!cols'] = [{ wch: 20 }, { wch: 12 }];
    wsStats['!rows'] = [{ hpt: 30 }, { hpt: 22 }, ...statItems.map(() => ({ hpt: 22 }))];
    wsStats['A1'].s = titleStyle;
    for (let c = 0; c <= 1; c++) {
      const cell = wsStats[XLSX.utils.encode_cell({ r: 1, c })];
      if (cell) cell.s = headerCellStyle;
    }
    for (let r = 2; r < statsAoa.length; r++) {
      const bg = rowBg(r - 2);
      const labCell = wsStats[XLSX.utils.encode_cell({ r, c: 0 })];
      const valCell = wsStats[XLSX.utils.encode_cell({ r, c: 1 })];
      if (labCell) labCell.s = {
        font: { sz: 11, color: { rgb: 'FF374151' } },
        fill: { fgColor: { rgb: bg }, patternType: 'solid' },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: thinBorder,
      };
      if (valCell) valCell.s = {
        font: { bold: true, sz: 11, color: { rgb: 'FF1E3A5F' } },
        fill: { fgColor: { rgb: bg }, patternType: 'solid' },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: thinBorder,
      };
    }
    XLSX.utils.book_append_sheet(wb, wsStats, safeSheetName(`${emp.name || emp.employee_id}-汇总统计`));

    // ── Sheet C：个人月度目标（3列：工种/目标/1日-XX日完成值） ──
    const workload = Math.round(
      ((stats.voiceDays || 0) + (stats.imDays || 0) + (stats.ticketDays || 0)
        + (stats.outboundDays || 0) + (stats.qaDays || 0)) * 90
      + (stats.testDays || 0) * 72
    );
    // 每工种目标（上半块）：语音/工单留邮/IM文字/外呼调研/质检 90件/天，拨测体验 72件/天
    const perTypeRows = [
      ['语音', Math.round((stats.voiceDays || 0) * 90), 'XX件'],
      ['工单留邮', Math.round((stats.ticketDays || 0) * 90), 'XX件'],
      ['IM文字', Math.round((stats.imDays || 0) * 90), 'XX件'],
      ['外呼调研', Math.round((stats.outboundDays || 0) * 90), 'XX件'],
      ['拨测体验', Math.round((stats.testDays || 0) * 72), 'XX件'],
      ['质检', Math.round((stats.qaDays || 0) * 90), 'XX件'],
    ]; // TODO: 完成值列今后接入外部平台API获取，此处暂用"XX件"占位
    // 下半块3行：工作量/语音上机时间/IM上机时间（完成值占位，TODO: 今后接API）
    const targetRows = [
      ['工作量', `${workload}件`, 'XX件'],
      ['语音上机时间', `${(stats.voiceDays || 0) * 7.5}小时`, 'XX小时'],
      ['IM上机时间', `${(stats.imDays || 0) * 7.5}小时`, 'XX小时'],
    ];
    const goalsAoa = [
      [`${empTitle} 个人月度目标`],
      [`${month}月工作量目标与完成情况`],
      ['工种', '目标', `${month}月1日-XX日完成值`],
      ...perTypeRows.map(([l, t, c]) => [l, `${t}件`, c]),
      [''],
      [`${month}月需完成绩效考核目标`],
      ['工种', '目标', `${month}月1日-XX日完成值`],
      ...targetRows,
      [''],
      ['备注：语音/IM文字/外呼调研/工单留邮/质检 目标90件/天，拨测体验目标72件/天；语音/IM文字 目标7.5小时/天'],
    ];
    const wsGoals = XLSX.utils.aoa_to_sheet(goalsAoa);
    const gRows = goalsAoa.length;

    // 行号按结构推导（0-based，防止手工数错行）：
    // 0=标题 1=上半块标题 2=上半块表头 3~8=上半块6行 9=空行
    // 10=下半块标题 11=下半块表头 12~14=下半块3行 15=空行 16=备注
    const idxB1Title = 1;
    const idxB1Header = 2;
    const idxB1DataStart = 3;
    const idxB1DataEnd = idxB1DataStart + perTypeRows.length - 1;        // 8
    const idxSpacer1 = idxB1DataEnd + 1;                                  // 9
    const idxB2Title = idxSpacer1 + 1;                                     // 10
    const idxB2Header = idxB2Title + 1;                                    // 11
    const idxB2DataStart = idxB2Header + 1;                                // 12
    const idxB2DataEnd = idxB2DataStart + targetRows.length - 1;           // 14
    const idxSpacer2 = idxB2DataEnd + 1;                                   // 15
    const idxNote = idxSpacer2 + 1;                                        // 16

    wsGoals['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
      { s: { r: idxB1Title, c: 0 }, e: { r: idxB1Title, c: 2 } },
      { s: { r: idxB2Title, c: 0 }, e: { r: idxB2Title, c: 2 } },
      { s: { r: idxNote, c: 0 }, e: { r: idxNote, c: 2 } },
    ];
    wsGoals['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 18 }];
    wsGoals['!rows'] = goalsAoa.map((_, i) => {
      if (i === 0) return { hpt: 30 };                                   // 总标题
      if (i === idxB1Title || i === idxB2Title) return { hpt: 26 };      // 两块小标题
      if (i === idxNote) return { hpt: 44 };                              // 备注
      if (i === idxSpacer1 || i === idxSpacer2) return { hpt: 8 };       // 两处空行分隔
      return { hpt: 22 };                                                 // 其余数据行统一22pt
    });
    wsGoals['A1'].s = titleStyle;
    for (const sr of [idxB1Title, idxB2Title]) {
      const cell = wsGoals[XLSX.utils.encode_cell({ r: sr, c: 0 })];
      if (cell) cell.s = {
        font: { bold: true, sz: 12, color: { rgb: 'FF1E3A5F' } },
        fill: { fgColor: { rgb: headerBg }, patternType: 'solid' },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: thinBorder,
      };
    }
    for (const hr of [idxB1Header, idxB2Header]) {
      for (let c = 0; c <= 2; c++) {
        const cell = wsGoals[XLSX.utils.encode_cell({ r: hr, c })];
        if (cell) cell.s = headerCellStyle;
      }
    }
    for (let r = idxB1DataStart; r <= idxB1DataEnd; r++) {
      const bg = rowBg(r - idxB1DataStart);
      for (let c = 0; c <= 2; c++) {
        const cell = wsGoals[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.s = {
          font: { bold: c > 0, sz: 11, color: { rgb: c > 0 ? 'FF1E3A5F' : 'FF374151' } },
          fill: { fgColor: { rgb: bg }, patternType: 'solid' },
          alignment: { horizontal: c === 0 ? 'left' : 'center', vertical: 'center' },
          border: thinBorder,
        };
      }
    }
    for (let r = idxB2DataStart; r <= idxB2DataEnd; r++) {
      const bg = rowBg(r - idxB2DataStart);
      for (let c = 0; c <= 2; c++) {
        const cell = wsGoals[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.s = {
          font: { bold: c > 0, sz: 11, color: { rgb: c > 0 ? 'FF2563EB' : 'FF374151' } },
          fill: { fgColor: { rgb: bg }, patternType: 'solid' },
          alignment: { horizontal: c === 0 ? 'left' : 'center', vertical: 'center' },
          border: thinBorder,
        };
      }
    }
    {
      const cell = wsGoals[XLSX.utils.encode_cell({ r: idxNote, c: 0 })];
      if (cell) cell.s = {
        font: { sz: 9, color: { rgb: 'FF9CA3AF' } },
        alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
        border: thinBorder,
      };
    }
    XLSX.utils.book_append_sheet(wb, wsGoals, safeSheetName(`${emp.name || emp.employee_id}-月度目标`));
  }

  return wb;
}