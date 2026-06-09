# 应用生态、小程序与渠道资产工具清单

| Tool | Path | 说明 |
| --- | --- | --- |
| `game_addiction_id_get_v3` | `/open_api/v3.0/game_addiction_id/get/` | 查询应用关键行为ID。用于获取优化目标external_action【关键行为】下的属性ID，供创建项目接口使用。 |
| `spi_task_get_v2` | `/open_api/2/spi_task/get/` | 查询2天内SPI推送给开发者回调地址的数据。查询推送数据，限制最多只能查询2天内数据。该接口token为应用级token。 |
| `subscribe_accounts_add_v3` | `/open_api/v3.0/subscribe/accounts/add/` | 对于SPI订阅任务，支持「App维度」/「订阅任务维度」管理推送账户列表；对于RDS订阅任务，支持「订阅任务维度」管理推送账户列表，暂不支持「App维度」 |
| `subscribe_accounts_list_v3` | `/open_api/v3.0/subscribe/accounts/list/` | 查询订阅账户列表。SPI支持App/订阅任务维度管理推送账户，RDS仅支持订阅任务维度。 |
| `subscribe_accounts_remove_v3` | `/open_api/v3.0/subscribe/accounts/remove/` | 对于SPI订阅任务，支持「App维度」/「订阅任务维度」管理推送账户列表；对于RDS订阅任务，支持「订阅任务维度」管理推送账户列表，暂不支持「App维度」 |
| `tool_quick_app_management_quick_app_get_v2` | `/open_api/2/tool/quick_app_management/quick_app/get/` | 用于查询当前广告主的快应用信息。 |
| `tools_app_management_android_app_list_v2` | `/open_api/2/tools/app_management/android_app/list/` | 查询账户下安卓应用信息（支持所有账户体系）及应用详细信息。 |
| `tools_app_management_android_basic_package_get_v2` | `/open_api/2/tools/app_management/android_basic_package/get/` | 查询安卓应用母包信息，包括当前版本和待发布版本的详细信息。 |
| `tools_app_management_android_basic_package_update_v2` | `/open_api/2/tools/app_management/android_basic_package/update/` | 更新安卓应用母包对应的信息 |
| `tools_app_management_app_get_v2` | `/open_api/2/tools/app_management/app/get/` | 查询安卓应用信息接口 |
| `tools_app_management_booking_get_v2` | `/open_api/2/tools/app_management/booking/get/` | 查询游戏预约列表接口 |
| `tools_app_management_booking_records_get_v2` | `/open_api/2/tools/app_management/booking_records/get/` | 查询游戏预约记录详情数据接口 |
| `tools_app_management_bp_share_cancel_v2` | `/open_api/2/tools/app_management/bp_share/cancel/` | 取消应用共享关系 |
| `tools_app_management_bp_share_v2` | `/open_api/2/tools/app_management/bp_share/` | 设置应用共享，可通过该接口将应用共享给相关组织或指定账户 |
| `tools_app_management_extend_package_create_v2` | `/open_api/2/tools/app_management/extend_package/create/` | 通过广告主id和应用包id，为应用包创建对应的分包信息。 |
| `tools_app_management_extend_package_create_v2_v2` | `/open_api/2/tools/app_management/extend_package/create_v2/` | 创建应用分包，支持所有账户体系下创建应用分包 |
| `tools_app_management_extend_package_list_v2_v2` | `/open_api/2/tools/app_management/extend_package/list_v2/` | 查询分包列表（支持所有账户体系），可查询该应用包相关信息和包含的分包信息。不受分包新建方式影响，都可以获取到。 |
| `tools_app_management_extend_package_update_v2` | `/open_api/2/tools/app_management/extend_package/update/` | 通过广告主id和应用包id，更新全部或部分应用子包版本。 |
| `tools_app_management_extend_package_update_v2_v2` | `/open_api/2/tools/app_management/extend_package/update_v2/` | 通过账户id、账户类型和应用包id，更新全部或部分应用子包版本。支持AD、巨量引擎工作台 - 旧版及巨量引擎工作台 - 升级版客户。 |
| `tools_app_management_harmony_app_list_v2` | `/open_api/2/tools/app_management/harmony_app_list/` | 查询鸿蒙应用列表。 |
| `tools_app_management_share_account_list_v2` | `/open_api/2/tools/app_management/share_account/list/` | 查询应用共享范围，查询巨量纵横组织下某个应用的共享范围。 |
| `tools_app_management_update_authorization_v2` | `/open_api/2/tools/app_management/update/authorization/` | 增加和删除应用资产的共享关系。请求需携带授权access_token，消息类型为application/json。请求参数包含广告主id、共享关系变更的广告主对象id、应用资产id和共享关系变更类型。 |
| `tools_app_management_upload_task_list_v2` | `/open_api/2/tools/app_management/upload_task/list/` | 查询异步上传解析任务的状态信息「支持所有账户体系」。 |
| `tools_download_package_get_v2` | `/open_api/2/tools/download/package/get/` | 查询包解析状态，用于创建包含游戏礼包码的广告计划 |
| `tools_download_package_parse_v2` | `/open_api/2/tools/download/package/parse/` | 提交解析应用包任务，用于解析应用包信息，如包名、appname、icon等。 |
| `tools_micro_app_create_v3` | `/open_api/v3.0/tools/micro_app/create/` | 创建字节小程序资产时，小程序调起链接存在两种录入方式：通过参数 app_page.link 录入完整的链接信息；通过参数 app_page.start_page 与 app_page.start_param 利用平台能力生成调起链接，进而录入链接信息。两种方式仅生效一种，当三个参数均有值时，按方式1生效逻辑。 |
| `tools_micro_app_list_v3` | `/open_api/v3.0/tools/micro_app/list/` | 获取巨量工作台上字节小程序资产列表 |
| `tools_micro_app_update_v3` | `/open_api/v3.0/tools/micro_app/update/` | 审核成功的小程序资产可批量新增、更新、删除链接信息。小程序资产信息仅支持更新备注信息，且更新后不会再次送审。新增调起链接时不需要填写链接id，更新链接或删除链接需要先获取链接id后再进行操作。创建链接或更新链接时，小程序调起链接存在两种录入方式，两种方式仅生效一种。 |
| `tools_micro_game_convert_window_get_v3` | `/open_api/v3.0/tools/micro_game/convert_window/get/` | 查询当前字节小游戏最新的归因激活时间窗配置内容。 |
| `tools_micro_game_convert_window_update_v3` | `/open_api/v3.0/tools/micro_game/convert_window/update/` | 当前接口仅支持修改字节小游戏归因激活时间窗，表示已激活用户最后一次打开小程序后，时隔多久可被重新判定为未激活用户，该周期针对字节自归因的广告转化目标生效，默认为30天，可通过该接口编辑修改。 |
| `tools_micro_game_create_v3` | `/open_api/v3.0/tools/micro_game/create/` | 创建字节小游戏资产时，小游戏调起链接存在两种信息录入方式：通过参数 game_link.link 录入完整的链接信息。通过参数 game_link.start_param 利用平台能力生成调起链接，进而录入链接信息。两种方式仅生效一种。当以上两个参数均有值时，将按照方式1.生效逻辑。 |
| `tools_micro_game_list_v3` | `/open_api/v3.0/tools/micro_game/list/` | 获取字节小游戏列表，对应在巨量工作台上的字节小游戏资产 |
| `tools_micro_game_update_v3` | `/open_api/v3.0/tools/micro_game/update/` | 审核成功的小游戏资产可批量新增、更新、删除链接信息。小游戏资产信息仅支持更新备注信息，且更新后不会再次送审。新增调起链接时不需要填写链接id，更新链接或删除链接需要先获取链接id后再进行操作。创建链接或更新链接时，小游戏调起链接存在两种录入方式，两种方式仅生效一种。 |
| `tools_playable_cloud_game_list_v2` | `/open_api/2/tools/playable/cloud_game/list/` | 获取云游戏试玩素材列表。 |
| `tools_playable_grant_result_v2` | `/open_api/2/tools/playable/grant/result/` | 试玩素材支持在同主体下进行推送，本接口用于获取试玩素材推送的结果。可根据【推送试玩素材】接口生成的task_id进行过滤检索试玩素材推送的状态 |
| `tools_playable_grant_v2` | `/open_api/2/tools/playable/grant/` | 本接口用于试玩素材推送，推送仅可至同主体下已开通试玩素材白名单的广告主。一次最多推50个，异步返回task_id可查状态。同一素材可重复推，两个月内已审过素材推送后仍通过，超两月需重审。 |
| `tools_playable_list_get_v2` | `/open_api/2/tools/playable_list/get/` | 获取试玩素材列表 |
| `tools_playable_save_v2` | `/open_api/2/tools/playable/save/` | 上传并校验审核通过后，调用本接口保存试玩素材。 |
| `tools_playable_upload_v2` | `/open_api/2/tools/playable/upload/` | 试玩素材上传，需要经历三个步骤，首先调用tools/playable/upload/接口进行素材包上传，然后调用/tools/playable/validate/接口进行素材上传结果校验，若审核通过，即可调用/tools/playable/save/完成素材上传流程。 |
| `tools_playable_validate_v2` | `/open_api/2/tools/playable/validate/` | 试玩素材上传校验结果 |
| `tools_union_flow_package_create_v2` | `/open_api/2/tools/union/flow_package/create/` | 创建穿山甲流量包。 |
| `tools_union_flow_package_delete_v2` | `/open_api/2/tools/union/flow_package/delete/` | 删除穿山甲流量包。 |
| `tools_union_flow_package_get_v2` | `/open_api/2/tools/union/flow_package/get/` | 获取穿山甲流量包 |
| `tools_union_flow_package_promotion_report_v3` | `/open_api/v3.0/tools/union/flow_package/promotion/report/` | 查看穿山甲2.0广告位数据 |
| `tools_union_flow_package_report_v2` | `/open_api/2/tools/union/flow_package/report/` | 查看穿山甲广告位数据 |
| `tools_union_flow_package_update_v2` | `/open_api/2/tools/union/flow_package/update/` | 修改穿山甲流量包，涉及修改流量包的相关信息，如广告主ID、流量包名称、流量包ID、穿山甲广告位等。 |
| `tools_wechat_applet_create_v3` | `/open_api/v3.0/tools/wechat_applet/create/` | 该接口用于创建微信小程序相关资产，包含请求头、请求参数等信息，请求参数涉及广告主ID、小程序名称、原始ID等，应答包含返回码、返回信息和返回数据等。 |
| `tools_wechat_applet_list_v3` | `/open_api/v3.0/tools/wechat_applet/list/` | 该接口用于获取微信小程序列表相关信息，包含请求参数设置及应答字段说明等内容。 |
| `tools_wechat_applet_update_v3` | `/open_api/v3.0/tools/wechat_applet/update/` | 全量更新接口，请上传您需要更新的全部信息 |
| `tools_wechat_game_create_v3` | `/open_api/v3.0/tools/wechat_game/create/` | 请您确保已经上传投放资质，且广告主账户认证的公司主体需与资产创建流程中选择的公司主体一致，用于资质审核。若未提交投放资质，请通过【投放资质提交接口】提交资质，否则资产审核将不通过。资质信息可通过【获取投放资质信息】接口查询。 |
| `tools_wechat_game_list_v3` | `/open_api/v3.0/tools/wechat_game/list/` | 支持获取纵横账户下及广告主账户下的微信小游戏资产 |
