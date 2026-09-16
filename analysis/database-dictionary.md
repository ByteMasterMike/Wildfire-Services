# 数据库字段、cause 与模型来源核对

核对日期：2026-09-13。EPSS 全量 API 取样时间：2026-09-13T16:45:17Z。

## 证据范围

- **字段清单：repo 的 `db/schema.sql` 定义了 12 张 wildfire 业务表、110 个字段。这里是代码定义，不是直接读取 RDS information_schema 的结果。**
- 远端可视化服务的 OpenAPI 当前只有 health、map-layer、time-series、utility-territory、event-detail；尝试 `/api/data-query/openapi.json` 返回 404。当前工作环境未发现数据库直连配置。
- 已实际读取六类 event-detail，非几何属性字段与下列六张表的声明一致：circuits、epss_outages、psps_events、cpuc_ignitions、calfire_incidents、us_ignitions。API 将 geom 单独返回为 geometry。API 投影一致仍不能证明远端没有额外隐藏字段或其他表。
- 要获得远端的最终完整目录，请在数据库端执行 [只读核对 SQL](database_inventory_readonly.sql)。它会先列出非系统关系，再导出 wildfire 的全部列及 cause 分布。尚未在远端执行这份 SQL。
- 2026-09-13 的这次数据库字段核对未修改网站、加载器或模型，也没有运行拟合；此处仅说明该核对工作的范围。

## 1. 全部业务表头

| 表 | 字段数 | 用途 |
|---|---:|---|
| `wildfire.circuits` | 5 | PG&E EPSS/GNA 线路子集；只有线路几何与变电站名称，没有风险分数或变电站点。 |
| `wildfire.epss_outages` | 17 | PG&E 停电事件；cause 是停电原因，outage_type 是另一列类型代码。 |
| `wildfire.psps_events` | 10 | PSPS 停电事件及影响区域；customers_deenergized 是事件级客户数。 |
| `wildfire.psps_event_circuits` | 3 | PSPS 事件与线路的关联表。 |
| `wildfire.cpuc_ignitions` | 7 | 主点火记录表，带 utility 属性；county 是加载时通过县界推断。 |
| `wildfire.cpuc_ignitions_with_time` | 6 | 另一份带时刻的点火记录；没有 utility、county、cause，不能与主表直接合并。 |
| `wildfire.calfire_incidents` | 22 | CAL FIRE 发布的事件记录；incident_type 是事件种类，不是起火原因。 |
| `wildfire.hftd_tiers` | 5 | HFTD Tier 2/3 区域。shape_area 的源单位不能直接当作 km²。 |
| `wildfire.iou_territories` | 3 | 三家 IOU 的服务区边界。 |
| `wildfire.counties` | 4 | California 县界；面积归一化查询尚未接通。 |
| `wildfire.grid_cells` | 7 | 824 个 0.24° 网格；lat/lon 为西南角，centroid 为中心点；经纬度网格并非等面积。 |
| `wildfire.us_ignitions` | 21 | FireCastRL/IRWIN 全原因点火样本及气象变量；不是全国事件普查，也不是完整 cell-day 气象库。 |

### wildfire.circuits

PG&E EPSS/GNA 线路子集；只有线路几何与变电站名称，没有风险分数或变电站点。

核对级别：DDL 全字段；远端 event-detail 非几何属性投影已核对。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `circuit_id` | `TEXT` | 否 |
| `circuit_name` | `TEXT` | 否 |
| `division` | `TEXT` | 否 |
| `substation` | `TEXT` | 否 |
| `geom` | `geometry(MultiLineString, 4326)` | 否 |

### wildfire.epss_outages

PG&E 停电事件；cause 是停电原因，outage_type 是另一列类型代码。

