/**
 * 模型预设：让普通用户在「设置」里点一下就能完成模型配置。
 *
 * 豆包/Doubao 在火山方舟提供 OpenAI 兼容接口，
 *   baseUrl: https://ark.cn-beijing.volces.com/api/v3
 *   modelName: <Model ID>，例如 doubao-seed-2-0-mini-260215
 *
 * AGENTS.md 要求默认模型必须是视觉多模态模型，因此这里只挑选具备视觉能力的型号。
 */

export const MODEL_PRESETS = [
  {
    id: 'doubao-seed-2-0',
    label: '豆包 Doubao-Seed-2.0（推荐）',
    description:
      '视觉多模态 + 256k 上下文 + 结构化生成；旗舰版，复杂巡检/规则生成最稳。',
    profile: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      modelName: 'doubao-seed-2-0',
      modelFamily: 'doubao-seed',
    },
  },
  {
    id: 'doubao-seed-2-0-pro',
    label: '豆包 Doubao-Seed-2.0-pro（旗舰）',
    description: '复杂多步推理、视频/长图理解、多约束执行最强。',
    profile: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      modelName: 'doubao-seed-2-0-pro',
      modelFamily: 'doubao-seed',
    },
  },
  {
    id: 'doubao-seed-2-0-mini-260215',
    label: '豆包 Doubao-Seed-2.0-mini-260215（首推 · 低延迟）',
    description: '低时延 + 多模态 + 4 档思考；适合定时巡检的稳定批量任务。',
    profile: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      modelName: 'doubao-seed-2-0-mini-260215',
      modelFamily: 'doubao-seed',
    },
  },
  {
    id: 'doubao-seed-2-0-lite',
    label: '豆包 Doubao-Seed-2.0-lite（性价比）',
    description: '均衡型，结构化输出与多步指令稳，价格更低。',
    profile: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      modelName: 'doubao-seed-2-0-lite',
      modelFamily: 'doubao-seed',
    },
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI / 自定义（高级）',
    description: '适用于自建网关或其他 OpenAI 兼容服务。',
    profile: {
      baseUrl: 'https://api.openai.com/v1',
      modelName: 'gpt-4.1',
      modelFamily: 'gpt-4',
    },
  },
];
