import { useState } from 'react';

export default function ChangeEmail({ token, user }) {
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
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
          field: 'email',
          value: newEmail,
          confirmPassword: confirmEmail,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message);
        setNewEmail(''); setConfirmEmail('');
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
      <h3 style={{ fontSize: '18px', color: '#1e3a5f', marginBottom: '20px' }}>修改关联邮箱</h3>
      <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ padding: '10px', background: '#eff6ff', borderRadius: '6px', marginBottom: '16px', color: '#2563eb', fontSize: '13px' }}>
          修改邮箱后需要重新验证，系统将向新邮箱发送验证链接。验证通过前账号将暂时无法登录。
        </div>
        <div className="form-group">
          <label className="form-label">新邮箱</label>
          <input className="input-field" type="email" value={newEmail}
            onChange={e => setNewEmail(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">确认新邮箱</label>
          <input className="input-field" type="email" value={confirmEmail}
            onChange={e => setConfirmEmail(e.target.value)} />
        </div>
        {error && <div className="error-text" style={{ marginBottom: '12px' }}>{error}</div>}
        {success && <div style={{ color: '#16a34a', fontSize: '13px', marginBottom: '12px', lineHeight: '1.8' }}>{success}</div>}
        <button className="btn-primary" style={{ width: '100%', padding: '10px' }}
          onClick={handleSubmit} disabled={loading}>
          {loading ? '提交中...' : '发送验证邮件'}
        </button>
      </div>
    </div>
  );
}
