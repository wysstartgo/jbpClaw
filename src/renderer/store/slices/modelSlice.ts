import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { defaultConfig, getProviderDisplayName } from '../../config';
import { resolveOpenClawModelRef } from '../../utils/openclawModelRef';

export interface Model {
  id: string;
  name: string;
  provider?: string; // 模型所属的提供商
  providerKey?: string; // 模型所属的提供商 key（用于唯一标识）
  openClawProviderId?: string; // OpenClaw runtime provider id
  supportsImage?: boolean;
  isServerModel?: boolean; // 是否为服务端套餐模型
  serverApiFormat?: string; // 服务端模型的 API 格式 ("openai" | "anthropic")
  modelKind?: string; // 服务端模型类型，客户端模型选择器只展示 chat
}

export function getModelIdentityKey(model: Pick<Model, 'id' | 'providerKey'>): string {
  return `${model.providerKey ?? ''}::${model.id}`;
}

export function isSameModelIdentity(
  modelA: Pick<Model, 'id' | 'providerKey'>,
  modelB: Pick<Model, 'id' | 'providerKey'>
): boolean {
  if (modelA.id !== modelB.id) {
    return false;
  }
  if (modelA.providerKey && modelB.providerKey) {
    return modelA.providerKey === modelB.providerKey;
  }
  // 兼容旧配置：缺失 providerKey 时回退到 id 匹配
  return true;
}

// 从 providers 配置中构建初始可用模型列表
function buildInitialModels(): Model[] {
  const models: Model[] = [];
  if (defaultConfig.providers) {
    Object.entries(defaultConfig.providers).forEach(([providerName, config]) => {
      if (config.enabled && config.models) {
        config.models.forEach(model => {
          models.push({
            id: model.id,
            name: model.name,
            provider: getProviderDisplayName(providerName, config),
            providerKey: providerName,
            openClawProviderId: model.openClawProviderId,
            supportsImage: model.supportsImage ?? false,
          });
        });
      }
    });
  }
  return models.length > 0 ? models : defaultConfig.model.availableModels;
}

// 初始可用模型列表（会在运行时更新）
export let availableModels: Model[] = buildInitialModels();
const defaultModelProvider = defaultConfig.model.defaultModelProvider;

interface ModelState {
  selectedModel: Model;
  availableModels: Model[];
  selectedModelDirty: boolean;
  selectedModelByAgent: Record<string, Model>;
}

type SelectedModelPayload = Model | { agentId: string; model: Model };

function isAgentSelectedModelPayload(payload: SelectedModelPayload): payload is { agentId: string; model: Model } {
  return 'agentId' in payload && 'model' in payload;
}

export function selectAgentSelectedModel(
  modelState: Pick<ModelState, 'selectedModel' | 'availableModels' | 'selectedModelByAgent'>,
  agentId: string,
  agentModelRef: string,
): Model {
  const override = modelState.selectedModelByAgent[agentId];
  if (override) return override;

  const normalizedAgentModelRef = agentModelRef.trim();
  if (normalizedAgentModelRef) {
    const resolvedAgentModel = resolveOpenClawModelRef(normalizedAgentModelRef, modelState.availableModels);
    if (resolvedAgentModel) return resolvedAgentModel;
  }

  return modelState.selectedModel;
}

function syncSelectedModelByAgent(
  selectedModelByAgent: Record<string, Model>,
  allAvailableModels: Model[],
): void {
  for (const agentId of Object.keys(selectedModelByAgent)) {
    const agentModel = selectedModelByAgent[agentId];
    const matchedModel = allAvailableModels.find(m => isSameModelIdentity(m, agentModel));
    if (matchedModel) {
      selectedModelByAgent[agentId] = matchedModel;
    } else {
      delete selectedModelByAgent[agentId];
    }
  }
}

const initialState: ModelState = {
  // 使用 config 中的默认模型
  selectedModel: availableModels.find(
    model => model.id === defaultConfig.model.defaultModel
      && (!defaultModelProvider || model.providerKey === defaultModelProvider)
  ) || availableModels[0],
  availableModels: availableModels,
  selectedModelDirty: false,
  selectedModelByAgent: {},
};

const modelSlice = createSlice({
  name: 'model',
  initialState,
  reducers: {
    setSelectedModel: (state, action: PayloadAction<SelectedModelPayload>) => {
      if (isAgentSelectedModelPayload(action.payload)) {
        state.selectedModelByAgent[action.payload.agentId] = action.payload.model;
        return;
      }
      state.selectedModel = action.payload;
      state.selectedModelDirty = true;
    },
    setSelectedModelSilently: (state, action: PayloadAction<Model>) => {
      state.selectedModel = action.payload;
      state.selectedModelDirty = false;
    },
    markSelectedModelPersisted: (state) => {
      state.selectedModelDirty = false;
    },
    setAgentSelectedModel: (state, action: PayloadAction<{ agentId: string; model: Model }>) => {
      state.selectedModelByAgent[action.payload.agentId] = action.payload.model;
    },
    clearAgentSelectedModel: (state, action: PayloadAction<string>) => {
      delete state.selectedModelByAgent[action.payload];
    },
    setAvailableModels: (state, action: PayloadAction<Model[]>) => {
      // 保留已有的服务端模型，只更新用户自配模型（与 setServerModels 对称）
      const serverModels = state.availableModels.filter(m => m.isServerModel);
      state.availableModels = [...serverModels, ...action.payload];
      // 更新导出的 availableModels
      availableModels = state.availableModels;
      // 同步选中模型信息，确保名称与最新配置一致
      if (state.availableModels.length > 0) {
        const matchedModel = state.availableModels.find(m => isSameModelIdentity(m, state.selectedModel));
        if (matchedModel) {
          state.selectedModel = matchedModel;
        } else {
          // 如果当前选中的模型不在新的可用模型列表中，选择第一个可用模型
          state.selectedModel = state.availableModels[0];
          state.selectedModelDirty = false;
        }
      }
      syncSelectedModelByAgent(state.selectedModelByAgent, state.availableModels);
    },
    setServerModels: (state, action: PayloadAction<Model[]>) => {
      // 服务端模型放前面，自配模型保留在后面
      const userModels = state.availableModels.filter(m => !m.isServerModel);
      state.availableModels = [...action.payload, ...userModels];
      availableModels = state.availableModels;
      // 同步选中模型信息（如 supportsImage 等属性可能随服务端更新）
      if (state.availableModels.length > 0) {
        const matchedModel = state.availableModels.find(m => isSameModelIdentity(m, state.selectedModel));
        if (matchedModel) {
          state.selectedModel = matchedModel;
        } else {
          state.selectedModel = state.availableModels[0];
          state.selectedModelDirty = false;
        }
      }
      syncSelectedModelByAgent(state.selectedModelByAgent, state.availableModels);
    },
    clearServerModels: (state) => {
      state.availableModels = state.availableModels.filter(m => !m.isServerModel);
      availableModels = state.availableModels;
      // 如果当前选中的是服务端模型，切换到第一个可用模型
      if (state.selectedModel.isServerModel && state.availableModels.length > 0) {
        state.selectedModel = state.availableModels[0];
        state.selectedModelDirty = false;
      }
      syncSelectedModelByAgent(state.selectedModelByAgent, state.availableModels);
    },
  },
});

export const {
  setSelectedModel,
  setSelectedModelSilently,
  markSelectedModelPersisted,
  setAgentSelectedModel,
  clearAgentSelectedModel,
  setAvailableModels,
  setServerModels,
  clearServerModels,
} = modelSlice.actions;
export default modelSlice.reducer; 
