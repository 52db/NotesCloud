export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // --- 调试版鉴权函数 ---
    const getDebugInfo = (req) => {
      const auth = req.headers.get("Authorization");
      
      // 1. 获取原始变量
      const rawKey = env.ADMIN_KEY;
      const rawKeys = env.ADMIN_KEYS;

      // 2. 生成白名单
      let allowedList = [];
      if (rawKey) allowedList.push(rawKey.trim());
      if (rawKeys) {
        // 同时尝试用 英文逗号 和 中文逗号 分割，以防万一
        const splitKeys = rawKeys.replace(/，/g, ',').split(',');
        allowedList = allowedList.concat(splitKeys.map(k => k.trim()).filter(k => k !== ""));
      }

      const receivedKey = auth ? auth.trim() : "null (未收到 Header)";
      const isMatch = allowedList.includes(receivedKey);

      return {
        success: isMatch,
        debugMsg: {
          message: "鉴权调试报告",
          received_from_frontend: receivedKey, // 前端发过来的是什么
          env_ADMIN_KEY: rawKey || "未读取到 (undefined)", // 变量1读取到了吗
          env_ADMIN_KEYS: rawKeys || "未读取到 (undefined)", // 变量2读取到了吗
          parsed_whitelist: allowedList, // 最终生成的白名单列表
          compare_result: isMatch ? "通过" : "失败"
        }
      };
    };

    const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
      status: status, headers: { "Content-Type": "application/json", ...corsHeaders }
    });

    try {
      // 仅拦截 /api/save 用于测试
      if (new URL(request.url).pathname === "/api/save" && request.method === "POST") {
        const authCheck = getDebugInfo(request);
        
        // 如果失败，返回详细的调试信息
        if (!authCheck.success) {
          return jsonResponse({ 
            error: "DEBUG_MODE_FAIL", 
            details: authCheck.debugMsg 
          }, 401);
        }
        
        // ... 如果成功，继续原来的保存逻辑 (此处省略，仅为了测试连接) ...
        // 为了安全起见，调试模式下即使成功也不真正写入数据库，只返回成功消息
        return jsonResponse({ success: true, msg: "调试模式：鉴权通过！Key 配置正确。" });
      }

      // 所有的其他请求，都先返回调试信息，方便您直接在浏览器访问 /api/list 查看
      if (new URL(request.url).pathname === "/api/list") {
          const authCheck = getDebugInfo(request);
          if (!authCheck.success) return jsonResponse({ error: "DEBUG_MODE_FAIL", details: authCheck.debugMsg }, 401);
          return jsonResponse([{id:1, content: "调试通过", created_at: Date.now()}]); // 假数据
      }
      
      return new Response("Debug Mode Active", { headers: corsHeaders });

    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }
};
