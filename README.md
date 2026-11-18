# 撸了么

从零开发的个人节奏记录网站。网页放在 GitHub Pages，个人记录可以通过 Cloudflare Worker + D1 在手机和电脑间同步。不包含排行榜或提醒，也不调用其他项目的后台接口。

## 已有功能

- 只记录“撸了”，同一天可以添加多次；每次保留独立发生时间，支持修改时间、删除和历史补记，不接受未来日期或发生时间。
- 从第一次“撸了”的日期到今天统计，包含今天；期间没有记录的日期自动计作“没撸”，首次记录之前的日期不纳入统计。
- 日历显示当天次数；统计天数、累计撸了次数、当前和最长连续没撸天数、本月没撸占比均按上述范围计算。今天的状态统计至当前时间，新增、补记或删除记录后自动重算。
- 一张统计图切换日期、星期、时段和月份维度；每日和月度默认折线，星期和时段默认柱状，也可手动切换图形。支持 7 / 30 / 90 天范围（月度展示最近六个月）、悬停或轻点查看次数，以及对应维度的数值明细；统计范围内无事件的日期显示零次，首次记录之前留空。
- “节奏蓄能站”：距离最近一次“撸了”的时间、蓄能动画、0 / 24 / 48 / 72 / 120 小时时间节点、下一节点倒计时和可展开趋势。支持精确调整起点，新的记录会重新开始计时。蓄能比例只表示时间进度，不是身体健康评估。
- 本机自动保存、JSON 导出和导入、手机和电脑布局、PWA 安装及离线使用。
- 可选的个人云端同步，随机同步密钥隔离空间，删除标记及断网修改也会同步。

前端没有第三方运行依赖，不需要安装依赖或进行框架构建。

## 本机预览

安装 Node.js 22 或更高版本，在此目录执行：

```powershell
npm run dev
```

浏览器打开 `http://127.0.0.1:4173/lulema/`。测试：

```powershell
npm test
```

没有配置云端地址时，所有记录只保存在当前浏览器。清除浏览器网站数据会删除本机记录，请导出备份或连接云端。

## 发布到 GitHub Pages，保留现有 Hexo 博客

1. 在你的 GitHub 账号中新建 **公开**仓库 `lulema`，不要修改现有 `dl-xuyongqing.github.io` 仓库。
2. 把本项目提交到新仓库的 `main` 分支，包括 `.github/workflows/pages.yml`。不要提交 `node_modules`、`artifacts`、密钥或环境文件。
3. 新仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
4. 在 **Actions** 中运行 `Deploy website to GitHub Pages`，或向 `main` 推送一次变更。
5. 部署完成后打开 `https://dl-xuyongqing.github.io/lulema/`。

流程自动执行测试，仅上传网页、样式、图标和前端脚本；Worker 源代码及测试不会作为部署产物上传。所有网页资源使用相对路径，根网址和 `/lulema/` 都可使用；Hexo 仍独立发布。

若希望不用 Actions，也可以把 `node scripts/build.mjs` 生成的 `artifacts/site` 内容放到专用发布分支，在 Pages 中选择 **Deploy from a branch**。不要把它发布到 Hexo 仓库。

## 配置 Cloudflare Worker + D1

需要你自己的 Cloudflare 账号。Worker 和 D1 可以从免费方案开始使用，适用平台当前的免费额度。GitHub Pages 不需要付费账号，但仓库需要公开。

在项目根目录执行：

```powershell
npm install
npx wrangler login
npx wrangler d1 create lulema
```

打开 `worker/wrangler.jsonc`，把返回的数据库 UUID 填入 `database_id`。`binding` 保持 `DB`，`database_name` 保持 `lulema`。如果你的数据库用了别的名称，也要调整下面命令中的名称。

`ALLOWED_ORIGINS` 已包含 `https://dl-xuyongqing.github.io` 和本机预览地址。Origin 只包括协议和域名，不包含 `/lulema/`。如果更换部署域名，在这里加入实际域名，用英文逗号分隔；不使用 `*`。

执行建表和发布：