核对级别：DDL 全字段；远端 event-detail 非几何属性投影已核对。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `id` | `BIGSERIAL` | 否 |
| `circuit_id` | `TEXT` | 否 |
| `circuit` | `TEXT` | 否 |
| `year` | `SMALLINT` | 否 |
| `start_date` | `DATE` | 否 |
| `end_date` | `DATE` | 否 |
| `county` | `TEXT` | 是 |
| `cause` | `TEXT` | 是 |
| `outage_type` | `TEXT` | 是 |
| `division` | `TEXT` | 是 |
| `customer_minutes` | `BIGINT` | 是 |
| `restoration_min` | `INTEGER` | 是 |
| `medical_baseline` | `INTEGER` | 是 |
| `life_support` | `INTEGER` | 是 |
| `schools` | `INTEGER` | 是 |
| `hospitals` | `INTEGER` | 是 |
| `geom` | `geometry(Point, 4326)` | 否 |

### wildfire.psps_events

PSPS 停电事件及影响区域；customers_deenergized 是事件级客户数。

核对级别：DDL 全字段；远端 event-detail 非几何属性投影已核对。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `event_name` | `TEXT` | 否 |
| `utility` | `TEXT` | 否 |
| `iou_raw` | `TEXT` | 否 |
| `first_date_of_poc` | `DATE` | 是 |
| `deenergization_start_date` | `DATE` | 是 |
| `full_restoration_date` | `DATE` | 是 |
| `de_energization` | `BOOLEAN` | 是 |
| `customers_deenergized` | `INTEGER` | 是 |
| `year` | `SMALLINT` | 是 |
| `geom` | `geometry(MultiPolygon, 4326)` | 否 |

### wildfire.psps_event_circuits

PSPS 事件与线路的关联表。

核对级别：repo DDL；未直接核对远端完整列目录。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `event_name` | `TEXT` | 否 |
| `circuit_id` | `TEXT` | 否 |
| `circuit_name` | `TEXT` | 是 |

### wildfire.cpuc_ignitions

主点火记录表，带 utility 属性；county 是加载时通过县界推断。

核对级别：DDL 全字段；远端 event-detail 非几何属性投影已核对。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `id` | `BIGSERIAL` | 否 |
| `utility` | `TEXT` | 否 |
| `event_date` | `DATE` | 否 |
| `year` | `SMALLINT` | 否 |
| `source_file` | `TEXT` | 是 |
| `county` | `TEXT` | 是 |
| `geom` | `geometry(Point, 4326)` | 否 |

### wildfire.cpuc_ignitions_with_time

另一份带时刻的点火记录；没有 utility、county、cause，不能与主表直接合并。

核对级别：repo DDL；未直接核对远端完整列目录。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `id` | `BIGSERIAL` | 否 |
| `event_date` | `DATE` | 否 |
| `event_time` | `TIME` | 是 |
| `year` | `SMALLINT` | 否 |
| `label` | `TEXT` | 是 |
| `geom` | `geometry(Point, 4326)` | 否 |

### wildfire.calfire_incidents

CAL FIRE 发布的事件记录；incident_type 是事件种类，不是起火原因。

核对级别：DDL 全字段；远端 event-detail 非几何属性投影已核对。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `incident_id` | `TEXT` | 否 |
| `incident_name` | `TEXT` | 是 |
| `incident_type` | `TEXT` | 是 |
| `acres_burned` | `DOUBLE PRECISION` | 是 |
| `containment` | `DOUBLE PRECISION` | 是 |
| `control` | `TEXT` | 是 |
| `county` | `TEXT` | 是 |
| `location` | `TEXT` | 是 |
| `administrative_unit` | `TEXT` | 是 |
| `cooperating_agencies` | `TEXT` | 是 |
| `utility` | `TEXT` | 是 |
| `date_created` | `TIMESTAMPTZ` | 是 |
| `date_only_created` | `DATE` | 是 |
| `date_last_update` | `TIMESTAMPTZ` | 是 |
| `date_extinguished` | `TIMESTAMPTZ` | 是 |
| `date_only_extinguished` | `DATE` | 是 |
| `is_final` | `BOOLEAN` | 是 |
| `is_active` | `BOOLEAN` | 是 |
| `is_calfire_incident` | `BOOLEAN` | 是 |
| `notification_desired` | `BOOLEAN` | 是 |
| `incident_url` | `TEXT` | 是 |
| `geom` | `geometry(Point, 4326)` | 否 |

### wildfire.hftd_tiers

