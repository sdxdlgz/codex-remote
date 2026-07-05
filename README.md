# Codex Remote

> 在手机上通过浏览器实时查看、继续控制本地 Windows 上运行的 Codex CLI。

Codex Remote 是一个轻量的本地 Web 包装器：它在 Windows 本机启动 `codex`，把 Codex CLI 的终端输出通过 WebSocket 实时同步到手机浏览器，并允许你在手机上继续输入、发送回车、同意/拒绝权限请求、Ctrl+C、重启或停止会话。

推荐公网访问方式是：**Cloudflare Tunnel + Cloudflare Access**。这样不需要在路由器上开放端口，也不需要把本地服务直接暴露到公网。

---

## 功能特性

- **实时监控 Codex CLI**：手机浏览器里直接看到本地 Codex 终端输出。
- **手机端继续对话**：底部输入框发送内容到 Codex CLI。
- **常用审批快捷按钮**：`继续 / Enter`、`同意 y`、`拒绝 n`、`Ctrl+C`。
- **单控制端机制**：默认只有一个浏览器拥有控制权，其他浏览器只读；可手动“接管控制”。
- **断线恢复**：手机断网或关闭页面后，本地 Codex 进程继续运行；重新打开页面后自动回放最近输出并继续控制。
- **公网安全入口**：支持 Cloudflare Access 登录保护，并可限制允许访问的邮箱。
- **默认不保存完整日志**：终端输出只保存在内存 scrollback 中，不默认写入磁盘。

---

## 架构说明

```text
手机浏览器
   │
   │ HTTPS / WSS
   ▼
Cloudflare Access
   │
   ▼
Cloudflare Tunnel
   │
   ▼
http://127.0.0.1:8787
   │
   ▼
Codex Remote Node.js 服务
   │
   ├─ Express 静态页面
   ├─ WebSocket 实时通信
   └─ node-pty 启动/控制 Codex CLI
        │
        ▼
本地 codex 终端会话
```

核心实现：

- 后端：Node.js + Express + `ws` + `node-pty`
- 前端：移动端 Web 页面 + `xterm.js`
- 公网入口：Cloudflare Tunnel
- 身份保护：Cloudflare Access

---

## 目录结构

```text
codex-remote/
├─ public/
│  ├─ index.html       # 手机端页面
│  ├─ app.js           # WebSocket + xterm.js 前端逻辑
│  └─ styles.css       # 移动端样式
├─ src/
│  ├─ server.js        # HTTP/WebSocket 服务入口
│  ├─ codex-session.js # Codex CLI PTY 会话管理
│  ├─ auth.js          # Cloudflare Access / Origin 校验
│  ├─ config.js        # 环境变量配置解析
│  └─ scrollback-buffer.js
├─ test/
│  ├─ config.test.js
│  └─ scrollback-buffer.test.js
├─ .env.example
├─ .gitignore
├─ package.json
├─ package-lock.json
└─ README.md
```

---

## 环境要求

Windows 本机需要安装：

- Node.js 20+，推荐 Node.js 22+
- npm
- Codex CLI，并确保命令行里可以直接运行：

```powershell
codex --version
```

如果要公网手机访问，还需要：

- Cloudflare 账号
- 一个已接入 Cloudflare 的域名
- `cloudflared`
- Cloudflare Zero Trust / Access 配置权限

---

## 本地快速启动

进入项目目录：

```powershell
cd G:\idm\codex-remote
```

安装依赖：

```powershell
npm install
```

创建配置文件：

```powershell
Copy-Item .env.example .env
```

启动服务：

```powershell
npm start
```

默认监听：

```text
http://127.0.0.1:8787
```

本机浏览器打开后即可看到 Codex 终端页面。

---

## 手机端使用方式

手机端打开公网域名或本地地址后，可以使用以下功能：

- **实时终端区域**：显示 Codex CLI 当前输出。
- **输入框**：输入一行内容后点击“发送”，会以回车结尾发送给 Codex。
- **继续 / Enter**：向 Codex 发送一个回车。
- **同意 y**：向 Codex 发送 `y + Enter`。
- **拒绝 n**：向 Codex 发送 `n + Enter`。
- **Ctrl+C**：向 Codex 发送中断信号。
- **接管控制**：当你当前是 viewer，只读模式时，点击后成为 controller。
- **启动**：当前 Codex 会话未运行时启动。
- **重启会话**：停止当前会话并重新启动，同时清空页面回放缓存。
- **停止**：停止当前 Codex 会话。

页面右上角会显示：

- `online / offline`：WebSocket 连接状态
- `controller / viewer`：当前浏览器是否拥有控制权

---

## 配置说明

复制 `.env.example` 到 `.env` 后可修改：

