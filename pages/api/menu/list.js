import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  if (req.method !== 'GET') return res.status(405).json({ error: '方法不允许' });

  try {
    // 查询用户的排班管理员权限
    const userRow = await query('SELECT is_schedule_admin, is_admin FROM users WHERE id = $1', [userInfo.id]);
    const isScheduleAdmin = userRow.rows[0] && (userRow.rows[0].is_schedule_admin || userRow.rows[0].is_admin);

    const level2 = await query('SELECT * FROM menus WHERE level = 2 ORDER BY sort_order ASC');
    const level3 = await query('SELECT * FROM menus WHERE level = 3 ORDER BY sort_order ASC');
    const perms = await query('SELECT menu_id FROM menu_permissions WHERE user_id = $1', [userInfo.id]);
    const permittedIds = new Set(perms.rows.map(p => p.menu_id));

    const isAdmin = userInfo.is_admin === 1 || userInfo.is_admin === true;

    const menus = level2.rows.map(m2 => {
      const children = level3.rows
        .filter(m3 => m3.parent_id === m2.id)
        .map(m3 => ({ ...m3, is_permitted: permittedIds.has(m3.id) }));

      let visible = false;

      if (m2.title === '个人设置') {
        // 个人设置：所有人可见，子菜单全部默认授权
        visible = true;
        children.forEach(c => { c.is_permitted = true; });
      } else if (m2.title === '系统管理') {
        // 系统管理：仅超管可见，子菜单全部授权
        visible = isAdmin;
        if (isAdmin) children.forEach(c => { c.is_permitted = true; });
      } else if (m2.title === '排班表') {
        // 排班表：超管和排班管理员可见
        visible = isScheduleAdmin;
        if (visible) children.forEach(c => { c.is_permitted = true; });
      } else {
        // 其他菜单：超管可见全部；其他用户需有授权才可见
        if (isAdmin) {
          visible = true;
          children.forEach(c => { c.is_permitted = true; });
        } else if (permittedIds.has(m2.id)) {
          visible = true;
        } else if (children.some(c => c.is_permitted)) {
          visible = true;
        }
      }

      return { ...m2, children, is_visible: visible };
    }).filter(m => m.is_visible);

    res.status(200).json(menus);
  } catch (err) {
    console.error('Menu list error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
}
