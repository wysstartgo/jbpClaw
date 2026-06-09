# 评论运营与渠道增效工具清单

| Tool | Path | 说明 |
| --- | --- | --- |
| `douplus_optional_items_list_v3` | `/open_api/v3.0/douplus/optional_items/list/` | 获取DOU+可投视频列表。 |
| `douplus_optional_targets_list_v3` | `/open_api/v3.0/douplus/optional_targets/list/` | 获取视频可投放转化目标。 |
| `douplus_order_close_v3` | `/open_api/v3.0/douplus/order/close/` | 可批量终止DOU+在投订单(注：此接口白名单管控，请联系巨量引擎销售开通） |
| `douplus_order_create_v3` | `/open_api/v3.0/douplus/order/create/` | 用于创建DOU+订单(注：此接口仅支持在DOU+完成企业入驻的客户调用且白名单管控，白名单请联系巨量引擎销售开通） |
| `douplus_order_list_v3` | `/open_api/v3.0/douplus/order/list/` | 查询DOU+订单属性，近期更新2024/1/11，请求参数新增排序条件order_by_field、order_by_type参数，支持按照订单ID排序。 |
| `douplus_order_renew_v3` | `/open_api/v3.0/douplus/order/renew/` | 用以追加DOU+订单预算与投放时长。注意：不可以仅增加投放时长，可以仅增加投放预算 |
| `douplus_order_report_v3` | `/open_api/v3.0/douplus/order/report/` | 获取DOU+订单指标数据。 |
| `tools_aweme_auth_list_v2` | `/open_api/2/tools/aweme_auth_list/` | 可以获取账户下抖音号授权关系以及授权视频，默认仅返回授权关系生效中的数据。 |
| `tools_aweme_author_info_get_v2` | `/open_api/2/tools/aweme_author_info/get/` | 用于查询抖音号id对应的抖音达人信息。当计划中设置抖音达人账号时，可以根据其抖音账号id，查询对应的抖音达人信息。 |
| `tools_aweme_banned_create_v3` | `/open_api/v3.0/tools/aweme_banned/create/` | 添加屏蔽用户接口，支持根据抖音ID或昵称关键词屏蔽用户 |
| `tools_aweme_banned_delete_v3` | `/open_api/v3.0/tools/aweme_banned/delete/` | 删除屏蔽用户接口，支持删除根据抖音ID或昵称关键词的屏蔽规则 |
| `tools_aweme_banned_list_v3` | `/open_api/v3.0/tools/aweme_banned/list/` | 用于获取屏蔽用户列表。 |
| `tools_aweme_category_top_author_get_v2` | `/open_api/2/tools/aweme_category_top_author/get/` | 该接口用于解决 创建计划时，设置抖音达人定向需要的相关id值，接口将返回抖音类目下的推荐达人，根据类目id查询抖音推荐达人，抖音类目id可以通过【查询抖音类目列表】接口获取 |
| `tools_aweme_info_search_v2` | `/open_api/2/tools/aweme_info_search/` | 用于查询绑定的抖音号信息，可获取抖音账户和类目相关信息。 |
| `tools_aweme_multi_level_category_get_v2` | `/open_api/2/tools/aweme_multi_level_category/get/` | 该接口用于解决 创建计划时，设置抖音达人定向需要的相关id值，接口将返回抖音类目id值 |
| `tools_aweme_similar_author_search_v2` | `/open_api/2/tools/aweme_similar_author_search/` | 用于查询绑定的抖音号信息，可获取类似抖音作者的相关信息。 |
| `tools_blue_flow_keyword_list_v3` | `/open_api/v3.0/tools/blue_flow_keyword/list/` | 创建蓝海广告时，您可先通过本接口获取同项目下可用的蓝海关键词blue_flow_keyword_name，再调用「创建广告」接口传入。 |
| `tools_blue_flow_package_list_v3` | `/open_api/v3.0/tools/blue_flow_package/list/` | 本接口支持查询搜索蓝海项目可用的蓝海流量包ID，您需要先通过本接口查询blue_flow_package_id，再前往「创建项目」接口创建搜索蓝海项目。 |
| `tools_comment_get_v3` | `/open_api/v3.0/tools/comment/get/` | 用于获取广告账号下的所有评论列表。 |
| `tools_comment_hide_v3` | `/open_api/v3.0/tools/comment/hide/` | 隐藏评论接口，用于批量隐藏评论 |
| `tools_comment_metrics_get_v3` | `/open_api/v3.0/tools/comment_metrics/get/` | 获取广告账户下评论的「可见评论数」、「可见负评数」、「可见评论负评率」 |
| `tools_comment_mid2item_id_v3` | `/open_api/v3.0/tools/comment/mid2item_id/` | 提供由mid查询对应的item_id的能力，仅返回有评论内容的对应抖音视频 |
| `tools_comment_reply_get_v3` | `/open_api/v3.0/tools/comment_reply/get/` | 用于获取广告账号下的评论回复（用于获取二级评论）。 |
| `tools_comment_reply_v3` | `/open_api/v3.0/tools/comment/reply/` | 回复评论接口，用于批量回复评论 |
| `tools_comment_terms_banned_add_v3` | `/open_api/v3.0/tools/comment/terms_banned/add/` | 批量添加屏蔽词接口 |
| `tools_comment_terms_banned_delete_v3` | `/open_api/v3.0/tools/comment/terms_banned/delete/` | 批量删除屏蔽词接口 |
| `tools_comment_terms_banned_get_v3` | `/open_api/v3.0/tools/comment/terms_banned/get/` | 用于获取屏蔽词接口。 |
| `tools_comment_terms_banned_update_v3` | `/open_api/v3.0/tools/comment/terms_banned/update/` | 仅支持单个更新屏蔽词（增量更新） |
| `tools_gray_get_v3` | `/open_api/v3.0/tools/gray/get/` | 支持客户通过接口查询广告主是否命中各项灰度/白名单功能 |
| `tools_inactive_advertiser_list_v3` | `/open_api/v3.0/tools/inactive_advertiser/list/` | 查询开发者应用下最近7天请求过的不活跃账户。不活跃账户定义：指广告主在至少90天内没有任何活跃行为，结合消耗、项目/广告创编、余额、有无开启中计划等条件综合判断。接口查询结果为T+1，可在次日10点后更新同步。 |
| `tools_interest_action_action_category_v2` | `/open_api/2/tools/interest_action/action/category/` | 行为兴趣定向行为类目查询。 |
| `tools_interest_action_action_keyword_v2` | `/open_api/2/tools/interest_action/action/keyword/` | 行为兴趣定向行为关键词查询 |
| `tools_interest_action_id2word_v2` | `/open_api/2/tools/interest_action/id2word/` | 用于将兴趣行为类目关键词id转换为对应的词。 |
| `tools_interest_action_interest_category_v2` | `/open_api/2/tools/interest_action/interest/category/` | 行为兴趣定向行为类目查询。 |
| `tools_interest_action_interest_keyword_v2` | `/open_api/2/tools/interest_action/interest/keyword/` | 兴趣关键词查询 |
| `tools_interest_action_keyword_suggest_v2` | `/open_api/2/tools/interest_action/keyword/suggest/` | 用于获取行为兴趣推荐关键词。 |
| `tools_keywords_bid_ratio_create_v3` | `/open_api/v3.0/tools/keywords_bid_ratio/create/` | 设置优词提量系数和生效维度，需满足条件：项目未被删除，广告类型仅支持搜索直投，出价方式为CPA或OCPM且未设置深度出价。优词设置仅支持全部成功/全部失败。 |
| `tools_keywords_bid_ratio_delete_v3` | `/open_api/v3.0/tools/keywords_bid_ratio/delete/` | 删除优词计划，仅支持搜索直投，仅支持全部成功/全部失败 |
| `tools_keywords_bid_ratio_get_v3` | `/open_api/v3.0/tools/keywords_bid_ratio/get/` | 用于查询优词提量系数信息，仅支持搜索直投，不支持搜索dpa链路。 |
| `tools_keywords_bid_ratio_update_v3` | `/open_api/v3.0/tools/keywords_bid_ratio/update/` | 更新优词提量系数和生效维度，仅支持搜索直投，优词提量系数和生效维度仅支持修改一种，不支持搜索dpa广告，即landing_type = DPA && ad_type = SEARCH |
| `tools_keywords_project_info_get_v3` | `/open_api/v3.0/tools/keywords_project_info/get/` | 用于查询优词绑定的项目信息，仅支持搜索直投。 |
| `tools_live_authorize_list_v2` | `/open_api/2/tools/live_authorize/list/` | 查询授权直播抖音达人列表。 |
| `tools_privative_word_batch_get_v3` | `/open_api/v3.0/tools/privative_word/batch_get/` | 项目批量获取否定词 |
| `tools_privative_word_project_add_v3` | `/open_api/v3.0/tools/privative_word/project/add/` | 2.0批量添加项目否定词（支持搜索快投和搜索直投） |
| `tools_privative_word_project_update_v3` | `/open_api/v3.0/tools/privative_word/project/update/` | 项目批量更新否定词（全量更新） |
| `tools_privative_word_promotion_add_v3` | `/open_api/v3.0/tools/privative_word/promotion/add/` | 仅适用于搜索直投不支持为搜索周期稳投广告设置否定词，仅支持在项目层级设置 |
| `tools_privative_word_promotion_update_v3` | `/open_api/v3.0/tools/privative_word/promotion/update/` | 仅适用于搜索直投不支持为搜索周期稳投广告设置否定词，仅支持在项目层级设置 |
| `tools_promotion_raise_set_v3` | `/open_api/v3.0/tools/promotion_raise/set/` | 一键起量使用条件：oCPM计划、非nobid&自动化计划（管家，省心投），仅状态为“投放中”的广告支持“立即生效”。每个起量方案生效时间为6小时，冲突会报错。全量更新。传空则更新为空，此时已预约的方案将被删除，生效中的方案不受影响。 |
| `tools_promotion_raise_status_current_ids_get_v3` | `/open_api/v3.0/tools/promotion_raise_status_current_ids/get/` | 批量获取广告当前的一键起量状态 |
| `tools_promotion_raise_status_get_v3` | `/open_api/v3.0/tools/promotion_raise_status/get/` | 获取已预约的广告方案信息 |
| `tools_promotion_raise_stop_v3` | `/open_api/v3.0/tools/promotion_raise/stop/` | 关停正在起量的方案。 |
| `tools_promotion_raise_version_get_v3` | `/open_api/v3.0/tools/promotion_raise_version/get/` | 获取已完成一键起量或一键起量中的广告在多次起量过程中产生的起量版本号及对应的起止时间。 |
| `tools_search_bid_ratio_get_v2` | `/open_api/2/tools/search_bid_ratio/get/` | 用于获取快投推荐出价系数。 |
