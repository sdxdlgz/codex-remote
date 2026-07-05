# Codex Remote

> 在手机上通过浏览器实时查看、继续控制本地 Windows 上运行的 Codex CLI。

Codex Remote 是一个轻量的本地 Web 包装器：它在 Windows 本机启动 `codex`，把 Codex CLI 的终端输出通过 WebSocket 实时同步到手机浏览器，并允许你在手机上继续输入、发送回车、同意/拒绝权限请求、Ctrl+C、重启或停止会话。

推荐公网访问方式是：**Cloudflare Tunnel + Cloudflare Access**；如果暂时没有配置 Access，也可以启用内置 `REMOTE_AUTH_TOKEN` 登录口令。

## 功能特性

- 实时查看本地 Codex CLI 输出。
- 手机端继续输入对话内容。
- 快捷按钮：`继续 / Enter`、`同意 y`、`拒绝 n`、`Ctrl+C`。
- 单控制端机制：一个浏览器拥有控制权，其它浏览器只读；可手动接管。
- 断线恢复：手机断开后本地 Codex 继续运行，重连后自动回放最近输出。
- 公网保护：支持内置访问口令，也可叠加 Cloudflare Access。
- 默认不落盘完整终端日志，只保留内存 scrollback。

## 架构

```text
手机浏览器
  │ HTTPS / WSS
  ▼
Cloudflare Tunnel / Cloudflare Access
  │
  ▼
http://127.0.0.1:8787
  │
  ▼
Codex Remote Node.js 服务
  ├─ Express 静态页面
  ├─ WebSocket 实时通信
  └─ node-pty 启动/控制 Codex CLI
      │
      ▼
本地 codex 终端会话
```

## 目录结构

```text
public/              手机端页面、样式和前端 WebSocket 逻辑
src/server.js        HTTP/WebSocket 服务入口
src/codex-session.js Codex CLI PTY 会话管理
src/auth.js          内置口令、Cloudflare Access、Origin 校验
src/config.js        环境变量配置解析
test/                单元测试
.env.example         配置模板
```

## 环境要求

- Windows
- Node.js 20+，推荐 Node.js 22+
- npm
- Codex CLI，且命令行中可运行 `codex --version`
- 公网部署需要 `cloudflared` 和已托管到 Cloudflare 的域名

## 本地启动

```powershell
cd G:\idm\codex-remote
npm install
Copy-Item .env.example .env
npm start
```

默认本地地址：

```text
http://127.0.0.1:8787
```

## 配置说明

`.env` 示例：

```env
HOST=127.0.0.1
PORT=8787
PUBLIC_URL=https://codex.example.com

CODEX_REMOTE_COMMAND=codex
CODEX_REMOTE_CWD=G:\idm\codex-remote
CODEX_REMOTE_AUTO_START=true

REMOTE_HISTORY_BYTES=1048576
MAX_INPUT_BYTES=8192
ALLOW_CONTROL_TAKEOVER=true

# 内置登录口令。公网部署且没有 Cloudflare Access 时强烈建议设置强随机值。
REMOTE_AUTH_TOKEN=
AUTH_COOKIE_NAME=codex_remote_token

# 可选：叠加 Cloudflare Access 校验。
REQUIRE_CF_ACCESS=false
ACCESS_ALLOWED_EMAILS=

# 可选：限制允许的浏览器来源。
ALLOWED_ORIGINS=https://codex.example.com,http://127.0.0.1:8787,http://localhost:8787
TRUST_PROXY=true
```

说明：

- `HOST=127.0.0.1`：推荐保持 localhost，只允许 Cloudflare Tunnel 转发。
- `CODEX_REMOTE_COMMAND`：启动 Codex 的命令，可加 CLI 参数。
- `CODEX_REMOTE_CWD`：Codex 会话工作目录。
- `REMOTE_AUTH_TOKEN`：启用后访问页面会先要求输入口令，WebSocket 也会校验 cookie。
- `REQUIRE_CF_ACCESS=true`：要求请求经过 Cloudflare Access，并携带 Access 身份头。
- `ACCESS_ALLOWED_EMAILS`：Cloudflare Access 邮箱 allowlist，逗号分隔。

## Cloudflare Tunnel 部署

推荐访问链路：

```text
手机浏览器 -> Cloudflare Tunnel -> 127.0.0.1:8787 -> Codex Remote
```

如果你也配置了 Cloudflare Access，则链路为：

```text
手机浏览器 -> Cloudflare Access -> Cloudflare Tunnel -> 127.0.0.1:8787 -> Codex Remote
```

创建 tunnel：

```powershell
cloudflared tunnel login
cloudflared tunnel create codex-remote
cloudflared tunnel route dns codex-remote codex.example.com --overwrite-dns
```

配置 `%USERPROFILE%\.cloudflared\codex-remote.yml`：

```yaml
tunnel: codex-remote
credentials-file: C:\Users\YOUR_USER\.cloudflared\YOUR_TUNNEL_ID.json
protocol: http2

ingress:
  - hostname: codex.example.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

启动：

```powershell
npm start
cloudflared tunnel --config $env:USERPROFILE\.cloudflared\codex-remote.yml run codex-remote
```

## Windows 开机自启建议

可以用计划任务分别启动：

- Codex Remote Node 服务
- Cloudflare Tunnel

本仓库的部署脚本会把日志写入：

```text
logs/codex-remote.log
logs/cloudflared-codex-remote.log
```

## 手机端使用

- 打开公网域名，例如 `https://codex.example.com`。
- 输入访问口令或完成 Cloudflare Access 登录。
- 右上角 `controller` 表示当前浏览器拥有控制权。
- 输入框发送新对话。
- 使用快捷按钮处理常见审批提示。
- 如果是 `viewer`，点击“接管控制”。

## 安全建议

1. 保持 `HOST=127.0.0.1`，不要把服务直接绑定到公网网卡。
2. 公网部署至少启用一种认证：`REMOTE_AUTH_TOKEN` 或 Cloudflare Access。
3. 如果开启 Cloudflare Access，建议同时设置 `ACCESS_ALLOWED_EMAILS`。
4. 不要提交 `.env`，其中可能包含访问口令。
5. 不要把 Cloudflare tunnel credential JSON 提交到 Git。
6. 这个项目可以向本地 Codex CLI 发送终端输入，请只给可信用户访问权限。

## 常用命令

```powershell
npm install
npm start
npm run dev
npm test
npm run tunnel:quick
```

## 健康检查

```text
http://127.0.0.1:8787/healthz
```

## 测试

```powershell
npm test
```

当前测试覆盖配置解析和 scrollback buffer 行为。

## 故障排查

### 页面可打开但没有 Codex 输出

检查 Codex CLI：

```powershell
codex --version
```

也可以设置：

```env
CODEX_REMOTE_AUTO_START=false
```

然后在页面点击“启动”。

### WebSocket 一直重连

检查：

- tunnel 是否转发到 `http://127.0.0.1:8787`
- `ALLOWED_ORIGINS` 是否包含公网域名
- 浏览器是否已登录并带有 cookie
- Cloudflare Access 是否保护了 WebSocket 请求

### 登录后仍 401

检查 `.env` 中 `REMOTE_AUTH_TOKEN` 是否和输入口令一致；如果开启了 Cloudflare Access，还要确认请求确实经过 Access。

## GitHub

```text
https://github.com/sdxdlgz/codex-remote
```
