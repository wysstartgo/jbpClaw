# 代理商、组织与结算工具清单

| Tool | Path | 说明 |
| --- | --- | --- |
| `agent_adv_advertiser_update_sale_v2` | `/open_api/2/agent/adv/advertiser/update_sale/` | 修改广告主所属销售信息。Header字段包含Access-Token和Content-Type，请求参数包含代理商账户ID、变更后广告主的销售ID和需要变更销售的广告主账户ID列表。 |
| `agent_adv_bidding_list_query_v2` | `/open_api/2/agent/adv/bidding/list/query/` | 代理商竞价投放数据，对应方舟平台「投放-数据概览-汇总数据-竞价数据」。 |
| `agent_adv_brand_list_query_v2` | `/open_api/2/agent/adv/brand/list/query/` | 代理商品牌投放数据，对应方舟平台「投放-数据概览-汇总数据-竞价数据」。 |
| `agent_adv_cost_report_list_query_v2` | `/open_api/2/agent/adv/cost_report/list/query/` | 代理商消耗报表查询，对应方舟平台侧「商务-流水查询-消耗报表」数据 |
| `agent_adv_recharge_recharge_record_v2` | `/open_api/2/agent/adv/recharge/recharge_record/` | 代理商充值记录查询，相关功能与代理商平台的「商务-充值记录-账户充值记录」模块对齐。 |
| `agent_advertiser_copy_v2` | `/open_api/2/agent/advertiser/copy/` | 广告主账户复制接口，支持复制原账户资质信息。请求参数字段包含被复制广告主账户ID、代理商账户ID、复制账户信息等，应答字段包含返回码、返回信息、json返回值等。 |
| `agent_advertiser_info_query_v2` | `/open_api/2/agent/advertiser_info/query/` | 广告主账户信息查询，包括：基础信息、自运营报备标签等。 |
| `agent_advertiser_refund_v2` | `/open_api/2/agent/advertiser/refund/` | 此接口操作功能是由广告主账户将款项退回至代理商账户。1月18日起，代理商转账退款接口转账类型【transfer_type】字段新增6项枚举值：预付通用、预付竞价专用、预付品牌专用、授信通用、授信竞价专用、授信品牌专用，新功能上线后需要您传入相应的transfer_type，不传会报错，请您知悉。 |
| `agent_advertiser_select_v2` | `/open_api/2/agent/advertiser/select/` | 获取代理商下的广告主ID列表。当请求数据量超过10000时，请使用cursor+count的分页方式请求数据。 |
| `agent_advertiser_update_v2` | `/open_api/2/agent/advertiser/update/` | 修改广告主信息，可更改内容包括账户名称、联系人、手机号码、固定电话、备注等，除此之外其他内容不允许修改。 |
| `agent_charge_verify_v2` | `/open_api/2/agent/charge/verify/` | 校验能否充值接口，校验不通过接口会报错并返回原因；校验通过接口返回可用于充值的合同。 |
| `agent_child_agent_select_v2` | `/open_api/2/agent/child_agent/select/` | 获取代理商下的二级代理商ID列表 |
| `agent_credit_charge_submit_v2` | `/open_api/2/agent/credit_charge/submit/` | 充值接口分为三步, 包含校验能否充值接口、提交授信充值接口、查询充值结果接口，本接口为第二步；提交之前需要校验能否充值，提交之后，通过轮训查询充值结果 |
| `agent_info_v2` | `/open_api/2/agent/info/` | 获取代理商信息。 |
| `agent_prepay_charge_generate_remittance_code_v2` | `/open_api/2/agent/prepay_charge/generate_remittance_code/` | 代理商进行预付充值生成汇款码记录，并透传汇款码信息给用户 |
| `agent_query_risk_promotion_list_v2` | `/open_api/2/agent/query/risk_promotion_list/` | 通过此接口，用户可以获取代理商账户下支持获取在投放中图片、视频和落地页被拒审的巨量广告信息，仅展示广告拒审时的信息支持获取广告中未过审的素材信息以及这个素材还在同代理商的哪些广告下（只披露近7天有消耗的关联广告）。 |
| `agent_transfer_transaction_record_v2` | `/open_api/2/agent/transfer/transaction_record/` | 代理商转账记录查询，相关功能与代理商平台的「商务-转账记录-账户转账记录」模块对齐。 |
| `business_platform_company_account_get_v3` | `/open_api/v3.0/business_platform/company_account/get/` | 用于获取对公验证通过的公司主体下账户列表。 |
| `business_platform_company_info_get_v3` | `/open_api/v3.0/business_platform/company_info/get/` | 用于获取巨量引擎工作台（原纵横组织）下全部主体信息。 |
| `cg_transfer_can_transfer_balance_get_v3` | `/open_api/v3.0/cg_transfer/can_transfer_balance/get/` | 查询转出方与转入方之间最大可转金额，接口内已自动扣除需要预留的竞价消耗保证金，支持查询1:N转账的最大可转金额。 |
| `cg_transfer_can_transfer_target_list_v3` | `/open_api/v3.0/cg_transfer/can_transfer_target/list/` | 查询当前账户(锚定账户)可以互相转账的账户列表。 |
| `cg_transfer_create_transfer_v3` | `/open_api/v3.0/cg_transfer/create_transfer/` | 转账-发起转账（代理），支持1:N转账、不停投转账、虚客互转 |
| `cg_transfer_query_can_transfer_balance_v3` | `/open_api/v3.0/cg_transfer/query_can_transfer_balance/` | 查询减款方与加款方之间最大可转金额，接口内已自动扣除需要预留的竞价消耗保证金，支持查询1:N转账的最大可转金额。 |
| `cg_transfer_query_transfer_balance_v3` | `/open_api/v3.0/cg_transfer/query_transfer_balance/` | 查询账户自身转账余额、作为减款方需要预留的竞价消耗保证金。 |
| `cg_transfer_query_transfer_detail_v3` | `/open_api/v3.0/cg_transfer/query_transfer_detail/` | 转账单信息，包括状态、双方账户、转账金额。 |
| `cg_transfer_transfer_balance_get_v3` | `/open_api/v3.0/cg_transfer/transfer_balance/get/` | 查询账户自身转账余额、作为转出方需要预留的竞价消耗保证金。 |
| `cg_transfer_transfer_create_v3` | `/open_api/v3.0/cg_transfer/transfer/create/` | 发起转账，支持1:N转账、不停投转账 |
| `cg_transfer_transfer_detail_get_v3` | `/open_api/v3.0/cg_transfer/transfer_detail/get/` | 转账单信息，包括状态、双方账户、转账金额。 |
| `cg_transfer_wallet_transfer_can_transfer_balance_v3` | `/open_api/v3.0/cg_transfer/wallet/transfer/can_transfer_balance/` | 支持查询减款方与加款方之间最大可转金额、减款方非品牌最大可转出金额、加款方非品牌最小转入金额，为转账申请提供校验依据。 |
| `cg_transfer_wallet_transfer_create_v3` | `/open_api/v3.0/cg_transfer/wallet/transfer/create/` | 发起转账，支持大钱包与小钱包互转，1:N批量转账 |
| `cg_transfer_wallet_transfer_detail_v3` | `/open_api/v3.0/cg_transfer/wallet/transfer/detail/` | 查询转账单信息，包括状态、转账钱包id、转账金额。 |
| `cg_transfer_wallet_transfer_list_v3` | `/open_api/v3.0/cg_transfer/wallet/transfer/list/` | 通过筛选条件捞取转账记录。 |
| `charge_result_v3` | `/open_api/v3.0/charge/result/` | 查询充值结果。 |
| `create_statement_invoice_v2` | `/open_api/2/create/statement_invoice/` | 创建结算单开票接口，支持差额开票。Header字段包含Access - Token（必填，授权access_token，可通过【获取Access token】接口获取）和Content - Type（必填，请求消息类型允许值: application/json）。请求参数字段包含代理商ID、客户ID列表等。 |
| `customer_center_advertiser_list_v2` | `/open_api/2/customer_center/advertiser/list/` | 获取当前巨量引擎工作台下可操作的资产账户列表（广告主/企业号），支持按账户名称、账户类型分页查询；返回指定工作台（cc_account_id）下拥有操作权限的全部资产账户，受授权 access_token 权限控制。 |
| `majordomo_advertiser_select_v2` | `/open_api/2/majordomo/advertiser/select/` | 获取巨量引擎工作台（原纵横组织）下的广告主ID列表 |
| `query_booking_business_entity_id_get_v2` | `/open_api/2/query/booking/business_entity_id/get/` | 排期—查询业务实体ID。 |
| `query_invoice_electronic_url_v2` | `/open_api/2/query/invoice_electronic_url/` | 开票-获取电票/数电票发票文件下载链接接口（代理商版）。 |
| `query_invoice_v2` | `/open_api/2/query/invoice/` | 用于通过结算单/项目查询开票单数据。 |
| `query_project_v2` | `/open_api/2/query/project/` | 用于查询项目信息，支持按代理商ID、客户ID、平台、投放类型等条件筛选。 |
| `query_rebate_accounting_info_v2` | `/open_api/2/query/rebate_accounting_info/` | 查询返点核算信息。 |
| `query_rebate_balance_v2` | `/open_api/2/query/rebate_balance/` | 查询返点流水信息。 |
| `query_statement_v2` | `/open_api/2/query/statement/` | 代理商查询项目关联结算单信息 |
| `remittance_code_list_v3` | `/open_api/v3.0/remittance_code/list/` | 根据账号ID或者汇款码查询汇款码信息。 |
| `tools_ies_account_search_v2` | `/open_api/2/tools/ies_account_search/` | 用户可以查询广告主账户当前绑定的抖音号信息 |