```powershell
npm run db:migrate
npm run worker:deploy
```

发布后 Cloudflare 会给出类似 `https://lulema-api.你的账号.workers.dev` 的地址。打开该地址的 `/api/health` 应返回 `{"ok":true,"service":"lulema"}`。这仅检查接口可用，数据库建表是否成功要以实际连接同步为准。

打开网页的 **同步与备份**，填写你部署的 Worker 根地址。服务地址默认留空；连接成功后只保存在当前浏览器，下次打开会显示已保存的连接。断开连接后地址恢复为空。

1. 点击 **生成新密钥**，复制并妥善保存。
2. 点击 **连接并同步**。本机记录与对应云端空间会合并。
3. 在另一台设备打开同一网站，填写相同服务地址和密钥，点击 **连接并同步**。

同步密钥是 192 位随机访问凭证，仅经 HTTPS 请求的 `Authorization` 头发送；数据库只存其 SHA-256 摘要作为空间标识。不要把个人密钥写入 `config.js`、提交到 GitHub 或发送给别人。没有邮箱或找回机制；遗失全部设备中的密钥后无法找回对应云端空间，但仍可通过本机备份建立新的空间。

记录会在修改后、联网后、回到页面时及页面打开期间每分钟尝试同步。只上传变化的记录；同一条记录的冲突按修改时间决定，同一天在不同设备新增的记录各自保留；时间相同按随机修改 ID 决定，确保各设备最终一致。删除记录会留下同步删除标记，不被旧设备再次恢复。新增、修改、导入和云端接收记录时都校验未来发生时间；请保持设备时间准确，服务端还会拒绝超过服务器五分钟的修改时间。

云端不提供端到端加密，Cloudflare 账户的管理者可以读取 D1 数据。断开云端连接保留本机及云端记录；删除一条记录会在下次同步时同步到其他设备。

## 从单日记录版升级

本机旧记录会自动转换为独立记录；旧版 JSON 备份可直接导入。旧“撸了”记录保留原日期和时间；旧“没撸”记录保留在备份和同步数据中，但不再显示或参与统计。重复导入同一份备份不会新增重复记录。删除最早的一次记录后，统计起点跟随剩余记录；删除全部“撸了”记录后恢复未开始统计状态。

已经使用多次记录版时，更新前端并重新执行 `npm run worker:deploy`，使云端也拒绝未来发生时间；这次统计规则调整不需要新增数据库迁移。

已经配置云端时，先更新数据库和 Worker，再发布新版网页：

```powershell
npm run db:migrate
npm run worker:deploy
```

`0002_multiple_records.sql` 创建独立记录表并保留旧数据和删除标记。新版网页使用 `/api/v2/state`、`/api/v2/sync`；旧版接口仍可读取、修改原有日记录，新版会合并这些修改。旧版网页无法显示新版新增的多条记录，所有设备都应刷新到新版。若 Worker 尚未升级，新版网页会提示升级，本机仍可记录。

## 本机调试云端

填写真实的 D1 UUID 后，在独立终端运行：

```powershell
npx wrangler d1 migrations apply lulema --local --config worker/wrangler.jsonc
npm run worker:dev
```

网页填入 Wrangler 显示的本机地址（通常为 `http://localhost:8787`）。只有 localhost / 127.0.0.1 的服务地址允许 HTTP；正式服务必须使用 HTTPS。

## 文件结构

```text
index.html                  页面
styles.css                  响应式样式
config.js                   前端配置（不预设云端服务地址）
src/                        打卡逻辑、备份与同步
assets/                     自绘图标
sw.js                       仅限本项目范围的离线缓存
worker/index.js             Worker 入口
worker/api.js               接口、访问校验与数据库读写
worker/wrangler.jsonc        Cloudflare 配置
worker/migrations/          D1 数据表
.github/workflows/pages.yml 自动测试及 Pages 部署
tests/                      核心逻辑和真实 SQLite 接口测试
```

更新离线缓存时同时修改 `sw.js` 中的 `VERSION`。前端不引用第三方字体、统计脚本或作者服务。
