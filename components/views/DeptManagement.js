import { useState } from 'react';
import ConfigEmployees from './schedule/ConfigEmployees';
import ConfigHolidays from './schedule/ConfigHolidays';

/**
 * 部门管理 - 系统管理/部门管理（仅超管可见）
 * 全局性配置，包含两个标签页：人员增删 | 假日配置
 * （从排班表/管理区转移而来，样式与管理区标签保持一致）
 */
export default function DeptManagement({ token }) {
  const [tab, setTab] = useState(0);

  const tabs = ['人员增删', '假日配置'];

  return (
    <div style={{ padding: '24px' }}>
      <h3 style={{ fontSize: '18px', color: '#1e3a5f', marginBottom: '20px' }}>部门管理</h3>

      {/* 标签栏（纵向滚动时冻结在顶部，样式与排班表管理区一致） */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '2px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 100, background: '#f9fafb' }}>
        {tabs.map((t, i) => (
          <button
            key={i}
            onClick={() => setTab(i)}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: tab === i ? '600' : 'normal',
              color: tab === i ? '#2563eb' : '#6b7280',
              background: tab === i ? '#eff6ff' : '#f9fafb',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              borderBottom: tab === i ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: '-2px',
              borderRadius: '4px 4px 0 0',
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div>
        {tab === 0 && <ConfigEmployees token={token} />}
        {tab === 1 && <ConfigHolidays token={token} />}
      </div>
    </div>
  );
}