HFTD Tier 2/3 区域。shape_area 的源单位不能直接当作 km²。

核对级别：repo DDL；未直接核对远端完整列目录。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `tier` | `TEXT` | 否 |
| `objectid` | `INTEGER` | 是 |
| `shape_length` | `DOUBLE PRECISION` | 是 |
| `shape_area` | `DOUBLE PRECISION` | 是 |
| `geom` | `geometry(MultiPolygon, 4326)` | 否 |

### wildfire.iou_territories

三家 IOU 的服务区边界。

核对级别：repo DDL；未直接核对远端完整列目录。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `utility` | `TEXT` | 否 |
| `utility_name` | `TEXT` | 否 |
| `geom` | `geometry(MultiPolygon, 4326)` | 否 |

### wildfire.counties

California 县界；面积归一化查询尚未接通。

核对级别：repo DDL；未直接核对远端完整列目录。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `geoid` | `TEXT` | 否 |
| `name` | `TEXT` | 否 |
| `statefp` | `TEXT` | 否 |
| `geom` | `geometry(MultiPolygon, 4326)` | 否 |

### wildfire.grid_cells

824 个 0.24° 网格；lat/lon 为西南角，centroid 为中心点；经纬度网格并非等面积。

核对级别：repo DDL；未直接核对远端完整列目录。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `cell_id` | `INTEGER` | 否 |
| `row` | `INTEGER` | 是 |
| `col` | `INTEGER` | 是 |
| `lat` | `DOUBLE PRECISION` | 否 |
| `lon` | `DOUBLE PRECISION` | 否 |
| `geom` | `geometry(Polygon, 4326)` | 否 |
| `centroid` | `geometry(Point, 4326)` | 否 |

### wildfire.us_ignitions

FireCastRL/IRWIN 全原因点火样本及气象变量；不是全国事件普查，也不是完整 cell-day 气象库。

核对级别：DDL 全字段；远端 event-detail 非几何属性投影已核对。

| 字段 | SQL 声明类型 | 允许 NULL |
|---|---|---|
| `id` | `BIGSERIAL` | 否 |
| `event_date` | `DATE` | 否 |
| `year` | `SMALLINT` | 否 |
| `latitude` | `DOUBLE PRECISION` | 否 |
| `longitude` | `DOUBLE PRECISION` | 否 |
| `pr` | `DOUBLE PRECISION` | 是 |
| `rmax` | `DOUBLE PRECISION` | 是 |
| `rmin` | `DOUBLE PRECISION` | 是 |
| `sph` | `DOUBLE PRECISION` | 是 |
| `srad` | `DOUBLE PRECISION` | 是 |
| `tmmn` | `DOUBLE PRECISION` | 是 |
| `tmmx` | `DOUBLE PRECISION` | 是 |
| `vs` | `DOUBLE PRECISION` | 是 |
| `bi` | `DOUBLE PRECISION` | 是 |
| `fm100` | `DOUBLE PRECISION` | 是 |
| `fm1000` | `DOUBLE PRECISION` | 是 |
| `erc` | `DOUBLE PRECISION` | 是 |
| `etr` | `DOUBLE PRECISION` | 是 |
| `pet` | `DOUBLE PRECISION` | 是 |
| `vpd` | `DOUBLE PRECISION` | 是 |
| `geom` | `geometry(Point, 4326)` | 否 |

类型来自 DDL；例如 BIGSERIAL 是建表声明，实际数据库列类型和序列默认值需要用核对 SQL 确认。

## 2. cause 的含义与实际取值

当前 DDL 中只有 `epss_outages` 存在 `cause` 列。它描述停电原因，不表示这次停电发生了火灾。CPUC 两张点火表、CAL FIRE、PSPS 和 US ignitions 当前都没有 cause 列。CPUC 原始报告是否另含原因字段，需要回到原始报告核对；不能由当前入库字段反推原报告没有。

以下中文为标签释义，**不是已确认的完整官方操作定义**。repo 没有提供逐类代码手册，也没有记录原因编码版本。PG&E/CPUC 发布材料中确实使用这些长标签，但尚不足以确认缩写及跨年分类的一一对应。

