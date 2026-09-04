/** Browser E2E rationale: compare local, immersive and collaborative hosts against one real backend truth. */
import { test } from '@playwright/test';
import { runBrowserCase } from '../../helpers/browser-black-box.js';
test('TC-SI-119', async ({ page }) => runBrowserCase('TC-SI-119', page));
