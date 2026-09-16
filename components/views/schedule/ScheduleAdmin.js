import { useState, useEffect } from 'react';
import ConfigSchedule from './ConfigSchedule';
import ConfigDict from './ConfigDict';
import ConfigConversion from './ConfigConversion';
import ConfigEmployees from './ConfigEmployees';
import ConfigEmail from './ConfigEmail';
import ConfigRules from './ConfigRules';
import ConfigHolidays from './ConfigHolidays';

/**
 * 排班表管理区 - 7个配置页面
 * 顶部标签切换：配置排班 | 数据字典 | 换算规则 | 人员增删 | 邮件提醒 | 默认规则 | 假日配置
 */
export default function ScheduleAdmin({ token }) {
  const [tab, setTab] = useState(0);

  const tabs = [
    '配置排班', '数据字典', '换算规则', '人员增删', '邮件提醒', '默认规则', '假日配置',
  ];

  return (
    <div style={{ padding: '24px' }}>
      <h3 style={{ fontSize: '18px', color: '#1e3a5f', marginBottom: '20px' }}>排班表管理区</h3>

      {/* 标签栏（纵向滚动时冻结在顶部） */}
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
              borderBottom: tab === i ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: '-2px',
              borderRadius: '4px 4px 0 0',
              cursor: 'pointer',
              border: 'none',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div>
        {tab === 0 && <ConfigSchedule token={token} />}
        {tab === 1 && <ConfigDict token={token} />}
        {tab === 2 && <ConfigConversion token={token} />}
        {tab === 3 && <ConfigEmployees token={token} />}
        {tab === 4 && <ConfigEmail token={token} />}
        {tab === 5 && <ConfigRules token={token} />}
        {tab === 6 && <ConfigHolidays token={token} />}
      </div>
    </div>
  );
}
