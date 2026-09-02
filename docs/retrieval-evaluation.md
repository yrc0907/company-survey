# RAG Golden Set 评测

## 目的

`lib/services/retrieval-evaluation-service.ts` 提供不依赖外部模型的确定性评测器。它接收一次检索运行的候选 Chunk、引用、拒答状态、耗时和成本，输出 Recall@K、MRR、引用覆盖率、拒答准确率、平均延迟、成本和按类别明细。

评测夹具只用于回归，不写入 PostgreSQL 的公开项目，也不作为企业事实。八类案例覆盖：精确命中、中文政策、语义、多语言、关系约束、冲突值、过期过滤和无证据拒答。

## 运行

```powershell
pnpm exec tsx lib/services/retrieval-evaluation.contract.ts
```

当前固定夹具应得到 8 个案例、Recall@5=1、MRR=1、引用覆盖率=1、拒答准确率=1、无失败项。契约还故意回放一个召回缺失、引用缺失和拒答错误的案例，确保失败原因可区分。

## 生产接入边界

生产评测任务应从脱敏、获授权的标注集读取结果，并保存运行版本、模型/向量版本、过滤范围和时间戳；不能把用户私有文件或密钥写进 Golden Set。当前模块证明指标计算和回归协议可重放，不代表真实模型准确率或业务 ROI 已测量。Reranker 429/5xx 降级、pgvector 向量重建和跨租户标注集仍需单独接入。
