# 薪资管理系统

正式台账使用 TanStack Start、React、TypeScript 和 StyleX。浏览器通过 TanStack Query 管理读取和保存，前后端通过 oRPC 的 HTTP 接口交换台账，Zod 校验薪资数据。服务使用 Node 内置的 SQLite 驱动，数据库位于项目内的 `data/payroll.sqlite3`。

## 开发和启动

在工程根目录执行。fnm 读取 `.node-version` 选择 Node 26，pnpm 使用 `package.json` 锁定的 12.x 版本。

```sh
fnm install
fnm use
npm install --global pnpm@12.16.1
pnpm install --frozen-lockfile
pnpm dev
```

已安装指定 pnpm 时可跳过全局安装。开发服务默认监听 [127.0.0.1:8765](http://127.0.0.1:8765/)。运行生产构建时，先停止占用同一端口的开发服务，再执行：

```sh
pnpm build
pnpm start
```

生产启动支持 `HOST` 和 `PORT`。通过反向代理访问时，保留浏览器请求的 Host（含非默认端口），并由代理覆盖 `X-Forwarded-Proto` 为实际外部协议。正式服务和开发服务都从工程根目录定位数据库；隔离验证可显式设置 `PAYROLL_DATA_DIR`。切换服务后使用原管理员凭据重新登录。

## Docker Compose

容器运行编译后的 Node 服务。Compose 默认在宿主机所有网络接口发布 `8765` 端口，使用当前目录下的 `data/` 持久化数据库和初始登录文件。已有台账时先停止使用该库的旧服务。首次使用空目录时，首次访问页面会创建台账。

```sh
mkdir -p data
docker compose up -d --build
```

从工程根目录执行以上命令，容器使用镜像内的 `node` 用户。Linux 上，挂载目录的所有者应与容器用户匹配（常规 Docker 配置下为 UID 1000），并确保该用户可以读写数据库。Compose 固定挂载与 `compose.yaml` 同级的 `data/` 目录，可通过 `PAYROLL_PORT` 指定宿主机端口。浏览器可直接使用宿主机的局域网 IP 或域名访问；提交操作按当前请求来源校验。

## GitHub Release 离线安装

GitHub Actions 在 PR 和 main 推送时检查、测试并构建镜像；推送版本标签（如 `v1.0.0`）并通过验证后，会发布 Release。每个 Release 包含 Linux amd64、arm64 两个独立的压缩镜像、`compose.yaml` 和 `SHA256SUMS`。下载适合部署机器的镜像和 Compose 文件，在同一目录执行（以 amd64 为例）：

```sh
docker load -i flt-payroll-management-v1.0.0-linux-amd64.tar.gz
mkdir -p data
PAYROLL_IMAGE=flt-payroll-management:v1.0.0 docker compose up -d --no-build --pull never
```

使用已有台账时，将包含 `payroll.sqlite3` 的 `data/` 目录放在 `compose.yaml` 旁。日常升级时载入新版本镜像，然后更换 `PAYROLL_IMAGE` 并重新执行 Compose 启动命令。GitHub 要求单个 Release 附件小于 2 GiB，工作流在上传前检查每个压缩包的实际字节数。[GitHub Release 限制](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas)

## 工程目录

- `src/routes/` 和 `src/ui/` 提供登录、薪酬总览、员工档案、月度台账、工资条和薪酬分析。StyleX 定义组件样式，基础 CSS 保留原有的全局、上下文和响应式规则。
- `src/api/` 定义 oRPC 契约、Zod 模型和浏览器客户端。`src/server.ts` 处理同源请求，`src/server/` 管理认证、数据库事务和版本校验。管理员接口沿用 `GET /api/state` 和 `POST /api/state`。
- `dist/` 保留可直接打开的静态演示版及网页和历史脚本共用的 Excel 资源。新服务的构建产物位于 `.output/`。
- `scripts/` 保留历史导入工具，Python 脚本通过 `storage.py` 读写同一数据库。旧版 `server.py` 用于行为对照和回退。

## 代码规范

源码文件使用小写短横线命名，例如 `employee-dialogs.tsx`；React 组件名沿用 PascalCase。测试和生成文件可带 `.test`、`.gen` 后缀，TanStack 根路由按框架约定保留 `__root.tsx`。

`pnpm format` 使用 Oxfmt 格式化，`pnpm lint` 运行 Oxlint 和文件命名检查。`pnpm check` 一次执行静态检查、格式检查和 TypeScript 类型检查。

## 验证

```sh
uv python install 3.12
pnpm exec playwright install chromium
pnpm build
pnpm check
pnpm test
```

测试在临时目录创建合成台账，核对 Python 与 Node 的读写兼容、修订号冲突、历史版本保护、浏览器交互和不同宽度下的新旧版布局。本机已有 Chrome 时可使用 `PLAYWRIGHT_CHANNEL=chrome pnpm test`。

## 台账和登录

服务使用项目内的 `data/payroll.sqlite3`。首次创建空台账时，管理员初始凭据保存在同目录的 `initial-login.txt`。整个数据目录已加入 Git 忽略规则。

- **从交接包启动**：首次运行前，将包内整个 `payroll-data/` 解压并命名为工程根目录下的 `data/`，使用随包凭据登录。
- **从旧版升级**：停止旧服务，备份旧目录（`./payroll-data/` 或更早版本的 `../payroll-data/`）。确认 `./data/` 尚不存在后，将整个旧目录复制为 `./data/`，然后启动。如果两处已有台账，先备份并确认要使用的副本。

## 导入历史薪资标准

专项脚本使用可选依赖组。默认执行核对，确认结果后可追加 `--apply` 写入。

```sh
uv run --locked --group salary-import scripts/import-employee-standards.py "/path/to/历年工资标准.xlsx"
```

## 同步历史月度工资表

日常工资表通过网页的「月度薪资台账 → 导入工资表」导入。批量迁移历史台账时，可在项目根目录用项目指定的 Node 26解析工资表。文件名需包含工资所属年月，输出文件应保存在台账目录内。

```sh
node scripts/sync-payroll.cjs "/path/to/2026年6月工资表.xlsx" "/path/to/2026年7月工资表.xlsx" > data/历史工资批次.json
```

解析成功并核对批次后，运行独立的导入脚本写入本地 SQLite 台账。此步骤无需启动 Web 服务。同一月份重复导入相同文件会跳过，遇到同月已有不同版本时，整批取消写入。

```sh
uv run --locked scripts/import-payroll-batches.py < data/历史工资批次.json
```
