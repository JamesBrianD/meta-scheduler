# cc-connect 配置指南

通过 cc-connect 将 Claude Code 桥接到飞书，实现在飞书中远程操控 Claude Code。

## 安装

```bash
npm install -g cc-connect
```

## 飞书应用配置

1. 打开 https://open.feishu.cn → 控制台 → 创建企业自建应用
2. 开启 **机器人** 能力（应用能力 → 机器人）
3. **权限管理** → 添加 `im:message.receive_v1`、`im:message:send_as_bot`
4. **事件订阅** → 选择 **WebSocket 长连接模式** → 添加事件 `im.message.receive_v1`
5. 发布应用版本
6. 复制 **App ID** 和 **App Secret**

## 配置文件

路径：`~/.cc-connect/config.toml`

```toml
data_dir = ""
language = "zh"

[[projects]]
  name = "meta-scheduler"
  quiet = true                        # 静默模式，只推送关键回复
  [projects.agent]
    type = "claudecode"
    [projects.agent.options]
      mode = "bypassPermissions"      # yolo 模式
      work_dir = "/Users/ramezes/job/meta-scheduler"

  [[projects.platforms]]
    type = "feishu"
    [projects.platforms.options]
      app_id = "<your-app-id>"
      app_secret = "<your-app-secret>"

[log]
  level = "info"

[display]
  progress_style = "compact"          # 飞书进度用紧凑样式

[stream_preview]
  enabled = false                     # 关掉流式预览，减少刷屏
```

### 关键配置说明

| 配置项 | 作用 |
|--------|------|
| `quiet = true` | 默认静默，只推送里程碑、结论、需要拍板的回复 |
| `stream_preview.enabled = false` | 关闭流式预览，避免飞书刷屏 |
| `progress_style = "compact"` | 紧凑进度样式 |
| `mode = "bypassPermissions"` | Claude Code 跳过所有权限确认 |

### 多项目配置

同一个飞书 bot 可以管理多个项目，添加多个 `[[projects]]` 块即可：

```toml
[[projects]]
  name = "sgl-jax"
  quiet = true
  [projects.agent]
    type = "claudecode"
    [projects.agent.options]
      mode = "bypassPermissions"
      work_dir = "/Users/ramezes/job/sgl-project/sgl-jax"

  [[projects.platforms]]
    type = "feishu"
    [projects.platforms.options]
      app_id = "<same-app-id>"
      app_secret = "<same-app-secret>"
```

在飞书中通过命令切换项目：

- `/new <project-name>` — 在指定项目下新建会话
- `/list` — 列出所有会话
- `/switch <id>` — 切换会话
- `/stop` — 停止当前执行

## 运行

### 手动启动

```bash
# 在 Claude Code 会话内需先 unset CLAUDECODE
unset CLAUDECODE && cc-connect
```

### 后台服务（推荐）

```bash
# 安装为系统服务（macOS 用 launchd，开机自启）
cc-connect daemon install --config ~/.cc-connect/config.toml
cc-connect daemon start

# 改配置后重启
cc-connect daemon restart

# 其他命令
cc-connect daemon status
cc-connect daemon logs -f
cc-connect daemon stop
cc-connect daemon uninstall
```
