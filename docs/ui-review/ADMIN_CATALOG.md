# React Admin Product & Catalog Management — Phase 2B

分支：`feat/react-admin-catalog`
Base：`feat/react-mobile-customer-ux`（`147661a`）
日期：2026-11-02

## 范围

在现有 React Mock 中增加管理员商品目录管理：商品、SKU、图片、系列、功能标签、上下架，以及客户目录即时更新。未引入后端、云端存储、真实认证或其他项目的编码体系。

## 数据与权限

- 新增可选字段：
  - `Product.active`、`series_id`、`tag_codes`、`description_en`
  - `ProductSKU.image_url`
  - `SeriesDefinition`、`FeatureTagDefinition`
- 新增 `DEMO_IMAGE_LIBRARY`（4 张本地 Demo 图）与 `isDemoImageUrl` 校验。
- 现有 27 项单元/集成测试保留；新增 12 项管理/订单资格集成测试，共 **39** 项。
- 仅管理员角色显示管理入口；`ProductAdminView` 还做前端角色校验。角色切换只是 Demo，不是服务端安全权限。
- 更新商品/SKU 不会改写历史订单行、订单价格快照、库存引用或预占 ID。

## 管理员商品列表

- 默认收起，一次仅展开一个。
- 展示图片、品牌、中文/英文名称、手工款号、分类、系列、标签、SKU 数、启用 SKU 数和上下架状态。
- 搜索款号、名称、SKU、系列、标签；系列 + 分类组合筛选。
- 新建成功后清空搜索/系列/分类筛选，滚动并展开新商品，聚焦标题。
- 支持商品编辑、上架/下架。

## 商品与 SKU

- 款号手工填写并检查重复，不自动生成或套用 FactoryOS3/其他系统编码。
- 中英文名称、英文描述、材质、尺寸、分类、品牌、系列、功能标签。
- SKU 可编辑：编码（唯一）、中英文颜色名、颜色预览色块、美元基础批发价、可售状态、SKU 独立图片。
- 新建 SKU 可设置初始在库，写入 `wh-sh` 库存行。
- **不提供 SKU 物理删除**；历史订单/库存引用保留，通过“停售”或商品下架处理。
- 上架条件：至少一个启用 SKU + 至少一张有效本地图片。
- 历史订单价格、行快照和 SKU 内部 ID 不因编辑改变。

## 图片

- 商品主图 + 多张展示图；可预览、设为主图、加入/移除图库、上下移动排序。
- SKU 独立图片；空值回退商品主图；SKU 图片选项限制在当前商品图库，避免借用其他商品/颜色图片。
- 客户商品详情显示商品图库缩略图和 SKU 独立图。
- **本阶段只使用 4 张本地 Demo 图，无上传、云端存储或 Google API。刷新后本地 Mock 数据可能丢失。**

## 系列与功能标签

- 管理员可新增、编辑中英文名称、排序、启用/停用系列和标签。
- 使用稳定内部 ID/Code 关联；显示名称可调整。
- 删除仍被商品引用的系列/标签会被拒绝；停用后客户筛选不再显示。
- 客户目录支持系列 + 分类 + 功能标签组合筛选。
- 功能标签使用现有橙黑小型彩色标签视觉。

## 移动端

- 375 / 390 / 430 / 768 / 1440px 实际检查无横向溢出。
- 商品编辑、新增 SKU、系列/标签字典均为全屏/抽屉式表单；避免宽数据表格。
- 底部导航增加管理员“商品管理”，5 列布局仍可用。
- 保留现有视觉、CSS 动效和 Reduced Motion。

## 验证

