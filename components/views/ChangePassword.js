import { useState } from 'react';

export default function ChangePassword({ token, user, force }) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          field: 'password',
          value: newPwd,
          oldValue: oldPwd,
          confirmPassword: confirmPwd,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess('密码修改成功');
        setOldPwd(''); setNewPwd(''); setConfirmPwd('');
        if (force && user.force_change_password) {
          // 延迟通知父组件
          setTimeout(() => window.location.reload(), 1000);
        }
      } else {
        setError(data.error || '修改失败');
      }
    } catch (err) {
      setError('网络错误');
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: '24px', maxWidth: '500px' }}>
      <h3 style={{ fontSize: '18px', color: '#1e3a5f', marginBottom: '20px' }}>修改密码</h3>
      <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {force && (
          <div style={{ padding: '10px', background: '#fef3c7', borderRadius: '6px', marginBottom: '16px', color: '#92400e', fontSize: '13px' }}>
            您正在使用系统重置的密码，请立即修改。
          </div>
        )}
        <div className="form-group">
          <label className="form-label">当前密码</label>
          <input className="input-field" type="password" value={oldPwd}
            onChange={e => setOldPwd(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">新密码 <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>(6-12位，含数字+大小写字母)</span></label>
          <input className="input-field" type="password" value={newPwd}
            onChange={e => setNewPwd(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">确认新密码</label>
          <input className="input-field" type="password" value={confirmPwd}
            onChange={e => setConfirmPwd(e.target.value)} />
        </div>
        {error && <div className="error-text" style={{ marginBottom: '12px' }}>{error}</div>}
        {success && <div style={{ color: '#16a34a', fontSize: '13px', marginBottom: '12px' }}>{success}</div>}
        <button className="btn-primary" style={{ width: '100%', padding: '10px' }}
          onClick={handleSubmit} disabled={loading}>
          {loading ? '提交中...' : '确认修改'}
        </button>
      </div>
    </div>
  );
}
