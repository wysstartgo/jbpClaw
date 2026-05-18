import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { SchemaForm, type UiHint } from '../im/SchemaForm';

interface PluginConfigPageProps {
  pluginId: string;
  onBack: () => void;
}

interface ConfigSchemaData {
  configSchema: Record<string, unknown>;
  uiHints: Record<string, {
    label?: string;
    help?: string;
    sensitive?: boolean;
    advanced?: boolean;
    placeholder?: string;
    order?: number;
  }>;
}

function deepSet(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.');
  const result = { ...obj };
  let current: Record<string, unknown> = result;

  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const existing = current[key];
    current[key] = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  if (value === '' || value === undefined) {
    delete current[lastKey];
  } else {
    current[lastKey] = value;
  }

  return result;
}

export default function PluginConfigPage({ pluginId, onBack }: PluginConfigPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<ConfigSchemaData | null>(null);
  const [configValue, setConfigValue] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const loadSchema = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron?.plugins.getConfigSchema(pluginId);
      if (result?.success && result.schema) {
        setSchema(result.schema);
        setConfigValue(result.config ?? {});
      } else {
        setError(result?.error || i18nService.t('pluginsConfigLoadError'));
      }
    } catch {
      setError(i18nService.t('pluginsConfigLoadError'));
    }
    setLoading(false);
  }, [pluginId]);

  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  const handleChange = (path: string, value: unknown) => {
    setConfigValue(prev => deepSet(prev, path, value));
    setSaved(false);
  };

  const handleToggleSecret = (path: string) => {
    setShowSecrets(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await window.electron?.plugins.saveConfig(pluginId, configValue);
      if (result?.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError(result?.error || 'Save failed');
      }
    } catch {
      setError('Save failed');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6 px-1">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-raised transition-colors"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {i18nService.t('pluginsConfigTitle')}
          </h3>
          <p className="text-sm text-muted-foreground">{pluginId}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
      ) : error ? (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-4">
          {error}
        </div>
      ) : !schema ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          {i18nService.t('pluginsConfigNoSchema')}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border p-4">
            <SchemaForm
              schema={schema.configSchema}
              hints={schema.uiHints as Record<string, UiHint>}
              value={configValue}
              onChange={handleChange}
              showSecrets={showSecrets}
              onToggleSecret={handleToggleSecret}
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2 text-sm rounded-md border border-border text-foreground hover:bg-surface-raised transition-colors"
            >
              {i18nService.t('pluginsConfigBack')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving
                ? i18nService.t('pluginsConfigSaving')
                : saved
                  ? i18nService.t('pluginsConfigSaved')
                  : i18nService.t('pluginsConfigSave')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
