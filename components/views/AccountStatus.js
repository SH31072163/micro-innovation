import { useState, useEffect } from 'react';

export default function AccountStatus({ token, user }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => { setProfile(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;

  const isFrozen = profile?.status === 'frozen';

  return (
    <div style={{ padding: '24px' }}>
      <h3 style={{ fontSize: '18px', color: '#1e3a5f', marginBottom: '20px' }}>账号状态</h3>
      <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <div style={{
            width: '12px', height: '12px', borderRadius: '50%',
            background: isFrozen ? '#dc2626' : '#16a34a',
            boxShadow: `0 0 8px ${isFrozen ? '#dc262680' : '#16a34a80'}`,
          }} />
          <span style={{ fontSize: '18px', fontWeight: '600', color: isFrozen ? '#dc2626' : '#16a34a' }}>
            {isFrozen ? '已冻结' : '正常'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 40px' }}>
          <InfoRow label="用户名" value={profile?.username} />
          <InfoRow label="姓名" value={profile?.real_name} />
          <InfoRow label="注册日期" value={profile?.register_date} />
          <InfoRow label="邮箱状态" value={profile?.email_verified ? '已验证' : '未验证'} />
          <InfoRow label="管理员" value={profile?.is_admin ? '是' : '否'} />
          <InfoRow label="部门" value={profile?.department} />
        </div>
        {isFrozen && (
          <div style={{ marginTop: '20px', padding: '12px', background: '#fef2f2', borderRadius: '6px', color: '#dc2626', fontSize: '13px' }}>
            您的账号已被冻结。您可以通过"忘记密码"功能重置密码来解冻，或联系管理员手动解冻。
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ width: '80px', color: '#6b7280', fontSize: '13px' }}>{label}</div>
      <div style={{ color: '#374151', fontSize: '14px' }}>{value || '-'}</div>
    </div>
  );
}
