import {
  createDefaultProductOptions,
  runProductCompositionAsync,
  runProductCompositionSync,
  type CreateNextAgentAppOptions,
  type NextAgentApp,
} from './create-app.js';
import { createLocalConfiguredAuthChannelContribution } from './local-configured-auth-channel-contribution.js';

export function createLocalConfiguredNextAgentApp(options: CreateNextAgentAppOptions = createDefaultProductOptions()): NextAgentApp {
  return runProductCompositionSync(options, localConfiguredAuthSelection()).app;
}

export async function createLocalConfiguredNextAgentAppAsync(
  options: CreateNextAgentAppOptions = createDefaultProductOptions(),
): Promise<NextAgentApp> {
  return (await runProductCompositionAsync(options, localConfiguredAuthSelection())).app;
}
function localConfiguredAuthSelection() {
  return {
    channelAuthProfile: 'LOCAL_CONFIGURED_AUTH' as const,
    frontendHostingProfile: 'NONE' as const,
    localConfiguredAuthContribution: createLocalConfiguredAuthChannelContribution(),
  };
}
