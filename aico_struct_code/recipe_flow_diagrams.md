# Recipe 工作流 Mermaid 流程图

> 注意：本文件比较的是 `930LUI/old_tool` 与 `930LUI/new_tool` 下的历史草稿，不代表 `aicoservice@27.68.169` 运行包中的 Recipe。完整包内当前版本实际为 31 个节点、7 个并行检索调用、4 类 Executor 动作、最多 4 轮工具循环；请以 [`aicoservice_import/pod-recipe-invocation.md`](./aicoservice_import/pod-recipe-invocation.md) 和包内 [`WATT_PLEX.yaml`](./aicoservice@27.68.169/agents/aico-agent-m/zh_CN/recipes/WATT_PLEX.yaml) 为准。

## 1. old_tool/old_recipe.yaml（WATT_Old_Tool_Test_v1）

```mermaid
flowchart TD
    %% ── 定义节点样式 ──
    classDef start fill:#4CAF50,color:#fff,stroke:#388E3C,stroke-width:2px
    classDef python fill:#E3F2FD,stroke:#1565C0,stroke-width:1px
    classDef restful fill:#FFF3E0,stroke:#E65100,stroke-width:1px
    classDef gateway fill:#F3E5F5,stroke:#7B1FA2,stroke-width:1px
    classDef display fill:#E8F5E9,stroke:#2E7D32,stroke-width:1px
    classDef endNode fill:#D32F2F,color:#fff,stroke:#B71C1C,stroke-width:2px

    start_node["start_node<br/>用户入口"]:::start --> preprocess

    subgraph Preprocess ["预处理"]
        preprocess["preprocess<br/>清洗历史对话"]:::python
    end

    preprocess --> parallel_search

    parallel_search["parallel_search<br/>inclusive-gateway<br/>并行7路搜索"]:::gateway

    subgraph Search_KPI ["KPI检索"]
        build_search_kpi_body["build_search_kpi_body<br/>构建搜索请求<br/>type=kpi"]:::python --> search_kpi["search_kpi<br/>REST: search_feature<br/>filter: type=kpi"]:::restful
    end

    subgraph Search_KPI_CN ["KPI中文检索"]
        build_search_kpi_cn_body["build_search_kpi_cn_body<br/>构建搜索请求<br/>提取中文, type=kpi"]:::python --> search_kpi_cn["search_kpi_cn<br/>REST: search_feature<br/>filter: type=kpi"]:::restful
    end

    subgraph Search_Filter ["Filter检索"]
        build_search_filter_body["build_search_filter_body<br/>构建搜索请求<br/>type=filter"]:::python --> search_filter["search_filter<br/>REST: search_feature<br/>filter: type=filter"]:::restful
    end

    subgraph Search_Configure ["Configure检索"]
        build_search_configure_body["build_search_configure_body<br/>构建搜索请求<br/>type=configure"]:::python --> search_configure["search_configure<br/>REST: search_feature<br/>filter: type=configure"]:::restful
    end

    subgraph Search_Cell ["Cell检索"]
        build_search_cell_body["build_search_cell_body<br/>构建搜索请求<br/>type=cell"]:::python --> search_cell["search_cell<br/>REST: search_object<br/>filter: type=cell"]:::restful
    end

    subgraph Search_Enodeb ["Enodeb检索"]
        build_search_enodeb_body["build_search_enodeb_body<br/>构建搜索请求<br/>type=enodeb"]:::python --> search_enodeb["search_enodeb<br/>REST: search_object<br/>filter: type=enodeb"]:::restful
    end

    subgraph Search_RRU ["RRU检索"]
        build_search_rru_body["build_search_rru_body<br/>构建搜索请求<br/>type=rru"]:::python --> search_rru["search_rru<br/>REST: search_object<br/>filter: type=rru"]:::restful
    end

    subgraph Search_Site ["Site检索"]
        build_search_site_body["build_search_site_body<br/>构建搜索请求<br/>type=site"]:::python --> search_site["search_site<br/>REST: search_object<br/>filter: type=site"]:::restful
    end

    parallel_search --> build_search_kpi_body & build_search_kpi_cn_body & build_search_filter_body & build_search_configure_body & build_search_cell_body & build_search_enodeb_body & build_search_rru_body & build_search_site_body

    search_kpi --> parallel_search_join
    search_kpi_cn --> parallel_search_join
    search_filter --> parallel_search_join
    search_configure --> parallel_search_join
    search_cell --> parallel_search_join
    search_enodeb --> parallel_search_join
    search_rru --> parallel_search_join
    search_site --> parallel_search_join

    parallel_search_join["parallel_search_join<br/>inclusive-gateway<br/>等待所有检索完成"]:::gateway --> postprocess

    postprocess["postprocess<br/>解析检索结果<br/>精确匹配+结构化输出"]:::python --> build_classify_messages

    subgraph Negotiation ["协商规划"]
        build_classify_messages["build_classify_messages<br/>构建LLM协商prompt<br/>3维: feature+object+time"]:::python --> call_classify_llm["call_classify_llm<br/>REST: LLM调用<br/>deepseek-v3"]:::restful
        call_classify_llm --> parse_nego_planner["parse_nego_planner<br/>解析LLM结果<br/>判断 intent_complete/need_nego"]:::python
    end

    parse_nego_planner -->|need_nego| display_nego["display_nego<br/>展示协商追问"]:::display
    display_nego --> end_node

    parse_nego_planner -->|intent_complete| init_tool_history["init_tool_history<br/>初始化loop_count=0<br/>tool_history=[]"]:::python

    init_tool_history --> build_exec_messages

    subgraph Executor_Loop ["Executor循环"]
        build_exec_messages["build_exec_messages<br/>构建executor prompt<br/>+ OpenAI tool schemas<br/>6工具"]:::python --> call_exec_llm["call_exec_llm<br/>REST: LLM调用<br/>deepseek-v3"]:::restful
        call_exec_llm --> parse_exec_response["parse_exec_response<br/>解析LLM响应<br/>提取tool_call或direct_answer"]:::python
        parse_exec_response -->|无工具调用| display_exec_direct_answer["display_exec_direct_answer<br/>展示直接回答"]:::display
        display_exec_direct_answer --> display_final_result["display_final_result"]:::display --> end_node

        parse_exec_response -->|有工具调用| route_tool["route_tool<br/>exclusive-gateway<br/>按tool_name路由"]:::gateway

        route_tool -->|region_creation| call_param["call_param<br/>REST: 工参筛选API"]:::restful
        route_tool -->|compute_cell_kpi| call_kpi["call_kpi<br/>REST: KPI汇聚API"]:::restful
        route_tool -->|bts_energy_analyze| call_energy["call_energy<br/>REST: 能耗分析API"]:::restful
        route_tool -->|configuration_query| call_config["call_config<br/>REST: 配置查询API"]:::restful
        route_tool -->|draw_graphs| call_draw["call_draw<br/>REST: 绘图API"]:::restful
        route_tool -->|calculate_gain| call_gain["call_gain<br/>REST: 增益计算API"]:::restful

        call_param & call_kpi & call_energy & call_config & call_draw & call_gain --> tool_join["tool_join<br/>exclusive-gateway"]:::gateway
        tool_join --> update_tool_history["update_tool_history<br/>追加tool_call+result<br/>loop_count+=1"]:::python
        update_tool_history -->|loop<10| build_exec_messages
        update_tool_history -->|loop>=10| display_max_loop_warning["display_max_loop_warning<br/>达到最大步数限制"]:::display
        display_max_loop_warning --> display_final_result
    end

    end_node["end_node<br/>结束"]:::endNode
```

