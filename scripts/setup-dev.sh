#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  开发机初始化脚本
#  用法: curl ... | sudo bash -s -- <GH_TOKEN>
#    或: sudo bash setup-dev.sh <GH_TOKEN>
# ============================================================

GH_TOKEN="${1:?❌ 缺少参数! 用法: sudo bash setup-dev.sh <你的GH_TOKEN>}"

echo "========== [1/4] apt update =========="
apt update

echo "========== [2/4] 安装 gh & tmux =========="
apt install -y gh tmux vim

echo "========== [3/4] 安装 Claude Code =========="
# 官方推荐的原生安装方式，无需 Node.js

# 兼容两种场景: sudo 跑 / 直接 root 跑
REAL_USER="${SUDO_USER:-${USER:-root}}"

# 封装: 如果实际用户就是 root，直接跑；否则 su 切过去
run_as_user() {
    if [ "$REAL_USER" = "root" ] || [ "$(id -u)" = "0" ] && [ -z "${SUDO_USER:-}" ]; then
        bash -c "$1"
    else
        su - "$REAL_USER" -c "$1"
    fi
}

run_as_user 'curl -fsSL https://claude.ai/install.sh | bash'

# 确保 claude 在 PATH 中
if ! run_as_user 'command -v claude' &>/dev/null; then
    echo "[info] 将 Claude Code 路径加入 PATH..."
    run_as_user 'echo '\''export PATH="$HOME/.claude/bin:$HOME/.local/bin:$PATH"'\'' >> ~/.bashrc'
fi

echo "========== [4/4] gh 登录 =========="
run_as_user "echo '${GH_TOKEN}' | gh auth login --with-token"
run_as_user "gh auth status"

echo ""
echo "========== 全部完成! =========="
echo "  - gh / tmux 已安装"
echo "  - Claude Code 已安装 (新终端生效或 source ~/.bashrc)"
echo "  - gh 已登录"
echo ""
echo "提示: 打开新终端后运行 'claude' 即可启动 Claude Code"
