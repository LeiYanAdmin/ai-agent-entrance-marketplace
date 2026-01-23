#!/usr/bin/env bash
# SessionStart hook for ai-agent-entrance plugin
# 功能：注入路由 Skill + 检查待沉淀知识

set -euo pipefail

# ════════════════════════════════════════════════════════════════
# 1. 确定插件根目录
# ════════════════════════════════════════════════════════════════
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ════════════════════════════════════════════════════════════════
# 2. 读取核心 Skill 内容
# ════════════════════════════════════════════════════════════════
agent_router_content=$(cat "${PLUGIN_ROOT}/skills/agent-router/SKILL.md" 2>&1 || echo "Error reading agent-router skill")

# ════════════════════════════════════════════════════════════════
# 3. 检查待沉淀知识（上次会话遗留）
# ════════════════════════════════════════════════════════════════
pending_knowledge=""
pending_file="${HOME}/.ai-agent-entrance/pending-sink.json"

if [ -f "$pending_file" ]; then
    pending_count=$(jq -r '.items | length' "$pending_file" 2>/dev/null || echo "0")
    if [ "$pending_count" -gt 0 ]; then
        # 读取待沉淀项目摘要
        pending_items=$(jq -r '.items[] | "• \(.type): \(.summary)"' "$pending_file" 2>/dev/null | head -5)
        pending_knowledge="
<pending-knowledge-reminder>
🔔 **上次会话有 ${pending_count} 条知识待沉淀：**

${pending_items}

输入 \`/knowledge\` 立即沉淀，或输入 \`/knowledge skip\` 跳过。
</pending-knowledge-reminder>"
    fi
fi

# ════════════════════════════════════════════════════════════════
# 4. 检查已安装的工具
# ════════════════════════════════════════════════════════════════
installed_tools=""

# 检查 Superpowers
if claude plugin list 2>/dev/null | grep -q "superpowers"; then
    installed_tools="${installed_tools}\\n- superpowers ✅"
fi

# 检查 BMAD
if [ -d ".bmad" ] || command -v bmad &>/dev/null; then
    installed_tools="${installed_tools}\\n- bmad ✅"
fi

# 检查 OpenSpec
if [ -d "openspec" ]; then
    installed_tools="${installed_tools}\\n- openspec ✅"
fi

# 检查 SpecKit
if claude plugin list 2>/dev/null | grep -q "speckit"; then
    installed_tools="${installed_tools}\\n- speckit ✅"
fi

tools_status=""
if [ -n "$installed_tools" ]; then
    tools_status="
<installed-tools>
已安装的开发工具：${installed_tools}
</installed-tools>"
fi

# ════════════════════════════════════════════════════════════════
# 5. JSON 转义函数
# ════════════════════════════════════════════════════════════════
escape_for_json() {
    local input="$1"
    local output=""
    local i char
    for (( i=0; i<${#input}; i++ )); do
        char="${input:$i:1}"
        case "$char" in
            $'\\') output+='\\\\' ;;
            '"') output+='\"' ;;
            $'\n') output+='\\n' ;;
            $'\r') output+='\\r' ;;
            $'\t') output+='\\t' ;;
            *) output+="$char" ;;
        esac
    done
    printf '%s' "$output"
}

router_escaped=$(escape_for_json "$agent_router_content")
pending_escaped=$(escape_for_json "$pending_knowledge")
tools_escaped=$(escape_for_json "$tools_status")

# ════════════════════════════════════════════════════════════════
# 6. 输出 JSON（注入到会话上下文）
# ════════════════════════════════════════════════════════════════
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<ai-agent-entrance>\\n\\n**智能路由已激活** - 我会根据你的需求自动推荐最佳开发流程。\\n\\n${router_escaped}\\n\\n${pending_escaped}\\n\\n${tools_escaped}\\n\\n</ai-agent-entrance>"
  }
}
EOF

exit 0