通过无日期/地域筛选的 `/map-layer?dataset=epss&include_outages=true&limit=1000` 取得 822 个线路特征内嵌的 9,651 条唯一停电记录，并与无筛选 time-series 的事件总量对齐。下面是该接口覆盖数据的全量统计：

| 原始 cause 值 | 条数 | 占比 | 中文释义／注意事项 |
|---|---:|---:|---|
| `Unknown` | 3,724 | 38.59% | 未识别的停电原因；这是明确的分类标签，不是缺失值。 |
| `Animal` | 1,347 | 13.96% | 动物相关。 |
| `Company Initiated` | 1,046 | 10.84% | 公司操作相关／由公司操作引发；不能直接等同于 PSPS 或所有计划停电。 |
| `Vegetation` | 1,042 | 10.80% | 植被相关。 |
| `Equipment Failure/Involved` | 986 | 10.22% | 设备故障／设备涉及；标签本身没有给出更细的根因边界。 |
| `3rd Party` | 914 | 9.47% | 第三方相关。 |
| `Environmental/External` | 293 | 3.04% | 环境／外部因素；不宜未经字典确认就改名为 Weather。 |
| `Equipment` | 290 | 3.00% | 设备相关；本次只见于 2022 年，未与后续设备分类合并。 |
| `UNK` | 6 | 0.06% | 2021 年缩写；可能对应 Unknown，缺正式代码映射，暂保留原样。 |
| `3RD` | 1 | 0.01% | 2021 年缩写；可能对应第三方，暂保留原样。 |
| `EF` | 1 | 0.01% | 2021 年缩写；正式释义与映射待确认。 |
| `VEG` | 1 | 0.01% | 2021 年缩写；可能对应植被，暂保留原样。 |

- 本次返回的 cause 空值为 **0**。网页的 `Not recorded` 是缺失值显示标签，不是此次数据库返回的一个原因类别。
- `Unknown`：全量 3,724 / 9,651 = **38.59%**；2024 年 1,057 / 2,787 = **37.93%**。原需求中的 41% 不能作为固定比例。
- 2021 年仅 9 条记录，全部使用缩写；不能把这一年当作与后续年度同覆盖率的完整样本。
- `Equipment` 的 290 条在 2022 年，后续年度使用 `Equipment Failure/Involved`。这可能是编码变化，不能直接当作某种原因消失或增长。

### repo 当前清洗规则

来源：[load_epss.py](../db/loaders/load_epss.py)、[util.py](../db/loaders/util.py)。

1. NULL 或纯空白变为 NULL。
2. 对比时忽略大小写与首尾空白，`unknown` / `unknown cause` 统一为 `Unknown`。
3. 其他值原样保留；没有将 UNK、3RD、EF、VEG 或 Equipment 做映射。对其他非空标签也没有统一去除首尾空白。
4. 只删除整行完全重复的记录，不因原因相同而去重。

`outage_type` 是另一列，本次实际值为：FTS 9,507；HLT 110；C/OUT 18；T-EPSS 16。repo 没有给出这些代码的完整定义；不能仅依据列名把全部 9,651 条自动解释成同一种自动跳闸事件。

### 公开材料佐证及边界

