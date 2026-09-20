import { useState, useEffect } from 'react';

export default function PersonalProfile({ token, user }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editField, setEditField] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/user/profile', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (field) => {
    setMsg('');
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ field, value: editValue }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(data.message);
        setEditing(false);
        setEditField(null);
        fetchProfile();
      } else {
        setMsg(data.error);
      }
    } catch (err) {
      setMsg('网络错误');
    }
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;

  return (
    <div style={{ padding: '24px' }}>
      <h3 style={{ fontSize: '18px', color: '#1e3a5f', marginBottom: '20px' }}>个人资料</h3>
      {msg && <div style={{ padding: '8px 12px', background: '#eff6ff', borderRadius: '4px', marginBottom: '16px', color: '#2563eb', fontSize: '13px' }}>{msg}</div>}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 40px' }}>
          <FieldRow label="用户名" value={profile?.username} />
          <FieldRow label="用户编号" value={profile?.user_id} />
          <FieldRow label="姓名" value={profile?.real_name} editable onEdit={() => { setEditing(true); setEditField('real_name'); setEditValue(profile?.real_name || ''); }} />
          <FieldRow label="关联邮箱" value={profile?.email} editable onEdit={() => { setEditing(true); setEditField('email'); setEditValue(profile?.email || ''); }} />
          <FieldRow label="手机号码" value={profile?.phone} editable onEdit={() => { setEditing(true); setEditField('phone'); setEditValue(profile?.phone || ''); }} />
          <FieldRow label="部门" value={profile?.department} editable onEdit={() => { setEditing(true); setEditField('department'); setEditValue(profile?.department || ''); }} />
          <FieldRow label="劳动关系" value={profile?.labor_relation} editable onEdit={() => { setEditing(true); setEditField('labor_relation'); setEditValue(profile?.labor_relation || ''); }} />
          <FieldRow label="注册日期" value={profile?.register_date} />
          <FieldRow label="邮箱状态" value={profile?.email_verified ? '已验证' : '未验证'} />
        </div>
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(false)}>
          <div className="modal-box" style={{ width: '400px' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: '16px' }}>修改{editField === 'real_name' ? '姓名' : editField === 'phone' ? '手机号' : editField === 'department' ? '部门' : editField === 'labor_relation' ? '劳动关系' : editField === 'email' ? '邮箱' : ''}</h3>
            {editField === 'labor_relation' ? (
              <select className="input-field" value={editValue} onChange={e => setEditValue(e.target.value)}>
                <option value="国脉员工">国脉员工</option>
                <option value="非国脉员工">非国脉员工</option>
              </select>
            ) : editField === 'email' ? (
              <EmailEditInline token={token} oldValue={editValue} onDone={(m) => { setMsg(m); setEditing(false); }} />
            ) : (
              <input className="input-field" type="text" value={editValue} onChange={e => setEditValue(e.target.value)} />
            )}
            {editField !== 'email' && (
              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setEditing(false)}>取消</button>
                <button className="btn-primary" style={{ flex: 1 }} onClick={() => handleSave(editField)}>保存</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, value, editable, onEdit }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ width: '80px', color: '#6b7280', fontSize: '13px', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, color: '#374151', fontSize: '14px' }}>{value || '-'}</div>
      {editable && (
        <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: '12px' }} onClick={onEdit}>修改</button>
      )}
    </div>
  );
}

function EmailEditInline({ token, onDone }) {
  const [email, setEmail] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ field: 'email', value: email, confirmPassword: confirm }),
      });
      const data = await res.json();
      if (res.ok) {
        onDone(data.message);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('网络错误');
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="form-group">
        <label className="form-label">新邮箱</label>
        <input className="input-field" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">确认新邮箱</label>
        <input className="input-field" type="email" value={confirm} onChange={e => setConfirm(e.target.value)} />
      </div>
      {error && <div className="error-text" style={{ marginBottom: '12px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleSubmit} disabled={loading}>{loading ? '提交中...' : '确认修改'}</button>
      </div>
    </div>
  );
}
