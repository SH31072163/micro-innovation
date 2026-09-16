import { useState, useEffect } from 'react';

/**
 * 配置邮件提醒规则 - 管理区第5个页面
 * 参照《配置_邮件提醒》sheet
 * 支持 C3-C8、D3-D5、E3-E5、C11-C13 修改，立即生效
 */
export default function ConfigEmail({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');
  const [draft, setDraft] = useState({}); // id -> { is_enabled, send_date, send_time, title_template }

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/schedule/email-rules', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setDraft({});
      }
    } catch (err) {
      console.error('获取邮件规则失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setMsg('');
    try {
      const rules = Object.entries(draft).map(([id, val]) => ({ id: parseInt(id), ...val }));
      const res = await fetch('/api/schedule/email-rules', {
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

  const updateDraft = (id, field, value) => {
    if (!draft[id]) {
      const orig = findOriginal(id);
      draft[id] = { ...orig };
    }
    draft[id][field] = value;
    setDraft({ ...draft });
  };

  const findOriginal = (id) => {
    for (const items of Object.values(data || {})) {
      const found = items.find(item => item.id === id);
      if (found) return {
        is_enabled: found.is_enabled,
        send_date: found.send_date || '',
        send_time: found.send_time || '',
        title_template: found.title_template || '',
      };
    }
    return { is_enabled: true, send_date: '', send_time: '', title_template: '' };
  };

  const getVal = (id, field) => {
    if (draft[id]) return draft[id][field];
    const orig = findOriginal(id);
    return orig[field];
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

      {/* 定期邮件发送 */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '16px' }}>定期邮件发送</h4>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>描述</th>
              <th style={{ padding: '8px 12px', textAlign: 'center', color: '#6b7280' }}>是否发送</th>
              <th style={{ padding: '8px 12px', textAlign: 'center', color: '#6b7280' }}>发送日期</th>
              <th style={{ padding: '8px 12px', textAlign: 'center', color: '#6b7280' }}>发送时间</th>
            </tr>
          </thead>
          <tbody>
            {(data?.['monthly_email'] || []).map(item => (
              <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 12px', color: '#374151' }}>{item.description}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  <input type="checkbox" checked={getVal(item.id, 'is_enabled')}
                    onChange={e => updateDraft(item.id, 'is_enabled', e.target.checked)} />
                </td>
                <td style={{ padding: '4px 12px', textAlign: 'center' }}>
                  <input type="text" value={getVal(item.id, 'send_date')}
                    onChange={e => updateDraft(item.id, 'send_date', e.target.value)}
                    placeholder="如: 1日"
                    style={{ width: '80px', fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px', padding: '4px 8px', textAlign: 'center' }} />
                </td>
                <td style={{ padding: '4px 12px', textAlign: 'center' }}>
                  <input type="text" value={getVal(item.id, 'send_time')}
                    onChange={e => updateDraft(item.id, 'send_time', e.target.value)}
                    placeholder="如: 10:00"
                    style={{ width: '60px', fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px', padding: '4px 8px', textAlign: 'center' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 调整排班后邮件 */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '16px' }}>调整排班后邮件</h4>
        {(data?.['adjustment_email'] || []).map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '13px', color: '#374151' }}>{item.description}</span>
            <label style={{ fontSize: '13px' }}>
              <input type="checkbox" checked={getVal(item.id, 'is_enabled')}
                onChange={e => updateDraft(item.id, 'is_enabled', e.target.checked)} />
              是否发送
            </label>
          </div>
        ))}
      </div>

      {/* 邮件标题模板 */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', color: '#1e3a5f', marginBottom: '16px' }}>邮件标题模板</h4>
        {(data?.['email_title'] || []).map(item => (
          <div key={item.id} style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{item.description}</label>
            <input type="text" value={getVal(item.id, 'title_template')}
              onChange={e => updateDraft(item.id, 'title_template', e.target.value)}
              style={{ width: '100%', fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', padding: '6px 12px' }} />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn-primary" onClick={handleSave} disabled={loading}>保存</button>
        <button className="btn-secondary" onClick={handleCancel} disabled={loading}>取消</button>
      </div>
    </div>
  );
}
