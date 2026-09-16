const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_9A3xmFdsfZIP@ep-cool-smoke-b343zz5i-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

// Cloudflare Workers 兼容的 Neon HTTP 客户端（无需 TCP 连接）
let sql = null;

function getSql() {
  if (!sql) {
    sql = neon(connectionString);
  }
  return sql;
}

/**
 * 执行查询。参数占位符 $1, $2 会被 Neon 客户端处理。
 * 返回 { rows } 结构，与 pg 兼容。
 */
async function query(text, params) {
  const client = getSql();
  // Neon serverless 客户端：参数化查询需用 client.query(text, params)
  // （neon() 本身是 tagged-template 函数，不能直接传参调用）
  const rows = await client.query(text, params || []);
  return { rows };
}

/**
 * 事务：Neon HTTP 模式不支持 BEGIN/COMMIT（无连接保持）。
 * 这里降级为顺序执行多条语句，并尽量保证语义一致。
 * 注意：在 Cloudflare Workers 中，@neondatabase/serverless 的
 * neon 函数默认是 HTTP 驱动，不具备事务能力。
 * 项目中调用 withTransaction 的地方需要确认是否真的需要强事务。
 */
async function withTransaction(callback) {
  // 模拟：直接执行回调，传入一个简化 client
  const client = getSql();
  const fakeClient = {
    query: async (text, params) => {
      const rows = await client.query(text, params || []);
      return { rows };
    },
  };
  return await callback(fakeClient);
}

async function initializeDb() {
  const client = getSql();
  try {
    // 用户表
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email VARCHAR(200) NOT NULL DEFAULT '',
        phone VARCHAR(20) NOT NULL DEFAULT '',
        real_name VARCHAR(20) NOT NULL,
        department VARCHAR(100) NOT NULL DEFAULT '',
        labor_relation VARCHAR(20) NOT NULL,
        email_verified BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) DEFAULT 'active',
        is_admin BOOLEAN DEFAULT FALSE,
        force_change_password BOOLEAN DEFAULT FALSE,
        login_fail_count INTEGER DEFAULT 0,
        register_date VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 菜单表
    await client.query(`
      CREATE TABLE IF NOT EXISTS menus (
        id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        level INTEGER NOT NULL,
        parent_id INTEGER,
        sort_order INTEGER DEFAULT 0,
        is_system BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 菜单授权表
    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_permissions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        UNIQUE(user_id, menu_id)
      )
    `);

    // AI API 配置表（含协议类型、厂商、模型名、启停开关）
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_apis (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        is_available BOOLEAN DEFAULT TRUE,
        protocol_type VARCHAR(20) DEFAULT 'openai',
        vendor VARCHAR(50) DEFAULT '',
        model VARCHAR(100) DEFAULT 'gpt-3.5-turbo',
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 对话记录表
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(200) DEFAULT '新对话',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 邮件验证token表
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        type VARCHAR(20) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 插入默认菜单
    const menuCount = await client.query('SELECT COUNT(*) as count FROM menus');
    if (parseInt(menuCount.rows[0].count) === 0) {
      const personalRes = await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('个人设置', 2, NULL, 1, TRUE) RETURNING id");
      const askMeRes = await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('你问我答', 2, NULL, 2, TRUE) RETURNING id");
      const sysMgmtRes = await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('系统管理', 2, NULL, 99, TRUE) RETURNING id");

      const psId = personalRes.rows[0].id;
      const amId = askMeRes.rows[0].id;
      const smId = sysMgmtRes.rows[0].id;

      await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('个人资料', 3, $1, 1, TRUE)", [psId]);
      await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('账号状态', 3, $1, 2, TRUE)", [psId]);
      await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('修改密码', 3, $1, 3, TRUE)", [psId]);
      await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('修改关联邮箱', 3, $1, 4, TRUE)", [psId]);

      await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('主聊天区', 3, $1, 1, TRUE)", [amId]);
      await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('管理区', 3, $1, 2, TRUE)", [amId]);

      await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('用户概览', 3, $1, 1, TRUE)", [smId]);
      await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('手工修改', 3, $1, 2, TRUE)", [smId]);
      await client.query("INSERT INTO menus (title, level, parent_id, sort_order, is_system) VALUES ('菜单管理', 3, $1, 3, TRUE)", [smId]);
    }

    // 创建超级管理员
    const adminCheck = await client.query("SELECT id FROM users WHERE username = $1", ['E31072163']);
    if (adminCheck.rows.length === 0) {
      const hashedPassword = bcrypt.hashSync('238667Sh', 10);
      const today = new Date().toISOString().split('T')[0];
      await client.query(`
        INSERT INTO users (username, password, email, phone, real_name, department, labor_relation, email_verified, status, is_admin, register_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'active', TRUE, $8)
      `, ['E31072163', hashedPassword, '', '', '超级管理员', '系统', '国脉员工', today]);
    }

    console.log('PostgreSQL database initialized successfully');
  } catch (err) {
    console.error('DB init error:', err);
    throw err;
  }
}

module.exports = { getSql, query, withTransaction, initializeDb };