```env
# 本地监听地址。公网部署时建议保持 127.0.0.1，只让 Cloudflare Tunnel 转发。
HOST=127.0.0.1
PORT=8787

# 可选：公网 URL，仅用于日志和状态显示。
PUBLIC_URL=

# Codex 进程启动命令。
CODEX_REMOTE_COMMAND=codex

# Codex 进程工作目录。留空时使用当前项目目录。
CODEX_REMOTE_CWD=

# 服务启动时是否自动启动 Codex 会话。
CODEX_REMOTE_AUTO_START=true

# 内存中保留最近多少字节终端输出，用于手机重连后回放。
REMOTE_HISTORY_BYTES=1048576

# 单次输入最大字节数。
MAX_INPUT_BYTES=8192

# 是否允许新连接的浏览器接管控制权。
ALLOW_CONTROL_TAKEOVER=true

# 公网访问时建议开启。开启后必须存在 Cloudflare Access 身份头。
REQUIRE_CF_ACCESS=false

# 可选：只允许这些 Cloudflare Access 邮箱访问，逗号分隔。
ACCESS_ALLOWED_EMAILS=

# 可选：限制 WebSocket/HTTP Origin，逗号分隔。
ALLOWED_ORIGINS=

# 位于 Cloudflare Tunnel/反代后时保持 true。
TRUST_PROXY=true
```

### 指定 Codex 工作目录

如果你希望 Codex 操作另一个项目目录，例如：

```powershell
G:\idm\my-project
```

可以设置：

```env
CODEX_REMOTE_CWD=G:\idm\my-project
CODEX_REMOTE_COMMAND=codex
```

### 给 Codex CLI 添加参数

例如你需要指定某些 Codex CLI 参数，可以直接写在命令里：

```env
CODEX_REMOTE_COMMAND=codex --some-flag
```

---

## Cloudflare Tunnel 公网部署

推荐生产访问链路：

```text
手机浏览器 -> Cloudflare Access -> Cloudflare Tunnel -> 127.0.0.1:8787 -> Codex Remote
```

### 1. 登录 Cloudflare

```powershell
cloudflared tunnel login
```

浏览器会打开 Cloudflare 授权页面，选择你的域名并授权。

### 2. 创建命名 Tunnel

```powershell
cloudflared tunnel create codex-remote
```

命令会生成一个 tunnel ID 和 credentials 文件，通常位于：

```text
C:\Users\你的用户名\.cloudflared\<TUNNEL_ID>.json
```

### 3. 绑定域名

假设你要使用：

```text
codex.example.com
```

执行：

```powershell
cloudflared tunnel route dns codex-remote codex.example.com
```

### 4. 创建 cloudflared 配置

编辑：

```text
%USERPROFILE%\.cloudflared\config.yml
```

示例：

```yaml
tunnel: codex-remote
credentials-file: C:\Users\YOUR_USER\.cloudflared\YOUR_TUNNEL_ID.json

ingress:
  - hostname: codex.example.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

注意替换：

- `codex.example.com`
- `YOUR_USER`
- `YOUR_TUNNEL_ID.json`

### 5. 配置 Cloudflare Access

进入 Cloudflare Dashboard：

```text
Zero Trust -> Access -> Applications -> Add an application
```

选择：

```text
Self-hosted
```

配置：

- Application name: `Codex Remote`
- Domain: `codex.example.com`
- Policy: 只允许你自己的邮箱或指定用户组

建议策略：

```text
Allow -> Emails -> your-email@example.com
```

### 6. 开启服务端 Access 校验

编辑 `.env`：

```env
PUBLIC_URL=https://codex.example.com
REQUIRE_CF_ACCESS=true
ACCESS_ALLOWED_EMAILS=your-email@example.com
```

`REQUIRE_CF_ACCESS=true` 会要求请求里存在 Cloudflare Access 注入的身份头：

- `Cf-Access-Authenticated-User-Email`
- `Cf-Access-Jwt-Assertion`

`ACCESS_ALLOWED_EMAILS` 会进一步限制允许访问的邮箱。

### 7. 启动 Codex Remote 和 Tunnel

终端 1：

```powershell
cd G:\idm\codex-remote
npm start
```

终端 2：

```powershell
cloudflared tunnel run codex-remote
```

手机访问：

```text
https://codex.example.com
```

完成 Cloudflare Access 登录后即可远程查看和控制 Codex。

---

## 临时 Quick Tunnel

项目内置一个快速测试脚本：

```powershell
npm run tunnel:quick
```

它会执行：

```powershell
cloudflared tunnel --url http://127.0.0.1:8787
```

注意：

- Quick Tunnel 适合临时测试。
- Quick Tunnel 域名通常不固定。
- 不建议用 Quick Tunnel 长期控制 Codex。
- 真正使用时请配置 Cloudflare Access 或其他强认证机制。

---

## 安全建议

因为这个项目可以从浏览器向本地 Codex CLI 发送终端输入，所以公网部署时务必注意：

1. **保持 `HOST=127.0.0.1`**
   - 不要直接监听 `0.0.0.0` 暴露给公网或局域网。
   - 让 Cloudflare Tunnel 访问本地 `127.0.0.1:8787`。

2. **公网使用时开启 `REQUIRE_CF_ACCESS=true`**
   - 防止未登录用户访问页面和 WebSocket。

3. **设置 `ACCESS_ALLOWED_EMAILS`**
   - 即使 Cloudflare Access 策略配置错误，本地服务仍会检查邮箱 allowlist。

4. **不要把 `.env` 提交到 Git**
   - `.gitignore` 已默认忽略 `.env`。

5. **不要在不可信网络下关闭 Access 校验**
   - `REQUIRE_CF_ACCESS=false` 只适合本地调试。

6. **不要直接信任伪造 Header 的公网请求**
   - 当前服务依赖 Cloudflare Tunnel + localhost 绑定来保证 Access Header 可信。
   - 如果你把服务直接暴露到公网，攻击者可能伪造类似 Header。

---

## 常用命令

```powershell
# 安装依赖
npm install

