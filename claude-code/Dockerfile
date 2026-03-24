# 使用官方 Python 3.12 环境作为基座
FROM python:3.12-bookworm

# 切换到 root 安装系统工具
USER root

# 1. 安装基础依赖
RUN apt-get update && apt-get install -y \
    git \
    vim \
    curl \
    sudo \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# 2. 安装 Node.js 24 (2026 稳定版)
# 使用 NodeSource 官方源进行安装
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest

# 3. 全局安装 Claude Code
RUN npm install -g @anthropic-ai/claude-code

# 设置工作目录
WORKDIR /app

# 默认进入 bash，方便你进去“指点江山”
CMD ["/bin/bash"]