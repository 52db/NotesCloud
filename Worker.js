export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // --- CORS 配置 (允许跨域) ---
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", 
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- 辅助函数 ---
    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status: status,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    };

    // --- 1. 检查数据库绑定 (关键排查步骤) ---
    // 如果你在 Cloudflare 设置里没有把变量名设为 "DB"，这里会明确报错
    if (!env.DB) {
      return jsonResponse({ error: "Server Configuration Error: 'DB' binding not found. Please bind D1 database as variable 'DB'." }, 500);
    }

    // --- 2. 鉴权逻辑 (支持多密码) ---
    const checkAuth = (req) => {
      const auth = req.headers.get("Authorization");
      if (!env.ADMIN_KEY) return false;

      // 分割逗号，并清理空格
      const validKeys = env.ADMIN_KEY.split(',').map(k => k.trim());
      
      // 检查前端发来的 Key 是否在白名单列表中
      // 注意：前端必须只发其中一个 Key，不能发一串
      return auth && validKeys.includes(auth);
    };

    try {
      // --- API 路由 ---

      // 保存 (POST)
      if (path === "/api/save" && request.method === "POST") {
        if (!checkAuth(request)) return jsonResponse({ error: "鉴权失败：密码错误" }, 401);
        
        const body = await request.json();
        const isShare = body.is_share ? 1 : 0;
        const publicId = body.public_id || null;
        
        await env.DB.prepare(
          "INSERT INTO notes (content, is_share, public_id) VALUES (?, ?, ?)"
        ).bind(body.content, isShare, publicId).run();

        return jsonResponse({ success: true });
      }

      // 获取列表 (GET)
      if (path === "/api/list" && request.method === "GET") {
        if (!checkAuth(request)) return jsonResponse({ error: "鉴权失败：密码错误" }, 401);

        const { results } = await env.DB.prepare(
          "SELECT id, content, created_at FROM notes WHERE is_share = 0 ORDER BY id DESC"
        ).all();

        return jsonResponse(results);
      }

      // 删除 (POST)
      if (path === "/api/delete" && request.method === "POST") {
        if (!checkAuth(request)) return jsonResponse({ error: "鉴权失败：密码错误" }, 401);
        
        const body = await request.json();
        await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(body.id).run();
        
        return jsonResponse({ success: true });
      }

      // AI 总结 (POST)
      if (path === "/api/ai-sum" && request.method === "POST") {
        if (!checkAuth(request)) return jsonResponse({ error: "鉴权失败：密码错误" }, 401);

        const body = await request.json();
        // 简单检查 AI 绑定
        if (!env.AI) return jsonResponse({ error: "Server Error: 'AI' binding not found" }, 500);

        const aiRes = await env.AI.run('@cf/qwen/qwen1.5-7b-chat-awq', {
          messages: [
            { role: "system", content: "你是一个专业的笔记助手。请用中文简明扼要地总结用户的笔记内容，提取核心要点。" },
            { role: "user", content: body.text }
          ]
        });

        return jsonResponse({ summary: aiRes.response });
      }

      // 阅后即焚 (GET)
      const shareMatch = path.match(/^\/api\/share\/([a-zA-Z0-9]+)$/);
      if (shareMatch && request.method === "GET") {
        const shareId = shareMatch[1];
        const note = await env.DB.prepare(
          "SELECT * FROM notes WHERE public_id = ? AND is_share = 1"
        ).bind(shareId).first();

        if (!note) return jsonResponse({ error: "笔记不存在或已销毁" }, 404);

        await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(note.id).run();
        return jsonResponse({ content: note.content });
      }

      if (path === "/") return new Response("CloudNotes API Running", { status: 200, headers: corsHeaders });
      return jsonResponse({ error: "Not Found" }, 404);

    } catch (e) {
      // 返回详细错误信息以便排查
      return jsonResponse({ error: "Server Exception: " + e.message }, 500);
    }
  }
};
