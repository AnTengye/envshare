# EnvShare Pro

基于最新 **Next.js App Router + Web Crypto API (AES-GCM)** 重写的零知识端到端加密分享工具。在保留原版 `envshare` 极简暗黑体验的基础上，针对高频痛点进行了全方位升级：

1. **链接 + 手机二维码同屏直出**：生成加密链接的同时，直接在浏览器本地渲染高清二维码（支持放大扫码、下载 PNG），手机一扫即可查看文本、保存图片或下载安装 APK。
2. **默认短效与阅后即焚**：默认选中 **「1 次读取（阅后即焚）+ 1 小时过期」**，提供胶囊快捷切换，并自动在浏览器记住你的上次偏好。
3. **文本 / 截图粘贴 / 大文件（APK）三合一**：
   - **文本 / `.env`**：等宽编辑器，支持拖拽导入文本文件、掩码查看与一键复制。
   - **图片 / 截图**：支持在页面任意位置按 `Ctrl+V / ⌘V` 直接粘贴剪贴板截图，解密端直接渲染高清大图预览。
   - **文件 / APK**：原生二进制流 AES-GCM 加密直传（0% Base64 体积膨胀），支持实时上传/下载进度条。

---

## 双模式部署方案（同一套代码自适应）

| 特性 | ☁️ Vercel 一键部署版 (`vercel`) | 🖥️ 自建 Pro 完整版 (`self-hosted`) |
| :--- | :--- | :--- |
| **单次大小上限** | **16 KB** | **默认 100 MB**（可通过 `MAX_FILE_SIZE_MB` 自定义） |
| **适用场景** | `.env` 环境变量、密钥文本、代码片段 | 文本 + 剪贴板截图 + **APK 安装包 / 大文件** |
| **存储后端** | Upstash Redis Serverless | 本地磁盘加密块存储（零外部 Redis 依赖） |
| **触发方式** | 部署于 Vercel 或设置 `ENVSHARE_MODE=vercel` | Docker / Node 自建运行（默认开启） |

---

### 方案 A：Vercel 一键部署（16 KB 轻量版）

1. Fork 本仓库并导入到 Vercel。
2. 在 Vercel 项目中添加 **Upstash Redis** 集成（或手动配置 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`）。
3. 部署完成后将自动运行于 **Vercel 16 KB 模式**。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fchronark%2Fenvshare&env=UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN)

---

### 方案 B：Docker 自建部署（支持 100 MB+ 大文件与 APK）

无需注册任何外部 Redis 或对象存储，一行命令即可启动：

```bash
docker compose up -d --build
```

或者使用 Node.js 直接运行：

```bash
npm install
npm run build
npm run start
```

加密后的文件存储在 `./data` 目录下，当达到可读取次数（如阅后即焚读取 1 次后）或到期后，服务端会立即从磁盘彻底抹除对应密文文件。
