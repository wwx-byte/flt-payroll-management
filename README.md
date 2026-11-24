# 薪资管理系统

正式台账使用 TanStack Start、React、TypeScript 和 StyleX。浏览器通过 TanStack Query 管理读取和保存，前后端通过 oRPC 的 HTTP 接口交换台账，Zod 校验薪资数据。服务使用 Node 内置的 SQLite 驱动，数据库位于项目内的 `payroll-data/payroll.sqlite3`。

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

生产启动支持 `HOST` 和 `PORT`。反向代理使用 `PAYROLL_ORIGIN` 指定浏览器看到的完整来源，并转发原始 Host。正式服务和开发服务都从工程根目录定位数据库；隔离验证可显式设置 `PAYROLL_DATA_DIR`。切换服务后使用原管理员凭据重新登录。

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

服务使用项目内的 `payroll-data/payroll.sqlite3`。首次创建空台账时，管理员初始凭据保存在同目录的 `initial-login.txt`。整个数据目录已加入 Git 忽略规则。

- **从交接包启动**：首次运行前，将包内整个 `payroll-data/` 解压到工程根目录，使用随包凭据登录。
- **从旧版升级**：停止旧服务，备份项目上一级的 `../payroll-data/`。确认目标目录尚不存在后，把整个旧目录复制到项目内，然后启动。如果两处已有台账，先备份并确认要使用的副本。

## 导入历史薪资标准

专项脚本使用可选依赖组。默认执行核对，确认结果后可追加 `--apply` 写入。

```sh
uv run --locked --group salary-import scripts/import-employee-standards.py "/path/to/历年工资标准.xlsx"
```

## 同步历史月度工资表

日常工资表通过网页的「月度薪资台账 → 导入工资表」导入。批量迁移历史台账时，可在项目根目录用项目指定的 Node 26解析工资表。文件名需包含工资所属年月，输出文件应保存在台账目录内。

```sh
node scripts/sync-payroll.cjs "/path/to/2026年6月工资表.xlsx" "/path/to/2026年7月工资表.xlsx" > payroll-data/历史工资批次.json
```

解析成功并核对批次后，运行独立的导入脚本写入本地 SQLite 台账。此步骤无需启动 Web 服务。同一月份重复导入相同文件会跳过，遇到同月已有不同版本时，整批取消写入。

```sh
uv run --locked scripts/import-payroll-batches.py < payroll-data/历史工资批次.json
```
