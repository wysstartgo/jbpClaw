# 人群包与 DMP 数据资产工具清单

| Tool | Path | 说明 |
| --- | --- | --- |
| `audience_package_bindinfo_get_v3` | `/open_api/v3.0/audience_package_bindinfo/get/` | 定向包查询关联项目信息。可通过【获取定向包】接口获取定向包ID，根据定向包ID查询该定向包关联了哪些项目。 |
| `audience_package_create_v2` | `/open_api/2/audience_package/create/` | 创建定向包 |
| `audience_package_delete_v2` | `/open_api/2/audience_package/delete/` | 删除定向包。 |
| `audience_package_get_v3` | `/open_api/v3.0/audience_package/get/` | 获取广告主下定向包，不同类型定向包可应用于不同类型的计划。原获取定向包接口由于接口能力局限性近期将下线，本接口能力覆盖原获取定向包接口。 |
| `audience_package_update_v2` | `/open_api/2/audience_package/update/` | 更新定向包 |
| `dmp_custom_audience_copy_v2` | `/open_api/2/dmp/custom_audience/copy/` | 通过此接口，将DMP人群包复制一个，并推送至对应的云图账号内，可在人群模块自定义分析查看和应用（该人群不支持再次推送） |
| `dmp_custom_audience_delete_v2` | `/open_api/2/dmp/custom_audience/delete/` | 通过此接口可做人群包删除操作。已经在计划中使用的人群包不能被删除，只有该计划被删除后，人群包才可以删除。 |
| `dmp_custom_audience_publish_v2` | `/open_api/2/dmp/custom_audience/publish/` | 使用发布接口可以将人群包进行发布。发布是一个异步的过程，发布中不建议对数据源进行更新操作，这会导致人群包的发布过程推迟！ |
| `dmp_custom_audience_push_v2_v2` | `/open_api/2/dmp/custom_audience/push_v2/` | 每个人群包生成一个人群包id后，都需要经过推送，才可以在被推送的广告主下使用。同时，推送人群包可以将人群包共享给同主体的广告主。 |
| `dmp_custom_audience_read_v2` | `/open_api/2/dmp/custom_audience/read/` | 查询广告主下的指定人群包信息，支持查询已删除的人群包信息 |
| `dmp_custom_audience_select_v2` | `/open_api/2/dmp/custom_audience/select/` | 查询广告主下存在的人群包列表和信息，包括人群包的id，可用状态，来源，覆盖人群等 |
| `dmp_data_source_create_v2` | `/open_api/2/dmp/data_source/create/` | 通过【数据源文件上传】接口得到file_path文件路径后，调用当前接口将数据源文件创建成一个数据源，创建成功后会返回一个数据源id，作为数据源的唯一标识。数据源创建完成后，系统会进行一个数据源解析的过程，将数据源解析成对应的人群包，这个过程大概持续20-60分钟；（同时使用该功能的用户数量多时可能造成解析时间较长，超出60分钟，具体时长将由具体任务量决定，请耐心等待）。 人群包的生成进度可通过【数据源详细信息】查询。目前每个广告主账号一天只能创建100次数据源，超出报错！一次上传的file_paths文件路径限制个数为1000，超出报错！ |
| `dmp_data_source_file_upload_v2` | `/open_api/2/dmp/data_source/file/upload/` | 当用户需要上传本地数据到DMP数据平台上时，需要处理成符合数据格式要求的文件，使用数据源文件上传功能。用户上传数据源文件后会返回文件路径file_path，用于调用【数据源创建】时创建相应的数据源。如果人群包用于广告投放，必须再调用【发布人群包】才能生效 |
| `dmp_data_source_read_v2` | `/open_api/2/dmp/data_source/read/` | 通过数据源id，查询该数据源相关信息和其对应的人群包信息，支持批量查询多个数据源 |
| `dmp_data_source_update_v2` | `/open_api/2/dmp/data_source/update/` | 用户可以调用该接口在原有的数据源上进行添加、删除、重置操作。 数据源更新不会导致数据源id发生变化。用户可以在【数据源详细信息】查看更新是否完成。当lastest_published_time:数据源最近一次发布时间返回的数据被覆盖为最新的更新发布时间后，则说明最近一次更新已经完成。添加：将需要添加的数据源文件内容通过调用【数据源文件上传】的方式获得文件路径file_path，作为【数据源更新】的请求参数file_paths添加到当前数据源内； 删除：将需要删除的数据源文件内容通过调用【数据源文件上传】的方式获得文件路径file_path，作为【数据源更新】的请求参数file_paths进行删除操作，删除掉当前数据源内这部分内容； 重置：将需要替换的新数据源内容通过调用【数据源文件上传】的方式获得文件路径file_path，作为【数据源更新】的请求参数file_paths进行重置操作，替换掉当前数据源内的内容；每一个数据源一天只能更新50次,建议合理使用更新次数，减少无效的更新！每次更新数据源后，都需要重新调用【发布人群包】接口发布人群包才能让对应的更新生效！否则人群包将使用更新前的数据源！在调用【发布人群包】接口发布人群包的过程中，建议不要更新数据源，这会导致人群包发布过程延后！ |
| `tools_estimate_audience_v2` | `/open_api/2/tools/estimate_audience/` | 用户可以查询计划的受众条件，预估其在今日头条、抖音短视频、火山小视频和西瓜视频中的覆盖用户量 |
