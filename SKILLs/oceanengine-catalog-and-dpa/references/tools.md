# 商品库、资产共享与 DPA工具清单

| Tool | Path | 说明 |
| --- | --- | --- |
| `dpa_album_create_v3` | `/open_api/v3.0/dpa/album/create/` | 创建短剧为异步动作，提交创建任务→上传短剧完成耗时较长，创建完后返回的album_id未必处于正常状态，建议定时轮询「查询短剧可投状态」获取短剧创建结果和是否可投，请求需使用APP Access Token及对应app_id。 |
| `dpa_album_status_get_v3` | `/open_api/v3.0/dpa/album_status/get/` | 查询短剧可投状态。特别注意：请求本接口时需要使用APP Access Token，通过【获取APP Access Token】接口获取。 |
| `dpa_asset_v2_list_v2` | `/open_api/2/dpa/asset_v2/list/` | 该接口主要查询汽车行业投放条件信息，根据新线索商品id查询投放条件列表。投放条件类型目前只支持汽车，只有启用的投放条件才可以在广告投放中添加。 |
| `dpa_assets_detail_read_v2` | `/open_api/2/dpa/assets/detail/read/` | 查询汽车行业投放条件信息，根据商品id查询投放条件详情 |
| `dpa_assets_list_v2` | `/open_api/2/dpa/assets/list/` | 查询汽车行业投放条件信息，根据商品id查询投放条件列表 |
| `dpa_category_get_v2` | `/open_api/2/dpa/category/get/` | 获取DPA分类 |
| `dpa_clue_product_delete_v2` | `/open_api/2/dpa/clue_product/delete/` | 删除升级版商品，支持批量操作，一次最多删除100个，已关联计划的商品不允许删除，服务为部分成功部分失败 |
| `dpa_clue_product_detail_v2` | `/open_api/2/dpa/clue_product/detail/` | 获取行业产品中心「产品管理-升级版」商品详情 |
| `dpa_clue_product_list_v2` | `/open_api/2/dpa/clue_product/list/` | 获取行业产品中心「产品管理-升级版」商品列表 |
| `dpa_clue_product_save_v2` | `/open_api/2/dpa/clue_product/save/` | 新增、编辑行业产品中心【产品管理 - 升级版】商品。支持类目包括电商店铺商品、活动商品、房产、汽车、游戏、影视等。截止更新日期2025/06/11，不同类目有不同使用规则和创建要求。还提供了查询升级版商品列表和详情的参考链接。 |
| `dpa_detail_get_v2` | `/open_api/2/dpa/detail/get/` | 根据商品库查询商品库中的商品列表，通过商品库ID+过滤条件查询商品列表信息 |
| `dpa_dict_get_v2` | `/open_api/2/dpa/dict/get/` | 获取dpa词包 |
| `dpa_meta_get_v2` | `/open_api/2/dpa/meta/get/` | 获取DPA元信息 |
| `dpa_playlet_auth_get_v2` | `/open_api/2/dpa/playlet/auth/get/` | 查询短剧商品原片授权申请状态。 |
| `dpa_product_availables_v2` | `/open_api/2/dpa/product/availables/` | 该接口用于查询商品库信息，仅支持查询广告主有权限访问的商品库 |
| `dpa_product_create_v2` | `/open_api/2/dpa/product/create/` | 创建DPA商品（无商品id） |
| `dpa_product_delete_v2` | `/open_api/2/dpa/product/delete/` | 此接口用于删除通用版商品库中的特定商品 |
| `dpa_product_detail_get_v2` | `/open_api/2/dpa/product/detail/get/` | 根据商品库查询商品库中的商品列表，仅填写商品库ID表示查询该商品库下所有商品，传入商品ID进行精准查询 |
| `dpa_product_status_batch_update_v2` | `/open_api/2/dpa/product_status/batch_update/` | 此接口用于批量修改DPA商品状态 |
| `dpa_product_update_v2` | `/open_api/2/dpa/product/update/` | 创建DPA商品（已有商品id）/修改DPA商品 |
| `dpa_video_get_v2` | `/open_api/2/dpa/video/get/` | 根据商品库和商品库商品查询可用的商品库视频模板 |
| `tools_bp_asset_management_share_cancel_v3` | `/open_api/v3.0/tools/bp_asset_management/share/cancel/` | 支持针对通用版商品库维度或升级版商品维度已有共享记录操作取消，取消成功后对应账户将不可使用对应的商品创建增量的计划及关联组件。请仔细核对需要取消的共享关系。 |
| `tools_bp_asset_management_share_get_v3` | `/open_api/v3.0/tools/bp_asset_management/share/get/` | 获取字节、微信小游戏/小程序资产共享范围 |
| `tools_bp_asset_management_share_v3` | `/open_api/v3.0/tools/bp_asset_management/share/` | 通用接口，支持通用版商品库、升级版商品及小程序小游戏资产共享。共享模式支持组织下所有账户、及单账户共享，商品库和商品目前仅支持共享给ad投放账户。 |
