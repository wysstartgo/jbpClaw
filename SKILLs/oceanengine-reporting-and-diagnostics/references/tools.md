# 报表、洞察与诊断工具清单

| Tool | Path | 说明 |
| --- | --- | --- |
| `diagnosis_task_adv_create_v2` | `/open_api/2/diagnosis_task/adv/create/` | 广告主创建前测任务，用于通过视频id和投放设置创建前测任务，同一广告主24小时内最多1000素材 |
| `diagnosis_task_adv_get_v2` | `/open_api/2/diagnosis_task/adv/get/` | Adv根据task_id获取前测结果。 |
| `diagnosis_task_adv_list_v2` | `/open_api/2/diagnosis_task/adv/list/` | Adv获取前测任务列表。 |
| `diagnosis_task_agent_create_v2` | `/open_api/2/diagnosis_task/agent/create/` | 代理商创建前测任务，用于通过视频id和投放设置创建前测任务，同一素材24小时内最多5次，同一代理商24小时内最多50000素材 |
| `diagnosis_task_agent_get_v2` | `/open_api/2/diagnosis_task/agent/get/` | 代理商根据task_id获取前测结果。 |
| `diagnosis_task_agent_list_v2` | `/open_api/2/diagnosis_task/agent/list/` | 代理商获取前测任务列表。 |
| `file_rebate_common_download_create_task_v2` | `/open_api/2/file/rebate/common_download/create_task/` | 根据筛选条件下载任务,返回用户query_id,用于后续的文件下载 |
| `file_rebate_common_download_download_file_v2` | `/open_api/2/file/rebate/common_download/download_file/` | 通过指定的task_id,获取对应的数据明细文件。 |
| `file_rebate_common_download_get_download_task_list_v2` | `/open_api/2/file/rebate/common_download/get_download_task_list/` | 查询指定query_id的所有下载任务。 |
| `file_rebate_material_download_create_task_v2` | `/open_api/2/file/rebate/material_download/create_task/` | Header字段：Access - Token为必填string类型，是授权access_token，可通过【获取Access token】接口获取；Content - Type为必填string类型，请求消息类型允许值: application/json。请求参数字段包含agent_id、period等多个参数及相关描述。应答字段包含code、message等。 |
| `file_rebate_material_download_download_file_v2` | `/open_api/2/file/rebate/material_download/download_file/` | 通过指定的task_id,获取对应的数据明细文件 |
| `file_rebate_material_download_get_download_task_list_v2` | `/open_api/2/file/rebate/material_download/get_download_task_list/` | 查询指定query_id的所有下载任务。 |
| `file_rebate_rebate_download_create_task_v2` | `/open_api/2/file/rebate/rebate_download/create_task/` | 返回文件详细内容请查看：https://bytedance.larkoffice.com/docx/EBETdc8IIonmWoxWYJ7c1dNtndg |
| `report_agent_get_v2_v2` | `/open_api/2/report/agent/get_v2/` | 获取代理商下所有广告主的消耗数据包括实时与历史 |
| `report_custom_async_task_create_v3` | `/open_api/v3.0/report/custom/async_task/create/` | 自定义报表—创建异步任务。每个开发者每天最多只能为每个广告账号创建 10 个任务（不包括提交失败的任务）。 |
| `report_custom_async_task_download_v3` | `/open_api/v3.0/report/custom/async_task/download/` | 自定义报表-获取下载结果。 |
| `report_custom_async_task_get_v3` | `/open_api/v3.0/report/custom/async_task/get/` | 自定义报表-获取异步任务列表 |
| `report_custom_config_get_v3` | `/open_api/v3.0/report/custom/config/get/` | 用于获取自定义报表可用指标和维度。 |
| `report_custom_get_v3` | `/open_api/v3.0/report/custom/get/` | 用于获取自定义报表数据，支持自由选择和组合指标和维度定义数据报表字段。 |
| `report_live_room_analysis_get_v2` | `/open_api/2/report/live_room/analysis/get/` | 用于获取直播间的基础分析数据、互动分析数据、商品转化数据 |
| `report_live_room_analysis_get_v3` | `/open_api/v3.0/report/live_room/analysis/get/` | 直播间分析报表接口用于获取直播间的基础分析数据、互动分析数据。仅支持获取广告主账户关联的抖音号的直播数据，不限制广告主账户和抖音号两者需为同一公司主体，支持查询2020年7月1日之后的数据，指标非实时，次日凌晨产出前一天数据。 |
| `report_live_room_attribute_get_v2` | `/open_api/2/report/live_room/attribute/get/` | 用于通过广告主id获取广告主账号绑定的抖音号的开播信息，包含主播信息和直播间信息 |
| `report_live_room_audience_portrait_get_v2` | `/open_api/2/report/live_room/audience/portrait/get/` | 用于进行直播间的受众分析、获取直播间用户画像数据，包含性别、年龄范围、省份、城市、用户设备平台等维度 |
| `report_live_room_flow_category_get_v2` | `/open_api/2/report/live_room/flow_category/get/` | 用于获取直播间的流量来源数据，包含竞价广告、品牌广告、DOU+流量、自然流量的各项指标 |
| `report_report_live_room_audience_portrait_get_v3` | `/open_api/v3.0/report/report/live_room/audience/portrait/get/` | 直播间受众分析报表，包含请求的Header字段、请求参数字段及应答字段等信息，可对直播间受众按不同维度进行分析，获取相关指标数据。 |
| `report_rta_cus_exp_get_v2` | `/open_api/2/report/rta_cus_exp/get/` | 获取穿山甲的广告主分流的联合实验数据。 |
| `report_rta_exp_get_v2` | `/open_api/2/report/rta_exp/get/` | 用于查询穿山甲渠道的RTA联合实验数据。 |
| `report_rta_exp_local_daily_get_v3` | `/open_api/v3.0/report/rta_exp_local_daily/get/` | 用于查询站内媒体渠道的RTA联合实验数据，支持分天t+1级别数据。 |
| `report_rta_exp_local_hourly_get_v3` | `/open_api/v3.0/report/rta_exp_local_hourly/get/` | 用于查询站内媒体渠道的RTA联合实验数据，支持分时t+5级别数据。 |
| `report_site_page_v2` | `/open_api/2/report/site/page/` | 获取橙子建站和程序化落地页的数据，不包含第三方落地页 |
| `tools_bids_suggest_v3` | `/open_api/v3.0/tools/bids/suggest/` | 通过广告分析查询广告的建议出价。 |
| `tools_log_search_v2` | `/open_api/2/tools/log_search/` | 用户可以查询巨量广告、巨量本地推、巨量千川后台操作日志，默认查询最近7天的数据，最多查询跨度为一个月 |
| `tools_promotion_diagnosis_suggestion_accept_v3` | `/open_api/v3.0/tools/promotion_diagnosis/suggestion/accept/` | 采纳广告诊断建议，用于应用系统提供的广告优化建议，支持多种素材参数调整 |
| `tools_promotion_diagnosis_suggestion_get_v3` | `/open_api/v3.0/tools/promotion_diagnosis/suggestion/get/` | 用于查询广告诊断建议，获取最新的广告诊断结果。 |
| `tools_suggest_budget_get_v3` | `/open_api/v3.0/tools/suggest_budget/get/` | 通过adv_id和promotion_ids获取建议的广告起量预算 |
