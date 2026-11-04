# React Internal Mobile Operations & Inventory Import — Phase 2C

分支：`feat/react-internal-operations`
Base：`feat/react-admin-catalog`（`131b56e`）
日期：2026-11-02

## 范围

- 优化业务员、管理员的移动端操作；保留 Phase 2B 商品管理。
- 将样例库存导入替换为真实本地 `.xlsx` / `.csv` 文件解析与预览确认。
- 只更新前端 Mock 内存；不接入后端、数据库、云存储或 Google API。

## 内部移动端

### 业务员

- 订单列表保持筛选卡片布局；移动端商品行改为紧凑 SKU 卡片，不再依赖超宽明细表。
- 待确认订单核准、库存模拟预占、付款登记、发货信息、承运商/运单号、客户变更审核沿用原有业务动作。
- 付款/发货弹窗限制在 `100dvh` 内滚动；表单在 375/390/430/768/1440 可用。
- 发货后订单卡直接显示承运商、运单号和发货/预计到达日期。
- 页面底部增加 safe-area 留白，避免被底部导航或系统手势区遮挡。

### 管理员

- 客户账户建档、品牌授权、多仓库存页、促销/等级、审计日志均保留。
- 审计日志移动端改为卡片；库存明细移动端改为卡片，桌面保留表格。
- 商品管理沿用 Phase 2B 的移动抽屉/全屏表单。
- 移动角色切换后 Sidebar 自动关闭，避免遮挡底部导航。

## Excel / CSV 库存导入

- 支持本地 `.xlsx`（动态加载 `read-excel-file`）与 `.csv`。
- 提供 CSV 模板下载，包含 `sku_code,warehouse_code,on_hand,unsellable` 和当前 Demo 库存行。
- 选择文件后先解析、校验、预览；确认前不写库存。
- 校验：
  - 缺失列 / 空文件 / 空值；
  - 非整数、负数；
  - 未知 SKU 或仓库；
  - 重复 SKU + 仓库；
  - 无现有库存行（新建库存策略未确认，拒绝）；
  - `unsellable > on_hand`；
  - `on_hand - unsellable < reserved`，防止覆盖已预占库存。
- 预览展示每行旧/新 on-hand、unsellable、available，以及当前 reserved；reserved 明确不变。
- 任一行错误则整批禁止提交；错误原因逐行显示。
- 提交仅调用现有 `excelImportStock`，更新匹配的 SKU + 仓库的 `on_hand/unsellable`，保留 `reserved`、订单和历史快照。
- 成功后显示提交行数，并明确“刷新页面可能丢失”“前端 Mock，不是真实事务”。

### 审核修复（P0）

- **确认时重新校验**：`excelImportStock` 用共享纯校验器重新检查最新 SKU、仓库、库存、reserved；确认时携带预览快照，任一目标行 `on_hand/unsellable/reserved` 与预览不一致即拒绝，不写入。UI 显示“库存已变化”，刷新差异并要求再次确认。
- **整批 all-or-nothing**：Context 写入入口先解析/校验全部行；未知 SKU/仓库、缺失余额、重复 SKU+仓库、空值/负数/非整数、unsellable 超限或 reserved 冲突任一存在则整批拒绝。失败不修改库存、不写成功审计。
- 预览/写入共用 `inventoryImport.ts` 校验，避免 UI 与 Context 规则分叉。
- 新增 Context 测试：reserved 增加后旧预览拒绝、源库存变化后旧预览拒绝、混合/重复/未知/缺失余额/负数批次不更新、有效多行准确更新且 reserved 不变、成功审计仅在完整成功后出现。

## 测试

| 检查 | 结果 |
| --- | --- |
| `npm ci` | PASS，0 vulnerabilities |
| `npm run lint` | PASS |
| `npm test` | PASS — **46 / 46**（5 文件） |
| `npm run test:e2e` | PASS — **74 passed / 6 skipped（共 80）** |
| `npm run test:e2e:preview` | PASS — **1 / 1** |
| `npm run build` | PASS — 主 JS 517.50 KB / gzip 142.59 KB；Excel 解析分包 67.43 KB / gzip 19.18 KB；管理分包 30.24 KB / gzip 7.67 KB；CSS 64.87 KB / gzip 12.02 KB |
| `npm run verify:assets` | PASS |

新增覆盖：

- CSV 引号/转义、表头、空值、负数、非整数、重复 SKU+仓库；
- 未知 SKU、未知仓库、无现有库存行；
- reserved 覆盖限制、unsellable > on-hand；
- 有效快照差异、提交后 on-hand/unsellable 更新且 reserved 不变；
- `.xlsx` 文件预览；
- 模板下载；
- 错误预览禁止提交；
- 业务员创建订单 → 确认 → 付款 → 发货完整移动/桌面路径；
- 管理员/业务员内部页面响应式无横向溢出。

## 截图

- [Sales orders 390](internal-operations/sales-orders-390.jpg)
- [Sales orders 430](internal-operations/sales-orders-430.jpg)
- [Sales orders 1440](internal-operations/sales-orders-1440.jpg)
- [Inventory import before 390](internal-operations/inventory-import-before-390.jpg)
- [Inventory import preview 390](internal-operations/inventory-import-preview-390.jpg)
- [Inventory import after 390](internal-operations/inventory-import-after-390.jpg)
- [Inventory import before 1440](internal-operations/inventory-import-before-1440.jpg)
- [Inventory import preview 1440](internal-operations/inventory-import-preview-1440.jpg)
- [Inventory import after 1440](internal-operations/inventory-import-after-1440.jpg)
- [Accounts 390](internal-operations/accounts-390.jpg)
- [Audit 390](internal-operations/audit-390.jpg)

## 未完成 / 未验证

- 库存导入与运营操作仍是浏览器内存 Mock，不是数据库事务；刷新后可能丢失，不能用于真实库存或并发验证。
- 文件上限 500 行 / 1 MB；新建库存行策略未批准，因此拒绝未知 SKU+仓库组合。
- 模板为 CSV；`.xlsx` 可导入但没有生成 xlsx 模板。
- 真实 iPhone Safari / Android Chrome、软键盘、系统导航与低端机性能未验收；Playwright 为浏览器模拟。
- 主 JS 仍有约 516 KB 的 Vite chunk 警告；Excel 解析与商品管理已按需分包。
- 角色切换只是前端模拟，不是真实账户/权限系统。

## Phase 4B-03 real inventory import

With `VITE_REAL_AUTH=true`, the Import tab parses CSV/XLSX locally and sends the rows to `/api/admin/inventory/import/preview`. The API re-validates every row, stores a database snapshot of old/new quantities and versions, and returns the preview. Confirming calls the commit endpoint, which locks the target rows, rejects the whole batch if anything changed (`stale_preview`), and applies all rows, movements and audit in one transaction. Repeating the confirmation returns `alreadyCommitted` without changing stock again.

The Mock import described above remains the default when `VITE_REAL_AUTH=false`.
