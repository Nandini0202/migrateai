import { useEffect, useState } from 'react';
import { getAIConfig, setAIConfig, getAIModels, testAIConnection } from '@/lib/api';

type Provider = 'ollama' | 'gemini' | 'openai' | 'claude';

interface AIConfig {
  provider: Provider;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  temperature?: number;
}

interface TestResult {
  status: 'ok' | 'error';
  message: string;
  models?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AISettingsModal({ open, onClose }: Props) {
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);

  // Load current config when modal opens
  useEffect(() => {
    if (open) {
      getAIConfig().then(setConfig).catch(() => setConfig(null));
    }
  }, [open]);

  // Load available models when provider changes
  useEffect(() => {
    if (config?.provider) {
      getAIModels(config.provider).then(setModels).catch(() => setModels([]));
    }
  }, [config?.provider]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setConfig((prev) =>
      prev ? { ...prev, [name]: name === 'temperature' ? Number(value) : value } : prev,
    );
  };

  const handleTest = async () => {
    if (!config) return;
    try {
      const res = await testAIConnection(config);
      setTestResult(res);
    } catch (err) {
      setTestResult({ status: 'error', message: 'Connection test failed', models: [] });
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await setAIConfig(config);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded bg-zinc-900 p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">AI Provider Settings</h2>
        <div className="space-y-4">
          <label className="block">
            Provider
            <select
              name="provider"
              value={config?.provider || ''}
              onChange={handleChange}
              className="mt-1 w-full rounded border bg-zinc-800 p-2"
            >
              <option value="ollama">Ollama</option>
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          {config?.provider !== 'ollama' && (
            <>
              <label className="block">
                Base URL
                <input
                  type="text"
                  name="baseUrl"
                  value={config?.baseUrl || ''}
                  onChange={handleChange}
                  className="mt-1 w-full rounded border bg-zinc-800 p-2"
                />
              </label>
              <label className="block">
                API Key
                <input
                  type="password"
                  name="apiKey"
                  value={config?.apiKey || ''}
                  onChange={handleChange}
                  className="mt-1 w-full rounded border bg-zinc-800 p-2"
                />
              </label>
            </>
          )}
          <label className="block">
            Model
            <select
              name="model"
              value={config?.model || ''}
              onChange={handleChange}
              className="mt-1 w-full rounded border bg-zinc-800 p-2"
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Temperature
            <input
              type="number"
              name="temperature"
              min="0"
              max="2"
              step="0.1"
              value={config?.temperature ?? 0.7}
              onChange={handleChange}
              className="mt-1 w-full rounded border bg-zinc-800 p-2"
            />
          </label>
        </div>
        {testResult && (
          <p
            className={`mt-2 ${testResult.status === 'ok' ? 'text-green-400' : 'text-red-400'}`}
          >
            {testResult.message}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded bg-zinc-600 px-3 py-1 hover:bg-zinc-500"
          >
            Cancel
          </button>
          <button
            onClick={handleTest}
            disabled={saving}
            className="rounded bg-amber-600 px-3 py-1 hover:bg-amber-500"
          >
            Test Connection
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !config}
            className="rounded bg-violet-600 px-3 py-1 hover:bg-violet-500"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