| 检查                       | 结果                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm ci`                   | PASS，0 vulnerabilities                                                                                         |
| `npm run lint`             | PASS                                                                                                            |
| `npm test`                 | PASS — **39 / 39**（4 文件）                                                                                    |
| `npm run test:e2e`         | PASS — **62 passed / 6 skipped（共 68）**                                                                       |
| `npm run test:e2e:preview` | PASS — **1 / 1** 生产预览冒烟                                                                                   |
| `npm run build`            | PASS — 主 JS 503.92 KB / gzip 138.52 KB；管理视图按需分包 30.24 KB / gzip 7.67 KB；CSS 64.32 KB / gzip 11.54 KB |
| `npm run verify:assets`    | PASS — 4 张 hashed 图，均 <160 KB                                                                               |
| GitHub Actions             | install → typecheck → 39 unit → build → asset check → Playwright → preview smoke                                |

### 审核修复（P0/P1）

- **旧购物车拦截**：提交订单前重新检查商品上架、SKU 可售、品牌授权、客户账户/公司状态、MOQ 和库存；失败保留购物车与运输草稿（sessionStorage），不创建订单。客户购物车显示明确英文原因。
- **批量删除保护**：系列/标签保存检查本次删除集合中的所有条目；任一仍被商品引用即整批拒绝，不部分成功。
- **历史 SKU 编码**：被历史订单引用的 SKU 禁止改编码；价格、颜色名、状态仍可编辑，内部 ID 与订单快照不变。
- **最后一个启用 SKU**：已上架商品不能直接停用最后一个启用 SKU；要求先下架，给出明确错误，不静默改状态。
- 修复移动端角色切换后 Sidebar 未关闭遮挡底部导航的问题。

新增测试覆盖：

- 商品新建/重复款号/非法图片；
- SKU 新建/重复编码/内部 ID/初始库存/编辑价格与状态/历史订单不变；
- 上架需要启用 SKU + 有效图片；上架后移除主图被拒；
- 图库顺序与主图更新；
- 系列/标签新增、英文名、删除仍被引用时拒绝；
- 管理员列表默认收起、单展开、搜索 + 系列筛选；
- 新建商品 → SKU → 上架 → 客户目录即时可见；
- 上架/下架即时影响客户目录；
- 客户系列 + 标签组合筛选；
- 管理员下架/停用 SKU/撤销品牌后旧购物车禁止提交，恢复后正常提交；
- 运输表单在跨角色返回后保留；
- 批量删除未引用项 + 被引用项时整批拒绝；
- 历史订单 SKU 编码修改被拒，价格/名称仍可改；
- 最后一个启用 SKU 停售被拒，先下架后可停售。

## 截图

- [Admin products 1440](admin-catalog/admin-products-1440.jpg)
- [Admin products 768](admin-catalog/admin-products-768.jpg)
- [Admin products 430](admin-catalog/admin-products-430.jpg)
- [Admin products 390](admin-catalog/admin-products-390.jpg)
- [Admin products 375](admin-catalog/admin-products-375.jpg)
- [Product editor 1440](admin-catalog/admin-product-editor-1440.jpg)
- [Product editor 390](admin-catalog/admin-product-editor-390.jpg)
- [Product image manager 390](admin-catalog/admin-product-images-390.jpg)
- [SKU editor 1440](admin-catalog/admin-sku-editor-1440.jpg)
- [SKU editor 390](admin-catalog/admin-sku-editor-390.jpg)
- [Series/tag dictionary 1440](admin-catalog/admin-taxonomy-1440.jpg)
- [Series/tag dictionary 390](admin-catalog/admin-taxonomy-390.jpg)
- [Blocked customer cart after admin unpublish 390](admin-catalog/cart-blocked-product-390.jpg)

## 未完成 / 未验证

- 前端内存 Mock；刷新页面后管理修改可能丢失，无后端、数据库、真实上传或云端存储。
- 本地图片库只有 4 张 Demo 图，不是商品摄影；无文件上传、裁剪、CDN 或响应式 `srcset`。
- 角色切换不是服务端权限；生产需要真实认证与授权。
- 款号仅做人工/重复校验，不接入 PDM 或 FactoryOS3 编码。
- 未实现物理删除；这是有意保护历史订单/库存引用。
- 主 JS 仍有约 500 KB 的 Vite chunk 警告；管理视图已拆分，进一步路由级拆分属于后续性能工作。
- 真机 iPhone Safari / Android Chrome 未验收；Playwright 是浏览器模拟。
