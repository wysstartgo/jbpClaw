# 账户、鉴权与资金工具清单

| Tool | Path | 说明 |
| --- | --- | --- |
| `account_fund_get_v3` | `/open_api/v3.0/account/fund/get/` | 为代理商场景，查询账号余额，对齐方舟平台能力。 |
| `advertiser_budget_get_v2` | `/open_api/2/advertiser/budget/get/` | 获取广告主账号设置的预算类型与预算，可以一次查询100个广告主账号预算 |
| `advertiser_delivery_pkg_config_v3` | `/open_api/v3.0/advertiser/delivery_pkg_config/` | 根据商业化行业获取不同行业下对应的资质提交规则。需注意：每个行业下的资质提交规则可能会因平台及外部监管的要求而发生变化，当规则发生变更时，规则的版本号+1。调用API之前，您需要首先查询本接口获取所选行业推广产品资质的配置规则（拿到config_id）。每个行业的配置规则由必填资质模块necessaries、选填资质模块unnecessaries构成，至少传其中一个模块。 |
| `advertiser_delivery_pkg_delete_v3` | `/open_api/v3.0/advertiser/delivery_pkg/delete/` | 该接口支持批量删除审核拒绝的投放资质（推广产品）。删除失败的原因包括2类：① 传入了审核状态≠「审核不通过」的资质id；② 广告主账户下没有该资质。 |
| `advertiser_delivery_pkg_get_v3` | `/open_api/v3.0/advertiser/delivery_pkg/get/` | 用于查询广告主以推广产品形式提交的投放资质，可以获取到资质审核状态等信息 |
| `advertiser_delivery_pkg_submit_v3` | `/open_api/v3.0/advertiser/delivery_pkg/submit/` | 用于提交以推广产品形式整组提交的投放资质，该接口可以同时用于新增和编辑（针对审核不通过的推广产品资质支持编辑提交）。调用API之前，需先查询【推广产品资质规则配置查询】接口获取所选行业推广产品资质的配置规则。 |
| `advertiser_delivery_qualification_delete_v3` | `/open_api/v3.0/advertiser/delivery_qualification/delete/` | 该接口支持批量删除审核拒绝的投放资质（单资质）。删除失败的原因包括2类：① 传入了审核状态≠「审核不通过」的资质id；② 广告主账户下没有该资质。 |
| `advertiser_delivery_qualification_list_v3` | `/open_api/v3.0/advertiser/delivery_qualification/list/` | 用于查询账户投放资质。 |
| `advertiser_delivery_qualification_submit_v3` | `/open_api/v3.0/advertiser/delivery_qualification/submit/` | 该接口用于广告主投放资质上传，请注意以下使用规则：需要将资质上传至对应的同名资质类型中，资质类型选择错误将会被审核拒绝。若找不到对应的资质类型，可以上传至“其他资质”。需要上传多份资质时，每一份分开上传，多份资质合并上传将会被审核拒绝。对于一份完整资质的多张图片请上传至一个资质id中。 |
| `advertiser_fund_daily_stat_v2` | `/open_api/2/advertiser/fund/daily_stat/` | 获取广告主日流水信息，一般每天8点会出来前一天的数据 |
| `advertiser_fund_get_v2` | `/open_api/2/advertiser/fund/get/` | 获取广告主或代理商账户余额信息 |
| `advertiser_fund_transaction_get_v2` | `/open_api/2/advertiser/fund/transaction/get/` | 获取广告主或代理商账户流水明细信息 |
| `advertiser_info_v2` | `/open_api/2/advertiser/info/` | 获取广告主账户详细信息。 |
| `advertiser_public_info_v2` | `/open_api/2/advertiser/public_info/` | 获取广告主账户基础信息，无需申请权限。 |
| `advertiser_qualification_create_v2_v2` | `/open_api/2/advertiser/qualification/create_v2/` | 通过此接口，用户可以批量上传投放资质。【注意】本接口不再维护，请使用【上传/更新投放资质（新版）】接口 此接口上传的是广告投放资质，如需账户主体资质请调用【上传主体资质（新版）】接口该接口不支持返回投放资质部分成功部分失败的报错信息，所以失败后需要重新全量上传后再进行审核 |
| `advertiser_qualification_get_v3` | `/open_api/v3.0/advertiser/qualification/get/` | 用于获取广告主的主体资质信息为全量接口，会返回广告主所有主体资质。 |
| `advertiser_qualification_select_v2_v2` | `/open_api/2/advertiser/qualification/select_v2/` | 获取广告主资质信息，资质分为描述，营业执照，开户资质，投放资质。不同类型的资质有不同的字段，具体字段见下表。【注意】本接口不再维护，建议使用「获取投放资质（新版）」接口。 |
| `advertiser_qualification_submit_v3` | `/open_api/v3.0/advertiser/qualification/submit/` | 提交广告主的主体资质信息，全量接口，更新时需要获取所有主体资质后再更新 |
| `advertiser_update_budget_v2` | `/open_api/2/advertiser/update/budget/` | 此接口可以更新广告主账号设置的预算类型与预算 |
| `fund_shared_wallet_balance_get_v2` | `/open_api/2/fund/shared_wallet_balance/get/` | 此接口功能是查询同客户主体下返货共享钱包相关余额信息。返货相关需要咨询相关的运营和销售同学对接，具备返货相关前置条件下，相关返货资金信息可以通过本接口获得返货共享钱包需要在同客户主体下共享，返货共享钱包中的返货资金。 |
| `oauth2_access_token` | `/open_api/oauth2/access_token/` | Access-Token是调用授权关系接口的调用凭证，用于服务端对API请求鉴权。所有接口均通过请求参数中传递的Access_Token来进行身份认证和鉴权。 |
| `oauth2_advertiser_get` | `/open_api/oauth2/advertiser/get/` | 此接口用于获取已经授权的账号列表，账号包含了店铺、代理商、组织等角色；一次授权多个账号，共用一个Access Token; 一个Access Token可用于操作授权的多个账号。 |
| `oauth2_app_access_token` | `/open_api/oauth2/app_access_token/` | 应用级token获取 |
| `oauth2_refresh_token` | `/open_api/oauth2/refresh_token/` | Refresh_Token在有效期内，可以通过接口刷新Access_Token，刷新会同时获得新的AccessToken及RefreshToken并更新效期时间（不会影响已有授权关系），同时原Token也会失效，再次刷新需要使用本次刷新获取的新的RefreshToken。Refresh_Token、Access_Token、auth_code失效后，只能通过重新申请授权获取，建议在调用Token相关接口时避免并发请求。 |
| `security_score_disposal_info_get_v3` | `/open_api/v3.0/security/score_disposal_info/get/` | 查看积分处置详情。 |
| `security_score_total_get_v3` | `/open_api/v3.0/security/score_total/get/` | 查询账户累计积分。 |
| `security_score_violation_event_get_v3` | `/open_api/v3.0/security/score_violation_event/get/` | 查询违规积分明细。 |
| `shared_wallet_account_relation_get_v3` | `/open_api/v3.0/shared_wallet/account_relation/get/` | 查询账户对应公司下的钱包关系。 |
| `shared_wallet_budget_get_v3` | `/open_api/v3.0/shared_wallet/budget/get/` | 资金共享-查询子钱包预算信息，需授权access_token，请求时要传入鉴权账户、鉴权账户类型和子钱包ID等信息，应答包含返回码、返回信息和预算等相关内容。 |
| `shared_wallet_budget_submit_v3` | `/open_api/v3.0/shared_wallet/budget/submit/` | 资金共享设置子钱包预算信息，需提供鉴权账户、账户类型、子钱包ID等信息，设置预算生效模式、预算模式和预算金额等。 |
| `shared_wallet_daily_stat_get_v3` | `/open_api/v3.0/shared_wallet/daily_stat/get/` | 资金共享-查询共享钱包日流水信息，一般每天8点会出来前一天的数据，如果当天存在数据延迟可往后再尝试。 |
| `shared_wallet_main_wallet_get_v3` | `/open_api/v3.0/shared_wallet/main_wallet/get/` | 查询当前共享钱包(大钱包)的信息。 |
| `shared_wallet_transaction_detail_get_v3` | `/open_api/v3.0/shared_wallet/transaction_detail/get/` | 资金共享-查询共享钱包流水明细。 |
| `shared_wallet_wallet_balance_get_v3` | `/open_api/v3.0/shared_wallet/wallet_balance/get/` | 资金共享-批量查询钱包余额。 |
| `shared_wallet_wallet_info_get_v3` | `/open_api/v3.0/shared_wallet/wallet_info/get/` | 批量查询钱包信息（包含共享钱包和子钱包）。 |
| `shared_wallet_wallet_relation_get_v3` | `/open_api/v3.0/shared_wallet/wallet_relation/get/` | 查询子钱包下绑定的adv列表, 支持分页。 |
| `shared_wallet_watch_rule_get_v3` | `/open_api/v3.0/shared_wallet/watch_rule/get/` | 资金共享-共享钱包盯盘规则查询，支持查询预警级别、阈值及级别对应的预警事件 |
| `shared_wallet_watch_rule_submit_v3` | `/open_api/v3.0/shared_wallet/watch_rule/submit/` | 设置子钱包盯盘预警规则，包含鉴权账户、账户类型、钱包盯盘预警规则等请求参数，应答包含返回码、返回信息和json返回值等。 |
| `tools_admin_info_v2` | `/open_api/2/tools/admin/info/` | 本接口需要与【查询国家/区域信息】接口搭配使用，通过该接口先拿到查询国家/区域的行政编码code，传入到本接口的请求参数codes中，查询国家/区域下具体的省份等行政区域信息。 |
| `tools_quota_get_v2` | `/open_api/2/tools/quota/get/` | 用于查询广告账户的在投计划配额和使用进度。 |
| `user_info_v2` | `/open_api/2/user/info/` | API授权是以User为纬度的，Access Token记录了授权User信息；通过此接口可以获取每一个Access Token对应的User信息，方便开发者区分以及管理对应授权关系。 |
