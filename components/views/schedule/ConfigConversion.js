import { useState, useEffect } from 'react';

/**
 * 配置换算规则 - 管理区第3个页面
 * 参照《配置_换算规则》sheet，C列数字可改，限浮点型1位小数且>0
 */
export default function ConfigConversion({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');
  const [draft, setDraft] = useState({}); // id -> value

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/schedule/conversion', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setDraft({});
      }
    } catch (err) {
      console.error('获取换算规则失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setMsg('');
    try {
      const rules = Object.entries(draft).map(([id, value]) => ({ id: parseInt(id), value }));
      const res = await fetch('/api/schedule/conversion', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rules }),
      });
      const result = await res.json();
      if (res.ok) {
        setMsg('保存成功');
        setMsgType('success');
        fetchData();
      } else {
        setMsg(result.error || '保存失败');
        setMsgType('error');
      }
    } catch (err) {
      setMsg('网络错误');
      setMsgType('error');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setDraft({});
    setMsg('');
  };

  const categoryLabels = {
    'daily_workload': '每日工作量绩效目标',
    'daily_machine_time': '每日上机时间绩效目标',
  };

  if (loading && !data) return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;

  return (
    <div>
      {msg && (
        <div style={{
          padding: '8px 12px', borderRadius: '4px', marginBottom: '16px', fontSize: '13px',
          background: msgType === 'success' ? '#dcfce7' : '#fee2e2',
          color: msgType === 'success' ? '#16a34a' : '#dc2626',
        }}>{msg}</div>
      )}

      {Object.entries(categoryLabels).map(([catKey, catLabel]) => (
        <div key={catKey} style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
          <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '16px' }}>{catLabel}</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '8px 16px', textAlign: 'left', color: '#6b7280' }}>工种</th>
                <th style={{ padding: '8px 16px', textAlign: 'center', color: '#6b7280' }}>数值</th>
                <th style={{ padding: '8px 16px', textAlign: 'left', color: '#6b7280' }}>单位</th>
              </tr>
            </thead>
            <tbody>
              {(data?.[catKey] || []).map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px 16px', color: '#374151' }}>{item.work_type}</td>
                  <td style={{ padding: '8px 16px', textAlign: 'center' }}>
                    <input type="number" step="0.1" min="0.1"
                      value={draft[item.id] ?? item.value}
                      onChange={e => setDraft({ ...draft, [item.id]: e.target.value })}
                      style={{ width: '80px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '4px 8px', textAlign: 'center' }} />
                  </td>
                  <td style={{ padding: '8px 16px', color: '#6b7280' }}>{item.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
        <button className="btn-primary" onClick={handleSave} disabled={loading}>保存</button>
        <button className="btn-secondary" onClick={handleCancel} disabled={loading}>取消</button>
      </div>
    </div>
  );
}
