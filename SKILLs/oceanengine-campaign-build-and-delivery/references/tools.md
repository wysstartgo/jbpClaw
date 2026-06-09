# 项目、广告与投放搭建工具清单

| Tool | Path | 说明 |
| --- | --- | --- |
| `budget_group_create_v3` | `/open_api/v3.0/budget_group/create/` | 新建预算组，预算组可设置多个项目的预算（日预算）。注意一个账户下同时最多存在 200 个有效的预算组，超过请先删除无用预算组。目前白名单开放，如需使用请联系对应销售。 |
| `budget_group_delete_v3` | `/open_api/v3.0/budget_group/delete/` | 通过此接口，可以批量删除预算组。注意目前白名单开放，如需使用请联系对应销售。 |
| `budget_group_list_v3` | `/open_api/v3.0/budget_group/list/` | 通过此接口，可查询广告账号下的所有预算组信息。注意目前白名单开放，如需使用请联系对应销售。 |
| `budget_group_update_v3` | `/open_api/v3.0/budget_group/update/` | 通过该接口，可更新预算组的名称和日预算。注意目前白名单开放，如需使用请联系对应销售。 |
| `cdp_brand_get_v3` | `/open_api/v3.0/cdp/brand/get/` | 仅能查询到关联云图和cdp的广告主品牌及类别信息 |
| `decoration_coupon_get_v3` | `/open_api/v3.0/decoration/coupon/get/` | 用于获取家装联盟卡券列表。 |
| `keyword_create_v3` | `/open_api/v3.0/keyword/create/` | 在指定的promotion_id下创建搜索关键词，支持在原有关键词基础上进行新增。目前仅支持搜索直投广告。创建关键词时会自动将优词添加为关键词。 |
| `keyword_delete_v3` | `/open_api/v3.0/keyword/delete/` | 删除指定keyword_id的搜索词，可批量删除。 |
| `keyword_list_v3` | `/open_api/v3.0/keyword/list/` | 根据过滤条件获取符合条件的所有关键词。目前仅支持根据promotion_id获取该广告下的关键词 |
| `keyword_update_v3` | `/open_api/v3.0/keyword/update/` | 根据keyword_id或word_id更新搜索词的出价、匹配类型等属性信息，增量更新。不支持更换关键词，如需要，可通过删除接口与创建接口实现 |
| `native_anchor_create_v3` | `/open_api/v3.0/native_anchor/create/` | 该接口暂不支持创建「高级在线预约」、「外跳」、「字节小程序」锚点。近期更新2023/12/27，请求参数中product_price类型调整为double，允许2位小数，原按整数型传入不受影响。 |
| `native_anchor_delete_v3` | `/open_api/v3.0/native_anchor/delete/` | 删除原生锚点 |
| `native_anchor_get_detail_v3` | `/open_api/v3.0/native_anchor/get/detail/` | 用于根据锚点唯一id获取锚点详情，支持查询账户下锚点的详情（包括被共享和自有锚点），暂不支持获取「高级在线预约」锚点详情。 |
| `native_anchor_get_v3` | `/open_api/v3.0/native_anchor/get/` | 用于获取账户下的原生锚点列表。 |
| `native_anchor_qrcode_preview_get_v3` | `/open_api/v3.0/native_anchor/qrcode_preview/get/` | 获取锚点的预览链接，您需将返回的预览url转成二维码，使用抖音APP扫码才可预览。预览url有效期24小时，仅当锚点关联广告时才可查询到预览url。 |
| `native_anchor_update_v3` | `/open_api/v3.0/native_anchor/update/` | 该接口暂不支持更新「高级在线预约」、「外跳」、「字节小程序」锚点 |
| `project_budget_update_v3` | `/open_api/v3.0/project/budget/update/` | 批量更新巨量引擎体验版项目预算，支持设置日预算和不限预算，单次可操作1-10个项目 |
| `project_cost_protect_status_get_v3` | `/open_api/v3.0/project/cost_protect_status/get/` | 批量获取项目成本保障状态。 |
| `project_create_v3` | `/open_api/v3.0/project/create/` | 创建巨量引擎体验版项目，支持多种推广目的、营销场景和投放模式 |
| `project_delete_v3` | `/open_api/v3.0/project/delete/` | 批量删除巨量引擎体验版已创建的广告项目，支持一次删除1-10个项目 |
| `project_list_v3` | `/open_api/v3.0/project/list/` | 用于获取巨量引擎体验版项目列表。 |
| `project_roigoal_update_v3` | `/open_api/v3.0/project/roigoal/update/` | 本接口支持批量修改项目ROI系数，当前仅以下项目支持ROI系数修改：应用推广、自动投放项目电商推广、自动投放项目电商推广、自动投放、周期稳投项目小程序、自动投放项目。注意：单ROI（仅设置roi_goal）和多ROI项目（仅设置shop_multi_roi_goals）不支持同时传入修改。 |
| `project_schedule_time_update_v3` | `/open_api/v3.0/project/schedule_time/update/` | 批量更新「巨量广告升级版」项目投放时间，不允许修改搜索周期投放项目的投放时间（项目层级delivery_type = DURATION） |
| `project_status_update_v3` | `/open_api/v3.0/project/status/update/` | 批量更新巨量引擎体验版广告项目的状态，支持启用和暂停项目，不允许修改搜索周期稳投项目状态 |
| `project_update_v3` | `/open_api/v3.0/project/update/` | 更新巨量引擎体验版项目，支持增量更新，不填或填固定不限格式可设置受众为不限 |
| `project_week_schedule_update_v3` | `/open_api/v3.0/project/week_schedule/update/` | 批量更新「巨量广告升级版」项目投放时段，不允许修改搜索周期投放项目的投放时段（项目层级delivery_type =DURATION），项目下广告会逐批完成修改，涉及广告数量过多时会有短暂延迟。 |
| `promotion_bid_update_v3` | `/open_api/v3.0/promotion/bid/update/` | 批量更新巨量引擎体验版广告出价，同时适用于o类广告和c类广告，不支持搜索周期稳投广告修改出价 |
| `promotion_budget_update_v3` | `/open_api/v3.0/promotion/budget/update/` | 批量更新巨量引擎体验版广告预算，不支持搜索周期稳投广告修改预算，预算修改有次数和幅度限制 |
| `promotion_cost_protect_status_get_v3` | `/open_api/v3.0/promotion/cost_protect_status/get/` | 用于批量获取广告成本保障状态。 |
| `promotion_create_v3` | `/open_api/v3.0/promotion/create/` | 在巨量广告项目下创建广告，暂不支持创建landing_type=LINK销售线索&ad_type=ALL通投&delivery_type=DURATION周期稳投项目及其广告 |
| `promotion_deepbid_update_v3` | `/open_api/v3.0/promotion/deepbid/update/` | 批量修改深度出价，不支持搜索周期稳投广告修改深度出价，深度出价单位元，精度两位小数 |
| `promotion_delete_v3` | `/open_api/v3.0/promotion/delete/` | 批量删除巨量引擎体验版广告，支持一次删除1-10个广告 |
| `promotion_list_v3` | `/open_api/v3.0/promotion/list/` | 获取广告列表，支持通过过滤条件（投放模式、状态、时间、学习期等）与两种分页方式（page/page_size或cursor/count）查询；可指定返回字段，默认不含已删除广告，返回广告列表及素材/配置等信息。 |
| `promotion_material_delete_v3` | `/open_api/v3.0/promotion/material/delete/` | 本接口支持删除一条广告下存在的素材，请注意：仅支持删除「巨量广告」账户下的广告素材，仅支持删除广告主在广告下添加的图片、视频、图文素材，不支持删除广告下「已删除」的素材，如传入的material_id在广告下的素材状态为已删除，调用本接口会报错“广告下不存在素材”，不支持将广告下素材全部删除，当广告下仅剩下1个素材时，再调用接口删除素材会报错。 |
| `promotion_reject_reason_get_v3` | `/open_api/v3.0/promotion/reject_reason/get/` | 用于批量查询一个账户下广告的审核建议，支持查询广告审核建议及素材审核建议。 |
| `promotion_schedule_time_update_v3` | `/open_api/v3.0/promotion/schedule_time/update/` | 支持在广告层级下批量修改投放时段，所设置的广告投放时段必须在广告所属项目的投放时段范围内。仅支持手动投放的广告，不支持搜索周期稳投广告修改投放时段（项目层级delivery_type = DURATION）。 |
| `promotion_status_update_v3` | `/open_api/v3.0/promotion/status/update/` | 批量更新巨量引擎体验版广告启用状态，支持启用和暂停广告，单次可操作1-10个广告 |
| `promotion_update_v3` | `/open_api/v3.0/promotion/update/` | 更新巨量引擎体验版广告，包括素材组合及广告出价预算，本接口为全量更新 |
| `tools_action_text_get_v2` | `/open_api/2/tools/action_text/get/` | 用户可以获取行动号召字段内容，结合附加创意类型以及广告主行业参数可以查询出更多细纬度的行动号召内容 |
| `tools_ad_preview_qrcode_get_v3` | `/open_api/v3.0/tools/ad_preview/qrcode_get/` | 新建广告审核通过后支持生成获取预览二维码，项目/广告暂停不支持获取预览二维码。注意：通过本接口获取到的预览url，需要自行转换为二维码，使用巨量引擎app或抖音app扫码预览。 |
| `tools_country_info_v2` | `/open_api/2/tools/country/info/` | 本接口支持查询国家/区域的code信息，需要与【获取行政信息】接口搭配使用。 |
| `tools_estimated_price_get_v2` | `/open_api/2/tools/estimated_price/get/` | 获取预估点击成本，返回建议出价上界、下界和回填建议出价。 |
| `tools_industry_get_v2` | `/open_api/2/tools/industry/get/` | 获取行业列表，通过接口可以获取到一级行业、二级行业、三级行业列表，其中代理商创建广告主时使用的是二级行业，而在创建创意填写创意分类时使用的是三级行业，请注意区分。 |
| `tools_promotion_card_recommend_get_v2` | `/open_api/2/tools/promotion_card/recommend/get/` | 查询创意推广卡片的行动号召、商品描述、商品卖点的推荐文案。创建创意——推广卡片时，请确保推广卡片的行动号召传参在获取到的推广卡片行动号召推荐文案中 |
| `tools_promotion_card_recommend_title_get_v2` | `/open_api/2/tools/promotion_card/recommend_title/get/` | 注意：此接口不再维护！即将下线，请勿接入！查询推广卡片推荐内容（新版） |
| `tools_region_get_v2` | `/open_api/2/tools/region/get/` | 用户可以获取地域列表（当前仅支持获取商圈ID） |