# 启动服务
npm start

# 开发模式，文件变化后自动重启
npm run dev

# 运行测试
npm test

# 临时 Cloudflare Quick Tunnel
npm run tunnel:quick
```

---

## 健康检查

服务启动后可以访问：

```text
http://127.0.0.1:8787/healthz
```

示例响应：

```json
{
  "ok": true,
  "session": {
    "command": "codex",
    "cwd": "G:\\idm\\codex-remote",
    "status": "running",
    "cols": 100,
    "rows": 30,
    "startedAt": "2026-07-05T09:00:00.000Z",
    "endedAt": null,
    "exitCode": null,
    "signal": null,
    "lastError": ""
  }
}
```

---

## WebSocket 协议概览

前端连接：

```text
/ws
```

服务端事件类型：

- `hello`：连接初始化，返回客户端 ID、角色、配置、会话状态。
- `output`：Codex 终端输出。
- `status`：Codex 会话状态变化。
- `presence`：当前连接列表和 controller 信息。
- `role`：当前浏览器角色变化。
- `clear`：清空前端终端显示。
- `error`：错误消息。

客户端事件类型：

- `input`：发送原始输入到 Codex PTY。
- `macro`：发送快捷操作，例如 `continue`、`approve`、`reject`、`ctrlC`。
- `takeControl`：接管控制权。
- `resize`：同步终端尺寸。
- `start`：启动 Codex 会话。
- `stop`：停止 Codex 会话。
- `restart`：重启 Codex 会话。

---

## 测试

运行：

```powershell
npm test
```

当前测试覆盖：

- 环境变量布尔值解析
- CSV allowlist 解析
- 默认配置解析
- Access 邮箱小写化
- scrollback buffer 截断和清空逻辑

---

## 故障排查

### 页面能打开，但终端没有输出

检查 Codex 是否能在本机直接运行：

```powershell
codex --version
```

也可以先关闭自动启动再手动点击页面里的“启动”：

```env
CODEX_REMOTE_AUTO_START=false
```

### 手机无法访问公网域名

检查：

```powershell
cloudflared tunnel run codex-remote
```

是否正在运行，并确认 `config.yml` 中 hostname 和 service 正确。

### Cloudflare Access 登录后仍然 401

确认 `.env`：

```env
REQUIRE_CF_ACCESS=true
```

并确认请求确实经过 Cloudflare Access，而不是直接访问本地端口。

### 登录后提示邮箱不允许

检查：

```env
ACCESS_ALLOWED_EMAILS=your-email@example.com
```

邮箱需要和 Cloudflare Access 传给源站的邮箱一致。

### WebSocket 一直重连

检查：

- Cloudflare Access 是否同时保护了 WebSocket 请求。
- Tunnel 是否转发到 `http://127.0.0.1:8787`。
- 浏览器控制台是否有 401/403。
- `.env` 中 `ALLOWED_ORIGINS` 是否写错。

### `node-pty` 安装失败

确认 Node.js 和 npm 正常：

```powershell
node -v
npm -v
```

建议使用 Node.js 20+ 或 22+。如果仍失败，删除依赖后重装：

```powershell
Remove-Item node_modules -Recurse -Force
Remove-Item package-lock.json -Force
npm install
```

---

## GitHub SSH 上传

如果你要把项目推送到 GitHub：

```powershell
git init
git add .
git commit -m "Initial Codex Remote implementation"
git branch -M main
git remote add origin git@github.com:sdxdlgz/codex-remote.git
git push -u origin main
```

确保本机 SSH key 已添加到 GitHub：

```powershell
ssh -T git@github.com
```

---

## 许可

当前仓库未声明开源许可证。若需要公开分发，请根据你的用途补充 `LICENSE` 文件。
