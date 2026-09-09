import { useState, useEffect } from 'react';

export default function AdminOverview({ token, user }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/overview', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('获取数据失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (!stats?.users || stats.users.length === 0) return;

    const headers = ['序号', '用户名', '姓名', '部门', '劳动关系', '注册日期', '状态'];
    const rows = stats.users.map((u, i) => [
      i + 1,
      u.username || '',
      u.real_name || '',
      u.department || '',
      u.labor_relation || '',
      u.register_date || '',
      u.status === 'frozen' ? '冻结' : (u.email_verified ? '正常' : '待邮箱验证'),
    ]);

    // CSV 需要加 BOM 头以支持 Excel 正确识别中文
    const csvContent = '\uFEFF' + [headers, ...rows].map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `用户概览-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '18px', color: '#1e3a5f', margin: 0 }}>用户概览</h3>
        <button className="btn-secondary" onClick={handleExportCSV} disabled={!stats?.users || stats.users.length === 0}
          style={{ padding: '6px 16px', fontSize: '13px' }}>
          导出 CSV
        </button>
      </div>

      {/* 统计卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <StatCard title="注册用户总数" value={stats?.total || 0} color="#2563eb" />
        <StatCard title="正常账号" value={stats?.active || 0} color="#16a34a" />
        <StatCard title="冻结账号" value={stats?.frozen || 0} color="#dc2626" />
        <StatCard title="未验证邮箱" value={stats?.unverified || 0} color="#d97706" />
      </div>

      {/* 用户列表 */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <h4 style={{ fontSize: '15px', color: '#374151', marginBottom: '16px' }}>
          用户列表
        </h4>
        {(!stats?.users || stats.users.length === 0) ? (
          <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>暂无注册用户</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>序号</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>用户名</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>姓名</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>部门</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>劳动关系</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>注册日期</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {stats.users.map((u, i) => (
                <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{i + 1}</td>
                  <td style={{ padding: '8px 12px', color: '#374151' }}>{u.username}</td>
                  <td style={{ padding: '8px 12px', color: '#374151' }}>{u.real_name}</td>
                  <td style={{ padding: '8px 12px', color: '#374151' }}>{u.department}</td>
                  <td style={{ padding: '8px 12px', color: '#374151' }}>{u.labor_relation}</td>
                  <td style={{ padding: '8px 12px', color: '#374151' }}>{u.register_date}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '12px',
                      background: u.status === 'frozen' ? '#fee2e2' : (u.email_verified ? '#dcfce7' : '#fffbeb'),
                      color: u.status === 'frozen' ? '#dc2626' : (u.email_verified ? '#16a34a' : '#d97706'),
                    }}>
                      {u.status === 'frozen' ? '冻结' : (u.email_verified ? '正常' : '待邮箱验证')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', textAlign: 'center' }}>
      <div style={{ fontSize: '28px', fontWeight: 'bold', color }}>{value}</div>
      <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '8px' }}>{title}</div>
    </div>
  );
}
