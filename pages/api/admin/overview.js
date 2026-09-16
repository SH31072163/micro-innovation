import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';

/**
 * 系统管理 - 用户概览 + 管理区授权
 *
 * GET    /api/admin/overview           获取统计数据 + 用户列表（含授权状态）
 * POST   /api/admin/overview           { action: 'toggle_admin_area', userId } 授权/取消授权
 */
export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  try {
    const adminResult = await query('SELECT is_admin FROM users WHERE id = $1', [userInfo.id]);
    if (!adminResult.rows[0] || !adminResult.rows[0].is_admin) {
      return res.status(403).json({ error: '无管理员权限' });
    }

    // ── POST: 授权切换 ──
    if (req.method === 'POST') {
      const { action, userId } = req.body;

      if (action === 'toggle_admin_area') {
        if (!userId) return res.status(400).json({ error: '缺少用户ID' });

        // 不能操作超管自己
        const targetUser = await query('SELECT is_admin FROM users WHERE id = $1', [userId]);
        if (targetUser.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
        if (targetUser.rows[0].is_admin) {
          return res.status(400).json({ error: '不能修改超管权限' });
        }

        // 查找"管理区"菜单 ID
        const menuResult = await query("SELECT id FROM menus WHERE title = '管理区'");
        if (menuResult.rows.length === 0) {
          return res.status(500).json({ error: '管理区菜单不存在' });
        }
        const menuId = menuResult.rows[0].id;

        // 检查是否已授权
        const existing = await query(
          'SELECT id FROM menu_permissions WHERE user_id = $1 AND menu_id = $2',
          [userId, menuId]
        );

        if (existing.rows.length > 0) {
          // 已授权 → 取消授权
          await query('DELETE FROM menu_permissions WHERE user_id = $1 AND menu_id = $2', [userId, menuId]);
          return res.status(200).json({ userId, authorized: false });
        } else {
          // 未授权 → 授权
          await query(
            'INSERT INTO menu_permissions (user_id, menu_id) VALUES ($1, $2)',
            [userId, menuId]
          );
          return res.status(200).json({ userId, authorized: true });
        }
      }

      return res.status(400).json({ error: '未知操作' });
    }

    // ── GET: 获取统计 + 用户列表 ──
    if (req.method !== 'GET') return res.status(405).json({ error: '方法不允许' });

    const total = await query("SELECT COUNT(*) as count FROM users WHERE is_admin = FALSE");
    // 正常账号 = 状态 active 且邮箱已验证
    const active = await query("SELECT COUNT(*) as count FROM users WHERE status = 'active' AND email_verified = TRUE AND is_admin = FALSE");
    // 未验证邮箱 = 非冻结 且 未验证邮箱（无论 active 或 其他状态）
    const unverified = await query("SELECT COUNT(*) as count FROM users WHERE email_verified = FALSE AND status != 'frozen' AND is_admin = FALSE");
    // 冻结账号 = 状态 frozen
    const frozen = await query("SELECT COUNT(*) as count FROM users WHERE status = 'frozen' AND is_admin = FALSE");

    // 获取管理区菜单 ID
    const menuResult = await query("SELECT id FROM menus WHERE title = '管理区'");
    const adminAreaMenuId = menuResult.rows[0]?.id;

    // 全量用户列表（含授权状态）
    let usersList = [];
    if (adminAreaMenuId) {
      usersList = await query(`
        SELECT u.id, u.username, u.real_name, u.department, u.labor_relation,
               u.register_date, u.status, u.email_verified,
               CASE WHEN mp.id IS NOT NULL THEN TRUE ELSE FALSE END as admin_area_authorized
        FROM users u
        LEFT JOIN menu_permissions mp ON mp.user_id = u.id AND mp.menu_id = $1
        WHERE u.is_admin = FALSE
        ORDER BY u.id ASC
      `, [adminAreaMenuId]);
    } else {
      usersList = await query(`
        SELECT id, username, real_name, department, labor_relation, register_date, status, email_verified,
               FALSE as admin_area_authorized
        FROM users
        WHERE is_admin = FALSE
        ORDER BY id ASC
      `);
    }

    res.status(200).json({
      total: parseInt(total.rows[0].count),
      active: parseInt(active.rows[0].count),
      frozen: parseInt(frozen.rows[0].count),
      unverified: parseInt(unverified.rows[0].count),
      recent: usersList.rows.slice(0, 10).map(u => ({
        username: u.username,
        real_name: u.real_name,
        department: u.department,
        labor_relation: u.labor_relation,
        register_date: u.register_date,
      })),
      users: usersList.rows,
    });
  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}
