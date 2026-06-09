# 站点、落地页与模板工具清单

| Tool | Path | 说明 |
| --- | --- | --- |
| `tools_forbidden_link_grey_get_v3` | `/open_api/v3.0/tools/forbidden_link/grey/get/` | 开发者可通过本接口查询巨量广告账户是否命中迁移本地推白名单。 |
| `tools_landing_group_create_v2` | `/open_api/2/tools/landing_group/create/` | 通过此接口，用户可以创建按照流量分配的落地页组，创建成功后，接口会返回落地页组信息。 |
| `tools_landing_group_get_v2` | `/open_api/2/tools/landing_group/get/` | 用户可以获取落地页组以及站点的基本信息，包括落地页组ID、名称、URL、状态、流量分配方式和站点列表信息 |
| `tools_landing_group_site_opt_status_update_v2` | `/open_api/2/tools/landing_group/site_opt_status/update/` | 通过此接口，用户可以修改落地页组站点的启用状态。 |
| `tools_landing_group_update_v2` | `/open_api/2/tools/landing_group/update/` | 通过此接口，用户可以更新落地页组的基本信息。 |
| `tools_orange_site_get_v3` | `/open_api/v3.0/tools/orange_site/get/` | 用于通过优化目标获取橙子落地页站点信息。 |
| `tools_site_copy_v2` | `/open_api/2/tools/site/copy/` | 通过此接口，用户可以实现站点的复制功能，成功后生成一个新站点id，站点内容和原站点一致。 |
| `tools_site_create_v2` | `/open_api/2/tools/site/create/` | 通过此接口，用户可以创建站点（用于存放落地页），之后才能创建落地页。创建站点接口会返回站点ID。 |
| `tools_site_forms_list_v2` | `/open_api/2/tools/site/forms/list/` | 用户可以获取橙子建站落地页中的特殊的表单类型，比如附带下载类型，包括落地页表单ID、表单位置、表单名字等 |
| `tools_site_get_v2` | `/open_api/2/tools/site/get/` | 用户可以获取广告主建站列表，包括建站ID、建站名称、建站状态、建站类型等信息 |
| `tools_site_handsel_v2` | `/open_api/2/tools/site/handsel/` | 通过此接口，用户可以实现站点的转赠功能，将某一广告主的站点复制给其他特定的广告主，转赠成功后，被转增的广告主账户下会新增一个站点id（内容同原站点）。不限制主体，同广告主不能进行转赠操作。 |
| `tools_site_preview_v2` | `/open_api/2/tools/site/preview/` | 用户可以获取已创建橙子建站站点的预览地址，预览地址有效期为20分钟 |
| `tools_site_read_v2` | `/open_api/2/tools/site/read/` | 用户可以获取站点的详细信息，包括新建或更新时传递的全量数据 |
| `tools_site_template_create_v2` | `/open_api/2/tools/site_template/create/` | 可通过此接口基于已有落地页创建落地页模版 |
| `tools_site_template_get_v2` | `/open_api/2/tools/site_template/get/` | 获取通过【基于站点创建模板】接口创建的落地页模板。 |
| `tools_site_template_pic_url_get_v2` | `/open_api/2/tools/site_template/pic_url/get/` | 通过 site_id / template_id 获取站点/模板下的图片加签URL |
| `tools_site_template_preview_v2` | `/open_api/2/tools/site_template/preview/` | 预览通过【基于站点创建模板】接口创建的落地页模板。落地页模板的预览链接有效时间为20分钟。 |
| `tools_site_template_site_create_v2` | `/open_api/2/tools/site_template/site/create/` | 可以基于已创建的模版新建或者编辑落地页站点 |
| `tools_site_update_status_v2` | `/open_api/2/tools/site/update_status/` | 通过此接口，用户可以更改橙子建站站点状态。新建的站点同样需要发布后才可生效投入使用！恢复删除站点后，需要再发布才可生效！ |
| `tools_site_update_v2` | `/open_api/2/tools/site/update/` | 通过此接口，用户可以修改站点的基本信息。目前bricks不支持部分更新，仅支持全量更新。 |
| `tools_third_site_delete_v2` | `/open_api/2/tools/third_site/delete/` | 通过此接口，用户可以删除第三方落地页站点。 |
| `tools_third_site_get_v2` | `/open_api/2/tools/third_site/get/` | 广告主可以获取广告主下拥有的第三方落地页站点列表，包含站点审核状态、创建时间、名称、ID、缩略图地址、站点地址 |
| `tools_third_site_preview_v2` | `/open_api/2/tools/third_site/preview/` | 用户可以获取第三方落地页预览地址 |
| `tools_third_site_update_v2` | `/open_api/2/tools/third_site/update/` | 通过此接口，用户可以修改第三方落地页站点名称name，修改成功后接口会返回"code_0"。 修改站点名称前后，站点id：site_id不变。 |
