import { useState, useEffect } from 'react';

export default function AdminOverview({ token, user }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [filteredUsers, setFilteredUsers] = useState([]);

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
        setFilteredUsers(data.users || []);
      }
    } catch (err) {
      console.error('获取数据失败:', err);
    } finally {
      setLoading(false);
    }
  };

  // 点击搜索按钮执行过滤
  const handleSearch = () => {
    if (!stats?.users) return;
    if (!keyword.trim()) {
      setFilteredUsers(stats.users);
      return;
    }
    const lower = keyword.toLowerCase();
    const filtered = stats.users.filter(u =>
      (u.username || '').toLowerCase().includes(lower) ||
      (u.email || '').toLowerCase().includes(lower) ||
      (u.real_name || '').toLowerCase().includes(lower) ||
      (u.labor_relation || '').toLowerCase().includes(lower) ||
      (u.department || '').toLowerCase().includes(lower)
    );
    setFilteredUsers(filtered);
  };

  const handleExportExcel = () => {
    if (!filteredUsers || filteredUsers.length === 0) return;

    // 动态导入 xlsx-js-style（避免首次加载过重）
    import('xlsx-js-style').then((XLSX) => {
      const headers = ['序号', '用户编号', '用户名', '姓名', '部门', '劳动关系', '注册日期', '状态'];
      const rows = filteredUsers.map((u, i) => [
        i + 1,
        u.user_id || '',
        u.username || '',
        u.real_name || '',
        u.department || '',
        u.labor_relation || '',
        u.register_date || '',
        u.status === 'frozen' ? '冻结' : (u.email_verified ? '正常' : '待邮箱验证'),
      ]);

      const wsData = [headers, ...rows];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // 列宽
      ws['!cols'] = [
        { wch: 6 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 12 },
      ];

      // 表头样式
      for (let c = 0; c < headers.length; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) {
          cell.s = {
            font: { bold: true, sz: 11, color: { rgb: 'FF374151' } },
            fill: { fgColor: { rgb: 'FFF9FAFB' }, patternType: 'solid' },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
              bottom: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
              left: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
              right: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
            },
          };
        }
      }

      // 数据行样式（交替底色）
      for (let r = 1; r < wsData.length; r++) {
        const rowBg = r % 2 === 0 ? 'FFF0F7FF' : 'FFFFFFFF';
        for (let c = 0; c < headers.length; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell) {
            cell.s = {
              font: { sz: 10, color: { rgb: 'FF374151' } },
              fill: { fgColor: { rgb: rowBg }, patternType: 'solid' },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: {
                top: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { rgb: 'FFE5E7EB' } },
              },
            };
          }
        }
      }

      XLSX.utils.book_append_sheet(wb, ws, '用户列表');
      const fileName = `用户概览-${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);
    });
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ fontSize: '18px', color: '#1e3a5f', margin: 0 }}>用户概览</h3>
      </div>

      {/* 统计卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '16px' }}>
        <StatCard title="注册用户总数" value={stats?.total || 0} color="#2563eb" />
        <StatCard title="正常账号" value={stats?.active || 0} color="#16a34a" />
        <StatCard title="冻结账号" value={stats?.frozen || 0} color="#dc2626" />
        <StatCard title="未验证邮箱" value={stats?.unverified || 0} color="#d97706" />
      </div>

      {/* 搜索框+搜索按钮在左，导出在右（位于用户概览与用户列表之间） */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input className="input-field" style={{ maxWidth: '360px', fontSize: '13px', padding: '6px 12px', height: '32px', boxSizing: 'border-box' }}
            placeholder="按用户名/邮箱/姓名/部门/劳动关系搜索..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }} />
          <button className="btn-primary" onClick={handleSearch}
            style={{ padding: '6px 16px', fontSize: '13px', height: '32px', boxSizing: 'border-box', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: '20px' }}>
            搜索
          </button>
        </div>
        <a href="#" onClick={(e) => { e.preventDefault(); handleExportExcel(); }}
          style={{ fontSize: '13px', color: '#2563eb', textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          导出列表
        </a>
      </div>

      {/* 用户列表 */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <h4 style={{ fontSize: '15px', color: '#374151', marginBottom: '16px' }}>
          用户列表
        </h4>
        {(!filteredUsers || filteredUsers.length === 0) ? (
          <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>暂无匹配用户</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>序号</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>用户编号</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>用户名</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>姓名</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>部门</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>劳动关系</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>注册日期</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280' }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u, i) => (
                <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{i + 1}</td>
                  <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: '12px' }}>{u.user_id || '-'}</td>
                  <td style={{ padding: '8px 12px', color: '#374151' }}>{u.username}{u.is_admin ? <span style={{ marginLeft: '4px', fontSize: '11px', color: '#2563eb', fontWeight: 'bold' }}>超管</span> : null}</td>
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