- [CPUC Resolution SPD-9](https://docs.cpuc.ca.gov/PublishedDocs/Published/G000/M498/K617/498617932.pdf) 的 Figure 4.6.6-3 使用 3rd Party、Animal、Company Initiated、Environmental/External、Equipment Failure/Involved、Unknown Cause、Vegetation 等分类。
- [PG&E 2023 Annual Electric Reliability Report](https://www.pge.com/assets/pge/docs/about/pge-systems/CPUC-2023-Annual-Electric-Reliability-Report.pdf) 有 company-initiated planned work 引发 EPSS outage 的实例；这能说明标签属于停电分类，不能当作所有同标签记录的完整定义。
- 本次检索取得相关索引摘录，全文在线打开因文件过大失败；未宣称已完整审阅这两份报告或找到官方代码手册。

## 3. repo 中的模型信息（仅核对，不属于此次开发范围）

| 内容 | 位置／核对结果 |
|---|---|
| 模型实现 | [models.py](../services/risk_forecasting/models.py)：HPP、NHPP、cNHPP；cNHPP 带空间邻接和时间记忆项。 |
| 当前建模单位 | 824 个 0.24° California 网格；事件矩阵是网格 × 日。 |
| 拟合与参数 | [fit_model.py](../services/risk_forecasting/fit_model.py) 与 `artifacts/cnhpp_params.npz`。 |
| 参数文件实际元数据 | train_years = 2020–2023；val_year = 2024；xi = **0.2**；converged = true。由已提交 npz 的内容读取。 |
| 推理 | [predictor.py](../services/risk_forecasting/predictor.py)：predict_grid 返回指定日的 824 格 λ；单日需要前面的协变量窗口。 |
| 协变量 | TMP、SPFH、wind_speed、NDVI、fm100，另加截距。SPFH 是比湿，不是相对湿度。 |
| HTTP 输出 | `/predict`：risk、expected_count、intensity / mean_intensity、local_percentile、statewide_percentile 等。 |
| 预测范围 | README 描述的是历史日期评分；没有未来天气接入或实时预测流程。当前远端模型服务与输入库存未在本次执行验证。 |
| 当前本地文件 | 网格、线路中点、拟合参数存在；天气 CSV、植被 NetCDF、年度模型事件 CSV 和 grid_W.pkl 不在当前数据目录。 |
| 评估材料 | outputs/ 下有 metrics_table、monthly_performance、model_comparison 和 covariate_audit；compare_models.py 有按年留出的比较及 bootstrap。 |

2024 在当前拟合脚本中用于选择 xi，不能把同一流程的 2024 成绩直接称为完全独立测试。model_comparison.csv 使用另一套按年留出流程，各折 xi 不同；不能把它的某一行直接当作当前 xi=0.2 参数文件的性能。README 记录 cNHPP 相对 NHPP 的小幅差异置信区间覆盖 0。

## 4. 历史点火密度与模型预测的区别

- **原需求 #12 的历史记录密度**：所选期间、所选数据集的县域点火记录数 ÷ 县面积(km²) × 100。需要事件、县界及约定的面积口径，不需要模型拟合。它是“所选期间每 100 km² 的记录数”，并不自动等于每年的发生率。
- **模型强度**：当前模型的 λ 是网格日事件计数的期望／率，代码没有自动把它归一为每 100 km² 的预测密度。`risk = 1 - exp(-λ)` 是至少一次事件的概率；聚合地区使用 `1 - exp(-sum(λ_i))`。这些量不能直接混用名称或单位。
- 如果 #12 真正想展示的是模型预测密度，应改写需求并请模型负责人明确输出、空间聚合和单位；可以与 #8 风险面一起处理。
- 当前仓库代码已有 county 几何，但 comparison 对 county 的 per_km2 仍返回不可用。可以由数据查询层补面积统计，但真实面积不能用经纬度平方度代替。

## 5. 线路风险排名的来源

目前没有已接入的年度线路风险分数表或字段。原需求 #23 是设计目标，不能据此当作数据库现成指标。

1. 当前可实现的线路排名来自 [queries.py::_rank_epss_sql](../services/data_query/queries.py)：按 circuit_id 分组，对 epss_outages 做 COUNT(*)。它是历史停电次数排名，**不是模型风险排名**。
2. repo 的 [analysis.py::plot_spatial_risk](../services/risk_forecasting/analysis.py) 有旧线路绘图逻辑：`exp(log_lambda).mean(axis=1)`，按研究期间平均估计强度给 GNA 线路着色。它需要线路模型数组和原始 shapefile，是早期线路方案的线索，不是当前 824 格模型已发布的年度线路评分。
3. 当前生产预测按网格计算；线路年度风险应由模型负责人提供可追溯结果，或明确网格到线路的映射、年度汇总口径、模型版本及覆盖范围。不能把停电次数换一个标题当作预测风险。

若第一版只用现有数据，可将这项明确命名为“年度停电次数最多的线路”；保留“年度线路风险排名”则需要模型侧输出协议。
