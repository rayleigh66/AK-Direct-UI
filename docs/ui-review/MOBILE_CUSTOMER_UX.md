# React Mobile Customer UX — Phase 2A

分支：`feat/react-mobile-customer-ux`
Base：`feat/react-foundation-p0`（`273690c`）
日期：2026-11-02

## 范围

只优化客户侧移动浏览、SKU 详情、订购清单、订单提交与订单状态；保留 React 技术栈、现有浅色橙黑视觉和内部销售/管理员界面。

## 移动端响应式

- 使用真实 viewport 宽度，不依赖固定 390px 手机模拟器。
- Playwright 在 **375 / 390 / 430 / 768 / 1440px** 检查：`scrollWidth === innerWidth`，无横向溢出。
- < 1024px 使用顶部汉堡菜单 + 底部客户导航；≥ 1024px 使用左侧栏。
- 客户侧导航为英文，只显示 Catalog / Order list / My orders / Membership；角色切换后内部界面仍保持原中文工作流。
- BottomNav、商品详情底部购买栏、页面底部留白使用 `env(safe-area-inset-bottom)`。
- 商品详情为移动端全屏抽屉，桌面为右侧 520px 抽屉；Escape 关闭、锁定背景滚动。
- My Orders / Catalog 弹窗限制 `100dvh` 内滚动；移动端输入框使用 16px 字号避免 iOS 自动缩放。
- 数量步进、移除、颜色、关闭等触控目标提升到约 44px。

## 客户英文显示

- `Product` 增加可选 `title_en`，`ProductSKU` 增加可选 `color_name_en`；不修改内部 `id`、`sku_code` 或业务编码。
- `Brand`/`TierRule` 增加可选英文名；客户目录、会员、订单使用英文显示。
- 客户目录、SKU 详情、购物车、订单、会员、通知、密码设置、命令搜索均使用英文。
- 订单行显示通过 `sku_code` 映射回英文产品名和颜色，不重写历史订单数据。
- 内部销售/管理员页面与编号保持原状。

## 商品目录

- 保留现有视觉体系与品牌授权拦截。
- 商品图使用 Vite hashed 资源、固定宽高、懒加载、异步解码。
- 390 下压缩 Hero、指标卡和卡片内边距，增加信息密度；分类筛选横向滚动。
- 搜索支持英文名称、颜色、款号与 SKU。
- 卡片展示英文标题、英文颜色、促销、价格、可订库存和 MOQ 状态。

## SKU 详情

- 颜色切换更新 SKU、英文颜色、价格、可订库存、促销提示。
- 数量支持 +/- 与手动输入；低于 MOQ 或超过库存时显示错误并阻止加入。
- 已加入数量会累计，不会覆盖已有清单行。
- 移动端底部固定 Add / View order list 操作区，含 safe-area。
- Demo 只有每个产品一张实拍示意图，没有每个颜色的独立图片；当前颜色切换不会伪造不同产品图，保留真实产品图。此限制在 PR 中明确列出。

## 购物车与订单

- 每个 SKU 独立数量、移除、行小计与总计。
- 手动数量输入使用草稿值：输入 5 时保留输入并显示错误，不会静默删除行；改回合法值后更新。
- 校验失败保留运输方式、国家、日期、包装要求等已填数据。
- 提交按钮使用同步 ref 防重复；同一事件双击只产生一张订单。
- 提交成功后可直接进入 My Orders。
- My Orders 使用移动端订单卡与展开时间轴；提供物流承运商、运单号、日期和允许的客户改单/取消操作。
- 客户可见的订单备注、通知和销售更新使用英文。

## 图片与动效

- 4 张商品 JPG 从 1200×896 / 约 2.35 MB 压缩为 1000×746 / 约 417 KB（单张 90–113 KB）。
- `scripts/verify-build-assets.mjs` 检查 hashed 图片、单张 ≤160 KB、bundle 无 `/src/assets/images`。
- 复用现有 CSS 过渡与动效，不引入新动效框架。
- 全局 `prefers-reduced-motion: reduce` 关闭非必要动画/过渡；Playwright 验证卡片 transition ≤ 0.01ms。

## 验证

| 检查 | 结果 |
| --- | --- |
| `npm ci` | PASS，0 vulnerabilities |
| `npm run lint` | PASS |
| `npm test` | PASS — **27 / 27** |
| `npm run test:e2e` | PASS — **32 / 32**（desktop-1440、mobile-375、mobile-390-webkit、tablet-768） |
| `npm run build` | PASS — JS 483.07 KB / gzip 132.77 KB；CSS 61.78 KB / gzip 11.45 KB |
| `npm run verify:assets` | PASS — 4 张 hashed 图，均 <160 KB |
| GitHub Actions | install → typecheck → unit → build → asset check → Playwright（待本次 push 运行） |

E2E 覆盖：

- 商品目录 → 颜色切换 → 数量 12 → 加入清单 → 订购清单 → 提交 → My Orders；
- 数量 5 的非法输入保留行并阻止提交；
- 同一事件双击提交只生成一张 Pending 订单；
- 375/390/430/768/1440 无横向溢出与移动导航可用；
- 客户会员/通知/展开订单无中文；
- 已发货订单的承运商、运单号、日期；
- Confirmed 订单的 Request quantity change / Request cancellation；
- Reduced Motion 下卡片无过渡。

## 截图

- [Catalog 375](mobile-customer-ux/catalog-375.jpg)
- [Catalog 390](mobile-customer-ux/catalog-390.jpg)
- [Catalog 430](mobile-customer-ux/catalog-430.jpg)
- [Catalog 768](mobile-customer-ux/catalog-768.jpg)
- [Catalog 1440](mobile-customer-ux/catalog-1440.jpg)
- [Product detail 390](mobile-customer-ux/product-detail-390.jpg)
- [Colour switched 390](mobile-customer-ux/product-detail-colour-390.jpg)
- [Added 390](mobile-customer-ux/product-detail-added-390.jpg)
- [Order list 390](mobile-customer-ux/cart-390.jpg)
- [Order submitted 390](mobile-customer-ux/order-success-390.jpg)
- [My Orders 390](mobile-customer-ux/orders-390.jpg)
- [Expanded order / timeline 390](mobile-customer-ux/orders-expanded-390.jpg)
- [Shipped tracking 390](mobile-customer-ux/orders-shipped-390.jpg)

## 未完成 / 未验证

- 没有正式后端、数据库、真实认证、支付或邮件；仍是前端内存 Mock。
- **没有每个颜色的独立实拍图**；切换颜色时使用真实产品主图，不伪造错误产品图。若需要颜色级图片，应先提供素材。
- Playwright WebKit/Chromium 是浏览器模拟，不是 iPhone Safari / Android Chrome 真机；软键盘、刘海/底部手势区和低端机帧率仍需 Owner 验收。
- 未做完整内部销售/管理员界面的移动重构。
- 商品目录 4 个 Demo 商品仍是虚构内容；未做正式 PRD 数据核对。
- 未做真实图片 CDN、响应式 `srcset` 或多格式 AVIF/WebP；当前只做 1000px JPEG 压缩。
