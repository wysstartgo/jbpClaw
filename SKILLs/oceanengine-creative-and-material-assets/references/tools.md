# 创意、素材与审核资产工具清单

| Tool | Path | 说明 |
| --- | --- | --- |
| `advertiser_avatar_get_v2` | `/open_api/2/advertiser/avatar/get/` | 查询广告主账户头像信息，包括头像审核状态、品牌审核状态及头像预览链接等。 |
| `advertiser_avatar_submit_v2` | `/open_api/2/advertiser/avatar/submit/` | 本接口用于更新广告主账户头像，使用路径如下：调用「获取广告主账户头像ID」接口获取头像的image_id调用本接口完成账户头像的更新 |
| `advertiser_avatar_upload_v2` | `/open_api/2/advertiser/avatar/upload/` | 本接口用户获取广告主账户头像的image_id，您可使用该id调用「更新广告主账户头像」接口完成账户头像更新。【注意】本接口的功能仅用于获取image_id，上传成功 ≠ 更新头像，更新头像的接口是「更新广告主账户头像」接口。 |
| `assets_creative_component_create_v2` | `/open_api/2/assets/creative_component/create/` | 通过通用工具能力，创建不同的创意组件，用于广告投放。 |
| `assets_creative_component_get_v2` | `/open_api/2/assets/creative_component/get/` | 用户可以获取创意组件信息，可通过组件ID、名称、类型、审核状态等条件进行过滤查询 |
| `assets_creative_component_update_v2` | `/open_api/2/assets/creative_component/update/` | 该接口用户更新创意组件信息。组件信息发生变更后，会触发组件以及组件关联的所有计划的重审逻辑。 |
| `carousel_ad_get_v2` | `/open_api/2/carousel/ad/get/` | 获取同主体下广告主图文素材 |
| `carousel_create_v2` | `/open_api/2/carousel/create/` | 利用图片和音频塑造图文，图文包含多张图片和一段背景音乐，支持自动轮播图片。需先获取图片/音频id，再塑造图文获取图文mid。 |
| `carousel_delete_v2` | `/open_api/2/carousel/delete/` | 通过此接口，用户可以对图文素材进行批量删除。当素材删除失败时，会展示在carousel_id列表，不在此列表内的素材表示删除成功。 |
| `carousel_list_v2` | `/open_api/2/carousel/list/` | 通过此接口，用户可以获取经过一定条件过滤后的广告主下创意素材库下图文及图文信息。注意：page*page_size＞10000时会报错，请注意调增请求量级 |
| `carousel_update_v2` | `/open_api/2/carousel/update/` | 更新图文信息，目前仅支持图文标题 file_name 和图片主题修改 |
| `file_audio_ad_v2` | `/open_api/2/file/audio/ad/` | 通过此接口，用户可以上传和广告相关的音频图片，例如图文中的音频。 |
| `file_audio_get_v2` | `/open_api/2/file/audio/get/` | 支持查询广告账户下自2024年4月26日起上传的音频素材，不支持查询版权音频相关信息。 |
| `file_carousel_aweme_get_v3` | `/open_api/v3.0/file/carousel/aweme/get/` | 获取创编可用的抖音图文素材，用于获取巨量广告平台创建广告时可用的抖音图文素材。 |
| `file_image_ad_get_v2` | `/open_api/2/file/image/ad/get/` | 查询获取同主体下的广告主图片素材信息，可获取图片md5、宽高、预览地址等内容 |
| `file_image_ad_v2` | `/open_api/2/file/image/ad/` | 通过此接口，用户可以上传和广告相关的素材图片，例如创意素材。 |
| `file_image_advertiser_v2` | `/open_api/2/file/image/advertiser/` | 通过此接口，用户可以按照一定方式上传符合格式的广告主投放资质、主体资质相关图片，例如营业执照等，接口会返回"code_0"和"message_OK"，代表上传成功 |
| `file_image_delete_v3` | `/open_api/v3.0/file/image/delete/` | 通过此接口，用户可以批量删除广告主下创意素材库的图片。 |
| `file_image_get_v2` | `/open_api/2/file/image/get/` | 获取经过一定条件过滤后的广告主下创意素材库的图片及图片信息 |
| `file_material_attributes_list_v2` | `/open_api/2/file/material_attributes/list/` | 获取视频素材评估标签（新版），是原接口的升级版，支持查询账户下视频库的素材评估标签。 |
| `file_material_bind_v2` | `/open_api/2/file/material/bind/` | 本接口支持推送广告账户下已有的视频素材。不支持推送组织共享的视频素材。当素材在被推送账户下已存在，素材文件名、来源不会变化，仅更新素材的上传时间。一次请求推送限制需满足：推送视频数<=50、推送账户数*推送视频数<=1000。 |
| `file_material_detail_v2` | `/open_api/2/file/material/detail/` | 本接口能力较久未更新，建议使用最新接口获取素材标签，请前往「获取视频素材评估标签（新版）」。根据提供的素材id查询素材属性信息，目前仅支持视频素材，可以获取的素材信息包括在投素材和不在投素材，查询结果不区分是否在投，可以搭配创建素材清理任务接口对其中的【正在投放的】问题素材进行清理。 |
| `file_material_list_v2` | `/open_api/2/file/material/list/` | 用于根据adv检索素材列表，返回结果包含素材属性，支持素材属性标签筛选，目前仅支持视频素材。 |
| `file_playable_list_v3` | `/open_api/v3.0/file/playable/list/` | 获取试玩/直玩素材列表。直玩、试玩列表。 |
| `file_upload_task_create_v2` | `/open_api/2/file/upload_task/create/` | 将视频文件通过连山云素材服务上传后获取到视频文件链接，再将获取到的连山云视频文件url作为入参的video_url通过素材库提供的视频上传接口进行文件上传。仅支持开发者购置连山云素材服务上传生成的tos链接/连山点播云产品的视频链接上传，不支持其他三方链接地址。 |
| `file_video_ad_get_v2` | `/open_api/2/file/video/ad/get/` | 查询同主体下的广告主视频信息，可获取视频md5、宽高、预览地址等内容，用于搭建自己的素材库进行素材管理 |
| `file_video_ad_v2` | `/open_api/2/file/video/ad/` | 通过此接口，用户可以上传和广告相关的素材视频 |
| `file_video_agent_get_v2` | `/open_api/2/file/video/agent/get/` | 代理商获取视频素材。 |
| `file_video_agent_v2` | `/open_api/2/file/video/agent/` | 代理商可以通过此接口将「首发素材」上传视频素材至巨量方舟，上传后「首发素材」即可自动完成保护（前置需要先完成整体保护授权，参考详细文档介绍「搬运治理-首发保护」说明手册（可对外））。保护后系统将根据代理授权范围识别搬运素材生效打压，避免其他方抢夺代理的流量。 |
| `file_video_aweme_get_v2` | `/open_api/2/file/video/aweme/get/` | 根据抖音号id，获取其抖音主页下的视频的id，支持分页获取。 |
| `file_video_delete_v2` | `/open_api/2/file/video/delete/` | 通过此接口，用户可以对素材视频进行批量删除。当素材删除失败时，会展示在video_id列表，不在此列表内的素材表示删除成功！ |
| `file_video_efficiency_get_v2` | `/open_api/2/file/video/efficiency/get/` | 用于查询素材是否是低效素材，传入素材ID列表，返回低效素材列表。 |
| `file_video_get_v2` | `/open_api/2/file/video/get/` | 获取经过一定条件过滤后的广告主下创意素材库对应的视频及视频信息 |
| `file_video_material_clear_task_create_v2` | `/open_api/2/file/video/material/clear_task/create/` | 创建低效/同质素材清理任务的异步接口，最多同时创建10个运行中的清理任务，配合「获取清理任务列表」、「下载清理任务结果」接口使用。清理是暂停该问题素材/该问题素材关联的创意，不是删除素材，也不会影响到计划下其他在投素材/创意。能够清理到的素材范围是当前正在投放中的素材，不在投素材不属于可以被清理的素材范围，即使传入也无法进行清理。 |
| `file_video_material_clear_task_get_v2` | `/open_api/2/file/video/material/clear_task/get/` | 返回已创建的低效/同质视频素材清理任务列表 |
| `file_video_material_clear_task_result_get_v2` | `/open_api/2/file/video/material/clear_task_result/get/` | 根据adv_id和clear_id返回低效/同质视频素材的清理结果，与「创建素材清理任务」、「获取清理任务列表」接口配合使用 |
| `file_video_pause_v2` | `/open_api/2/file/video/pause/` | 通过【【代理商】明点无效素材查询】接口查询无效素材，然后进行暂停。本接口不支持暂停自动化素材，自动化素材可通过【批量更新广告素材启用状态】暂停。素材清理范围限「同质化素材」。 |
| `file_video_update_v2` | `/open_api/2/file/video/update/` | 通过此接口，用户可以批量更新素材视频的名称。 |
| `file_video_upload_task_list_v2` | `/open_api/2/file/video/upload_task/list/` | 获取异步上传视频文件结果。 |
| `material_status_update_v3` | `/open_api/v3.0/material/status/update/` | 批量更新广告素材启用状态，支持启用和暂停素材，单次可操作1-10个素材 |
| `open_material_audit_pro_get_v3` | `/open_api/v3.0/open_material_audit/pro/get/` | 广告素材预审结果查询（连山云视频点播版），连山云视频点播版广告素材预审接口对应的审核结果查询接口。 |
| `open_material_audit_pro_submit_v3` | `/open_api/v3.0/open_material_audit/pro/submit/` | 支持连山云视频点播的视频进行预审 |
| `recommend_video_list_v3` | `/open_api/v3.0/recommend/video/list/` | 本接口暂仅支持白名单客户使用，如有诉求可联系对接销售/运营。建议获取推荐视频素材的投放场景：销售线索推广目的下营销场景 = 短视频 + 图文。如接口返回为空则代表没有推荐的视频素材。 |
| `reject_material_ai_repair_accept_task_create_v3` | `/open_api/v3.0/reject_material/ai_repair_accept_task/create/` | 本接口为异步接口，需与「获取素材修复建议采纳结果」接口搭配使用。一次传入50个修复id，从创建采纳任务→采纳完成，时效预估在1分钟以内。 |
| `reject_material_ai_repair_accept_task_list_v3` | `/open_api/v3.0/reject_material/ai_repair_accept_task/list/` | 注意：本接口为异步接口，需与创建采纳「拒审素材修复建议」任务API搭配使用。您可通过本接口查询采纳的最新状态。 |
| `reject_material_ai_repair_cross_account_get_v3` | `/open_api/v3.0/reject_material/ai_repair/cross_account/get/` | 根据mid查询同主体账户下修复建议列表。 |
| `reject_material_ai_repair_get_v3` | `/open_api/v3.0/reject_material/ai_repair/get/` | 获取拒审素材修复建议。对应PC端产品能力：拒审素材「一键过审」产品手册一一过审真的「方便」。 |
| `sugg_words_v3` | `/open_api/v3.0/sugg_words/` | 获取推荐关键词，支持搜索直投和搜索快投场景，可以通过多种方式获取关键词推荐 |
| `tools_asset_link_list_v3` | `/open_api/v3.0/tools/asset_link/list/` | 获取字节小程序/小游戏详情内容 |
| `tools_creative_word_select_v2` | `/open_api/2/tools/creative_word/select/` | 用于创意标题时的动态词包，本接口可以查询已有创意词词包id，目前仅支持查询词包，不支持创建新词包 |
| `tools_rubeex_get_v2` | `/open_api/2/tools/rubeex/get/` | 查询广告主名下的互动广告作品列表与作品信息。 |
| `tools_rubeex_playable_list_v2` | `/open_api/2/tools/rubeex_playable/list/` | 查询广告主名下的互动作品(project_id)关联的试玩素材(playable_id)列表。project id和playable id是1对n的关系。 |
| `tools_rubeex_remark_v2` | `/open_api/2/tools/rubeex/remark/` | 获取作品场景信息。 |
| `tools_rubeex_version_get_v2` | `/open_api/2/tools/rubeex/version/get/` | 获取互动广告作品对应的版本信息。 |
| `tools_video_cover_suggest_v2` | `/open_api/2/tools/video_cover/suggest/` | 获取针对素材视频推荐的智能封面，通过提取视频关键帧筛选出推荐封面 |
