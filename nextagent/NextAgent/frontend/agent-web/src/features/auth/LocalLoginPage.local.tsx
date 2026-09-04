import { useState } from 'react';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { apiClient, isApiError } from '../../services/apiClient.ts';

export function LocalLoginPage({ onAuthenticated }: { readonly onAuthenticated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(values: { credential?: string }) {
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/api/v1/auth/local/login', { credential: values.credential ?? '' });
      onAuthenticated();
    } catch (loginError) {
      setError(isApiError(loginError) ? loginError.error : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <section style={{ width: 'min(360px, 100%)' }}>
        <Typography.Title level={2}>NextAgent</Typography.Title>
        <Form layout="vertical" onFinish={submit}>
          <Form.Item name="credential" label="Credential" rules={[{ required: true }]}>
            <Input.Password autoFocus autoComplete="current-password" />
          </Form.Item>
          {error ? <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} /> : null}
          <Button type="primary" htmlType="submit" loading={submitting} block>
            Sign in
          </Button>
        </Form>
      </section>
    </main>
  );
}
