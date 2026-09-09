import { query } from '../../../lib/db';
import { getUserFromRequest } from '../../../lib/auth';
import { callAI, checkAvailability, VENDORS } from '../../../lib/ai-provider';

/**
 * AI API 接口管理
 *
 * GET    /api/admin/ai-apis            获取列表（含厂商清单）
 * POST   /api/admin/ai-apis            新增 API
 * PUT    /api/admin/ai-apis            编辑 API
 * DELETE /api/admin/ai-apis?id=X       删除 API
 * PATCH  /api/admin/ai-apis            批量检测所有 API 状态
 * PATCH  /api/admin/ai-apis?id=X       检测单个 API 状态
 *
 * 特殊 POST action:
 *   { action: 'toggle', id }           启停切换
 *   { action: 'test', id, message }    测试对话
 *   { action: 'check_all' }            批量检测
 *   { action: 'vendors' }              获取厂商预设列表
 */
export default async function handler(req, res) {
  const userInfo = getUserFromRequest(req);
  if (!userInfo) return res.status(401).json({ error: '未登录' });

  // 权限校验：超管 或 被授权管理区的用户
  async function checkAdminAreaAccess() {
    const adminResult = await query('SELECT is_admin FROM users WHERE id = $1', [userInfo.id]);
    const isAdmin = adminResult.rows[0]?.is_admin;
    if (isAdmin) return true;

    const permResult = await query(`
      SELECT mp.* FROM menu_permissions mp
      JOIN menus m ON mp.menu_id = m.id
      WHERE mp.user_id = $1 AND m.title = '管理区'
    `, [userInfo.id]);
    return permResult.rows.length > 0;
  }

  // POST 方式处理特殊 action
  if (req.method === 'POST' && req.body.action) {
    if (!(await checkAdminAreaAccess())) {
      return res.status(403).json({ error: '无管理区权限' });
    }

    const { action } = req.body;

    // ── 获取厂商列表 ──
    if (action === 'vendors') {
      return res.status(200).json({ vendors: VENDORS });
    }

    // ── 批量检测所有 API ──
    if (action === 'check_all') {
      const apis = await query('SELECT * FROM ai_apis ORDER BY priority ASC, id ASC');
      const results = [];
      for (const api of apis.rows) {
        const result = await checkAvailability(api);
        await query('UPDATE ai_apis SET is_available = $1 WHERE id = $2', [result.available, api.id]);
        results.push({ id: api.id, name: api.name, ...result });
      }
      return res.status(200).json({ results });
    }

    // ── 启停切换 ──
    if (action === 'toggle') {
      const { id } = req.body;
      const apiResult = await query('SELECT enabled FROM ai_apis WHERE id = $1', [id]);
      if (apiResult.rows.length === 0) return res.status(404).json({ error: 'API不存在' });
      const newEnabled = !apiResult.rows[0].enabled;
      await query('UPDATE ai_apis SET enabled = $1 WHERE id = $2', [newEnabled, id]);
      return res.status(200).json({ id, enabled: newEnabled });
    }

    // ── 测试对话 ──
    if (action === 'test') {
      const { id, message } = req.body;
      const apiResult = await query('SELECT * FROM ai_apis WHERE id = $1', [id]);
      if (apiResult.rows.length === 0) return res.status(404).json({ error: 'API不存在' });
      const api = apiResult.rows[0];

      try {
        const reply = await callAI(api, [
          { role: 'user', content: message || '你好，请简单回复确认接口正常' },
        ], { maxTokens: 2000, timeout: 60000 });
        await query('UPDATE ai_apis SET is_available = TRUE WHERE id = $1', [id]);
        return res.status(200).json({ success: true, reply });
      } catch (err) {
        await query('UPDATE ai_apis SET is_available = FALSE WHERE id = $1', [id]);
        return res.status(200).json({ success: false, error: err.message });
      }
    }
  }

  // 标准 REST 方法
  try {
    if (req.method === 'GET') {
      if (!(await checkAdminAreaAccess())) {
        return res.status(403).json({ error: '无管理区权限' });
      }
      const apis = await query('SELECT * FROM ai_apis ORDER BY priority ASC, id ASC');
      return res.status(200).json({
        apis: apis.rows,
        vendors: VENDORS,
      });

    } else if (req.method === 'POST') {
      if (!(await checkAdminAreaAccess())) {
        return res.status(403).json({ error: '无管理区权限' });
      }
      const { name, url, apiKey, priority, protocolType, vendor, model } = req.body;
      if (!name || !url || !apiKey) {
        return res.status(400).json({ error: '名称、网址、密钥不能为空' });
      }
      const result = await query(`
        INSERT INTO ai_apis (name, url, api_key, priority, protocol_type, vendor, model, enabled)
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
        RETURNING id
      `, [name, url, apiKey, priority || 0, protocolType || 'openai', vendor || 'custom', model || 'gpt-3.5-turbo']);
      return res.status(200).json({ message: 'API添加成功', id: result.rows[0].id });

    } else if (req.method === 'PUT') {
      if (!(await checkAdminAreaAccess())) {
        return res.status(403).json({ error: '无管理区权限' });
      }
      const { id, name, url, apiKey, priority, protocolType, vendor, model } = req.body;
      await query(`
        UPDATE ai_apis SET
          name = $1, url = $2, api_key = $3, priority = $4,
          protocol_type = $5, vendor = $6, model = $7
        WHERE id = $8
      `, [name, url, apiKey, priority, protocolType || 'openai', vendor || 'custom', model || 'gpt-3.5-turbo', id]);
      return res.status(200).json({ message: 'API更新成功' });

    } else if (req.method === 'DELETE') {
      if (!(await checkAdminAreaAccess())) {
        return res.status(403).json({ error: '无管理区权限' });
      }
      const { id } = req.query;
      await query('DELETE FROM ai_apis WHERE id = $1', [id]);
      return res.status(200).json({ message: 'API已删除' });

    } else if (req.method === 'PATCH') {
      if (!(await checkAdminAreaAccess())) {
        return res.status(403).json({ error: '无管理区权限' });
      }
      // 单个 API 状态检测
      const { id } = req.body;
      const apiResult = await query('SELECT * FROM ai_apis WHERE id = $1', [id]);
      const api = apiResult.rows[0];
      if (!api) return res.status(404).json({ error: 'API不存在' });

      const result = await checkAvailability(api);
      await query('UPDATE ai_apis SET is_available = $1 WHERE id = $2', [result.available, id]);
      return res.status(200).json({
        id,
        available: result.available,
        error: result.error,
        responseTime: result.responseTime,
      });

    } else {
      return res.status(405).json({ error: '方法不允许' });
    }
  } catch (err) {
    console.error('AI APIs error:', err);
    return res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}
