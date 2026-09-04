import { Component, type ReactNode } from 'react';
import { Alert, Button } from 'antd';
import i18n from '../i18n/index.ts';

interface Props {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

interface State {
  readonly hasError: boolean;
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <Alert
          type="error"
          showIcon
          message={i18n.t('errors.boundaryTitle')}
          description={this.state.error?.message ?? i18n.t('errors.boundaryDescription')}
          action={
            <Button size="small" onClick={() => this.setState({ hasError: false, error: null })}>
              {i18n.t('common.retry')}
            </Button>
          }
        />
      );
    }

    return this.props.children;
  }
}