---

## 2. new_tool/new_tool/WATT_PLEX.yaml（WATT_PLEX）

```mermaid
flowchart TD
    %% ── 定义节点样式 ──
    classDef start fill:#4CAF50,color:#fff,stroke:#388E3C,stroke-width:2px
    classDef python fill:#E3F2FD,stroke:#1565C0,stroke-width:1px
    classDef restful fill:#FFF3E0,stroke:#E65100,stroke-width:1px
    classDef gateway fill:#F3E5F5,stroke:#7B1FA2,stroke-width:1px
    classDef display fill:#E8F5E9,stroke:#2E7D32,stroke-width:1px
    classDef endNode fill:#D32F2F,color:#fff,stroke:#B71C1C,stroke-width:2px
    classDef parallel fill:#FFF8E1,stroke:#F9A825,stroke-width:2px,stroke-dasharray: 5 5

    start_node["start_node<br/>用户入口"]:::start --> preprocess

    subgraph Preprocess ["预处理"]
        preprocess["preprocess<br/>清洗历史对话"]:::python
    end

    preprocess --> parallel_search

    parallel_search["parallel_search<br/>parallel-gateway<br/>join_timeout=120s<br/>join_node指定"]:::parallel

    subgraph S_PM ["PM检索"]
        build_search_feature_body["build_search_feature_body<br/>dim_feature, dimension=PM"]:::python --> search_feature["search_feature<br/>REST: search_dim_feature<br/>filter: PM"]:::restful
    end

    subgraph S_EP ["EP检索"]
        build_search_ep_body["build_search_ep_body<br/>dim_feature, dimension=EP"]:::python --> search_ep["search_ep<br/>REST: search_dim_feature<br/>filter: EP"]:::restful
    end

    subgraph S_ALARM ["ALARM检索"]
        build_search_alarm_body["build_search_alarm_body<br/>dim_feature, dimension=ALARM"]:::python --> search_alarm["search_alarm<br/>REST: search_dim_feature<br/>filter: ALARM"]:::restful
    end

    subgraph S_CELL ["CELL检索"]
        build_search_cell_body["build_search_cell_body<br/>dim_cell, dimension=CELL"]:::python --> search_cell["search_cell<br/>REST: search_dim_cell<br/>filter: CELL"]:::restful
    end

    subgraph S_SITE ["SITE检索"]
        build_search_site_body["build_search_site_body<br/>dim_cell, dimension=SITE"]:::python --> search_site["search_site<br/>REST: search_dim_cell<br/>filter: SITE"]:::restful
    end

    subgraph S_REGION ["REGION检索"]
        build_search_region_body["build_search_region_body<br/>dim_region, dimension=REGION"]:::python --> search_region["search_region<br/>REST: search_dim_region<br/>filter: REGION"]:::restful
    end

    subgraph S_GRID ["GRID检索"]
        build_search_grid_body["build_search_grid_body<br/>dim_region, dimension=GRID"]:::python --> search_grid["search_grid<br/>REST: search_dim_region<br/>filter: GRID"]:::restful
    end

    subgraph S_POI ["POI检索"]
        build_search_poi_body["build_search_poi_body<br/>dim_region, dimension=POI"]:::python --> search_poi["search_poi<br/>REST: search_dim_region<br/>filter: POI"]:::restful
    end

    parallel_search --> build_search_feature_body & build_search_ep_body & build_search_alarm_body & build_search_cell_body & build_search_site_body & build_search_region_body & build_search_grid_body & build_search_poi_body

    search_feature & search_ep & search_alarm & search_cell & search_site & search_region & search_grid & search_poi --> parallel_search_join

    parallel_search_join["parallel_search_join<br/>display-content<br/>等待8路检索完成"]:::display --> postprocess

    postprocess["postprocess<br/>解析检索结果<br/>精确匹配+结构化输出"]:::python --> build_classify_messages

    subgraph Negotiation ["协商规划（2维度）"]
        build_classify_messages["build_classify_messages<br/>构建LLM协商prompt<br/>2维: feature+object<br/>无time协商"]:::python --> call_classify_llm["call_classify_llm<br/>REST: LLM调用<br/>deepseek-v3<br/>api_yaml_path指定"]:::restful
        call_classify_llm --> parse_nego_planner["parse_nego_planner<br/>解析LLM结果<br/>feature+object判断"]:::python
    end

    parse_nego_planner -->|need_nego| display_nego["display_nego<br/>展示协商追问<br/>output_parser: HTML"]:::display
    display_nego --> end_node

    parse_nego_planner -->|intent_complete| init_tool_history["init_tool_history<br/>初始化loop_count=0<br/>tool_history=[]"]:::python

    init_tool_history --> build_exec_messages

    subgraph Executor_Loop ["Executor循环"]
        build_exec_messages["build_exec_messages<br/>构建executor prompt<br/>+ OpenAI tool schemas<br/>5工具"]:::python --> call_exec_llm["call_exec_llm<br/>REST: LLM调用<br/>deepseek-v3<br/>api_yaml_path指定"]:::restful
        call_exec_llm --> parse_exec_response["parse_exec_response<br/>解析LLM响应<br/>提取tool_call或direct_answer"]:::python
        parse_exec_response -->|无工具调用| display_exec_direct_answer["display_exec_direct_answer<br/>output_parser: HTML"]:::display
        display_exec_direct_answer --> display_final_result["display_final_result<br/>output_parser: HTML"]:::display --> end_node

        parse_exec_response -->|有工具调用| route_tool["route_tool<br/>display-content<br/>按tool_name路由"]:::display

        route_tool -->|query_pm| call_pm["call_pm<br/>REST: unified-data-service<br/>queryPerformanceData"]:::restful
        route_tool -->|query_param| call_param["call_param<br/>REST: unified-data-service<br/>queryEngineerParam"]:::restful
        route_tool -->|query_alarm| call_alarm["call_alarm<br/>REST: services-alarm<br/>queryAlarms"]:::restful
        route_tool -->|calculate_gain| call_gain["call_gain<br/>python内联计算<br/>支持value/path模式"]:::python
        route_tool -->|smartcanvas| call_canvas["call_canvas<br/>REST: smartcanvas<br/>sseGenerateUI"]:::restful

        call_pm & call_param & call_alarm & call_gain & call_canvas --> update_tool_history["update_tool_history<br/>追加tool_call+result<br/>loop_count+=1"]:::python
        update_tool_history -->|loop<10| build_exec_messages
        update_tool_history -->|loop>=10| display_max_loop_warning["display_max_loop_warning<br/>达到最大步数限制"]:::display
        display_max_loop_warning --> display_final_result
    end

    end_node["end_node<br/>结束"]:::endNode
```

## 主要差异对比

| 特性 | old_tool | new_tool |
|------|----------|----------|
| **并行网关** | `inclusive-gateway`（无超时） | `parallel-gateway`（有 join_timeout + join_node） |
| **搜索路数** | 8 路（含 kpi_cn） | 8 路（PM/EP/ALARM/CELL/SITE/REGION/GRID/POI） |
| **协商维度** | 3 维（feature + object + time） | 2 维（feature + object，无 time） |
| **Executor 工具数** | 6 工具 | 5 工具 |
| **工具架构** | 旧老 API（独立 yaml） | 统一数据服务 unified-data-service |
| **新增功能** | — | 告警查询、区域/网格/POI 搜索、smartcanvas 画图 |
| **去除功能** | — | 配置查询、BTS 能耗分析、独立绘图 |
| **路由节点** | `exclusive-gateway` | `display-content` |
| **api_yaml_path** | 无 | 每个 REST 调用显式指定 |
| **output_parser** | 仅部分节点 | display 节点更多使用 HTML output_parser |
