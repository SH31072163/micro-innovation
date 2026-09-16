import { useState, useEffect, useCallback } from 'react';

/**
 * 假日配置 - 管理区第7个页面
 * - 一键从互联网抓取当年国定假日
 * - 手工添加/修正单条假日（含调休上班日）
 * - 删除单条假日
 * - 按年查看列表
 */
export default function ConfigHolidays({ token }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [newIsHoliday, setNewIsHoliday] = useState(true);

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch(`/api/schedule/holidays?year=${year}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setHolidays(await res.json());
      }
    } catch (err) {
      setMsg('获取假日数据失败');
      setMsgType('error');
    } finally {
      setLoading(false);
    }
  }, [year, token]);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const handleFetchFromAPI = async () => {
    if (!confirm(`确定从互联网抓取 ${year} 年国定假日数据？\n这将覆盖该年已有的假日配置。`)) return;
    setFetching(true);
    setMsg('');
    try {
      const res = await fetch('/api/schedule/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'fetch', year }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(data.message);
        setMsgType('success');
        fetchHolidays();
      } else {
        setMsg(data.error || '抓取失败');
        setMsgType('error');
      }
    } catch (err) {
      setMsg('网络错误');
      setMsgType('error');
    } finally {
      setFetching(false);
    }
  };

  const handleAddHoliday = async () => {
    if (!newDate || !newName) {
      setMsg('请填写日期和名称');
      setMsgType('error');
      return;
    }
    try {
      const res = await fetch('/api/schedule/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'add', date: newDate, name: newName, is_holiday: newIsHoliday }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(data.message);
        setMsgType('success');
        setShowAddForm(false);
        setNewDate('');
        setNewName('');
        setNewIsHoliday(true);
        fetchHolidays();
      } else {
        setMsg(data.error || '添加失败');
        setMsgType('error');
      }
    } catch (err) {
      setMsg('网络错误');
      setMsgType('error');
    }
  };

  const handleDeleteHoliday = async (id, name, date) => {
    if (!confirm(`确定删除「${name}（${date}）」？`)) return;
    try {
      const res = await fetch('/api/schedule/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'delete', id }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(data.message);
        setMsgType('success');
        fetchHolidays();
      } else {
        setMsg(data.error || '删除失败');
        setMsgType('error');
      }
    } catch (err) {
      setMsg('网络错误');
      setMsgType('error');
    }
  };

  return (
    <div>
      {/* 工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select className="input-field" style={{ width: '100px', fontSize: '13px', padding: '6px 8px' }}
            value={year} onChange={e => setYear(parseInt(e.target.value))}>
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          <button className="btn-secondary" style={{ padding: '6px 14px', fontSize: '13px' }}
            onClick={fetchHolidays} disabled={loading}>
            刷新
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }}
            onClick={handleFetchFromAPI} disabled={fetching}>
            {fetching ? '抓取中...' : '一键抓取国定假日'}
          </button>
          <button className="btn-secondary" style={{ padding: '6px 16px', fontSize: '13px' }}
            onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? '取消添加' : '手工添加'}
          </button>
        </div>
      </div>

      {/* 提示条 */}
      {msg && (
        <div style={{
          padding: '8px 12px', borderRadius: '4px', marginBottom: '16px', fontSize: '13px',
          background: msgType === 'success' ? '#dcfce7' : '#fee2e2',
          color: msgType === 'success' ? '#16a34a' : '#dc2626',
        }}>{msg}</div>
      )}

      {/* 手工添加表单 */}
      {showAddForm && (
        <div style={{
          background: '#fff', borderRadius: '8px', padding: '16px', marginBottom: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #e5e7eb',
        }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', marginRight: '4px' }}>日期</label>
              <input type="date" className="input-field" style={{ width: '150px', fontSize: '13px', padding: '4px 8px' }}
                value={newDate} onChange={e => setNewDate(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', marginRight: '4px' }}>名称</label>
              <input className="input-field" style={{ width: '150px', fontSize: '13px', padding: '4px 8px' }}
                placeholder="如：元旦、国庆节调休"
                value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', marginRight: '4px' }}>类型</label>
              <select className="input-field" style={{ fontSize: '13px', padding: '4px 8px' }}
                value={newIsHoliday ? 'true' : 'false'} onChange={e => setNewIsHoliday(e.target.value === 'true')}>
                <option value="true">假日（休息）</option>
                <option value="false">调休上班日</option>
              </select>
            </div>
            <button className="btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }}
              onClick={handleAddHoliday}>确认添加</button>
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af' }}>
            提示：调休上班日标记为"调休上班日"类型，排班算法会将其视为正常工作日处理。
          </div>
        </div>
      )}

      {/* 假日列表 */}
      <div style={{ background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>
        ) : holidays.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>
            暂无 {year} 年假日数据，请点击"一键抓取国定假日"自动获取
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>序号</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>日期</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>名称</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>类型</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h, i) => (
                <tr key={h.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 16px', color: '#9ca3af' }}>{i + 1}</td>
                  <td style={{ padding: '10px 16px', color: '#374151' }}>{h.date}</td>
                  <td style={{ padding: '10px 16px', color: '#374151' }}>{h.name}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: '4px', fontSize: '12px',
                      background: h.is_holiday ? '#f0fdf4' : '#fffbeb',
                      color: h.is_holiday ? '#16a34a' : '#d97706',
                    }}>{h.is_holiday ? '假日' : '调休上班'}</span>
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <button className="btn-danger" style={{ padding: '4px 12px', fontSize: '12px' }}
                      onClick={() => handleDeleteHoliday(h.id, h.name, h.date)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: '12px', fontSize: '12px', color: '#9ca3af' }}>
        共 {holidays.length} 条假日记录 | 数据来源：timor.tech 国定假日 API | 排班时自动读取假日数据标记"休"
      </div>
    </div>
  );
}
